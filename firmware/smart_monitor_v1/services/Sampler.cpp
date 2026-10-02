#include "Sampler.h"

#include <cstring>

#include "../config.h"
#include "../hal/NvsConfig.h"

Sampler Samplers;

namespace {
// Capability precedence: first valid source wins, `source` records the winner.
const Sampler::Entry kOrder[] = {
  { CAP_TEMPERATURE, &Sampler::temp },
  { CAP_HUMIDITY, &Sampler::hum },
  { CAP_PRESSURE, &Sampler::pres },
  { CAP_TEMPERATURE, &Sampler::presTemp },  // fallback when DHT11 is absent
  { CAP_ILLUMINANCE, &Sampler::lux },
  { CAP_ECO2, &Sampler::eco2 },
  { CAP_TVOC, &Sampler::tvoc },
  { CAP_WIND_RPM, &Sampler::rpm },
  { CAP_WIND_SPEED, &Sampler::speed },
};
}  // namespace

void Sampler::begin() {
  dht_.begin(PIN_DHT);
  bmp_.begin();
  bh_.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  ccs_.begin();
  anemo_.begin(PIN_ANEMO);
  refreshDeclared();
  Serial.print(F("[SAMPLE] declared: "));
  Serial.println(declared_);
}

void Sampler::pollNextDriver() {
  switch (cursor_) {
    case 0: dht_.poll(); break;
    case 1: bmp_.poll(); break;
    case 2: bh_.poll(); break;
    case 3: ccs_.poll(); break;
    case 4: anemo_.poll(Config.windCalibrationCoef()); break;
    default: break;
  }
  cursor_ = (cursor_ + 1) % 5;
  if (cursor_ == 0) refreshDeclared();
}

SensorReading Sampler::resolve(const char* capability, uint32_t nowMs,
                               const char** sourceOut) const {
  for (size_t i = 0; i < sizeof(kOrder) / sizeof(kOrder[0]); i += 1) {
    if (strcmp(kOrder[i].capability, capability) != 0) continue;
    SensorReading r = (this->*kOrder[i].getter)();
    if (!r.valid) continue;
    // Stale = sensor died silently; omit, do not publish old data as live.
    if (nowMs - r.atMs > (uint32_t)READING_MAX_AGE_MS) continue;
    if (sourceOut) *sourceOut = r.source;
    return r;
  }
  if (sourceOut) *sourceOut = nullptr;
  return invalidReading("none");
}

bool Sampler::hasFreshData(uint32_t nowMs) const {
  const char* src = nullptr;
  for (size_t i = 0; i < sizeof(kOrder) / sizeof(kOrder[0]); i += 1) {
    SensorReading r = (this->*kOrder[i].getter)();
    if (r.valid && (nowMs - r.atMs) <= (uint32_t)READING_MAX_AGE_MS) return true;
  }
  (void)src;
  return false;
}

size_t Sampler::buildCapabilities(uint32_t nowMs, String& outJson) const {
  // Emit each capability name once, in precedence order.
  const char* seen[8];
  size_t seenN = 0;
  size_t count = 0;
  outJson = "{";
  for (size_t i = 0; i < sizeof(kOrder) / sizeof(kOrder[0]); i += 1) {
    const char* cap = kOrder[i].capability;
    bool dup = false;
    for (size_t s = 0; s < seenN; s += 1) {
      if (strcmp(seen[s], cap) == 0) { dup = true; break; }
    }
    if (dup) continue;
    seen[seenN++] = cap;
    const char* src = nullptr;
    SensorReading r = resolve(cap, nowMs, &src);
    if (!r.valid || !src) continue;
    if (count) outJson += ',';
    outJson += '"';
    outJson += cap;
    outJson += F("\":{\"value\":");
    outJson += String(r.value, 3);
    outJson += F(",\"unit\":\"");
    outJson += r.unit;
    outJson += F("\",\"quality\":\"");
    outJson += r.quality;
    outJson += F("\",\"source\":\"");
    outJson += src;
    outJson += F("\"}");
    count += 1;
  }
  outJson += "}";
  return count;
}

String Sampler::sensorStatusJson() const {
  String s = "{";
  s += "\"dht11\":\"" + String(dht_.healthy() ? "ok" : "down") + "\",";
  s += "\"bmp180\":\"" + String(bmp_.healthy() ? "ok" : "down") + "\",";
  s += "\"bh1750\":\"" + String(bh_.healthy() ? "ok" : "down") + "\",";
  s += "\"ccs811\":\"" + String(ccs_.healthy() ? "ok" : "down") + "\",";
  s += "\"a3144\":\"" + String(anemo_.present() ? "ok" : "down") + "\"";
  s += "}";
  return s;
}

size_t Sampler::presentCount() const {
  size_t n = 0;
  if (dht_.present()) n += 1;
  if (bmp_.present()) n += 1;
  if (bh_.present()) n += 1;
  if (ccs_.present()) n += 1;
  if (anemo_.present()) n += 1;
  return n;
}

void Sampler::refreshDeclared() {
  // Declared = capabilities with at least one present driver.
  const char* caps[] = { CAP_TEMPERATURE, CAP_HUMIDITY, CAP_PRESSURE,
                         CAP_ILLUMINANCE, CAP_ECO2, CAP_TVOC,
                         CAP_WIND_RPM, CAP_WIND_SPEED };
  declared_ = "[";
  bool first = true;
  for (size_t i = 0; i < 8; i += 1) {
    const char* src = nullptr;
    // Presence check ignores staleness: a driver that answered once counts.
    bool present = false;
    for (size_t k = 0; k < sizeof(kOrder) / sizeof(kOrder[0]); k += 1) {
      if (strcmp(kOrder[k].capability, caps[i]) != 0) continue;
      SensorReading r = (this->*kOrder[k].getter)();
      if (r.atMs != 0) { present = true; src = r.source; break; }
    }
    (void)src;
    if (!present) continue;
    if (!first) declared_ += ',';
    declared_ += '"';
    declared_ += caps[i];
    declared_ += '"';
    first = false;
  }
  declared_ += "]";
}
