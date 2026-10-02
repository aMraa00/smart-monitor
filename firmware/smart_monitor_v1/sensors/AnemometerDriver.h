#pragma once

#include <Arduino.h>

#include "../capabilities.h"

/**
 * A3144 Hall sensor on a interrupt pin -> `wind_rpm` + `wind_speed`.
 *
 * Physical chain (ARCHITECTURE.md §18): wind cups -> shaft -> A3144 -> pulses.
 *
 * Calibration is DATA, not a constant: `wind_speed = rps * coefficient` where the
 * coefficient comes from NVS and defaults to 1.0, which means UNCALIBRATED. The
 * reading is then flagged `quality = "uncalibrated"` so the dashboard warns
 * instead of showing a confident wrong number.
 *
 * KNOWN LIMITATION: an unconnected A3144 with a pull-up reads the same idle
 * level as a connected one that is simply not spinning, so hardware presence
 * cannot be inferred. `wind_rpm = 0` on a still day is a genuine measurement,
 * therefore this driver reports it; the wiring check belongs in WIRING.md.
 */
class AnemometerDriver {
 public:
  void begin(uint8_t pin);
  bool present() const { return attached_; }

  /** Called from the scheduler; computes rpm over the elapsed window. */
  void poll(float calibrationCoef);

  SensorReading windRpm() const { return rpm_; }
  SensorReading windSpeed() const { return speed_; }

  const char* source() const { return "a3144"; }
  uint32_t totalPulses() const { return totalPulses_; }

  /** ISR entry: increments a counter and nothing else (no logic in an ISR). */
  void onPulse() { pulses_++; }

  static AnemometerDriver* instance();

 private:
  bool attached_ = false;
  uint32_t lastMs_ = 0;
  uint32_t totalPulses_ = 0;
  volatile uint32_t pulses_ = 0;
  SensorReading rpm_ = invalidReading("a3144");
  SensorReading speed_ = invalidReading("a3144");
  static AnemometerDriver* s_instance;
};
