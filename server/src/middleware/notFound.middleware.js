'use strict';

const ApiError = require('../utils/apiError');

/** Terminal 404 handler for unmatched routes. */
function notFound(req, _res, next) {
  next(ApiError.notFound('ROUTE_NOT_FOUND', `Route ${req.method} ${req.originalUrl} not found`));
}

module.exports = notFound;
