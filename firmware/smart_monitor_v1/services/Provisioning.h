#pragma once

#include <Arduino.h>

/**
 * First-boot identity flow (ARCHITECTURE.md §20.2, FR-B / FR-C).
 *
 * Two unauthenticated calls, each used exactly in this order:
 *   1. POST /provisioning/register  { hwId, model, ... } -> provisioningToken
 *   2. POST /provisioning/exchange  { provisioningToken, hwId } -> deviceSecret
 *
 * The secret is returned EXACTLY ONCE and stored in NVS; after that every
 * request is HMAC-signed. `hwId` is the ESP32 eFuse MAC (stable across
 * reflash), so re-provisioning the same board yields the SAME deviceId and
 * never creates duplicates server-side (idempotent per hardware unit).
 */
class Provisioning {
 public:
  /** Stable hardware id: lowercase hex of the eFuse MAC, e.g. "a1b2c3d4e5f6". */
  static String hwId();

  /** True once register+exchange completed (deviceId + secret in NVS). */
  bool provisioned() const;

  /**
   * Run the two-step flow. Blocking but short (two HTTP calls); called only
   * when !provisioned() and Wi-Fi is up.
   * @return true when identity is now stored, false on any failure
   */
  bool run();

 private:
  bool doRegister(const String& hwId, String& outToken);
  bool doExchange(const String& hwId, const String& token);
};

extern Provisioning Provisioner;
