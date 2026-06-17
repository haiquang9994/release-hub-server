import { spawn, execSync, ChildProcess } from 'child_process';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import assert from 'assert';

const SERVER_DIR = '/Volumes/SSD/www/code-push-clone/server';
const CLI_BIN = '/Volumes/SSD/www/code-push-clone/cli/dist/index.js';
const PORT = 4500;
const SERVER_URL = `http://localhost:${PORT}`;
const API_KEY = 'test-secret-key-123';

const TEST_DIR = path.resolve(__dirname, '../test_runtime');
const MOCK_BUNDLE_DIR = path.join(TEST_DIR, 'mock_bundle');
const DOWNLOAD_DEST = path.join(TEST_DIR, 'downloaded.zip');

let serverProcess: ChildProcess | null = null;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startServer(): Promise<void> {
  console.log('Starting ReleaseHub Server...');
  
  // Setup environment variables for test server
  const env = {
    ...process.env,
    PORT: PORT.toString(),
    API_KEY: API_KEY
  };

  serverProcess = spawn('npx', ['ts-node', 'src/index.ts'], {
    cwd: SERVER_DIR,
    env,
    stdio: 'pipe'
  });

  serverProcess.stdout?.on('data', (data) => {
    console.log(`[Server]: ${data.toString().trim()}`);
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

async function runTests() {
  try {
    // 0. Setup directories
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });
    fs.mkdirSync(MOCK_BUNDLE_DIR, { recursive: true });

    // Create a mock JS bundle and asset files
    fs.writeFileSync(path.join(MOCK_BUNDLE_DIR, 'main.jsbundle'), 'console.log("Mock Hello OTA Update!");', 'utf8');
    fs.mkdirSync(path.join(MOCK_BUNDLE_DIR, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(MOCK_BUNDLE_DIR, 'assets/logo.png'), 'mock_png_content', 'utf8');

    // 1. Configure the CLI
    console.log('\n--- Test 1: CLI Login ---');
    const loginResult = runCliCommand(['login', '--server', SERVER_URL, '--token', API_KEY]);
    assert(loginResult.includes('Successfully configured'), 'Login message mismatch');
    console.log('✓ CLI configured successfully.');

    // 2. Release a bundle using prebuilt bundle path
    console.log('\n--- Test 2: CLI Release (Staging) ---');
    const releaseResult = runCliCommand([
      'release-react',
      '-a', 'MyApp',
      '-p', 'ios',
      '-v', '1.0.0',
      '-e', 'Staging',
      '-d', '"E2E testing release notes"',
      '-m', // mandatory
      '--bundle-path', MOCK_BUNDLE_DIR
    ]);
    console.log(releaseResult);
    assert(releaseResult.includes('Release deployed successfully'), 'Release message mismatch');
    console.log('✓ Release uploaded successfully via CLI.');

    // 3. Query check-update as the SDK would
    console.log('\n--- Test 3: SDK Check-Update Request ---');
    const updateCheckUrl = `${SERVER_URL}/api/check-update?appName=MyApp&platform=ios&deploymentName=Staging&appVersion=1.0.0&packageHash=empty`;
    console.log(`Checking update at: ${updateCheckUrl}`);
    
    const updateResponse = await axios.get(updateCheckUrl);
    const updateInfo = updateResponse.data.updateInfo;
    
    console.log('Update Info response:', JSON.stringify(updateInfo, null, 2));
    assert(updateInfo.update === true, 'Should indicate update is available');
    assert(updateInfo.isMandatory === true, 'Update should be mandatory');
    assert(updateInfo.description === 'E2E testing release notes', 'Description should match');
    assert(typeof updateInfo.packageHash === 'string' && updateInfo.packageHash.length > 0, 'Should return a package hash');
    assert(updateInfo.downloadUrl.startsWith(SERVER_URL), 'Download URL should point to our server');
    console.log('✓ SDK check-update response structure verified.');

    // 4. Download and verify the ZIP package
    console.log('\n--- Test 4: Download ZIP Bundle ---');
    console.log(`Downloading zip from: ${updateInfo.downloadUrl}`);
    const downloadResponse = await axios({
      method: 'get',
      url: updateInfo.downloadUrl,
      responseType: 'stream'
    });
    
    const writer = fs.createWriteStream(DOWNLOAD_DEST);
    downloadResponse.data.pipe(writer);
    
    await new Promise<void>((resolve, reject) => {
      writer.on('finish', () => resolve());
      writer.on('error', reject);
    });
    
    assert(fs.existsSync(DOWNLOAD_DEST), 'Zip package should be downloaded');
    assert(fs.statSync(DOWNLOAD_DEST).size > 0, 'Zip package should not be empty');
    console.log('✓ Downloaded bundle zip file successfully.');

    // 5. Query Release History via CLI
    console.log('\n--- Test 5: CLI Release History ---');
    const historyResult = runCliCommand([
      'history',
      '-a', 'MyApp',
      '-p', 'ios',
      '-e', 'Staging'
    ]);
    console.log(historyResult);
    assert(historyResult.includes('E2E testing release notes'), 'History should print release notes');
    assert(historyResult.includes('1.0.0'), 'History should print app version');
    assert(historyResult.includes('Yes'), 'History should print mandatory status');
    console.log('✓ CLI History query successfully verified.');

    // 6. Check update with current hash
    console.log('\n--- Test 6: SDK Check-Update with Latest Hash (Up to date) ---');
    const sameHashCheckUrl = `${SERVER_URL}/api/check-update?appName=MyApp&platform=ios&deploymentName=Staging&appVersion=1.0.0&packageHash=${updateInfo.packageHash}`;
    const sameHashResponse = await axios.get(sameHashCheckUrl);
    console.log('Same Hash response:', JSON.stringify(sameHashResponse.data, null, 2));
    assert(sameHashResponse.data.updateInfo.update === false, 'Should show no update is available when hashes match');
    console.log('✓ SDK check-update verified up-to-date case.');

    // 7. Check dashboard summary API
    console.log('\n--- Test 7: Dashboard Summary API Request ---');
    const dashboardResponse = await axios.get(`${SERVER_URL}/api/dashboard-summary`);
    const summary = dashboardResponse.data.summary;
    console.log('Dashboard Summary response:', JSON.stringify(summary, null, 2));
    assert(summary.totalReleases > 0, 'Should return non-zero total releases');
    assert(summary.apps.includes('MyApp'), 'Apps list should contain MyApp');
    assert(summary.platforms.includes('ios'), 'Platforms list should contain ios');
    assert(summary.deployments.includes('Staging'), 'Deployments list should contain Staging');
    console.log('✓ Dashboard summary API response verified.');

  } catch (error: any) {
    console.error('Test suite failed:');
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error('Data:', error.response.data);
    } else {
      console.error(error.message || error);
    }
    process.exit(1);
  } finally {
    // Cleanup
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  }
}

async function main() {
  try {
    await startServer();
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
