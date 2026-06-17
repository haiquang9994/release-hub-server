import { Request, Response } from 'express';
import { getDb } from '../database';

export async function getDashboardSummary(req: Request, res: Response): Promise<void> {
  try {
    const db = await getDb();

    // 1. Get total releases
    const countResult = await db.get<{ total: number }>('SELECT COUNT(*) AS total FROM releases');
    const totalReleases = countResult?.total || 0;

    // 2. Get distinct apps
    const appsResult = await db.all<{ appName: string }[]>('SELECT DISTINCT appName FROM releases ORDER BY appName ASC');
    const apps = appsResult.map((a) => a.appName);

    // 3. Get distinct platforms
    const platformsResult = await db.all<{ platform: string }[]>('SELECT DISTINCT platform FROM releases');
    const platforms = platformsResult.map((p) => p.platform);

    // 4. Get distinct deployments
    const deploymentsResult = await db.all<{ deploymentName: string }[]>('SELECT DISTINCT deploymentName FROM releases');
    const deployments = deploymentsResult.map((d) => d.deploymentName);

    // 5. Get recent releases
    const recentReleases = await db.all(
      'SELECT * FROM releases ORDER BY id DESC LIMIT 5'
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
