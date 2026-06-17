import crypto from 'crypto';

export function generateSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function hashPassword(password: string, salt: string): string {
  // Use pbkdf2Sync for secure hashing without native compilation issues
  return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
}

export function verifyPassword(password: string, salt: string, hash: string): boolean {
  const checkHash = hashPassword(password, salt);
  return checkHash === hash;
}

export function generateToken(): string {
  // Generate a cryptographically secure 32-byte API token (64 hex characters)
  return crypto.randomBytes(32).toString('hex');
}
