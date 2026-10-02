'use strict';

/**
 * MongoDB connection lifecycle.
 *
 * The API owns the only connection to MongoDB; devices can never reach it.
 */

const mongoose = require('mongoose');
const config = require('./index');
const logger = require('./logger');

mongoose.set('strictQuery', true);

// NOTE: `autoCreate`/`autoIndex` are disabled in models/index.js, which is the
// single entry point every caller (server, tests, scripts) goes through.

/**
 * Open the MongoDB connection.
 * @param {string} [uri] override connection string (used by tests)
 * @returns {Promise<typeof mongoose>}
 */
async function connect(uri = config.mongoUri) {
  if (mongoose.connection.readyState === 1) return mongoose;

  mongoose.connection.on('error', (err) => {
    logger.error({ err: err.message }, 'mongodb connection error');
  });
  mongoose.connection.on('disconnected', () => {
    logger.warn('mongodb disconnected');
  });
  mongoose.connection.on('reconnected', () => {
    logger.info('mongodb reconnected');
  });

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20,
    // Telemetry durability: acknowledge on the majority of the replica set.
    writeConcern: { w: 'majority' },
  });

  logger.info({ db: mongoose.connection.name }, 'mongodb connected');
  return mongoose;
}

/** Close the connection (tests / graceful shutdown). */
async function disconnect() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
    logger.info('mongodb connection closed');
  }
}

module.exports = { connect, disconnect, mongoose };
