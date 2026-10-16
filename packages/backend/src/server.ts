/**
 * Server entry point.
 *
 * Loads config (which reads .env), creates the Express app, and starts listening.
 * Handles graceful shutdown on SIGTERM/SIGINT to close DB connections cleanly.
 */

import { createApp } from './app.js';
import { config } from './config.js';
import { closePool } from './db/pool.js';
import { APP_NAME, APP_VERSION } from '@store/shared';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`[${APP_NAME} v${APP_VERSION}] ${config.env} server listening on port ${config.port}`);
});

// Graceful shutdown
async function shutdown(signal: string): Promise<void> {
  console.log(`[server] ${signal} received — shutting down gracefully`);
  server.close(async () => {
    await closePool();
    console.log('[server] shutdown complete');
    process.exit(0);
  });

  // Force exit after 10 s if graceful shutdown stalls
  setTimeout(() => {
    console.error('[server] forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT',  () => { void shutdown('SIGINT'); });
