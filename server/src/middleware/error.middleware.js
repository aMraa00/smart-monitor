'use strict';

/**
 * Terminal error handler.
 *
 * Converts every failure into the uniform envelope:
 *   { success:false, error:{ code, message, details? } }
 *
 * Only operational (ApiError) messages are exposed; internal errors are logged
 * with a request id and answered with a generic message so no stack, query or
 * secret ever reaches a client (threat T19).
 */

const { ZodError } = require('zod');
const mongoose = require('mongoose');
const ApiError = require('../utils/apiError');
const logger = require('../config/logger');
const config = require('../config');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Internal server error';
  let details;

  if (err instanceof ApiError) {
    status = err.status;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof ZodError) {
    status = 422;
    code = 'VALIDATION_ERROR';
    message = 'Request validation failed';
    details = err.issues.map((issue) => ({
      path: issue.path.join('.') || '(root)',
      message: issue.message,
    }));
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 422;
    code = 'VALIDATION_ERROR';
    message = 'Data validation failed';
    details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    code = 'BAD_IDENTIFIER';
    message = 'Malformed identifier in request';
  } else if (err && err.code === 11000) {
    status = 409;
    code = 'DUPLICATE_KEY';
    message = 'Resource already exists';
    details = err.keyValue;
  } else if (err && err.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body exceeds the allowed size';
  } else if (err && err.type === 'entity.parse.failed') {
    status = 400;
    code = 'BAD_JSON';
    message = 'Request body is not valid JSON';
  }

  if (status >= 500) {
    logger.error(
      { err: { message: err.message, stack: config.isProd ? undefined : err.stack }, requestId: req.id },
      'unhandled error'
    );
    if (config.isProd) message = 'Internal server error';
  } else {
    logger.warn(
      { code, status, path: req.originalUrl, requestId: req.id },
      'request rejected'
    );
  }

  return res.status(status).json({
    success: false,
    error: { code, message, ...(details ? { details } : {}) },
    requestId: req.id,
  });
}

module.exports = errorHandler;
