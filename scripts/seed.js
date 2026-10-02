#!/usr/bin/env node
'use strict';

/**
 * Development seed: one account, one claimed station, 24h of realistic
 * telemetry and a sample alert rule, so the dashboard is useful on first run.
 *
 *   cd server && npm run seed
 *
 * IDEMPOTENT: re-running never duplicates the account, the device or the
 * history. Pass `--reset` to regenerate the seeded telemetry.
 */

const path = require('path');

// Load the server's .env exactly like the API does, wherever we are run from.
require(path.resolve(__dirname, '..', 'server', 'src', 'config', 'index.js'));

const db = require('../server/src/config/db');
const { User, Device, Telemetry, TelemetryLatest, AlertRule, syncIndexes } = require('../server/src/models');

const SEED_EMAIL = process.env.SEED_EMAIL || 'owner@example.com';
const SEED_PASSWORD = process.env.SEED_PASSWORD || 'Str0ng!Passw0rd';
const SEED_DEVICE_ID = 'SMV1-A1B2C3D4E5F6';
const SAMPLES = 288; // 24h at a 5-minute interval
const INTERVAL_MS = 5 * 60 * 1000;

const CAPABILITIES = [
  { name: 'temperature', unit: 'C', source: 'dht11', base: 21.5, swing: 4, decimals: 1 },
  { name: 'humidity', unit: '%', source: 'dht11', base: 47, swing: 12, decimals: 1 },
  { name: 'pressure', unit: 'Pa', source: 'bmp180', base: 99800, swing: 400, decimals: 0 },
  { name: 'illuminance', unit: 'lx', source: 'bh1750', base: 900, swing: 850, decimals: 0 },
  { name: 'eco2', unit: 'ppm', source: 'ccs811', base: 620, swing: 220, decimals: 0 },
  { name: 'tvoc', unit: 'ppb', source: 'ccs811', base: 90, swing: 60, decimals: 0 },
  { name: 'wind_rpm', unit: 'rpm', source: 'a3144', base: 70, swing: 60, decimals: 1 },
  // Coefficient is still 1.0 -> flagged as uncalibrated, never silently trusted.
  { name: 'wind_speed', unit: 'm/s', source: 'a3144', base: 2.4, swing: 2.2, decimals: 2 },
];

/** Smooth daily curve plus light noise so charts look like a real station. */
function valueAt(spec, index) {
  const phase = (index / SAMPLES) * Math.PI * 2;
  const ts = new Date(Date.now() - (SAMPLES - 1 - index) * INTERVAL_MS);
  const daily = Math.sin(((ts.getUTCHours() - 6) / 24) * Math.PI * 2);
  const noise = ((Math.sin(index * 12.9898) * 43758.5453) % 1) * spec.swing * 0.08;

  let value = spec.base + Math.sin(phase * 2.3) * spec.swing * 0.5 + daily * spec.swing * 0.4 + noise;

  if (spec.name === 'illuminance') value = Math.max(0, value);
  if (spec.name === 'humidity') value = Math.min(100, Math.max(0, value));
  return Number(value.toFixed(spec.decimals));
}

async function seed() {
  await db.connect();
  await syncIndexes();

  // ---- account ------------------------------------------------------------
  let user = await User.findOne({ email: SEED_EMAIL });
  if (!user) {
    user = await User.create({
      email: SEED_EMAIL,
      passwordHash: await User.hashPassword(SEED_PASSWORD),
      name: 'Demo Owner',
      role: 'owner',
    });
    console.log(`created account    ${SEED_EMAIL}`);
  } else {
    console.log(`account exists     ${SEED_EMAIL}`);
  }

  // ---- device -------------------------------------------------------------
  let device = await Device.findOne({ deviceId: SEED_DEVICE_ID });
  if (!device) {
    device = await Device.create({
      deviceId: SEED_DEVICE_ID,
      hwId: 'A0B1C2D3E4F5',
      model: 'smart_monitor_v1',
      hardwareRevision: '1.0',
      firmwareVersion: '1.0.0',
      owner: user._id,
      displayName: 'Roof station',
      locationName: 'Ulaanbaatar, roof',
      capabilities: CAPABILITIES.map((spec) => spec.name),
      status: 'active',
      claimedAt: new Date(),
      provisionedAt: new Date(),
      lastSeenAt: new Date(),
      meta: { rssi: -61, timeQuality: 'ntp', backlog: 0 },
    });
    console.log(`created device     ${SEED_DEVICE_ID}`);
  } else {
    // Keep the demo data attached to the demo account after a reseed.
    device.owner = user._id;
    device.status = 'active';
    device.lastSeenAt = new Date();
    await device.save();
    console.log(`device exists      ${SEED_DEVICE_ID}`);
  }

  // ---- history ------------------------------------------------------------
  const existing = await Telemetry.countDocuments({ device: device._id });

  if (existing > 0 && !process.argv.includes('--reset')) {
    console.log(`telemetry kept      ${existing} samples (pass --reset to regenerate)`);
  } else {
    if (existing > 0) {
      await Telemetry.deleteMany({ device: device._id });
      await TelemetryLatest.deleteOne({ device: device._id });
      console.log('previous telemetry cleared');
    }

    const now = Date.now();
    const docs = [];

    for (let i = 0; i < SAMPLES; i += 1) {
      const ts = new Date(now - (SAMPLES - 1 - i) * INTERVAL_MS);
      const capabilities = {};

      for (const spec of CAPABILITIES) {
        capabilities[spec.name] = {
          value: valueAt(spec, i),
          unit: spec.unit,
          quality: spec.name === 'wind_speed' ? 'uncalibrated' : 'ok',
          source: spec.source,
          ts,
        };
      }

      docs.push({
        ts,
        device: device._id,
        deviceId: device.deviceId,
        sampleId: `${device.deviceId}-${String(i + 1).padStart(10, '0')}`,
        timeQuality: 'ntp',
        firmwareVersion: '1.0.0',
        capabilities,
      });
    }

    await Telemetry.insertMany(docs);

    const last = docs[docs.length - 1];
    await TelemetryLatest.findOneAndUpdate(
      { device: device._id },
      {
        device: device._id,
        deviceId: device.deviceId,
        ts: last.ts,
        timeQuality: last.timeQuality,
        capabilities: last.capabilities,
      },
      { upsert: true }
    );

    console.log(`inserted telemetry  ${docs.length} samples (24h, 5m interval)`);
  }

  // ---- sample alert rule ---------------------------------------------------
  const rules = await AlertRule.countDocuments({ device: device._id });
  if (rules === 0) {
    await AlertRule.create({
      device: device._id,
      capability: 'temperature',
      min: 10,
      max: 32,
      forSeconds: 60,
      severity: 'warning',
      name: 'Comfort range',
    });
    console.log('created alert rule  temperature 10-32 C');
  } else {
    console.log(`alert rules kept    ${rules}`);
  }

  console.log('\nSeed complete.');
  console.log(`  email     ${SEED_EMAIL}`);
  console.log(`  password  ${SEED_PASSWORD}`);
  console.log(`  device    ${SEED_DEVICE_ID}`);
}

seed()
  .then(() => db.disconnect())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('seed failed:', err.message);
    console.error(err.stack);
    return db.disconnect().finally(() => process.exit(1));
  });
