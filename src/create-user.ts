import { initDb, createUser, getUserByUsername } from './database';

function printUsage() {
  console.log('\nUsage:');
  console.log('  npm run create-user -- --username <username> --password <password> --role <admin|user>\n');
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  
  const usernameIndex = args.indexOf('--username');
  const passwordIndex = args.indexOf('--password');
  const roleIndex = args.indexOf('--role');

  if (usernameIndex === -1 || passwordIndex === -1 || roleIndex === -1) {
    console.error('Error: Missing required arguments.');
    printUsage();
  }

  const username = args[usernameIndex + 1];
  const password = args[passwordIndex + 1];
  const role = args[roleIndex + 1] as 'admin' | 'user';

  if (!username || !password || !role) {
    console.error('Error: Arguments values cannot be empty.');
    printUsage();
  }

  if (role !== 'admin' && role !== 'user') {
    console.error("Error: Role must be either 'admin' or 'user'.");
    printUsage();
  }

  try {
    await initDb();
    
    // Check if user already exists
    const existingUser = await getUserByUsername(username);
    if (existingUser) {
      console.error(`Error: User with username '${username}' already exists.`);
      process.exit(1);
    }

    const userId = await createUser(username, password, role);
    console.log(`\nSuccess! User created successfully.`);
    console.log(`  ID:       ${userId}`);
    console.log(`  Username: ${username.toLowerCase()}`);
    console.log(`  Role:     ${role}`);
    
    process.exit(0);
  } catch (err: any) {
    console.error('Failed to create user:', err.message || err);
    process.exit(1);
  }
}

main();
