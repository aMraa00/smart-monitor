'use strict';

const authService = require('../services/auth.service');
const asyncHandler = require('../utils/asyncHandler');
const { ok, created, noContent } = require('../utils/response');

/** Context passed to the token service (audit + rotation families). */
const ctxOf = (req) => ({ userAgent: req.get('user-agent') || '', ip: req.ip });

/** POST /auth/register */
const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body, ctxOf(req));
  return created(res, result);
});

/** POST /auth/login */
const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body, ctxOf(req));
  return ok(res, result);
});

/** POST /auth/refresh */
const refresh = asyncHandler(async (req, res) => {
  const result = await authService.refresh(req.body.refreshToken, ctxOf(req));
  return ok(res, result);
});

/** POST /auth/logout */
const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.body.refreshToken);
  return noContent(res);
});

/** GET /auth/me */
const me = asyncHandler(async (req, res) => {
  const user = await authService.me(req.user._id);
  return ok(res, { user });
});

/** GET /users - admin only: list accounts. */
const listUsers = asyncHandler(async (req, res) => {
  const { items, meta } = await authService.listUsers(req.query);
  return ok(res, items, meta);
});

/** POST /users - admin only: create an account with an explicit role. */
const createUser = asyncHandler(async (req, res) => {
  // No session is returned: the new account signs in for itself.
  const { user } = await authService.createUser(req.body);
  return created(res, { user });
});

module.exports = { register, login, refresh, logout, me, listUsers, createUser };
