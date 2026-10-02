#pragma once

#include <Arduino.h>

#include "../capabilities.h"

/**
 * DHT11 driver -> `temperature` + `humidity`.
 *
 * Isolation contract (ARCHITECTURE.md §8.3): a failed read returns
 * `valid == false`, the sampler then OMITS the capability from the sample.
 * It never substitutes 0.0, which would look like a real measurement.
 */
class Dht11Driver {
 public:
  bool begin(uint8_t pin);
  bool present() const { return present_; }

  /** Read both channels once. Safe to call at most ~1 Hz. */
  void poll();

  SensorReading temperature() const { return temp_; }
  SensorReading humidity() const { return hum_; }

  const char* source() const { return "dht11"; }
  bool healthy() const { return consecutiveFailures_ < 3; }

 private:
  void* dht_ = nullptr;  // DHT* - kept opaque so the header needs no library
  bool present_ = false;
  uint8_t failures_ = 0;
  uint8_t consecutiveFailures_ = 0;
  SensorReading temp_ = invalidReading("dht11");
  SensorReading hum_ = invalidReading("dht11");
};
