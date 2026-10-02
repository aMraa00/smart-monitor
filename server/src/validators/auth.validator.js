'use strict';

const { z } = require('zod');
const { email, password, pagination } = require('./common');

const registerSchema = z.object({
  email,
  password,
  name: z.string().trim().max(120).optional().default(''),
});

const loginSchema = z.object({
  email,
  password: z.string().min(1, 'password is required').max(128),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(10, 'refreshToken is required'),
});

const createUserSchema = z.object({
  email,
  password,
  name: z.string().trim().max(120).optional().default(''),
  role: z.enum(['admin', 'manager', 'owner', 'viewer']).optional().default('owner'),
});

const listUsersQuerySchema = z.object({
  role: z.enum(['admin', 'manager', 'owner', 'viewer']).optional(),
  ...pagination,
});

module.exports = { registerSchema, loginSchema, refreshSchema, createUserSchema, listUsersQuerySchema };
