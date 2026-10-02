'use strict';

/**
 * Express application assembly.
 *
 * Kept separate from server.js so tests can mount the app without binding a
 * port. Middleware order is security-significant:
 *
 *   security headers -> CORS -> rate limit (in routes) -> body (WITH rawBody)
 *   -> logging -> routes -> 404 -> error envelope
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const pinoHttp = require('pino-http');
const { randomUUID } = require('crypto');

const config = require('./config');
const logger = require('./config/logger');
const apiRoutes = require('./routes');
const notFound = require('./middleware/notFound.middleware');
const errorHandler = require('./middleware/error.middleware');

function createApp() {
  const app = express();

  // Trust the reverse proxy so req.ip reflects the real client (rate limiting).
  app.set('trust proxy', 1);

  // ---- security headers -----------------------------------------------------
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false, // the API serves JSON only; the web app sets its own CSP
    })
  );

  // ---- CORS -----------------------------------------------------------------
  // The browser sends the request Origin and the API answers with exactly that
  // origin. A missing CLIENT_URL is not a silent pass/fail - it is reported at
  // boot (see server.js) and logged per rejected origin, because a CORS block
  // with no ACAO header is otherwise very hard to diagnose from the browser.
  app.use(
    cors({
      origin(origin, callback) {
        // Allow same-origin/non-browser clients (devices send no Origin header).
        if (!origin) return callback(null, true);
        if (config.clientUrls.includes(origin)) return callback(null, true);

        logger.warn(
          { origin, allowed: config.clientUrls },
          'cors rejected origin - add it to CLIENT_URL'
        );
        return callback(null, false);
      },
      credentials: true,
    })
  );

  // ---- body parsing (rawBody is REQUIRED for HMAC verification) -------------
  app.use(
    express.json({
      limit: '256kb',
      verify(req, _res, buf) {
        // Preserve the exact bytes the device signed.
        req.rawBody = buf;
      },
    })
  );
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));

  // ---- request logging with a correlation id --------------------------------
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.get('x-request-id') || randomUUID(),
      autoLogging: {
        ignore: (req) => req.url === `${config.apiPrefix}/health`,
      },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    })
  );

  // Make the correlation id visible to error responses.
  app.use((req, _res, next) => {
    req.id = req.id || randomUUID();
    next();
  });

  // ---- routes ----------------------------------------------------------------
  app.get('/', (_req, res) => {
    res.json({
      success: true,
      data: {
        name: 'smart_monitor_v1 API',
        version: '1.0.0',
        docs: '/api/v1/health',
      },
    });
  });

  app.use(config.apiPrefix, apiRoutes);

  // ---- terminal handlers -----------------------------------------------------
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
