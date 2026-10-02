'use strict';

/**
 * Socket.IO realtime layer (FR-E4, §21).
 *
 * Authorization is performed at handshake and again on every room join:
 * a socket may only subscribe to a device it owns (or any device if admin),
 * so live data is never leaked to the wrong account (threat T8).
 *
 * Rooms:
 *   user:<userId>       every socket of one account
 *   device:<deviceId>   sockets watching one device
 */

const { Server } = require('socket.io');
const config = require('../config');
const logger = require('../config/logger');
const { verifyAccessToken } = require('../services/token.service');
const { User, Device } = require('../models');
const emitter = require('./emitter');

/**
 * Attach a Socket.IO server to the HTTP server.
 * @param {import('http').Server} httpServer
 * @returns {import('socket.io').Server}
 */
function createSocketServer(httpServer) {
  const io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: config.clientUrls, credentials: true },
    serveClient: false,
  });

  const realtime = io.of('/realtime');

  /** Handshake authentication: a valid access token is mandatory. */
  realtime.use(async (socket, next) => {
    try {
      const token =
        (socket.handshake.auth && socket.handshake.auth.token) ||
        (socket.handshake.headers.authorization || '').replace(/^Bearer\s+/i, '');

      if (!token) return next(new Error('AUTH_REQUIRED'));

      const payload = verifyAccessToken(token);
      const user = await User.findById(payload.sub).select('_id role');
      if (!user) return next(new Error('AUTH_INVALID'));

      socket.data.user = { id: user._id.toString(), role: user.role };
      return next();
    } catch {
      return next(new Error('AUTH_INVALID'));
    }
  });

  realtime.on('connection', (socket) => {
    const userId = socket.data.user.id;
    socket.join(`user:${userId}`);
    logger.debug({ userId, socketId: socket.id }, 'socket connected');

    socket.on('device:subscribe', async (payload = {}) => {
      const { deviceId } = payload;
      if (!deviceId) {
        return socket.emit('error', { code: 'SUBSCRIBE_NO_DEVICE', message: 'deviceId is required' });
      }
      try {
        const device = await Device.findOne({ deviceId }).select('owner');
        const isOwner = device && device.owner && device.owner.toString() === userId;
        const isAdmin = socket.data.user.role === 'admin';
        if (!device || (!isOwner && !isAdmin)) {
          return socket.emit('error', {
            code: 'SUBSCRIBE_FORBIDDEN',
            message: 'You are not allowed to watch this device',
          });
        }
        socket.join(`device:${deviceId}`);
        return socket.emit('device:subscribed', { deviceId });
      } catch (err) {
        logger.warn({ err: err.message }, 'device:subscribe failed');
        return socket.emit('error', { code: 'SUBSCRIBE_FAILED', message: 'Subscription failed' });
      }
    });

    socket.on('device:unsubscribe', (payload = {}) => {
      if (payload.deviceId) socket.leave(`device:${payload.deviceId}`);
    });

    socket.on('ping', (callback) => {
      if (typeof callback === 'function') callback({ ts: Date.now() });
    });

    socket.on('disconnect', (reason) => {
      logger.debug({ userId, socketId: socket.id, reason }, 'socket disconnected');
    });
  });

  // Services publish through the emitter indirection, never directly.
  emitter.setIO(realtime);
  logger.info('socket.io realtime namespace ready at /realtime');

  return io;
}

module.exports = { createSocketServer };
