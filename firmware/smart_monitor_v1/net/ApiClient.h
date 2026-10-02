#pragma once

#include <Arduino.h>

/**
 * Minimal HTTP client for the API.
 *
 * Two call shapes, matching the server's trust separation:
 *   postSigned()   -> device identity, HMAC headers, telemetry + heartbeat
 *   postAnon()     -> no identity, used only while provisioning (no secret yet)
 *
 * The base URL comes from NVS (portal), never from source, so the same image
 * works against localhost, a LAN server or production TLS.
 */
class ApiClient {
 public:
  /** @param base e.g. "http://192.168.1.90:5000" (no trailing slash) */
  void setBase(const String& base);
  const String& base() const { return base_; }

  bool online() const;

  /**
   * Signed POST.
   * @param outStatus HTTP status, or -1 on transport failure
   * @param outBody   response payload (error envelope on 4xx/5xx)
   * @return true when a response was received (any status)
   */
  bool postSigned(const String& path, const String& body, const String& secret,
                  int& outStatus, String& outBody);

  /** Unauthenticated POST (provisioning only). */
  bool postAnon(const String& path, const String& body, int& outStatus, String& outBody);

  /** GET with an optional Bearer token (used by the portal status page). */
  bool get(const String& path, int& outStatus, String& outBody);

 private:
  bool request(const String& method, const String& path, const String& body,
               const String& bearer, const String& secret, bool signRequest,
               int& outStatus, String& outBody);

  String base_;
  String scheme_;
  String host_;
  uint16_t port_ = 80;
  String prefix_;

  void parseBase();
};

extern ApiClient Api;
