#include "Uploader.h"

#include <ArduinoJson.h>
#include <WiFi.h>

#include "../config.h"
#include "../hal/NvsConfig.h"
#include "../hal/TimeSync.h"
#include "../net/ApiClient.h"
#include "Sampler.h"
#include "SdBuffer.h"

Uploader Uploader_;

bool Uploader::backingOff(uint32_t nowMs) const {
  return (nowMs - lastAttemptMs_) < backoffMs_;
}

size_t Uploader::pending() const { return Buffer.pendingCount(); }

void Uploader::tick() {
  const uint32_t now = millis();
  if (backingOff(now)) return;
  if (WiFi.status() != WL_CONNECTED) return;
  if (!Config.hasIdentity()) return;
  if (Buffer.pendingCount() == 0) return;

  String batch;
  size_t n = Buffer.peekBatch(SYNC_BATCH_MAX, batch);
  if (n == 0) return;

  lastAttemptMs_ = now;
  if (postBatch(batch, n)) {
    backoffMs_ = SYNC_BACKOFF_MIN_MS;
  } else {
    backoffMs_ = backoffMs_ * 2;
    if (backoffMs_ > SYNC_BACKOFF_MAX_MS) backoffMs_ = SYNC_BACKOFF_MAX_MS;
  }
}

bool Uploader::postBatch(const String& samplesArrayJson, size_t count) {
  // Body exactly as the server validates it (§20.4): capabilities = declared.
  String body;
  body.reserve(samplesArrayJson.length() + 160);
  body += F("{\"firmwareVersion\":\"");
  body += SM_FW_VERSION;
  body += F("\",\"hardwareRevision\":\"");
  body += SM_HW_REVISION;
  body += F("\",\"capabilities\":");
  body += Samplers.declaredCapabilities();
  body += F(",\"samples\":");
  body += samplesArrayJson;
  body += F("}");

  int status = -1;
  String resp;
  if (!Api.postSigned(SM_API_PREFIX "/telemetry", body, Config.deviceSecret(),
                      status, resp)) {
    Serial.print(F("[NET] telemetry transport failed: "));
    Serial.println(resp);
    return false;
  }

  if (status == 202) {
    Buffer.ackBatch(count);
    Config.countSent(count);
    Serial.print(F("[NET] telemetry 202 accepted x"));
    Serial.println(count);
    return true;
  }

  if (status >= 400 && status < 500) {
    // Auth / validation failure: retrying the same bytes is pointless.
    // Drop them (counted) so one poisoned sample cannot wedge the queue.
    Serial.print(F("[NET] telemetry rejected "));
    Serial.print(status);
    Serial.print(F(": "));
    Serial.println(resp);
    Buffer.ackBatch(count);
    Config.countRejected(count);
    return true;  // queue advanced; do not back off further
  }

  Serial.print(F("[NET] telemetry server error "));
  Serial.print(status);
  Serial.print(F(": "));
  Serial.println(resp);
  return false;
}
