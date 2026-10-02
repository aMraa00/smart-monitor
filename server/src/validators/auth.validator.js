'use strict';

const { z } = require('zod');
const { email, password } = require('./common');

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

module.exports = { registerSchema, loginSchema, refreshSchema };
