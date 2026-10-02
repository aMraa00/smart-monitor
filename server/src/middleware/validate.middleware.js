'use strict';

/**
 * Zod validation middleware.
 *
 * Parsed (and coerced) values replace the raw ones, so controllers always work
 * with trusted, typed input. Validation failures become 422 with field details.
 */

const { ZodError } = require('zod');
const ApiError = require('../utils/apiError');

/**
 * @param {{body?:import('zod').ZodTypeAny, query?:import('zod').ZodTypeAny, params?:import('zod').ZodTypeAny}} schemas
 */
function validate(schemas = {}) {
  return function validateMiddleware(req, _res, next) {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params || {});
      if (schemas.query) {
        const parsedQuery = schemas.query.parse(req.query || {});
        req.query = parsedQuery;
        req.validatedQuery = parsedQuery;
      }
      if (schemas.body) req.body = schemas.body.parse(req.body || {});
      return next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.issues.map((issue) => ({
          path: issue.path.join('.') || '(root)',
          message: issue.message,
        }));
        return next(ApiError.validation('Request validation failed', details));
      }
      return next(err);
    }
  };
}

module.exports = validate;
