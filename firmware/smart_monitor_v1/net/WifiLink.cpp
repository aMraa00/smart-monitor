#include "WifiLink.h"

#include <WiFi.h>

#include "../config.h"
#include "../hal/NvsConfig.h"

WifiLink Wifi;

namespace {
constexpr uint32_t kConnectWindowMs = 10000;
constexpr uint32_t kRetryEveryMs = 30000;
}

void WifiLink::begin() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);
  if (Config.hasWifi()) {
    connectStored();
  } else {
    Serial.println(F("[WIFI] no credentials -> portal"));
    startPortal();
  }
}

void WifiLink::connectStored() {
  const String ssid = Config.wifiSsid();
  const String pass = Config.wifiPass();
  if (!ssid.length()) {
    startPortal();
    return;
  }
  Serial.print(F("[WIFI] connecting to "));
  Serial.println(ssid);
  WiFi.begin(ssid.c_str(), pass.c_str());
  connectStartMs_ = millis();
  lastRetryMs_ = millis();
  connecting_ = true;
}

void WifiLink::tick() {
  if (portalActive_) return;
  if (WiFi.status() == WL_CONNECTED) {
    if (connecting_) {
      connecting_ = false;
      Serial.print(F("[WIFI] connected, ip="));
      Serial.println(WiFi.localIP());
    }
    return;
  }
  const uint32_t now = millis();
  if (connecting_ && (now - connectStartMs_) > kConnectWindowMs) {
    Serial.println(F("[WIFI] connect timeout -> portal"));
    connecting_ = false;
    startPortal();
    return;
  }
  if (!connecting_ && Config.hasWifi() && (now - lastRetryMs_) > kRetryEveryMs) {
    lastRetryMs_ = now;
    connectStored();
  }
}

bool WifiLink::connected() const { return WiFi.status() == WL_CONNECTED; }

String WifiLink::apName() const {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char buf[24];
  snprintf(buf, sizeof(buf), SM_AP_PREFIX "%02X%02X%02X", mac[3], mac[4], mac[5]);
  return String(buf);
}

void WifiLink::startPortal() {
  if (portalActive_) return;
  WiFi.disconnect(true, true);
  WiFi.mode(WIFI_AP_STA);
  const String name = apName();
  WiFi.softAP(name.c_str(), SM_AP_PASSWORD);
  IPAddress ip(192, 168, 4, 1);
  WiFi.softAPConfig(ip, ip, IPAddress(255, 255, 255, 0));
  portalActive_ = true;
  Serial.print(F("[WIFI] portal AP: "));
  Serial.print(name);
  Serial.println(F(" -> join it, open http://192.168.4.1"));
}
