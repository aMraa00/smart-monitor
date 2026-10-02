#include "Bh1750Driver.h"

#include <BH1750.h>
#include <Wire.h>

bool Bh1750Driver::begin(uint8_t sdaPin, uint8_t sclPin) {
  Wire.begin(sdaPin, sclPin);

  BH1750* light = new BH1750();
  // false = the chip did not ACK its address (missing, miswired, wrong voltage).
  if (!light->begin(BH1750::CONTINUOUS_HIGH_RES_MODE, 0x23, &Wire)) {
    Serial.println(F("[SENSOR] bh1750 not found (i2c) -> illuminance omitted"));
    delete light;
    return false;
  }
  light_ = light;
  present_ = true;
  poll();
  return present_;
}

void Bh1750Driver::poll() {
  if (!light_) return;
  BH1750* light = static_cast<BH1750*>(light_);

  // -1 signals a bus error; the library also returns -1 before the first
  // conversion completes. Both must be treated as "no reading", not as -1 lx.
  float lux = light->readLightLevel();
  const bool ok = (lux >= 0.0f);
  const uint32_t now = millis();

  if (ok) {
    lux_ = { true, (double)lux, "lx", "ok", "bh1750", now };
    consecutiveFailures_ = 0;
  } else {
    consecutiveFailures_ = (consecutiveFailures_ < 255) ? consecutiveFailures_ + 1 : 255;
    lux_.valid = false;
    if (consecutiveFailures_ == 3) {
      Serial.println(F("[SENSOR] bh1750 INVALID (i2c) -> capability omitted"));
    }
  }
}
