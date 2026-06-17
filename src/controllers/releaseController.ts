import { Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import semver from 'semver';
import { getReleases, insertRelease, Release } from '../database';

// Helper to calculate SHA256 hash of a file
function calculateFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}

export async function deployRelease(req: Request, res: Response): Promise<void> {
  try {
    const { appName, platform, deploymentName, appVersion, description, isMandatory } = req.body;
    const file = req.file;

    if (!appName || !platform || !deploymentName || !appVersion || !file) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    if (platform !== 'ios' && platform !== 'android') {
      res.status(400).json({ error: 'Platform must be ios or android' });
      return;
    }

    if (deploymentName !== 'Staging' && deploymentName !== 'Production') {
      res.status(400).json({ error: 'DeploymentName must be Staging or Production' });
      return;
    }

    // Verify semver target
    if (!semver.validRange(appVersion)) {
      res.status(400).json({ error: 'Target appVersion must be a valid semver expression (e.g. 1.0.0, ^1.0.0)' });
      return;
    }

    // Calculate file hash (to ensure uniqueness and integrity)
    const packageHash = await calculateFileHash(file.path);
    
    // Rename file to its hash to prevent duplicate storage and keep a clean naming scheme
    const uploadDir = path.dirname(file.path);
    const newFileName = `${packageHash}.zip`;
    const newFilePath = path.join(uploadDir, newFileName);

    if (fs.existsSync(newFilePath)) {
      // Clean up the temp file if the bundle already exists
      fs.unlinkSync(file.path);
    } else {
      fs.renameSync(file.path, newFilePath);
    }

    const releaseData: Release = {
      appName: appName.trim(),
      platform: platform as 'ios' | 'android',
      deploymentName: deploymentName as 'Staging' | 'Production',
      appVersion: appVersion.trim(),
      packageHash,
      downloadPath: `/uploads/${newFileName}`,
      description: description || '',
      isMandatory: isMandatory === 'true' || isMandatory === '1' || isMandatory === true ? 1 : 0,
      size: file.size
    };

    const id = await insertRelease(releaseData);

    res.status(201).json({
      message: 'Release deployed successfully',
      release: {
        id,
        ...releaseData
      }
    });
  } catch (error: any) {
    console.error('Deployment error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

export async function checkUpdate(req: Request, res: Response): Promise<void> {
  try {
    const { appName, platform, deploymentName, appVersion, packageHash } = req.query;

    if (!appName || !platform || !deploymentName || !appVersion) {
      res.status(400).json({ error: 'Missing required query parameters' });
      return;
    }

    const clientAppVersion = String(appVersion).trim();
    const clientPackageHash = packageHash ? String(packageHash).trim() : '';

    // Validate client version is a valid semver
    if (!semver.valid(clientAppVersion)) {
      res.status(400).json({ error: 'Client appVersion must be a valid semver string (e.g. 1.0.0)' });
      return;
    }

    // Fetch releases for this app, platform, and deployment
    const releases = await getReleases(
      String(appName),
      platform as 'ios' | 'android',
      deploymentName as 'Staging' | 'Production'
    );

    // Find the latest release that satisfies the app's binary version
    let matchedRelease: Release | null = null;
    for (const release of releases) {
      try {
        if (semver.satisfies(clientAppVersion, release.appVersion)) {
          matchedRelease = release;
          break; // Since list is sorted DESC by ID, this is the latest release
        }
      } catch (err) {
        // Fallback to exact match if semver evaluation fails
        if (release.appVersion === clientAppVersion) {
          matchedRelease = release;
          break;
        }
      }
    }

    if (!matchedRelease) {
      res.json({ updateInfo: { update: false } });
      return;
    }

    // If the client's current hash matches the matched release hash, it's already up to date
    if (clientPackageHash === matchedRelease.packageHash) {
      res.json({ updateInfo: { update: false } });
      return;
    }

    // Build absolute download URL
    const protocol = req.protocol;
    const host = req.get('host');
    const downloadUrl = `${protocol}://${host}${matchedRelease.downloadPath}`;

    res.json({
      updateInfo: {
        update: true,
        downloadUrl,
        packageHash: matchedRelease.packageHash,
        isMandatory: matchedRelease.isMandatory === 1,
        description: matchedRelease.description,
        appVersion: matchedRelease.appVersion,
        packageSize: matchedRelease.size
      }
    });
  } catch (error: any) {
    console.error('Check update error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

export async function listReleases(req: Request, res: Response): Promise<void> {
  try {
    const { appName, platform, deploymentName } = req.query;
    if (!appName || !platform || !deploymentName) {
      res.status(400).json({ error: 'Missing parameters' });
      return;
    }

    const releases = await getReleases(
      String(appName),
      platform as 'ios' | 'android',
      deploymentName as 'Staging' | 'Production'
    );

    res.json({ releases });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
