#pragma once

#include <Arduino.h>

/**
 * Batch uploader: SD/RAM buffer -> POST /telemetry -> ack on 202.
 *
 * Delivery is at-least-once, storage is exactly-once: the server keeps a
 * unique {device, sampleId} guard, so re-sending an unacked batch after a
 * crash or timeout is always safe. Only a 202 removes records.
 *
 * Backoff: 2 s -> 60 s exponential between transport failures so a dead
 * network does not spin the loop; a 4xx (bad payload/auth) is counted as
 * REJECTED and dropped, never retried blindly.
 */
class Uploader {
 public:
  void begin() { backoffMs_ = 2000; lastAttemptMs_ = 0; }

  /** Try one batch. Call every TASK_SYNC_MS; internally rate-limited. */
  void tick();

  /** True while waiting out a backoff window. */
  bool backingOff(uint32_t nowMs) const;

  size_t pending() const;

 private:
  bool postBatch(const String& samplesArrayJson, size_t count);

  uint32_t backoffMs_ = 2000;
  uint32_t lastAttemptMs_ = 0;
};

extern Uploader Uploader_;
