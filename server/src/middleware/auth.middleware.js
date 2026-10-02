'use strict';

/**
 * User authentication + role authorization (FR-A4).
 *
 * The token is verified locally (stateless), then the user is re-read so a
 * revoked/deleted account or a downgraded role takes effect immediately
 * (threat T17). Device requests never reach this middleware: HMAC credentials
 * cannot authenticate as a user and vice versa.
 */

const { User } = require('../models');
const ApiError = require('../utils/apiError');
const { verifyAccessToken } = require('../services/token.service');

/** Extract a Bearer token from the Authorization header. */
function extractBearer(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (!token || scheme.toLowerCase() !== 'bearer') return null;
  return token;
}

/** Require a valid access token; attaches `req.user`. */
async function authenticate(req, _res, next) {
  try {
    const token = extractBearer(req);
    if (!token) throw ApiError.unauthorized('AUTH_REQUIRED', 'Authentication required');

    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub).select('_id email role name');
    if (!user) throw ApiError.unauthorized('AUTH_USER_MISSING', 'Account no longer exists');

    req.user = user;
    req.authPayload = payload;
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Require one of the given roles.
 * @param {...string} roles allowed roles
 */
function requireRole(...roles) {
  return function requireRoleMiddleware(req, _res, next) {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden('ROLE_FORBIDDEN', 'Your role cannot perform this action'));
    }
    return next();
  };
}

module.exports = { authenticate, requireRole, extractBearer };
