'use strict';

const { z } = require('zod');

const createRuleSchema = z
  .object({
    capability: z.string().trim().min(1).max(48),
    min: z.number().nullable().optional(),
    max: z.number().nullable().optional(),
    forSeconds: z.number().int().min(0).max(86_400).optional().default(0),
    severity: z.enum(['info', 'warning', 'critical']).optional().default('warning'),
    name: z.string().trim().max(120).optional().default(''),
  })
  .refine((rule) => rule.min !== null && rule.min !== undefined || rule.max !== null && rule.max !== undefined, {
    message: 'at least one of min or max must be provided',
    path: ['min'],
  })
  .refine(
    (rule) =>
      rule.min === null ||
      rule.min === undefined ||
      rule.max === null ||
      rule.max === undefined ||
      rule.min < rule.max,
    { message: 'min must be lower than max', path: ['min'] }
  );

const updateRuleSchema = z.object({
  capability: z.string().trim().min(1).max(48).optional(),
  min: z.number().nullable().optional(),
  max: z.number().nullable().optional(),
  forSeconds: z.number().int().min(0).max(86_400).optional(),
  severity: z.enum(['info', 'warning', 'critical']).optional(),
  enabled: z.boolean().optional(),
  name: z.string().trim().max(120).optional(),
});

const listAlertsQuerySchema = z.object({
  state: z.enum(['pending', 'firing', 'resolved']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

module.exports = { createRuleSchema, updateRuleSchema, listAlertsQuerySchema };
