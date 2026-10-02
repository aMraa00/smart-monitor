#pragma once

#include <Arduino.h>

/**
 * Wi-Fi station link with portal fallback (ARCHITECTURE.md FR-B, §8.4).
 *
 * Priority at boot:
 *   1. NVS credentials -> STA connect (non-blocking, ~10 s window)
 *   2. No credentials / connect failed / long button press -> SoftAP portal
 *      `SmartMonitor-<6hex>` at 192.168.4.1 (see Portal.h)
 *   3. Fresh credentials saved -> reboot into STA
 *
 * The loop never blocks on Wi-Fi: `tick()` advances retries, callers only
 * check `connected()` before doing network work.
 */
class WifiLink {
 public:
  void begin();
  void tick();

  bool connected() const;

  /** Force portal mode (long button press). */
  void startPortal();

  /** True while the SoftAP portal is being served. */
  bool portalActive() const { return portalActive_; }
  void setPortalActive(bool v) { portalActive_ = v; }

  /** SoftAP name derived from the MAC: SmartMonitor-<6hex>. */
  String apName() const;

 private:
  void connectStored();

  bool portalActive_ = false;
  uint32_t connectStartMs_ = 0;
  uint32_t lastRetryMs_ = 0;
  bool connecting_ = false;
};

extern WifiLink Wifi;
