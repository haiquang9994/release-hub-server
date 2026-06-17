import { open, Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';

let dbInstance: Database | null = null;

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
  createdAt?: string; // ISO string
}

export async function getDb(): Promise<Database> {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = path.resolve(__dirname, '../../database.sqlite');
  
  dbInstance = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  return dbInstance;
}

export async function initDb(): Promise<void> {
  const db = await getDb();
  
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
      createdAt TEXT NOT NULL
    )
  `);

  // Create an index for faster lookups
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_releases_query 
    ON releases (appName, platform, deploymentName)
  `);
}

export async function insertRelease(release: Release): Promise<number> {
  const db = await getDb();
  const createdAt = new Date().toISOString();
  
  const result = await db.run(
    `INSERT INTO releases (
      appName, platform, deploymentName, appVersion, packageHash, 
      downloadPath, description, isMandatory, size, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
