/**
 * Frontend capability registry (§10.2).
 *
 * This is the mirror of server/src/utils/capabilities.js and the reason the
 * dashboard renders ANY product model: widgets are generated from
 * `device.capabilities`, never from hard-coded sensor names. Adding an entry
 * here is the ONLY frontend change a new capability needs.
 *
 * `range` powers the alert-rule form (sensible min/max placeholders) and lets
 * the UI flag physically impossible readings without asking the server.
 */

const CAPABILITIES = {
  temperature: { label: 'Temperature', unit: 'C', icon: '🌡', color: '#f97316', decimals: 1, range: [-60, 125] },
  humidity: { label: 'Humidity', unit: '%', icon: '💧', color: '#38bdf8', decimals: 1, range: [0, 100] },
  pressure: { label: 'Pressure', unit: 'Pa', icon: '🧭', color: '#a78bfa', decimals: 0, range: [30000, 110000] },
  illuminance: { label: 'Illuminance', unit: 'lx', icon: '☀️', color: '#facc15', decimals: 0, range: [0, 200000] },
  // CCS811 equivalent CO2 - NEVER rendered as NDIR `co2` (prompt §42).
  eco2: { label: 'eCO2 (equivalent)', unit: 'ppm', icon: '🌫', color: '#fb923c', decimals: 0, range: [400, 60000] },
  tvoc: { label: 'TVOC', unit: 'ppb', icon: '🧪', color: '#c084fc', decimals: 0, range: [0, 60000] },
  wind_speed: { label: 'Wind speed', unit: 'm/s', icon: '🌬', color: '#22d3ee', decimals: 2, range: [0, 75] },
  wind_rpm: { label: 'Wind RPM', unit: 'rpm', icon: '🌀', color: '#818cf8', decimals: 1, range: [0, 20000] },
  battery_voltage: { label: 'Battery', unit: 'V', icon: '🔋', color: '#4ade80', decimals: 2, range: [0, 30] },

  // Reserved for the future product models (agriculture / industrial / air / weather).
  rainfall: { label: 'Rainfall', unit: 'mm', icon: '🌧', color: '#60a5fa', decimals: 1, range: [0, 2000] },
  pm1: { label: 'PM1', unit: 'µg/m³', icon: '🍂', color: '#94a3b8', decimals: 1, range: [0, 2000] },
  pm2_5: { label: 'PM2.5', unit: 'µg/m³', icon: '🍂', color: '#64748b', decimals: 1, range: [0, 2000] },
  pm10: { label: 'PM10', unit: 'µg/m³', icon: '🍂', color: '#475569', decimals: 1, range: [0, 3000] },
  soil_moisture: { label: 'Soil moisture', unit: '%', icon: '🌱', color: '#22c55e', decimals: 1, range: [0, 100] },
  uv_index: { label: 'UV index', unit: 'index', icon: '🧴', color: '#eab308', decimals: 1, range: [0, 20] },
  solar_radiation: { label: 'Solar radiation', unit: 'W/m²', icon: '🔆', color: '#f59e0b', decimals: 0, range: [0, 2000] },
  noise: { label: 'Noise', unit: 'dB', icon: '🔊', color: '#f43f5e', decimals: 1, range: [0, 160] },
  voc: { label: 'VOC', unit: 'ppb', icon: '⚗️', color: '#e879f9', decimals: 0, range: [0, 60000] },
  co: { label: 'Carbon monoxide', unit: 'ppm', icon: '☠️', color: '#ef4444', decimals: 1, range: [0, 5000] },
  co2: { label: 'CO2 (NDIR)', unit: 'ppm', icon: '🌬', color: '#14b8a6', decimals: 0, range: [300, 60000] },
};

const FALLBACK = { label: 'Unknown', unit: '', icon: '•', color: '#94a3b8', decimals: 2, range: null };

/** Metadata for a capability; unknown names degrade gracefully (never crash). */
export function describeCapability(name) {
  return CAPABILITIES[name] || { ...FALLBACK, label: name };
}

/** Deterministic widget order so a dashboard never re-shuffles between renders. */
export function orderCapabilities(names = []) {
  const known = Object.keys(CAPABILITIES);
  return [...names].sort((a, b) => {
    const ia = known.indexOf(a);
    const ib = known.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

/** Quality flags a device may attach to a reading (mirrors the backend list). */
export const QUALITY_FLAGS = ['ok', 'low', 'high', 'calibrating', 'uncalibrated', 'estimated', 'error'];

export function isQualityOk(quality) {
  return !quality || quality === 'ok';
}

export { CAPABILITIES };
