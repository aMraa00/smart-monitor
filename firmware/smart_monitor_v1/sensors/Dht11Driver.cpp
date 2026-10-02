#include "Dht11Driver.h"

#include <DHT.h>

bool Dht11Driver::begin(uint8_t pin) {
  DHT* dht = new DHT(pin, DHT11);
  dht->begin();
  dht_ = dht;

  // Probe with a first read: wiring faults surface immediately rather than
  // producing a device that reports nothing for days.
  poll();
  present_ = hum_.valid || temp_.valid;
  if (!present_) {
    Serial.println(F("[SENSOR] dht11 not responding -> capability omitted"));
  }
  return present_;
}

void Dht11Driver::poll() {
  if (!dht_) return;

  DHT* dht = static_cast<DHT*>(dht_);
  // NAN means "could not read" (wrong wiring, timing, unplugged) - never a 0.
  float t = dht->readTemperature();
  float h = dht->readHumidity();

  const bool okT = !isnan(t);
  const bool okH = !isnan(h);
  const uint32_t now = millis();

  if (okT) {
    temp_ = { true, (double)t, "C", "ok", "dht11", now };
  }
  if (okH) {
    hum_ = { true, (double)h, "%", "ok", "dht11", now };
  }

  if (!okT && !okH) {
    failures_ = (failures_ < 255) ? failures_ + 1 : 255;
    consecutiveFailures_ = (consecutiveFailures_ < 255) ? consecutiveFailures_ + 1 : 255;
    temp_.valid = false;
    hum_.valid = false;
    if (consecutiveFailures_ == 3) {
      Serial.println(F("[SENSOR] dht11 INVALID -> capabilities omitted"));
    }
  } else {
    failures_ = 0;
    consecutiveFailures_ = 0;
  }
}
