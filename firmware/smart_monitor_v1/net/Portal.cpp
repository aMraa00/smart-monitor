#include "Portal.h"

#include <WebServer.h>

#include "../config.h"
#include "../hal/NvsConfig.h"
#include "../services/Provisioning.h"
#include "../services/Sampler.h"
#include "WifiLink.h"

Portal SetupPortal;

namespace {
WebServer* s_server = nullptr;
}

void Portal::begin() {
  if (s_server) return;
  s_server = new WebServer(80);
  s_server->on("/", HTTP_GET, [this]() { handleRoot(); });
  s_server->on("/save", HTTP_POST, [this]() { handleSave(); });
  s_server->on("/status", HTTP_GET, [this]() { handleStatus(); });
  s_server->onNotFound([this]() { handleRoot(); });  // captive-portal behaviour
  s_server->begin();
  Serial.println(F("[PORTAL] http://192.168.4.1"));
}

void Portal::tick() {
  if (s_server) s_server->handleClient();
}

void Portal::stop() {
  if (!s_server) return;
  s_server->stop();
  delete s_server;
  s_server = nullptr;
  Wifi.setPortalActive(false);
}

String Portal::formHtml() const {
  String h = F("<!doctype html><html><head><meta charset=utf-8>"
               "<meta name=viewport content='width=device-width,initial-scale=1'>"
               "<title>SmartMonitor setup</title></head><body style='font-family:sans-serif;max-width:480px;margin:2em auto'>"
               "<h1>SmartMonitor setup</h1>"
               "<form method=POST action=/save>"
               "<p><label>Wi-Fi name (SSID)<br><input name=ssid required style='width:100%'></label></p>"
               "<p><label>Wi-Fi password<br><input name=pass type=password style='width:100%'></label></p>"
               "<p><label>Server URL<br><input name=server style='width:100%' placeholder='http://192.168.1.90:5000'></label></p>"
               "<p><button type=submit>Save &amp; reboot</button></p>"
               "</form>"
               "<p><a href=/status>device status (JSON)</a></p>"
               "</body></html>");
  return h;
}

void Portal::handleRoot() {
  s_server->send(200, "text/html", formHtml());
}

void Portal::handleSave() {
  String ssid = s_server->arg("ssid");
  String pass = s_server->arg("pass");
  String server = s_server->arg("server");
  ssid.trim();
  server.trim();
  if (!ssid.length()) {
    s_server->send(400, "text/plain", "ssid is required");
    return;
  }
  Config.setWifi(ssid, pass);
  if (server.length()) Config.setServerBase(server);
  Serial.print(F("[PORTAL] credentials saved for "));
  Serial.println(ssid);
  s_server->send(200, "text/html",
                 F("<p>Saved. Rebooting...</p><script>setTimeout(function(){},3000)</script>"));
  delay(500);
  ESP.restart();
}

void Portal::handleStatus() {
  String j = F("{\"hwId\":\"");
  j += Provisioning::hwId();
  j += F("\",\"model\":\"");
  j += SM_MODEL;
  j += F("\",\"provisioned\":");
  j += Config.hasIdentity() ? F("true") : F("false");
  j += F(",\"sensorsPresent\":");
  j += String(Samplers.presentCount());
  j += F("}");
  s_server->send(200, "application/json", j);
}
