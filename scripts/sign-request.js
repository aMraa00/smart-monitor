#!/usr/bin/env node
'use strict';

/**
 * Device request signer - REQUIRED for testing the telemetry endpoint.
 *
 * Mirrors the firmware implementation exactly:
 *
 *   canonical = METHOD \n PATH \n X-Timestamp \n X-Nonce \n X-Body-SHA256
 *   X-Signature = hex( HMAC-SHA256(deviceSecret, canonical) )
 *
 * Usage:
 *   node scripts/sign-request.js --deviceId SMV1-XXXXXXXXXXXX --secret <secret> --file sample.json
 *   node scripts/sign-request.js --deviceId SMV1-XXXXXXXXXXXX --secret <secret> \
 *     --url http://localhost:5000/api/v1/telemetry --method POST --send
 *
 * Options:
 *   --deviceId  device id (SMV1-...)
 *   --secret    device secret (from /provisioning/exchange)
 *   --file      JSON body file (default: emits a demo temperature sample)
 *   --url       full URL to send to (enables --send)
 *   --method    HTTP method (default POST)
 *   --send      actually perform the request and print the response
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (!args.deviceId || !args.secret) {
  console.error('Usage: node scripts/sign-request.js --deviceId SMV1-... --secret <secret> [--file body.json] [--url ...] [--send]');
  process.exit(1);
}

/** Default demo payload: 8 capabilities, mirrors the V1 hardware. */
function demoBody() {
  const ts = new Date().toISOString();
  return {
    firmwareVersion: '1.0.0',
    hardwareRevision: '1.0',
    capabilities: [
      'temperature',
      'humidity',
      'pressure',
      'illuminance',
      'eco2',
      'tvoc',
      'wind_rpm',
      'wind_speed',
    ],
    samples: [
      {
        sampleId: `${args.deviceId}-${Date.now()}`,
        ts,
        timeQuality: 'ntp',
        capabilities: {
          temperature: { value: 21.4, unit: 'C', quality: 'ok', source: 'dht11' },
          humidity: { value: 47.0, unit: '%', quality: 'ok', source: 'dht11' },
          pressure: { value: 99812, unit: 'Pa', quality: 'ok', source: 'bmp180' },
          illuminance: { value: 134.0, unit: 'lx', quality: 'ok', source: 'bh1750' },
          eco2: { value: 612, unit: 'ppm', quality: 'calibrating', source: 'ccs811' },
          tvoc: { value: 88, unit: 'ppb', quality: 'ok', source: 'ccs811' },
          wind_rpm: { value: 96.5, unit: 'rpm', quality: 'ok', source: 'a3144' },
          wind_speed: { value: 3.1, unit: 'm/s', quality: 'uncalibrated', source: 'a3144' },
        },
      },
    ],
  };
}

const bodyObject = args.file
  ? JSON.parse(fs.readFileSync(path.resolve(args.file), 'utf8'))
  : demoBody();
const body = JSON.stringify(bodyObject);

const url = new URL(args.url || 'http://localhost:5000/api/v1/telemetry');
const method = (args.method || 'POST').toUpperCase();
// The device signs the request PATH only (query string excluded).
const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
const timestamp = String(Math.floor(Date.now() / 1000));
const nonce = crypto.randomUUID();

const canonical = [method, url.pathname, timestamp, nonce, bodyHash].join('\n');
const signature = crypto
  .createHmac('sha256', args.secret)
  .update(canonical)
  .digest('hex');

const headers = {
  'Content-Type': 'application/json',
  'X-Device-Id': args.deviceId,
  'X-Timestamp': timestamp,
  'X-Nonce': nonce,
  'X-Body-SHA256': bodyHash,
  'X-Signature': signature,
};

console.log('--- canonical string ---');
console.log(canonical);
console.log('--- headers ---');
console.log(JSON.stringify(headers, null, 2));

if (!args.send) {
  console.log('--- body ---');
  console.log(body);
  console.log('\n(add --send --url <url> to actually POST the request)');
  process.exit(0);
}

(async () => {
  const response = await fetch(url, { method, headers, body });
  const text = await response.text();
  console.log('--- response ---');
  console.log(response.status, response.statusText);
  console.log(text);
  process.exit(response.ok ? 0 : 2);
})().catch((err) => {
  console.error('request failed:', err.message);
  process.exit(3);
});
