'use strict';

const mongoose = require('mongoose');

/**
 * Device secrets are kept in their own collection so that:
 *   - a device document can be exported/read without ever touching secrets
 *   - rotation is an isolated, auditable operation
 *   - `select:false` on secretCipher guarantees it is never returned accidentally
 *
 * Storage form: AES-256-GCM ciphertext under a server master key (see
 * utils/crypto.util.js for why HMAC verification forbids a one-way hash).
 * The plaintext exists only in device NVS and in the one-time
 * `/provisioning/exchange` (or rotate-secret) response.
 */

const deviceCredentialSchema = new mongoose.Schema(
  {
    device: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Device',
      required: true,
      unique: true,
      index: true,
    },
    secretCipher: { type: String, required: true, select: false },
    alg: { type: String, default: 'hmac-sha256' },
    rotatedAt: { type: Date, default: Date.now },
    revoked: { type: Boolean, default: false, index: true },
    revokedAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model('DeviceCredential', deviceCredentialSchema);
