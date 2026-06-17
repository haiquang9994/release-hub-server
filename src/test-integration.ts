import { spawn, execSync, ChildProcess } from 'child_process';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import os from 'os';

const SERVER_DIR = '/Volumes/SSD/www/code-push-clone/server';
const CLI_BIN = '/Volumes/SSD/www/code-push-clone/cli/dist/index.js';
const PORT = 4500;
const SERVER_URL = `http://localhost:${PORT}`;

const TEST_DIR = path.resolve(__dirname, '../test_runtime');
const MOCK_BUNDLE_DIR = path.join(TEST_DIR, 'mock_bundle');
const DOWNLOAD_DEST = path.join(TEST_DIR, 'downloaded.zip');

let serverProcess: ChildProcess | null = null;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startServer(): Promise<void> {
  console.log('Starting ReleaseHub Server...');
  
  const env = {
    ...process.env,
    PORT: PORT.toString()
  };

  serverProcess = spawn('npx', ['ts-node', 'src/index.ts'], {
    cwd: SERVER_DIR,
    env,
    stdio: 'pipe'
  });

  serverProcess.stdout?.on('data', (data) => {
    // console.log(`[Server]: ${data.toString().trim()}`);
  });

  serverProcess.stderr?.on('data', (data) => {
    console.error(`[Server Error]: ${data.toString().trim()}`);
  });

  // Wait for server to be ready
  for (let i = 0; i < 15; i++) {
    try {
      const response = await axios.get(`${SERVER_URL}/health`);
      if (response.data.status === 'ok') {
        console.log('Server is healthy and ready!');
        return;
      }
    } catch {
      await sleep(500);
    }
  }
  throw new Error('Server failed to start');
}

function runCliCommand(args: string[]): string {
  const cmd = `node ${CLI_BIN} ${args.join(' ')}`;
  console.log(`[Running CLI]: ${cmd}`);
  return execSync(cmd, { encoding: 'utf8' });
}

function runCliLoginInteractive(serverUrl: string, token: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [CLI_BIN, 'login'], { stdio: 'pipe' });
    let output = '';
    
    child.stdout.on('data', (data) => {
      const chunk = data.toString();
      output += chunk;
      console.log(`[CLI Login Stdout]:`, chunk);
      
      if (chunk.includes('Enter ReleaseHub server URL')) {
        child.stdin.write(serverUrl + '\n');
      } else if (chunk.includes('Paste your CLI Access Token')) {
        child.stdin.write(token + '\n');
      }
    });
    
    child.stderr.on('data', (data) => {
      console.error('[CLI Login Stderr]:', data.toString());
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`CLI Login failed with code ${code}. Output:\n${output}`));
      }
    });
  });
}

