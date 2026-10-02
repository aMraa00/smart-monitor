#pragma once

#include <Arduino.h>

#include "../capabilities.h"

/**
 * BMP180 driver -> `pressure` (Pa) and a secondary `temperature`.
 *
 * Only `pressure` is claimed here: `temperature` already has an owner in the
 * capability precedence order (DHT11), and a capability map can hold exactly one
 * value per name. Keeping the source visible in the reading makes the choice
 * auditable instead of silent.
 */
class Bmp180Driver {
 public:
  bool begin();
  bool present() const { return present_; }

  void poll();

  SensorReading pressure() const { return pressure_; }
  /** Secondary channel; used only when DHT11 is absent. */
  SensorReading temperature() const { return temp_; }

  const char* source() const { return "bmp180"; }
  bool healthy() const { return consecutiveFailures_ < 3; }

 private:
  void* bmp_ = nullptr;  // Adafruit_BMP085*
  bool present_ = false;
  uint8_t consecutiveFailures_ = 0;
  SensorReading pressure_ = invalidReading("bmp180");
  SensorReading temp_ = invalidReading("bmp180");
};
