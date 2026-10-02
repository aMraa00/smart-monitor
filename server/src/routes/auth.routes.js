'use strict';

const express = require('express');
const controller = require('../controllers/auth.controller');
const validate = require('../middleware/validate.middleware');
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const { authLimiter } = require('../middleware/rateLimit.middleware');
const {
  registerSchema,
  loginSchema,
  refreshSchema,
  createUserSchema,
  listUsersQuerySchema,
} = require('../validators/auth.validator');

const router = express.Router();

router.post('/register', authLimiter, validate({ body: registerSchema }), controller.register);
router.post('/login', authLimiter, validate({ body: loginSchema }), controller.login);
router.post('/refresh', authLimiter, validate({ body: refreshSchema }), controller.refresh);
router.post('/logout', validate({ body: refreshSchema }), controller.logout);
router.get('/me', authenticate, controller.me);

// Admin-only user management: ONLY admins create/promote accounts.
// Managers and owners can never reach these routes (403).
router.get(
  '/users',
  authenticate,
  requireRole('admin'),
  validate({ query: listUsersQuerySchema }),
  controller.listUsers
);
router.post(
  '/users',
  authenticate,
  requireRole('admin'),
  validate({ body: createUserSchema }),
  controller.createUser
);

module.exports = router;