async function runTests() {
  const configPath = path.join(os.homedir(), '.release-hub.json');
  let configBackup: string | null = null;
  
  try {
    // Backup local CLI config if it exists so test is isolated
    if (fs.existsSync(configPath)) {
      configBackup = fs.readFileSync(configPath, 'utf8');
      fs.unlinkSync(configPath);
    }

    // 0. Clean database & runtime directory
    const dbPath = path.resolve(SERVER_DIR, 'database.sqlite');
    if (fs.existsSync(dbPath)) {
      console.log('Deleting existing test database...');
      fs.unlinkSync(dbPath);
    }

    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });
    fs.mkdirSync(MOCK_BUNDLE_DIR, { recursive: true });

    // Create a mock JS bundle and asset files
    fs.writeFileSync(path.join(MOCK_BUNDLE_DIR, 'main.jsbundle'), 'console.log("Mock Hello OTA Update!");', 'utf8');
    fs.mkdirSync(path.join(MOCK_BUNDLE_DIR, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(MOCK_BUNDLE_DIR, 'assets/logo.png'), 'mock_png_content', 'utf8');

    // Start server (it will initialize the DB)
    await startServer();

    // 1. Bootstrap users using create-user.ts script
    console.log('\n--- Bootstrapping Users ---');
    execSync('npx ts-node src/create-user.ts --username admin --password adminpass --role admin', { cwd: SERVER_DIR });
    execSync('npx ts-node src/create-user.ts --username user1 --password user1pass --role user', { cwd: SERVER_DIR });
    execSync('npx ts-node src/create-user.ts --username user2 --password user2pass --role user', { cwd: SERVER_DIR });
    console.log('✓ Users bootstrapped successfully.');

    // Get tokens by logging in via POST /api/login
    console.log('\n--- Logging in users via API ---');
    const adminLogin = await axios.post(`${SERVER_URL}/api/login`, { username: 'admin', password: 'adminpass' });
    const user1Login = await axios.post(`${SERVER_URL}/api/login`, { username: 'user1', password: 'user1pass' });
    const user2Login = await axios.post(`${SERVER_URL}/api/login`, { username: 'user2', password: 'user2pass' });

    const adminToken = adminLogin.data.token;
    const user1Token = user1Login.data.token;
    const user2Token = user2Login.data.token;

    assert(adminToken && user1Token && user2Token, 'Failed to retrieve all user tokens');
    console.log('✓ Retrieved session tokens for admin, user1, user2.');

    // 2. Test interactive login flow
    console.log('\n--- Test 1: Interactive CLI Login (User1) ---');
    const loginResult = await runCliLoginInteractive(SERVER_URL, user1Token);
    assert(loginResult.includes('Success! Logged in as user1'), 'Login message mismatch');
    console.log('✓ Interactive CLI login verified.');

    // 3. User1 deploys MyApp (First release, so User1 owns MyApp)
    console.log('\n--- Test 2: CLI Release (User1 -> MyApp) ---');
    const releaseResult = runCliCommand([
      'release-react',
      '-a', 'MyApp',
      '-p', 'ios',
      '-v', '1.0.0',
      '-e', 'Staging',
      '-d', '"E2E test release v1.0.0"',
      '--bundle-path', MOCK_BUNDLE_DIR
    ]);
    assert(releaseResult.includes('Release deployed successfully'), 'Release message mismatch');
    console.log('✓ Release deployed successfully. User1 is now owner of MyApp.');

    // 4. Public update-check verification (React Native client update checks must remain public)
    console.log('\n--- Test 3: Public SDK Check-Update Request ---');
    const updateCheckUrl = `${SERVER_URL}/api/check-update?appName=MyApp&platform=ios&deploymentName=Staging&appVersion=1.0.0&packageHash=empty`;
    const updateResponse = await axios.get(updateCheckUrl);
    const updateInfo = updateResponse.data.updateInfo;
    assert(updateInfo.update === true, 'Update should be available');
    assert(updateInfo.description === 'E2E test release v1.0.0', 'Release notes mismatch');
    console.log('✓ Public update check succeeded without credentials.');

    // 5. User2 log in and tries to deploy or view MyApp (Forbidden)
    console.log('\n--- Test 4: Permission Check (User2 is Blocked from MyApp) ---');
    await runCliLoginInteractive(SERVER_URL, user2Token);
    
    // User2 tries to view history
    try {
      runCliCommand(['history', '-a', 'MyApp', '-p', 'ios', '-e', 'Staging']);
      assert.fail('User2 should be blocked from viewing MyApp history');
    } catch (err: any) {
      assert(err.message.includes('403') || err.message.includes('Forbidden'), 'Should fail with 403 Forbidden');
      console.log('✓ User2 blocked from viewing MyApp history.');
    }

    // User2 tries to deploy to MyApp
    try {
      runCliCommand([
        'release-react',
        '-a', 'MyApp',
        '-p', 'ios',
        '-v', '1.1.0',
        '-e', 'Staging',
        '-d', '"User2 hijack"',
        '--bundle-path', MOCK_BUNDLE_DIR
      ]);
      assert.fail('User2 should be blocked from deploying to MyApp');
    } catch (err: any) {
      assert(err.message.includes('403') || err.message.includes('Forbidden'), 'Should fail with 403 Forbidden on deploy');
      console.log('✓ User2 blocked from deploying to MyApp.');
    }

    // User2 dashboard summary should be empty
    const u2Dashboard = await axios.get(`${SERVER_URL}/api/dashboard-summary`, {
      headers: { 'Authorization': `Bearer ${user2Token}` }
    });
    assert(u2Dashboard.data.summary.apps.length === 0, 'User2 should see 0 apps in dashboard');
    console.log('✓ User2 dashboard is empty of User1\'s apps.');

    // 6. Admin logs in and updates MyApp (Admin bypass)
    console.log('\n--- Test 5: Admin Permission Bypass (Admin -> MyApp) ---');
    await runCliLoginInteractive(SERVER_URL, adminToken);

    const adminReleaseResult = runCliCommand([
      'release-react',
      '-a', 'MyApp',
      '-p', 'ios',
      '-v', '1.1.0',
      '-e', 'Staging',
      '-d', '"Admin release v1.1.0"',
      '--bundle-path', MOCK_BUNDLE_DIR
    ]);
    assert(adminReleaseResult.includes('Release deployed successfully'), 'Admin deploy failed');
    console.log('✓ Admin successfully bypassed owner restriction and deployed.');

    // Admin should see MyApp in dashboard summary
    const adminDashboard = await axios.get(`${SERVER_URL}/api/dashboard-summary`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(adminDashboard.data.summary.apps.includes('MyApp'), 'Admin dashboard should list MyApp');
    assert(adminDashboard.data.summary.totalReleases === 2, 'Admin dashboard should show 2 releases');
    console.log('✓ Admin dashboard correctly aggregates all app data.');

    // 7. User1 logs back in and checks history (Should see both their own and Admin's releases)
    console.log('\n--- Test 6: Owner Release History Query ---');
    await runCliLoginInteractive(SERVER_URL, user1Token);
    
    const historyResult = runCliCommand([
      'history',
      '-a', 'MyApp',
      '-p', 'ios',
      '-e', 'Staging'
    ]);
    assert(historyResult.includes('E2E test release v1.0.0'), 'Missing User1 release in history');
    assert(historyResult.includes('Admin release v1.1.0'), 'Missing Admin release in history');
    console.log('✓ Owner successfully retrieved history containing both owner and admin updates.');

  } catch (error: any) {
    console.error('Test suite failed:');
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error('Data:', error.response.data);
    } else {
      console.error(error);
    }
    process.exit(1);
  } finally {
    // Cleanup runtime
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
    
    // Restore local CLI config
    if (configBackup !== null) {
      fs.writeFileSync(configPath, configBackup, 'utf8');
    } else if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
  }
}

async function main() {
  try {
    await runTests();
    console.log('\n=====================================');
    console.log('ALL TESTS PASSED SUCCESSFULLY! 🎉');
    console.log('=====================================');
  } catch (e: any) {
    console.error('Test process failed:', e.message);
    process.exit(1);
  } finally {
    if (serverProcess) {
      console.log('Stopping server...');
      serverProcess.kill('SIGTERM');
    }
  }
}

main();
