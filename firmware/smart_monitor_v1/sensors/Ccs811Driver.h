#pragma once

#include <Arduino.h>

#include "../capabilities.h"

/**
 * CCS811 driver -> `eco2` (ppm) + `tvoc` (ppb).
 *
 * TWO rules this driver must honour (prompt §42):
 *  1. `eco2` is a CALCULATED EQUIVALENT, never NDIR CO2 - the capability name
 *     itself keeps the two apart (`co2` exists in the registry for NDIR parts).
 *  2. The equivalent is only meaningful once the sensor has burned in, so for
 *     the first 48 h of runtime it is published with `quality = "calibrating"`
 *     and the UI shows a warning instead of pretending it is final.
 */
class Ccs811Driver {
 public:
  bool begin();
  bool present() const { return present_; }

  void poll();

  SensorReading eco2() const { return eco2_; }
  SensorReading tvoc() const { return tvoc_; }

  const char* source() const { return "ccs811"; }
  bool healthy() const { return consecutiveFailures_ < 3; }

 private:
  void* ccs_ = nullptr;  // Adafruit_CCS811*
  bool present_ = false;
  uint8_t consecutiveFailures_ = 0;
  uint32_t lastPollMs_ = 0;
  uint32_t warmupMs_ = 0;
  SensorReading eco2_ = invalidReading("ccs811");
  SensorReading tvoc_ = invalidReading("ccs811");
};
