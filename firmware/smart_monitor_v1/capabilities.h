#pragma once

/**
 * Capability registry - the mirror of server/src/utils/capabilities.js.
 *
 * A capability is a SEMANTIC MEASUREMENT NAME, never a sensor name. The backend
 * does not know that `temperature` comes from a DHT11 on GPIO4, which is what
 * lets every future product model reuse the same API, schema and dashboard
 * (ARCHITECTURE.md §1.3). Adding a model = adding capability names, zero
 * backend changes.
 *
 * HARD RULE: a failed sensor contributes NO capability. It never writes 0.0 -
 * a zero reading would be indistinguishable from a real measurement (prompt §42).
 */

#define CAP_TEMPERATURE   "temperature"
#define CAP_HUMIDITY      "humidity"
#define CAP_PRESSURE      "pressure"
#define CAP_ILLUMINANCE   "illuminance"
#define CAP_ECO2          "eco2"        // CCS811 equivalent CO2, NEVER NDIR `co2`
#define CAP_TVOC          "tvoc"
#define CAP_WIND_RPM      "wind_rpm"
#define CAP_WIND_SPEED    "wind_speed"

/** Capabilities this hardware model can declare (ARCHITECTURE.md §1.5). */
#define SM_CAPABILITY_LIST \
  CAP_TEMPERATURE, CAP_HUMIDITY, CAP_PRESSURE, CAP_ILLUMINANCE, \
  CAP_ECO2, CAP_TVOC, CAP_WIND_RPM, CAP_WIND_SPEED

/**
 * One reading produced by one driver (ARCHITECTURE.md §8.3).
 *
 * `valid == false` means "no reading this cycle" - the sampler skips it.
 * `quality` mirrors the server-side flag list so the UI can warn honestly
 * (e.g. `uncalibrated` while the anemometer coefficient is still 1.0).
 */
struct SensorReading {
  bool valid;
  double value;
  const char* unit;
  const char* quality;
  const char* source;   // which driver produced it (informational)
  uint32_t atMs;        // millis() when it was captured
};

inline SensorReading invalidReading(const char* source) {
  return { false, 0.0, "", "error", source, 0 };
}
