#pragma once

#include <Arduino.h>

/**
 * Offline-first sample buffer (ARCHITECTURE.md §8.2, §13.2).
 *
 * Two tiers:
 *   1. SD card  - `/smv1/seg-00000.ndjson`, one JSON sample per line.
 *                 Rotates after SD_SEGMENT_MAX lines. Survives power loss.
 *   2. RAM queue - used when no card is fitted (bounded RAM_QUEUE_MAX).
 *
 * The uploader asks for a batch (peek), POSTs it, then acks on 202.
 * Nothing is ever deleted before the server confirms it.
 */
class SdBuffer {
 public:
  bool begin();
  bool sdReady() const { return sdReady_; }

  /** Append one already-built sample JSON line. Always succeeds (RAM fallback). */
  bool append(const String& sampleJson);

  /** Total pending samples (SD + RAM). */
  size_t pendingCount() const;

  /**
   * Fill `out` with up to `maxSamples` samples as a JSON array string.
   * @return number of samples placed in `out` (0 = nothing pending)
   */
  size_t peekBatch(size_t maxSamples, String& out);

  /** Drop the oldest `n` samples after the server accepted them. */
  void ackBatch(size_t n);

  uint32_t corruptCount() const { return corrupt_; }

 private:
  bool sdReady_ = false;
  uint32_t corrupt_ = 0;

  // RAM fallback (also used as read cache).
  static const size_t kRamMax = 64;
  String ramQueue_[64];
  size_t ramHead_ = 0;
  size_t ramCount_ = 0;

  String segPath(uint32_t index) const;
  uint32_t segIndex_ = 0;
  size_t segLines_ = 0;

  size_t sdLineCount(const String& path);
  bool sdAppendLine(const String& path, const String& line);
  bool sdDropFirstLines(const String& path, size_t n);
};

extern SdBuffer Buffer;
