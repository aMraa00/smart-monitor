#!/usr/bin/env node
'use strict';

/**
 * Change the password of an existing account.
 *
 *   node scripts/reset-password.js <email> <new-password>
 *
 * WHY THIS EXISTS: the demo accounts created by `npm run seed` are LIVE on the
 * deployed instance, because the API and a local `mongod` share one database.
 * Their passwords are therefore real credentials - they must be rotated rather
 * than written down, and they must never end up in a committed file.
 *
 * The new password comes from the command line so it is never persisted here.
 * Only the email is printed back, never the password.
 */

const path = require('path');

// Load the server's .env exactly like the API does.
require(path.resolve(__dirname, '..', 'server', 'src', 'config', 'index.js'));

const db = require('../server/src/config/db');
const { User } = require('../server/src/models');

const MIN_LENGTH = 8;

async function main() {
  const [email, password] = process.argv.slice(2);

  if (!email || !password) {
    console.error('usage: node scripts/reset-password.js <email> <new-password>');
    process.exitCode = 1;
    return;
  }
  if (password.length < MIN_LENGTH) {
    console.error(`password must be at least ${MIN_LENGTH} characters`);
    process.exitCode = 1;
    return;
  }

  const normalised = email.trim().toLowerCase();
  await db.connect();

  const user = await User.findOne({ email: normalised });
  if (!user) {
    console.error(`no account with email ${normalised}`);
    await db.disconnect();
    process.exitCode = 1;
    return;
  }

  user.passwordHash = await User.hashPassword(password);
  // Clear any lockout so the new password can be tried immediately.
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  await user.save();

  console.log(`password updated for ${normalised} (role: ${user.role})`);
  console.log('store it in a password manager, not in a file.');

  await db.disconnect();
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('reset failed:', err.message);
    await db.disconnect().finally(() => process.exit(1));
  });
