#include "Ccs811Driver.h"

#include <Adafruit_CCS811.h>

#include "../hal/NvsConfig.h"

namespace {
constexpr uint32_t kWarmupMs = 48UL * 60UL * 60UL * 1000UL;  // 48 h burn-in
constexpr uint32_t kMaxPollGapMs = 10000;  // ignore gaps while the loop was stalled
}

bool Ccs811Driver::begin() {
  Adafruit_CCS811* ccs = new Adafruit_CCS811();
  if (!ccs->begin()) {
    Serial.println(F("[SENSOR] ccs811 not found (i2c) -> eco2/tvoc omitted"));
    delete ccs;
    return false;
  }

  // 1 s mode: one data-ready flag per second, no busy-wait in the loop.
  ccs->setDriveMode(CCS811_DRIVE_MODE_1SEC);
  ccs_ = ccs;
  present_ = true;
  lastPollMs_ = millis();

  // Carry burn-in across reboots: the baseline lives on the chip, so restarting
  // the 48 h clock on every reset would keep the reading flagged forever.
  warmupMs_ = Config.ccsHours() * 3600UL * 1000UL;
  return true;
}

void Ccs811Driver::poll() {
  if (!ccs_) return;
  Adafruit_CCS811* ccs = static_cast<Adafruit_CCS811*>(ccs_);

  const uint32_t now = millis();
  if (lastPollMs_ != 0) {
    const uint32_t gap = now - lastPollMs_;
    if (gap < kMaxPollGapMs) {
      warmupMs_ += gap;
      if (warmupMs_ >= (Config.ccsHours() + 1) * 3600UL * 1000UL) Config.addCcsHour();
    }
    lastPollMs_ = now;
  }

  // available() == false simply means the conversion has not finished yet;
  // the previous reading stays valid, no failure is recorded.
  if (!ccs->available()) return;

  // v1.1.3 API: readData() returns 0 on success, error code otherwise.
  if (ccs->readData() == 0) {
    const uint16_t eco2 = ccs->geteCO2();
    const uint16_t tvoc = ccs->getTVOC();
    // 0 means "no valid estimate", never a real 0 ppm room.
    const bool okE = (eco2 > 0);
    const bool okT = (tvoc >= 0);

    const bool warming = (warmupMs_ < kWarmupMs);
    const char* q = warming ? "calibrating" : "ok";

    if (okE) eco2_ = { true, (double)eco2, "ppm", q, "ccs811", now };
    if (okT) tvoc_ = { true, (double)tvoc, "ppb", q, "ccs811", now };

    consecutiveFailures_ = (okE || okT) ? 0 : (uint8_t)min(255, consecutiveFailures_ + 1);
    if (!okE && !okT) {
      eco2_.valid = false;
      tvoc_.valid = false;
    }
    return;
  }

  consecutiveFailures_ = (uint8_t)min(255, consecutiveFailures_ + 1);
  eco2_.valid = false;
  tvoc_.valid = false;
  if (consecutiveFailures_ == 3) {
    Serial.println(F("[SENSOR] ccs811 INVALID -> eco2/tvoc omitted"));
  }
}
