#include "Provisioning.h"

#include <ArduinoJson.h>
#include <WiFi.h>
#include <esp_system.h>

#include "../config.h"
#include "../hal/NvsConfig.h"
#include "../net/ApiClient.h"
#include "Sampler.h"

Provisioning Provisioner;

String Provisioning::hwId() {
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  char buf[13];
  snprintf(buf, sizeof(buf), "%02x%02x%02x%02x%02x%02x", mac[0], mac[1], mac[2],
           mac[3], mac[4], mac[5]);
  return String(buf);
}

bool Provisioning::provisioned() const { return Config.hasIdentity(); }

bool Provisioning::run() {
  if (provisioned()) return true;
  if (WiFi.status() != WL_CONNECTED) return false;

  const String hw = hwId();
  Serial.print(F("[PROV] hwId="));
  Serial.println(hw);

  String token;
  if (!doRegister(hw, token)) return false;
  return doExchange(hw, token);
}

bool Provisioning::doRegister(const String& hwId, String& outToken) {
  JsonDocument doc;
  doc["hwId"] = hwId;
  doc["model"] = SM_MODEL;
  doc["hardwareRevision"] = SM_HW_REVISION;
  doc["firmwareVersion"] = SM_FW_VERSION;
  JsonArray caps = doc["capabilities"].to<JsonArray>();
  // Declared = what the sensors actually answered at boot.
  String declared = Samplers.declaredCapabilities();
  JsonDocument tmp;
  deserializeJson(tmp, declared);
  for (JsonVariant v : tmp.as<JsonArray>()) caps.add(v.as<const char*>());

  String body;
  serializeJson(doc, body);

  int status = -1;
  String resp;
  if (!Api.postAnon(SM_API_PREFIX "/provisioning/register", body, status, resp)) {
    Serial.print(F("[PROV] register transport failed: "));
    Serial.println(resp);
    return false;
  }
  if (status != 201) {
    Serial.print(F("[PROV] register "));
    Serial.print(status);
    Serial.print(F(": "));
    Serial.println(resp);
    return false;
  }

  JsonDocument out;
  if (deserializeJson(out, resp)) {
    Serial.println(F("[PROV] register: bad response JSON"));
    return false;
  }
  const char* token = out["data"]["provisioningToken"];
  const char* claim = out["data"]["claimCode"];
  if (!token || !token[0]) {
    Serial.println(F("[PROV] register: no token in response"));
    return false;
  }
  outToken = String(token);
  Serial.println(F("[PROV] registered. Claim code (enter in dashboard):"));
  Serial.print(F("        >>> "));
  Serial.print(claim ? claim : "(see dashboard)");
  Serial.println(F(" <<<"));
  return true;
}

bool Provisioning::doExchange(const String& hwId, const String& token) {
  JsonDocument doc;
  doc["provisioningToken"] = token;
  doc["hwId"] = hwId;
  String body;
  serializeJson(doc, body);

  int status = -1;
  String resp;
  if (!Api.postAnon(SM_API_PREFIX "/provisioning/exchange", body, status, resp)) {
    Serial.print(F("[PROV] exchange transport failed: "));
    Serial.println(resp);
    return false;
  }
  if (status != 201) {
    Serial.print(F("[PROV] exchange "));
    Serial.print(status);
    Serial.print(F(": "));
    Serial.println(resp);
    return false;
  }

  JsonDocument out;
  if (deserializeJson(out, resp)) {
    Serial.println(F("[PROV] exchange: bad response JSON"));
    return false;
  }
  const char* id = out["data"]["deviceId"];
  const char* secret = out["data"]["deviceSecret"];
  if (!id || !secret || !id[0] || !secret[0]) {
    Serial.println(F("[PROV] exchange: identity missing in response"));
    return false;
  }
  Config.setIdentity(String(id), String(secret));
  Serial.print(F("[PROV] identity stored: "));
  Serial.println(id);
  Serial.println(F("[PROV] deviceSecret was shown ONCE and is now in NVS only."));
  return true;
}
