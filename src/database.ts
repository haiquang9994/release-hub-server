import { open, Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import { generateSalt, hashPassword, generateToken } from './utils/auth';

let dbInstance: Database | null = null;

export interface User {
  id: number;
  username: string;
  passwordHash: string;
  salt: string;
  role: 'admin' | 'user';
  createdAt: string;
}

export interface Release {
  id?: number;
  appName: string;
  platform: 'ios' | 'android';
  deploymentName: 'Staging' | 'Production';
  appVersion: string; // e.g. "1.0.0" or semver range "^1.0.0"
  packageHash: string; // SHA256 of zip
  downloadPath: string; // path to ZIP file relative to server url
  description: string; // release notes
  isMandatory: number; // 0 or 1
  size: number; // bytes
  userId?: number | null; // ID of user who uploaded
  createdAt?: string; // ISO string
}

export async function getDb(): Promise<Database> {
  if (dbInstance) {
    return dbInstance;
  }

  // Allow overriding data directory via env (used for Docker volume mounting)
  const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '..');
  const dbPath = path.join(DATA_DIR, 'database.sqlite');
  
  dbInstance = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  return dbInstance;
}

export async function initDb(): Promise<void> {
  const db = await getDb();
  
  // 1. Create releases table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS releases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      appName TEXT NOT NULL,
      platform TEXT NOT NULL,
      deploymentName TEXT NOT NULL,
      appVersion TEXT NOT NULL,
      packageHash TEXT NOT NULL,
      downloadPath TEXT NOT NULL,
      description TEXT,
      isMandatory INTEGER NOT NULL DEFAULT 0,
      size INTEGER NOT NULL,
      userId INTEGER,
      createdAt TEXT NOT NULL
    )
  `);

  // Create an index for faster lookups
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_releases_query 
    ON releases (appName, platform, deploymentName)
  `);

  // 2. Create users table (without legacy token column)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      passwordHash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      createdAt TEXT NOT NULL
    )
  `);

  // Migration: drop legacy token column from users table if it still exists
  try {
    const cols = await db.all<{ name: string }[]>(`PRAGMA table_info(users)`);
    const hasToken = (cols as any[]).some((c: any) => c.name === 'token');
    if (hasToken) {
      await db.exec(`ALTER TABLE users DROP COLUMN token`);
      console.log('[DB Migration] Dropped legacy token column from users table.');
    }
  } catch {
    // Older SQLite doesn't support DROP COLUMN — silently ignore
  }

  // 3. Create user_apps table for permissions mapping
  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_apps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      appName TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(userId, appName)
    )
  `);

  // 4. Create user_tokens table for dynamically generated CLI tokens
  await db.exec(`
    CREATE TABLE IF NOT EXISTS user_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL DEFAULT 'cli',
      createdAt TEXT NOT NULL,
      lastUsedAt TEXT,
      FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
}

// User-related DB Helpers
export async function createUser(username: string, password: string, role: 'admin' | 'user'): Promise<number> {
  const db = await getDb();
  const salt = generateSalt();
  const passwordHash = hashPassword(password, salt);
  const createdAt = new Date().toISOString();

  const result = await db.run(
    `INSERT INTO users (username, passwordHash, salt, role, createdAt)
     VALUES (?, ?, ?, ?, ?)`,
    [username.trim().toLowerCase(), passwordHash, salt, role, createdAt]
  );

  return result.lastID!;
}

export async function getUserByToken(token: string): Promise<(User & { tokenId: number }) | null> {
  const db = await getDb();
  const row = await db.get<User & { tokenId: number }>(
    `SELECT u.*, ut.id AS tokenId FROM users u
     INNER JOIN user_tokens ut ON u.id = ut.userId
     WHERE ut.token = ?`,
    [token]
  );
  if (row) {
    // Stamp last used time (fire-and-forget)
    db.run('UPDATE user_tokens SET lastUsedAt = ? WHERE token = ?', [
      new Date().toISOString(), token
    ]).catch(() => {});
  }
  return row || null;
}

export async function createUserToken(userId: number, type: 'web' | 'cli' = 'cli'): Promise<string> {
  const db = await getDb();
  const token = generateToken();
  const createdAt = new Date().toISOString();
  await db.run(
    `INSERT INTO user_tokens (userId, token, type, createdAt) VALUES (?, ?, ?, ?)`,
    [userId, token, type, createdAt]
  );
  return token;
}

export async function getUserTokens(userId: number): Promise<{ id: number, token: string, type: string, createdAt: string, lastUsedAt: string | null }[]> {
  const db = await getDb();
  return db.all('SELECT id, token, type, createdAt, lastUsedAt FROM user_tokens WHERE userId = ? ORDER BY createdAt DESC', [userId]);
}

export async function deleteUserToken(userId: number, tokenId: number): Promise<boolean> {
  const db = await getDb();
  const result = await db.run('DELETE FROM user_tokens WHERE id = ? AND userId = ?', [tokenId, userId]);
  return (result.changes || 0) > 0;
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const db = await getDb();
  const user = await db.get<User>('SELECT * FROM users WHERE username = ?', [username.trim().toLowerCase()]);
  return user || null;
}

export async function deleteUser(username: string): Promise<boolean> {
  const db = await getDb();
  const user = await getUserByUsername(username);
  if (!user) {
    return false;
  }
  
  // Clean up user app permissions mapping
  await db.run('DELETE FROM user_apps WHERE userId = ?', [user.id]);
  
  // Set userId to NULL in releases so release history is preserved
  await db.run('UPDATE releases SET userId = NULL WHERE userId = ?', [user.id]);

  // Delete the user
  const result = await db.run('DELETE FROM users WHERE id = ?', [user.id]);
  return (result.changes || 0) > 0;
}

// App Permission Helpers
export async function isUserAuthorizedForApp(userId: number, appName: string): Promise<boolean> {
  const db = await getDb();
  
  // 1. Get user details
  const user = await db.get<{ role: string }>('SELECT role FROM users WHERE id = ?', [userId]);
  if (!user) return false;
  
  // Admin is authorized for all apps
  if (user.role === 'admin') return true;

  // 2. Check if app has releases yet (if it doesn't, first user to deploy becomes owner/authorized)
  const releasesCount = await db.get<{ count: number }>(
    'SELECT COUNT(*) as count FROM releases WHERE appName = ?',
    [appName.trim()]
  );
  
  if (!releasesCount || releasesCount.count === 0) {
    // No releases exist, so this user is allowed to start it (and will be mapped)
    return true;
  }

  // 3. Check if mapping exists
  const mapping = await db.get(
    'SELECT id FROM user_apps WHERE userId = ? AND appName = ?',
    [userId, appName.trim()]
  );

  return !!mapping;
}

export async function authorizeUserForApp(userId: number, appName: string): Promise<void> {
  const db = await getDb();
  const createdAt = new Date().toISOString();
  await db.run(
    `INSERT OR IGNORE INTO user_apps (userId, appName, createdAt) VALUES (?, ?, ?)`,
    [userId, appName.trim(), createdAt]
  );
}

export async function getUserAuthorizedApps(userId: number, role: 'admin' | 'user'): Promise<string[]> {
  const db = await getDb();

  if (role === 'admin') {
    // Admin sees all apps that have at least one release
    const result = await db.all<{ appName: string }[]>('SELECT DISTINCT appName FROM releases ORDER BY appName ASC');
    return result.map(r => r.appName);
  }

  // Regular user sees apps they are mapped to
  const result = await db.all<{ appName: string }[]>(
    'SELECT appName FROM user_apps WHERE userId = ? ORDER BY appName ASC',
    [userId]
  );
  return result.map(r => r.appName);
}

// Releases DB Helpers
export async function insertRelease(release: Release): Promise<number> {
  const db = await getDb();
  const createdAt = new Date().toISOString();
  
  const result = await db.run(
    `INSERT INTO releases (
      appName, platform, deploymentName, appVersion, packageHash, 
      downloadPath, description, isMandatory, size, userId, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      release.appName.trim(),
      release.platform,
      release.deploymentName,
      release.appVersion.trim(),
      release.packageHash.trim(),
      release.downloadPath,
      release.description || '',
      release.isMandatory ? 1 : 0,
      release.size,
      release.userId || null,
      createdAt
    ]
  );
  
  return result.lastID!;
}

export async function getReleases(
  appName: string,
  platform: 'ios' | 'android',
  deploymentName: 'Staging' | 'Production'
): Promise<Release[]> {
  const db = await getDb();
  return db.all<Release[]>(
    `SELECT * FROM releases 
     WHERE appName = ? AND platform = ? AND deploymentName = ?
     ORDER BY id DESC`,
    [appName.trim(), platform, deploymentName]
  );
}
