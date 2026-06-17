import { initDb, deleteUser, getUserByUsername } from './database';

function printUsage() {
  console.log('\nUsage:');
  console.log('  npm run delete-user -- --username <username>\n');
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  
  const usernameIndex = args.indexOf('--username');

  if (usernameIndex === -1) {
    console.error('Error: Missing required argument --username.');
    printUsage();
  }

  const username = args[usernameIndex + 1];

  if (!username) {
    console.error('Error: Username value cannot be empty.');
    printUsage();
  }

  try {
    await initDb();
    
    // Check if user exists
    const existingUser = await getUserByUsername(username);
    if (!existingUser) {
      console.error(`Error: User with username '${username}' does not exist.`);
      process.exit(1);
    }

    const success = await deleteUser(username);
    if (success) {
      console.log(`\nSuccess! User '${username.toLowerCase()}' deleted successfully.`);
      process.exit(0);
    } else {
      console.error(`Error: Failed to delete user '${username}'.`);
      process.exit(1);
    }
  } catch (err: any) {
    console.error('Failed to delete user:', err.message || err);
    process.exit(1);
  }
}

main();
