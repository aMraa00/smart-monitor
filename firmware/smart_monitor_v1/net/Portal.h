#pragma once

#include <Arduino.h>

/**
 * SoftAP setup portal (ARCHITECTURE.md FR-B2/FR-B3, §14).
 *
 * Served at http://192.168.4.1 while WifiLink::portalActive():
 *   GET  /            -> setup form (SSID, password, server URL)
 *   POST /save        -> validate + write to NVS -> reboot into station mode
 *   GET  /status      -> JSON: hwId, model, provisioned?, sensors present
 *
 * Physical-presence security: the AP only exists when the board has no
 * credentials (first boot), failed to connect, or the BOOT button was held
 * for 3 s. There is no password on the AP itself; the window is short-lived.
 */
class Portal {
 public:
  void begin();
  /** Serve clients; call every loop while portalActive(). */
  void tick();
  void stop();

 private:
  void handleRoot();
  void handleSave();
  void handleStatus();
  String formHtml() const;
};

extern Portal SetupPortal;
