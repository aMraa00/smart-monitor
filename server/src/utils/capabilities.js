'use strict';

/**
 * Capability registry - the single source of truth that decouples the backend
 * from any specific hardware model (prompt §2, §42).
 *
 * Adding a new measurement to any future product model (v2, agriculture,
 * industrial, air, weather ...) means adding ONE entry here. No schema
 * migration, no new endpoint, no new frontend code is required.
 *
 * `range` is used for telemetry poisoning defence (threat T16): values outside
 * the physically plausible window are rejected, never stored.
 */

const CAPABILITIES = {
  temperature: { unit: 'C', min: -60, max: 125 },
  humidity: { unit: '%', min: 0, max: 100 },
  pressure: { unit: 'Pa', min: 30000, max: 110000 },
  illuminance: { unit: 'lx', min: 0, max: 200000 },
  eco2: { unit: 'ppm', min: 400, max: 60000 }, // CCS811 equivalent CO2, NOT NDIR CO2
  tvoc: { unit: 'ppb', min: 0, max: 60000 },
  wind_speed: { unit: 'm/s', min: 0, max: 75 },
  wind_rpm: { unit: 'rpm', min: 0, max: 20000 },
  battery_voltage: { unit: 'V', min: 0, max: 30 },

  // reserved for future product models
  rainfall: { unit: 'mm', min: 0, max: 2000 },
  pm1: { unit: 'ug/m3', min: 0, max: 2000 },
  pm2_5: { unit: 'ug/m3', min: 0, max: 2000 },
  pm10: { unit: 'ug/m3', min: 0, max: 3000 },
  soil_moisture: { unit: '%', min: 0, max: 100 },
  uv_index: { unit: 'index', min: 0, max: 20 },
  solar_radiation: { unit: 'W/m2', min: 0, max: 2000 },
  noise: { unit: 'dB', min: 0, max: 160 },
  voc: { unit: 'ppb', min: 0, max: 60000 },
  co: { unit: 'ppm', min: 0, max: 5000 },
  co2: { unit: 'ppm', min: 300, max: 60000 }, // NDIR CO2, distinct from eco2
};

const CAPABILITY_NAMES = Object.keys(CAPABILITIES);

/** Valid quality flags a device may attach to a reading. */
const QUALITY_FLAGS = ['ok', 'low', 'high', 'calibrating', 'uncalibrated', 'estimated', 'error'];

/** @returns {boolean} whether the capability name is known to the platform */
function isKnownCapability(name) {
  return Object.prototype.hasOwnProperty.call(CAPABILITIES, name);
}

/** @returns {boolean} whether the numeric value is within the plausible range */
function isValueInRange(name, value) {
  const spec = CAPABILITIES[name];
  if (!spec) return false;
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  const tolerance = (spec.max - spec.min) * 0.001;
  return value >= spec.min - tolerance && value <= spec.max + tolerance;
}

/** Metadata for a capability, or undefined when unknown. */
function describe(name) {
  return CAPABILITIES[name];
}

module.exports = {
  CAPABILITIES,
  CAPABILITY_NAMES,
  QUALITY_FLAGS,
  isKnownCapability,
  isValueInRange,
  describe,
};
