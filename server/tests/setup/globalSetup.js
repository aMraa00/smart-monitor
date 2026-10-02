'use strict';

/**
 * Start ONE MongoDB instance for the whole test run.
 *
 * Preference order:
 *   1. an already-running local MongoDB (MONGO_TEST_URI) - fastest
 *   2. mongodb-memory-server using the locally installed mongod binary
 *      (avoids a download when the machine already has MongoDB 8 installed)
 *   3. mongodb-memory-server downloading a binary
 *
 * The URI is exported through process.env.MONGO_URI so every worker (and the
 * app config) picks it up automatically.
 */

const fs = require('fs');

const LOCAL_MONGOD_CANDIDATES = [
  'C:\\Program Files\\MongoDB\\Server\\8.0\\bin\\mongod.exe',
  'C:\\Program Files\\MongoDB\\Server\\7.0\\bin\\mongod.exe',
  'C:\\Program Files\\MongoDB\\Server\\6.0\\bin\\mongod.exe',
  '/usr/bin/mongod',
  '/usr/local/bin/mongod',
];

/** Remember a local mongod so mongodb-memory-server does not download one. */
function detectSystemBinary() {
  if (process.env.MONGOMS_SYSTEM_BINARY) return;
  const found = LOCAL_MONGOD_CANDIDATES.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });
  if (found) process.env.MONGOMS_SYSTEM_BINARY = found;
}

module.exports = async () => {
  detectSystemBinary();

  process.env.NODE_ENV = 'test';

  // 1. an explicitly provided test database (CI service container)
  if (process.env.MONGO_TEST_URI) {
    process.env.MONGO_URI = process.env.MONGO_TEST_URI;
    return;
  }

  try {
    const { MongoMemoryServer } = require('mongodb-memory-server');
    // When a system binary is used, its own version wins; only pin a version
    // when a download is actually required (keeps the two configurations from
    // reporting a version conflict).
    const binary = process.env.MONGOMS_SYSTEM_BINARY ? {} : { version: '7.0.14' };
    const instance = await MongoMemoryServer.create({ binary });
    global.__MONGOD__ = instance;
    process.env.MONGO_URI = instance.getUri();
    // eslint-disable-next-line no-console
    console.log(`\n[test] mongodb-memory-server started at ${process.env.MONGO_URI}\n`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[test] could not start mongodb-memory-server (${err.message}); falling back to local mongod`
    );
    process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/smart_monitor_v1_test';
  }
};
