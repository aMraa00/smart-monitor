/**
 * smart_monitor_v1 - ESP32 firmware entry point.
 *
 * Data path (ARCHITECTURE.md 8, 13.2):
 *   sensors -> Sampler (1/min aggregate) -> SdBuffer (SD + RAM)
 *           -> Uploader (POST /telemetry, HMAC) -> server -> MongoDB Atlas
 *           -> dashboard (realtime socket + charts)
 *
 * The ESP32 NEVER talks to MongoDB directly. It only speaks HTTP JSON
 * to the API; the server validates (Zod), stores exactly-once (sampleId
 * guard) and broadcasts to the dashboard. MONGO_URI lives in server/.env.
 *
 * Cooperative scheduler: no delay() anywhere except the portal-save reboot.
 * Every task runs on its own period; sensor reads are round-robin so one
 * slow driver never blocks the loop.
 */

#include <Arduino.h>
#include <WiFi.h>

#include "capabilities.h"
#include "config.h"
#include "hal/NvsConfig.h"
#include "hal/TimeSync.h"
#include "net/ApiClient.h"
#include "net/Portal.h"
#include "net/WifiLink.h"
#include "services/Provisioning.h"
#include "services/Sampler.h"
#include "services/SdBuffer.h"
#include "services/Uploader.h"

// ---------------------------------------------------------------------------
// Local state
// ---------------------------------------------------------------------------
namespace {
uint32_t tSensor = 0;
uint32_t tAggregate = 0;
uint32_t tNet = 0;
uint32_t tHeartbeat = 0;
uint32_t tSync = 0;
uint32_t tButton = 0;
uint32_t tLed = 0;

uint32_t buttonDownSince = 0;
bool buttonWasDown = false;
bool ledOn = false;

// BOOT button on GPIO0 is active-LOW.
bool buttonDown() { return digitalRead(PIN_BUTTON) == LOW; }

void ledSet(bool on) {
  digitalWrite(PIN_LED, on ? HIGH : LOW);
  ledOn = on;
}

void handleButton(uint32_t now) {
  const bool down = buttonDown();
  if (down && !buttonWasDown) buttonDownSince = now;
  if (!down && buttonWasDown) buttonDownSince = 0;
  if (down && buttonWasDown && buttonDownSince != 0) {
    const uint32_t held = now - buttonDownSince;
    if (held >= BUTTON_VERY_LONG_MS) {
      Serial.println(F("[BTN] very long -> forget Wi-Fi (identity kept)"));
      Config.forgetNetwork();
      delay(300);
      ESP.restart();
    } else if (held >= BUTTON_LONG_MS) {
      buttonDownSince = 0;  // act once until release
      Serial.println(F("[BTN] long press -> portal"));
      if (!Wifi.portalActive()) {
        Wifi.startPortal();
        SetupPortal.begin();
      }
    }
  }
  buttonWasDown = down;
}

void handleLed() {
  if (Wifi.portalActive()) {
    ledSet((millis() / 500) % 2 == 0);  // slow blink: portal up
  } else if (WiFi.status() == WL_CONNECTED) {
    if (!ledOn) ledSet(true);  // solid: linked
  } else {
    ledSet((millis() / 150) % 2 == 0);  // fast blink: hunting
  }
}

/** Build one sample object line and append it to the offline buffer. */
void takeSample() {
  const uint32_t now = millis();
  if (!Samplers.hasFreshData(now)) {
    Serial.println(F("[SAMPLE] no fresh data -> skipped (nothing invented)"));
    return;
  }
  String caps;
  const size_t n = Samplers.buildCapabilities(now, caps);
  if (n == 0) {
    Serial.println(F("[SAMPLE] empty capability set -> skipped"));
    return;
  }
  char sid[80];
  snprintf(sid, sizeof(sid), "%s-%010lu", Config.deviceId().c_str(),
           (unsigned long)Config.nextSequence());
  String sample = F("{\"sampleId\":\"");
  sample += sid;
  sample += F("\",\"ts\":\"");
  sample += Clock.iso8601();
  sample += F("\",\"timeQuality\":\"");
  sample += Clock.quality();
  sample += F("\",\"capabilities\":");
  sample += caps;
  sample += F("}");
  Buffer.append(sample);
  Serial.print(F("[SAMPLE] buffered "));
  Serial.print(sid);
  Serial.print(F(" caps="));
  Serial.println(n);
}

/** Signed liveness report (FR-G3). Best-effort: never blocks sampling. */
void sendHeartbeat() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (!Config.hasIdentity()) return;
  String body = F("{\"firmwareVersion\":\"");
  body += SM_FW_VERSION;
  body += F("\",\"rssi\":");
  body += String(WiFi.RSSI());
  body += F(",\"ip\":\"");
  body += WiFi.localIP().toString();
  body += F("\",\"uptimeS\":");
  body += String((unsigned long)(millis() / 1000UL));
  body += F(",\"timeQuality\":\"");
  body += Clock.quality();
  body += F("\",\"backlog\":");
  body += String((unsigned long)Buffer.pendingCount());
  body += F(",\"capabilities\":");
  body += Samplers.declaredCapabilities();
  body += F(",\"sensors\":");
  body += Samplers.sensorStatusJson();
  body += F("}");
  int status = -1;
  String resp;
  if (!Api.postSigned(SM_API_PREFIX "/provisioning/heartbeat", body,
                      Config.deviceSecret(), status, resp)) {
    Serial.print(F("[HB] transport failed: "));
    Serial.println(resp);
    return;
  }
  if (status == 200) {
    Serial.println(F("[HB] ok"));
  } else {
    Serial.print(F("[HB] "));
    Serial.print(status);
    Serial.print(F(": "));
    Serial.println(resp);
  }
}

