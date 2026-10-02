'use strict';

/**
 * Wrap an async route handler so rejected promises reach the error middleware.
 * Express 4 does not forward async rejections on its own.
 *
 * @param {Function} fn async (req, res, next) handler
 * @returns {Function} express handler
 */
module.exports = function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
