/**
 * Health-check endpoint: GET /health
 *
 * Returns the application status and basic service availability.
 * Does NOT require authentication — it is safe to expose publicly.
 * Does NOT include any sensitive information (no DB URL, no config, no secrets).
 */

import { Router, Request, Response, IRouter } from 'express';
import { checkDatabaseHealth } from '../db/pool.js';
import { APP_VERSION } from '@store/shared';
import type { ApiSuccess, HealthCheckData } from '@store/shared';

export const healthRouter: IRouter = Router();

healthRouter.get('/', async (_req: Request, res: Response) => {
  const dbStatus = await checkDatabaseHealth();

  const data: HealthCheckData = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: APP_VERSION,
    services: {
      database: dbStatus,
    },
  };

  const body: ApiSuccess<HealthCheckData> = { ok: true, data };

  // Return 200 even if database is degraded — the caller can inspect services
  // A 5xx here would cause load-balancers to stop sending traffic prematurely
  res.status(200).json(body);
});
