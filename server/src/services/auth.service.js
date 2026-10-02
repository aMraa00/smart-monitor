'use strict';

/**
 * Account lifecycle: register, login, refresh, logout (FR-A).
 * All brute-force protection lives here (threat T5).
 *
 * Roles: self-registered accounts are ALWAYS `owner` (threat T17).
 * `admin` / `manager` accounts are created by an admin (POST /users) or by
 * server-side seeding (scripts/seed.js, BOOTSTRAP_ADMIN_EMAIL).
 */

const { User, ROLES } = require('../models');
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

/**
 * Admin: list accounts (paginated, newest first).
 * Hashes and lock metadata are never exposed (toPublicJSON).
 */
async function listUsers({ page = 1, limit = 50, role } = {}) {
  const filter = {};
  if (role) filter.role = role;
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safePage = Math.max(Number(page) || 1, 1);
  const [items, total] = await Promise.all([
    User.find(filter)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit),
    User.countDocuments(filter),
  ]);
  return {
    items: items.map((user) => user.toPublicJSON()),
    meta: { total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) || 1 },
  };
}

/**
 * Admin: create an account with an explicit role (admin/manager/owner/viewer).
 * Rejects duplicates with the same generic message as self-registration.
 *
 * NO session is issued here: the new account has never authenticated, so a
 * refresh token would be an orphaned credential nobody can use (and nobody
 * should be able to). The account signs in itself with the given password.
 *
 * @returns {Promise<{user:object}>}
 */
async function createUser({ email, password, name, role }) {
  const normalised = String(email).trim().toLowerCase();
  const existing = await User.findOne({ email: normalised }).lean();
  if (existing) {
    throw ApiError.conflict('AUTH_EMAIL_TAKEN', 'An account with this email already exists');
  }
  const passwordHash = await User.hashPassword(password);
  const user = await User.create({
    email: normalised,
    passwordHash,
    name: name || '',
    role: ROLES.includes(role) ? role : 'owner',
  });
  return { user: user.toPublicJSON() };
}

/**
 * Create/promote the first privileged accounts from the environment.
 *
 * Self-registration can only ever produce an `owner` (threat T17), so a fresh
 * deployment needs a way in. `BOOTSTRAP_*_EMAIL` / `_PASSWORD` are read here so
 * an operator can declare the first admin/manager/owner through deployment
 * configuration (Render env vars, .env) instead of a public form.
 *
 * IDEMPOTENT: an existing account keeps its password; only a drifted role is
 * repaired. Runs at boot and from `npm run seed`, so it is safe to call twice.
 *
 * @returns {Promise<Array<{email:string, role:string, action:string}>>} what was done
 */
async function ensureBootstrapAccounts(env = process.env) {
  const wanted = [
    { role: 'admin', name: 'Administrator', email: env.BOOTSTRAP_ADMIN_EMAIL, password: env.BOOTSTRAP_ADMIN_PASSWORD },
    { role: 'manager', name: 'Fleet Manager', email: env.BOOTSTRAP_MANAGER_EMAIL, password: env.BOOTSTRAP_MANAGER_PASSWORD },
    { role: 'owner', name: 'Device Owner', email: env.BOOTSTRAP_OWNER_EMAIL, password: env.BOOTSTRAP_OWNER_PASSWORD },
  ];

  const applied = [];

  for (const spec of wanted) {
    const email = (spec.email || '').trim().toLowerCase();
    if (!email || !spec.password) continue; // not configured -> skip silently

    const existing = await User.findOne({ email });
    if (!existing) {
      await User.create({
        email,
        passwordHash: await User.hashPassword(spec.password),
        name: spec.name,
        role: spec.role,
      });
      applied.push({ email, role: spec.role, action: 'created' });
      continue;
    }
    if (existing.role !== spec.role) {
      existing.role = spec.role;
      await existing.save();
      applied.push({ email, role: spec.role, action: 'promoted' });
      continue;
    }
    applied.push({ email, role: spec.role, action: 'unchanged' });
  }

  return applied;
}

module.exports = {
  register,
  login,
  refresh,
  logout,
  me,
  issueSession,
  listUsers,
  createUser,
  ensureBootstrapAccounts,
};
