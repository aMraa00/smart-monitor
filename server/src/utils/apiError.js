'use strict';

/**
 * Operational error type carrying an HTTP status and a stable machine code.
 * Only ApiError instances expose their message to clients; anything else is
 * reported as a generic 500 (see middleware/error.middleware.js).
 */
class ApiError extends Error {
  /**
   * @param {number} status  HTTP status code
   * @param {string} code    stable machine-readable code, e.g. 'AUTH_INVALID'
   * @param {string} message human readable message
   * @param {object} [details] optional extra structured details
   */
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, ApiError);
  }

  static badRequest(code, message, details) {
    return new ApiError(400, code, message, details);
  }

  static unauthorized(code = 'AUTH_REQUIRED', message = 'Authentication required') {
    return new ApiError(401, code, message);
  }

  static forbidden(code = 'FORBIDDEN', message = 'Not allowed') {
    return new ApiError(403, code, message);
  }

  static notFound(code = 'NOT_FOUND', message = 'Resource not found') {
    return new ApiError(404, code, message);
  }

  static conflict(code, message, details) {
    return new ApiError(409, code, message, details);
  }

  static validation(message, details) {
    return new ApiError(422, 'VALIDATION_ERROR', message, details);
  }

  static tooMany(message = 'Too many requests') {
    return new ApiError(429, 'RATE_LIMITED', message);
  }

  static internal(message = 'Internal server error') {
    return new ApiError(500, 'INTERNAL_ERROR', message);
  }
}

module.exports = ApiError;
