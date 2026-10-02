#pragma once

#include <Arduino.h>

/**
 * Time strategy for a board with NO RTC (ARCHITECTURE.md §8.4).
 *
 *   "ntp"      -> SNTP answered since boot; timestamps are trusted
 *   "synced"   -> NTP answered earlier this power cycle, extrapolated by millis()
 *   "estimated"-> never NTP-synced; last known wall clock + uptime, still RECORDED
 *
 * The server stores the quality with every sample and never treats an
 * `estimated` timestamp as authoritative. Sampling continues either way - a
 * device must keep working while the internet is down.
 */
class TimeSync {
 public:
  void begin(const char* tz = "UTC");
  /** Kick off (or restart) an SNTP sync. Non-blocking. */
  void syncAsync();

  bool isNtp() const { return quality_ == Quality::kNtp; }
  const char* quality() const;
  bool everSynced() const { return syncedAtMs_ != 0; }

  /** True when a re-sync is due (never synced, or last sync > 6 h ago). */
  bool needsSync(uint32_t nowMs, uint32_t intervalMs) const;

  /** Epoch seconds, valid for every quality level (best effort). */
  time_t now() const;

  /** ISO-8601 UTC with milliseconds: 2026-02-10T09:15:00.000Z (server contract). */
  String iso8601() const;

 private:
  enum class Quality : uint8_t { kEstimated, kSynced, kNtp };
  mutable Quality quality_ = Quality::kEstimated;
  mutable uint32_t syncedAtMs_ = 0;   // millis() at the last successful sync
  mutable time_t syncedEpoch_ = 0;    // epoch at the last successful sync
  mutable bool sntpStarted_ = false;
};

extern TimeSync Clock;
