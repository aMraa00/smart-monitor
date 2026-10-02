'use strict';

/**
 * Uniform response envelope: { success, data, meta }.
 * Controllers use these helpers so every client parses one shape.
 */

function ok(res, data, meta) {
  return res.status(200).json({ success: true, data, ...(meta ? { meta } : {}) });
}

function created(res, data, meta) {
  return res.status(201).json({ success: true, data, ...(meta ? { meta } : {}) });
}

function accepted(res, data, meta) {
  return res.status(202).json({ success: true, data, ...(meta ? { meta } : {}) });
}

function noContent(res) {
  return res.status(204).send();
}

module.exports = { ok, created, accepted, noContent };
