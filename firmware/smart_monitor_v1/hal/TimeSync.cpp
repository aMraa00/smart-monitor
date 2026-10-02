#include "TimeSync.h"

#include <time.h>

#include <esp_sntp.h>

TimeSync Clock;

namespace {
constexpr uint32_t kResyncIntervalMs = 6UL * 60UL * 60UL * 1000UL;
}

void TimeSync::begin(const char* tz) {
  // Set the zone first so a later sync immediately yields local wall time.
  setenv("TZ", tz, 1);
  tzset();
  syncAsync();
}

void TimeSync::syncAsync() {
  // configTime is non-blocking: it schedules the SNTP query and returns.
  configTime(0, 0, "pool.ntp.org", "time.google.com", "time.nist.gov");
  sntpStarted_ = true;
}

const char* TimeSync::quality() const {
  switch (quality_) {
    case Quality::kNtp:
      return "ntp";
    case Quality::kSynced:
      return "synced";
    default:
      return "estimated";
  }
}

bool TimeSync::needsSync(uint32_t nowMs, uint32_t intervalMs) const {
  if (!sntpStarted_) return true;
  if (syncedAtMs_ == 0) return true;
  return (nowMs - syncedAtMs_) > intervalMs;
}

time_t TimeSync::now() const {
  time_t wall = time(nullptr);
  if (wall < 1000000000L) {
    // Not synced yet: extrapolate from the last known point + uptime so a
    // sample is still stamped (marked `estimated`) instead of being dropped.
    if (syncedEpoch_ > 0 && syncedAtMs_ > 0) {
      return syncedEpoch_ + (time_t)((millis() - syncedAtMs_) / 1000UL);
    }
    return 0;
  }

  // SNTP answered since boot -> promote to "ntp".
  if (quality_ != Quality::kNtp) {
    quality_ = Quality::kNtp;
    syncedAtMs_ = millis();
    syncedEpoch_ = wall;
  }
  return wall;
}

String TimeSync::iso8601() const {
  time_t t = now();
  if (t <= 0) {
    // Nothing to anchor to: emit the epoch rather than an empty field, and let
    // the quality flag tell the server this timestamp cannot be trusted.
    t = 0;
    quality_ = Quality::kEstimated;
  }

  struct tm tmUtc;
  gmtime_r(&t, &tmUtc);

  // Derive milliseconds from millis(): second-resolution epoch alone would make
  // two samples inside the same second look identical to the server.
  uint16_t ms = (uint16_t)(millis() % 1000UL);

  char buf[32];
  size_t n = strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%S", &tmUtc);

  if (quality_ == Quality::kNtp && syncedAtMs_ == 0) syncedAtMs_ = millis();
  // A sync that happened earlier this power cycle but is no longer reachable
  // still counts as `synced` (millis extrapolation), never as `ntp`.
  if (quality_ == Quality::kNtp && !sntpStarted_) quality_ = Quality::kSynced;

  char out[40];
  snprintf(out, sizeof(out), "%s.%03uZ", buf, (unsigned)ms);
  (void)n;
  return String(out);
}
