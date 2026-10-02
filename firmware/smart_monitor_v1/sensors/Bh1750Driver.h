#pragma once

#include <Arduino.h>

#include "../capabilities.h"

/**
 * BH1750 driver -> `illuminance` (lx).
 * Continuous high-resolution mode, 1 lx resolution, ~120 ms conversion.
 */
class Bh1750Driver {
 public:
  bool begin(uint8_t sdaPin, uint8_t sclPin);
  bool present() const { return present_; }

  void poll();

  SensorReading illuminance() const { return lux_; }
  const char* source() const { return "bh1750"; }
  bool healthy() const { return consecutiveFailures_ < 3; }

 private:
  void* light_ = nullptr;  // BH1750*
  bool present_ = false;
  uint8_t consecutiveFailures_ = 0;
  SensorReading lux_ = invalidReading("bh1750");
};
