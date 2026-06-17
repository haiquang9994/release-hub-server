import { Request, Response } from 'express';
import { getDb, getUserAuthorizedApps } from '../database';

export async function getDashboardSummary(req: Request, res: Response): Promise<void> {
  try {
    const db = await getDb();
    const user = (req as any).user;

    if (!user) {
      res.status(401).json({ error: 'Unauthorized: User context missing' });
      return;
    }

    // Get authorized apps for this user
    const authorizedApps = await getUserAuthorizedApps(user.id, user.role);

    if (authorizedApps.length === 0) {
      res.json({
        summary: {
          totalReleases: 0,
          apps: [],
          platforms: [],
          deployments: [],
          recentReleases: []
        }
      });
      return;
    }

    const placeholders = authorizedApps.map(() => '?').join(',');

    // 1. Get total releases
    const countResult = await db.get<{ total: number }>(
      `SELECT COUNT(*) AS total FROM releases WHERE appName IN (${placeholders})`,
      authorizedApps
    );
    const totalReleases = countResult?.total || 0;

    // 2. Get distinct apps (that actually have releases)
    const appsResult = await db.all<{ appName: string }[]>(
      `SELECT DISTINCT appName FROM releases WHERE appName IN (${placeholders}) ORDER BY appName ASC`,
      authorizedApps
    );
    const apps = appsResult.map((a) => a.appName);

    // 3. Get distinct platforms
    const platformsResult = await db.all<{ platform: string }[]>(
      `SELECT DISTINCT platform FROM releases WHERE appName IN (${placeholders})`,
      authorizedApps
    );
    const platforms = platformsResult.map((p) => p.platform);

    // 4. Get distinct deployments
    const deploymentsResult = await db.all<{ deploymentName: string }[]>(
      `SELECT DISTINCT deploymentName FROM releases WHERE appName IN (${placeholders})`,
      authorizedApps
    );
    const deployments = deploymentsResult.map((d) => d.deploymentName);

    // 5. Get recent releases
    const recentReleases = await db.all(
      `SELECT * FROM releases WHERE appName IN (${placeholders}) ORDER BY id DESC LIMIT 5`,
      authorizedApps
    );

    res.json({
      summary: {
        totalReleases,
        apps,
        platforms,
        deployments,
        recentReleases
      }
    });
  } catch (error: any) {
    console.error('Failed to load dashboard summary:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
