#include "SdBuffer.h"

#include <SD.h>
#include <SPI.h>

#include "../config.h"

SdBuffer Buffer;

namespace {
constexpr const char* kDir = "/smv1";
}

String SdBuffer::segPath(uint32_t index) const {
  char buf[32];
  snprintf(buf, sizeof(buf), "/smv1/seg-%05lu.ndjson", (unsigned long)index);
  return String(buf);
}

bool SdBuffer::begin() {
  SPI.begin(PIN_SD_SCK, PIN_SD_MISO, PIN_SD_MOSI, PIN_SD_CS);
  if (!SD.begin(PIN_SD_CS, SPI)) {
    Serial.println(F("[SD] no card -> RAM queue only (64 samples)"));
    sdReady_ = false;
    return false;
  }
  if (!SD.exists(kDir)) SD.mkdir(kDir);
  // Resume from the newest existing segment.
  uint32_t idx = 0;
  while (SD.exists(segPath(idx + 1))) idx += 1;
  segIndex_ = idx;
  segLines_ = sdLineCount(segPath(segIndex_));
  sdReady_ = true;
  Serial.print(F("[SD] ready, pending="));
  Serial.println(pendingCount());
  return true;
}

bool SdBuffer::append(const String& sampleJson) {
  if (sdReady_) {
    if (segLines_ >= SD_SEGMENT_MAX) {
      segIndex_ += 1;
      segLines_ = 0;
    }
    if (sdAppendLine(segPath(segIndex_), sampleJson)) {
      segLines_ += 1;
      return true;
    }
    Serial.println(F("[SD] write failed -> falling back to RAM"));
    sdReady_ = false;
  }
  // RAM fallback: drop oldest when full, count it as dropped data.
  if (ramCount_ >= kRamMax) {
    ramHead_ = (ramHead_ + 1) % kRamMax;
    ramCount_ -= 1;
  }
  ramQueue_[(ramHead_ + ramCount_) % kRamMax] = sampleJson;
  ramCount_ += 1;
  return true;
}

size_t SdBuffer::pendingCount() const {
  size_t n = ramCount_;
  if (sdReady_) {
    // segLines_ tracks the HEAD segment; older segments are full-size.
    // Recompute cheaply: head lines + full segments before it.
    n += segLines_;
    for (uint32_t i = 0; i < segIndex_; i += 1) {
      (void)i;
      n += SD_SEGMENT_MAX;  // older segments rotated exactly at the cap
    }
  }
  return n;
}

size_t SdBuffer::peekBatch(size_t maxSamples, String& out) {
  out = "[";
  size_t added = 0;
  // Oldest segment first; within the head segment skip already-acked lines.
  if (sdReady_) {
    for (uint32_t i = 0; i <= segIndex_ && added < maxSamples; i += 1) {
      File f = SD.open(segPath(i), FILE_READ);
      if (!f) continue;
      while (f.available() && added < maxSamples) {
        String line = f.readStringUntil('\n');
        line.trim();
        if (!line.length()) continue;
        if (line.charAt(0) != '{') { corrupt_ += 1; continue; }
        if (added) out += ',';
        out += line;
        added += 1;
      }
      f.close();
    }
  }
  for (size_t i = 0; i < ramCount_ && added < maxSamples; i += 1) {
    if (added) out += ',';
    out += ramQueue_[(ramHead_ + i) % kRamMax];
    added += 1;
  }
  out += "]";
  return added;
}

void SdBuffer::ackBatch(size_t n) {
  size_t left = n;
  // Drop from SD oldest-first.
  if (sdReady_) {
    for (uint32_t i = 0; i <= segIndex_ && left > 0;) {
      size_t inSeg = sdLineCount(segPath(i));
      if (inSeg == 0) {
        SD.remove(segPath(i));
        if (i == segIndex_) { segLines_ = 0; break; }
        // Compact: shift names down (segments are few, lines are many).
        for (uint32_t j = i; j < segIndex_; j += 1) {
          SD.rename(segPath(j + 1), segPath(j));
        }
        segIndex_ -= 1;
        continue;
      }
      size_t drop = (left < inSeg) ? left : inSeg;
      if (sdDropFirstLines(segPath(i), drop)) {
        left -= drop;
        if (i == segIndex_) segLines_ -= drop;
      } else {
        break;
      }
      if (sdLineCount(segPath(i)) == 0) {
        SD.remove(segPath(i));
        if (i == segIndex_) { segLines_ = 0; break; }
        for (uint32_t j = i; j < segIndex_; j += 1) SD.rename(segPath(j + 1), segPath(j));
        segIndex_ -= 1;
      } else {
        i += 1;
      }
    }
  }
  // Then from RAM.
  while (left > 0 && ramCount_ > 0) {
    ramHead_ = (ramHead_ + 1) % kRamMax;
    ramCount_ -= 1;
    left -= 1;
  }
}

size_t SdBuffer::sdLineCount(const String& path) {
  File f = SD.open(path, FILE_READ);
  if (!f) return 0;
  size_t n = 0;
  while (f.available()) {
    if (f.read() == '\n') n += 1;
  }
  f.close();
  return n;
}

bool SdBuffer::sdAppendLine(const String& path, const String& line) {
  File f = SD.open(path, FILE_APPEND);
  if (!f) return false;
  f.println(line);
  f.close();
  return true;
}

bool SdBuffer::sdDropFirstLines(const String& path, size_t n) {
  File src = SD.open(path, FILE_READ);
  if (!src) return false;
  String tmp = path + ".tmp";
  File dst = SD.open(tmp, FILE_WRITE);
  if (!dst) { src.close(); return false; }
  size_t skipped = 0;
  while (src.available()) {
    String line = src.readStringUntil('\n');
    if (skipped < n) { skipped += 1; continue; }
    dst.println(line);
  }
  src.close();
  dst.close();
  SD.remove(path);
  SD.rename(tmp, path);
  return true;
}
