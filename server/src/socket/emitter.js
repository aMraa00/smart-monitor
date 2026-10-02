'use strict';

/**
 * Thin indirection around the Socket.IO server.
 *
 * Services must never import the socket server directly (that would create a
 * hard dependency and a circular import with app.js). They publish through
 * this module, which is a no-op until the transport is attached - so telemetry
 * ingest keeps working even when realtime is disabled.
 */

const logger = require('../config/logger');

/** @type {import('socket.io').Server|null} */
let io = null;

/** Attach the Socket.IO server (called once from server.js). */
function setIO(server) {
  io = server;
}

/** @returns {boolean} whether realtime delivery is available */
function isReady() {
  return Boolean(io);
}

function safeEmit(target, event, payload) {
  if (!io) return;
  try {
    io.to(target).emit(event, payload);
  } catch (err) {
    // Realtime delivery must never break the ingest path.
    logger.warn({ err: err.message, event, target }, 'socket emit failed');
  }
}

/** Emit to every socket subscribed to one device (`device:<deviceId>`). */
function emitToDevice(deviceId, event, payload) {
  safeEmit(`device:${deviceId}`, event, payload);
}

/** Emit to every socket of one user (`user:<userId>`). */
function emitToUser(userId, event, payload) {
  safeEmit(`user:${String(userId)}`, event, payload);
}

/** Emit to a device room and its owner room (deduped by the socket layer). */
function emitToDeviceAndOwner(deviceId, ownerId, event, payload) {
  emitToDevice(deviceId, event, payload);
  if (ownerId) emitToUser(ownerId, event, payload);
}

module.exports = { setIO, isReady, emitToDevice, emitToUser, emitToDeviceAndOwner };