void printHelp() {
  Serial.println(F("commands: status | sample | sync | reset-net | help"));
}

void handleSerial() {
  if (!Serial.available()) return;
  String cmd = Serial.readStringUntil('\n');
  cmd.trim();
  if (cmd == "status") {
    Serial.print(F("hwId="));
    Serial.println(Provisioning::hwId());
    Serial.print(F("deviceId="));
    Serial.println(Config.deviceId());
    Serial.print(F("provisioned="));
    Serial.println(Config.hasIdentity() ? "yes" : "no");
    Serial.print(F("pending="));
    Serial.println(Buffer.pendingCount());
    Serial.print(F("time="));
    Serial.print(Clock.iso8601());
    Serial.print(F(" "));
    Serial.println(Clock.quality());
  } else if (cmd == "sample") {
    takeSample();
  } else if (cmd == "sync") {
    Uploader_.tick();
  } else if (cmd == "reset-net") {
    Config.forgetNetwork();
    ESP.restart();
  } else {
    printHelp();
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 1500) { /* wait briefly for USB serial */ }

  Serial.println();
  Serial.println(F("=== smart_monitor_v1 " SM_FW_VERSION " ==="));
#if SM_TLS_INSECURE
  Serial.println(F("!!! TLS INSECURE=1: development only, do not ship !!!"));
#endif

  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  ledSet(true);

  Config.begin();

  Samplers.begin();   // probe every driver, declare real capabilities
  Buffer.begin();     // SD card or RAM fallback
  Clock.begin("UTC");  // NTP in background; sampling works regardless

  Api.setBase(Config.serverBase());
  Serial.print(F("[NET] server="));
  Serial.println(Config.serverBase());

  Wifi.begin();
  if (Wifi.portalActive()) SetupPortal.begin();
  Uploader_.begin();

  const uint32_t now = millis();
  tSensor = tAggregate = tNet = tHeartbeat = tSync = tButton = tLed = now;

  Serial.println(F("[BOOT] ready. type 'help' for commands."));
  printHelp();
}

void loop() {
  const uint32_t now = millis();

  if (Wifi.portalActive()) SetupPortal.tick();

  if (now - tButton >= TASK_BUTTON_MS) {
    tButton = now;
    handleButton(now);
  }
  if (now - tLed >= 100) {
    tLed = now;
    handleLed();
  }
  if (now - tSensor >= TASK_SENSOR_POLL_MS) {
    tSensor = now;
    Samplers.pollNextDriver();  // exactly one driver per tick
  }

  if (now - tNet >= TASK_NET_CHECK_MS) {
    tNet = now;
    Wifi.tick();
    if (Wifi.connected()) {
      if (Clock.needsSync(now, 6UL * 60UL * 60UL * 1000UL)) Clock.syncAsync();
      if (!Config.hasIdentity()) Provisioner.run();  // register+exchange, once
    }
  }

  const uint32_t intervalMs = Config.sampleIntervalS() * 1000UL;
  if (now - tAggregate >= intervalMs) {
    tAggregate = now;
    if (Config.hasIdentity()) takeSample();
  }

  if (now - tSync >= TASK_SYNC_MS) {
    tSync = now;
    Uploader_.tick();  // one batch per tick, backoff-aware
  }

  if (now - tHeartbeat >= TASK_HEARTBEAT_MS) {
    tHeartbeat = now;
    sendHeartbeat();
  }

  handleSerial();
  yield();  // feed the watchdog; never delay()
}

