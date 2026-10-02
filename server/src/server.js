'use strict';

/**
 * Process entry point: connect the database, sync indexes, ensure the first
 * privileged accounts exist, start HTTP + WS, and shut down gracefully.
 */

const http = require('http');
const config = require('./config');
const logger = require('./config/logger');
const db = require('./config/db');
const { syncIndexes } = require('./models');
const authService = require('./services/auth.service');
const createApp = require('./app');
const { createSocketServer } = require('./socket');

async function main() {
  // ---- database -------------------------------------------------------------
  await db.connect();
  await syncIndexes();

  // ---- bootstrap accounts ---------------------------------------------------
  // Self-registration can only create an `owner`, so without this a fresh
  // deployment would have nobody able to create the first admin. Idempotent.
  const bootstrapped = await authService.ensureBootstrapAccounts();
  for (const account of bootstrapped) {
    logger.info({ ...account }, 'bootstrap account ensured');
  }

  // ---- CORS allow-list sanity check ----------------------------------------
  // With no CLIENT_URL every browser request is rejected, which surfaces only
  // as "blocked by CORS policy" in the browser. Fail loudly at boot instead.
  if (config.clientUrls.length === 0) {
    logger.warn(
      { env: config.env },
      'CLIENT_URL is not set - every browser origin will be blocked by CORS. Set it to your web app origin (e.g. https://your-app.vercel.app)'
    );
  } else {
    logger.info({ clientUrls: config.clientUrls }, 'cors allow-list ready');
  }

  // ---- http + realtime ------------------------------------------------------
  const app = createApp();
  const server = http.createServer(app);
  createSocketServer(server);

  await new Promise((resolve) => {
    server.listen(config.port, () => {
      logger.info(
        { port: config.port, env: config.env, apiPrefix: config.apiPrefix },
        'smart_monitor_v1 API listening'
      );
      resolve();
    });
  });

  // ---- graceful shutdown ----------------------------------------------------
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    server.close(async () => {
      await db.disconnect();
      logger.info('shutdown complete');
      process.exit(0);
    });

    // Failsafe: never hang forever on open sockets.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  ['SIGINT', 'SIGTERM'].forEach((signal) => {
    process.on(signal, () => shutdown(signal));
  });

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason: reason && reason.message }, 'unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err: err.message, stack: err.stack }, 'uncaught exception');
    process.exit(1);
  });

  return server;
}

if (require.main === module) {
  main().catch((err) => {
    logger.fatal({ err: err.message, stack: err.stack }, 'failed to start server');
    process.exit(1);
  });
}

module.exports = main;
