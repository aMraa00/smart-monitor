#pragma once

#include <Arduino.h>

#include "../capabilities.h"
#include "../sensors/AnemometerDriver.h"
#include "../sensors/Bh1750Driver.h"
#include "../sensors/Bmp180Driver.h"
#include "../sensors/Ccs811Driver.h"
#include "../sensors/Dht11Driver.h"

/**
 * Turns driver readings into ONE sample: a map of capability -> reading.
 *
 * Three rules, all of them load-bearing (ARCHITECTURE.md §1.3, §8.3, §42):
 *
 *  1. A reading that is missing or older than READING_MAX_AGE_MS is OMITTED.
 *     Stale data must not masquerade as a live measurement.
 *  2. A capability is filled by the FIRST driver that produced a valid value
 *     (registration order = the precedence order). Two drivers can measure the
 *     same quantity - e.g. DHT11 and BMP180 both sense temperature - and the
 *     `source` field records which one won, so the choice is auditable.
 *  3. Nothing is ever invented. An empty capability set means "do not sample
 *     yet", not "everything is zero".
 */
class Sampler {
 public:
  /** Probe every driver once at boot. Returns the capability names detected. */
  void begin();

  /** Round-robin: read exactly ONE driver so a tick never blocks the loop. */
  void pollNextDriver();

  /** True when at least one capability is fresh enough to publish. */
  bool hasFreshData(uint32_t nowMs) const;

  // Per-capability readers. Public ONLY so the precedence table in Sampler.cpp
  // (file scope, outside the class) can take their addresses - they are still
  // read-only accessors with no mutating power.
  SensorReading temp() const { return dht_.temperature(); }
  SensorReading hum() const { return dht_.humidity(); }
  SensorReading pres() const { return bmp_.pressure(); }
  SensorReading presTemp() const { return bmp_.temperature(); }
  SensorReading lux() const { return bh_.illuminance(); }
  SensorReading eco2() const { return ccs_.eco2(); }
  SensorReading tvoc() const { return ccs_.tvoc(); }
  SensorReading rpm() const { return anemo_.windRpm(); }
  SensorReading speed() const { return anemo_.windSpeed(); }

  /**
   * Build the `capabilities` object of a sample.
   * @return number of capabilities included (0 = nothing worth sending)
   */
  size_t buildCapabilities(uint32_t nowMs, String& outJson) const;

  /** Capability names currently detected - declared at provisioning time. */
  const String& declaredCapabilities() const { return declared_; }

  /** { "dht11": "ok"/"down", ... } for the heartbeat. */
  String sensorStatusJson() const;

  /** Total drivers that answered at least once since boot. */
  size_t presentCount() const;

  struct Entry {
    const char* capability;
    SensorReading (Sampler::*getter)() const;
  };

 private:
  void refreshDeclared();
  SensorReading resolve(const char* capability, uint32_t nowMs, const char** sourceOut) const;

  Dht11Driver dht_;
  Bmp180Driver bmp_;
  Bh1750Driver bh_;
  Ccs811Driver ccs_;
  AnemometerDriver anemo_;

  uint8_t cursor_ = 0;
  String declared_;
};

extern Sampler Samplers;
