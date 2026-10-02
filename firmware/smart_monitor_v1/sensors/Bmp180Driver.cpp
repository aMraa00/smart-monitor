#include "Bmp180Driver.h"

#include <Adafruit_BMP085.h>

bool Bmp180Driver::begin() {
  Adafruit_BMP085* bmp = new Adafruit_BMP085();
  // begin() performs a soft reset + calibration read; false = not on the bus.
  if (!bmp->begin()) {
    Serial.println(F("[SENSOR] bmp180 not found (i2c) -> pressure omitted"));
    delete bmp;
    return false;
  }
  bmp_ = bmp;
  present_ = true;
  poll();
  return present_;
}

void Bmp180Driver::poll() {
  if (!bmp_) return;
  Adafruit_BMP085* bmp = static_cast<Adafruit_BMP085*>(bmp_);

  // readPressure()/readTemperature() return 0 on I2C failure, which is exactly
  // why a plain "0" must never be accepted as a valid reading.
  int32_t p = bmp->readPressure();
  float t = bmp->readTemperature();
  const bool okP = (p > 0);
  const bool okT = !isnan(t) && t > -60.0f && t < 125.0f;
  const uint32_t now = millis();

  if (okP) {
    pressure_ = { true, (double)p, "Pa", "ok", "bmp180", now };
  }
  if (okT) {
    temp_ = { true, (double)t, "C", "ok", "bmp180", now };
  }

  if (!okP && !okT) {
    consecutiveFailures_ = (consecutiveFailures_ < 255) ? consecutiveFailures_ + 1 : 255;
    pressure_.valid = false;
    temp_.valid = false;
    if (consecutiveFailures_ == 3) {
      Serial.println(F("[SENSOR] bmp180 INVALID (i2c) -> capability omitted"));
    }
  } else {
    consecutiveFailures_ = 0;
  }
}
