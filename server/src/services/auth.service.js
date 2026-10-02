'use strict';

/**
 * Account lifecycle: register, login, refresh, logout (FR-A).
 * All brute-force protection lives here (threat T5).
 */

const { User } = require('../models');
const ApiError = require('../utils/apiError');
const tokenService = require('./token.service');

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

/** Issue the {accessToken, refreshToken} pair for a user. */
async function issueSession(user, ctx = {}) {
  const accessToken = tokenService.signAccessToken(user);
  const refreshToken = await tokenService.issueRefreshToken(user, ctx);
  return { accessToken, refreshToken };
}

/**
 * Create a new account.
 * @returns {Promise<{user:object, accessToken:string, refreshToken:string}>}
 */
async function register({ email, password, name }, ctx = {}) {
  const normalised = String(email).trim().toLowerCase();

  const existing = await User.findOne({ email: normalised }).lean();
  if (existing) {
    // Generic-ish message: does not confirm anything beyond the duplicate itself.
    throw ApiError.conflict('AUTH_EMAIL_TAKEN', 'An account with this email already exists');
  }

  const passwordHash = await User.hashPassword(password);
  const user = await User.create({
    email: normalised,
    passwordHash,
    name: name || '',
    role: 'owner', // role is never taken from client input (threat T17)
  });

  const session = await issueSession(user, ctx);
  return { user: user.toPublicJSON(), ...session };
}

/**
 * Authenticate with email + password, applying lockout.
 * @returns {Promise<{user:object, accessToken:string, refreshToken:string}>}
 */
async function login({ email, password }, ctx = {}) {
  const normalised = String(email).trim().toLowerCase();
  const user = await User.findOne({ email: normalised }).select(
    '+passwordHash +failedLoginAttempts +lockedUntil'
  );

  // Uniform failure response to avoid account enumeration.
  const invalid = () =>
    ApiError.unauthorized('AUTH_INVALID_CREDENTIALS', 'Email or password is incorrect');

  if (!user) throw invalid();

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const retryInS = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
    throw ApiError.tooMany(`Account temporarily locked. Try again in ${retryInS}s.`);
  }

  const matches = await user.comparePassword(password);
  if (!matches) {
    user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
    if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      user.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
      user.failedLoginAttempts = 0;
    }
    await user.save();
    throw invalid();
  }

  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  user.lastLoginAt = new Date();
  await user.save();

  const session = await issueSession(user, ctx);
  return { user: user.toPublicJSON(), ...session };
}

/** Rotate the refresh token and mint a new access token. */
async function refresh(refreshToken, ctx = {}) {
  const { user, refreshToken: nextRefresh } = await tokenService.rotateRefreshToken(
    refreshToken,
    ctx
  );
  if (!user) throw ApiError.unauthorized('AUTH_INVALID_REFRESH', 'Refresh token is not valid');
  return {
    user: user.toPublicJSON(),
    accessToken: tokenService.signAccessToken(user),
    refreshToken: nextRefresh,
  };
}

/** Invalidate a single refresh token. */
async function logout(refreshToken) {
  if (refreshToken) await tokenService.revokeRefreshToken(refreshToken);
}

/** Load the authenticated user's public profile. */
async function me(userId) {
  const user = await User.findById(userId);
  if (!user) throw ApiError.unauthorized('AUTH_USER_MISSING', 'Account no longer exists');
  return user.toPublicJSON();
}

module.exports = { register, login, refresh, logout, me, issueSession };
