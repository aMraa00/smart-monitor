'use strict';

/**
 * Jest configuration.
 *
 * A single MongoDB instance is started by globalSetup and shared by every test
 * file (run with --runInBand so tests never race each other).
 */

module.exports = {
  testEnvironment: 'node',
  rootDir: __dirname,
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  testTimeout: 60_000,
  verbose: true,
  setupFiles: ['<rootDir>/tests/setup/env.js'],
  globalSetup: '<rootDir>/tests/setup/globalSetup.js',
  globalTeardown: '<rootDir>/tests/setup/globalTeardown.js',
  collectCoverageFrom: [
    'src/services/**/*.js',
    'src/middleware/**/*.js',
    'src/utils/**/*.js',
  ],
  clearMocks: true,
};
