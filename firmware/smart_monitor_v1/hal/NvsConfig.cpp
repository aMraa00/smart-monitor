#include "NvsConfig.h"
#include "../config.h"

NvsConfig Config;

namespace {
constexpr const char* kNs = "smv1";
constexpr uint32_t kDefaultIntervalS = 60;
constexpr float kUncalibratedCoef = 1.0f;
}  // namespace

bool NvsConfig::begin() {
  if (open_) return true;
  // NVS is read-only during OTA-style operations; readWrite is what we need.
  open_ = prefs_.begin(kNs, false);
  return open_;
}

String NvsConfig::wifiSsid() const { return open_ ? prefs_.getString("wifi.ssid", "") : ""; }
String NvsConfig::wifiPass() const { return open_ ? prefs_.getString("wifi.pass", "") : ""; }

String NvsConfig::serverBase() const {
  if (!open_) return SM_DEFAULT_SERVER;
  String base = prefs_.getString("server.base", "");
  return base.length() ? base : SM_DEFAULT_SERVER;
}

void NvsConfig::setWifi(const String& ssid, const String& pass) {
  if (!open_) return;
  prefs_.putString("wifi.ssid", ssid);
  prefs_.putString("wifi.pass", pass);
}

void NvsConfig::setServerBase(const String& base) {
  if (!open_) return;
  prefs_.putString("server.base", base);
}

bool NvsConfig::hasWifi() const { return wifiSsid().length() > 0; }

String NvsConfig::deviceId() const { return open_ ? prefs_.getString("dev.id", "") : ""; }
String NvsConfig::deviceSecret() const { return open_ ? prefs_.getString("dev.secret", "") : ""; }

bool NvsConfig::hasIdentity() const {
  return deviceId().length() > 0 && deviceSecret().length() > 0;
}

void NvsConfig::setIdentity(const String& deviceId, const String& secret) {
  if (!open_) return;
  prefs_.putString("dev.id", deviceId);
  prefs_.putString("dev.secret", secret);
}

void NvsConfig::clearIdentity() {
  if (!open_) return;
  prefs_.remove("dev.id");
  prefs_.remove("dev.secret");
}

/**
 * Monotonic per-device sample counter.
 *
 * Persisted on every sample: if it were only kept in RAM a reboot would restart
 * the numbering and the server would drop the new samples as duplicates.
 * At one sample per minute this is a handful of NVS writes per day, which the
 * wear leveller spreads across the partition for many years.
 */
uint32_t NvsConfig::nextSequence() {
  if (!open_) return 1;
  uint32_t seq = prefs_.getULong("seq", 0) + 1;
  prefs_.putULong("seq", seq);
  return seq;
}

uint32_t NvsConfig::sampleIntervalS() const {
  if (!open_) return kDefaultIntervalS;
  uint32_t v = prefs_.getUInt("cfg.interval", kDefaultIntervalS);
  return (v >= 5 && v <= 3600) ? v : kDefaultIntervalS;
}

void NvsConfig::setSampleIntervalS(uint32_t seconds) {
  if (!open_) return;
  if (seconds < 5) seconds = 5;
  if (seconds > 3600) seconds = 3600;
  prefs_.putUInt("cfg.interval", seconds);
}

float NvsConfig::windCalibrationCoef() const {
  if (!open_) return kUncalibratedCoef;
  float v = prefs_.getFloat("anemo.coef", kUncalibratedCoef);
  return (v > 0.0f) ? v : kUncalibratedCoef;
}

void NvsConfig::setWindCalibrationCoef(float coef) {
  if (!open_ || coef <= 0.0f) return;
  prefs_.putFloat("anemo.coef", coef);
}

uint32_t NvsConfig::ccsHours() const { return open_ ? prefs_.getUInt("ccs.hours", 0) : 0; }

void NvsConfig::addCcsHour() {
  if (!open_) return;
  prefs_.putUInt("ccs.hours", ccsHours() + 1);
}

void NvsConfig::countSent(uint32_t n) {
  if (!open_) return;
  prefs_.putULong("c.sent", sentCount() + n);
}
void NvsConfig::countRejected(uint32_t n) {
  if (!open_) return;
  prefs_.putULong("c.rej", rejectedCount() + n);
}
void NvsConfig::countCorrupt(uint32_t n) {
  if (!open_) return;
  prefs_.putULong("c.corr", corruptCount() + n);
}
void NvsConfig::countDropped(uint32_t n) {
  if (!open_) return;
  prefs_.putULong("c.drop", droppedCount() + n);
}

uint32_t NvsConfig::sentCount() const { return open_ ? prefs_.getULong("c.sent", 0) : 0; }
uint32_t NvsConfig::rejectedCount() const { return open_ ? prefs_.getULong("c.rej", 0) : 0; }
uint32_t NvsConfig::corruptCount() const { return open_ ? prefs_.getULong("c.corr", 0) : 0; }
uint32_t NvsConfig::droppedCount() const { return open_ ? prefs_.getULong("c.drop", 0) : 0; }

void NvsConfig::forgetNetwork() {
  if (!open_) return;
  prefs_.remove("wifi.ssid");
  prefs_.remove("wifi.pass");
  prefs_.remove("server.base");
}
