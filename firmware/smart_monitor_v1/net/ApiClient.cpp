#include "ApiClient.h"

#include <HTTPClient.h>
#include <WiFi.h>

#include "../config.h"
#include "../hal/NvsConfig.h"
#include "HmacSigner.h"

ApiClient Api;

namespace {
constexpr uint16_t kConnectTimeoutMs = 5000;
constexpr uint16_t kReadTimeoutMs = 8000;
}  // namespace

void ApiClient::setBase(const String& base) {
  base_ = base;
  while (base_.endsWith("/")) base_.remove(base_.length() - 1);
  parseBase();
}

void ApiClient::parseBase() {
  scheme_ = "http";
  port_ = 80;
  prefix_ = "";

  String rest = base_;
  int schemeEnd = rest.indexOf("://");
  if (schemeEnd > 0) {
    scheme_ = rest.substring(0, schemeEnd);
    rest = rest.substring(schemeEnd + 3);
  }
  if (scheme_ == "https") port_ = 443;

  int pathStart = rest.indexOf('/');
  String hostPort = (pathStart > 0) ? rest.substring(0, pathStart) : rest;
  if (pathStart > 0) prefix_ = rest.substring(pathStart);

  int colon = hostPort.indexOf(':');
  if (colon > 0) {
    host_ = hostPort.substring(0, colon);
    port_ = (uint16_t)hostPort.substring(colon + 1).toInt();
  } else {
    host_ = hostPort;
  }
}

bool ApiClient::online() const {
  return WiFi.status() == WL_CONNECTED && host_.length() > 0;
}

bool ApiClient::postSigned(const String& path, const String& body, const String& secret,
                           int& outStatus, String& outBody) {
  return request("POST", path, body, "", secret, true, outStatus, outBody);
}

bool ApiClient::postAnon(const String& path, const String& body, int& outStatus, String& outBody) {
  return request("POST", path, body, "", "", false, outStatus, outBody);
}

bool ApiClient::get(const String& path, int& outStatus, String& outBody) {
  return request("GET", path, "", "", "", false, outStatus, outBody);
}

bool ApiClient::request(const String& method, const String& path, const String& body,
                        const String& bearer, const String& secret, bool doSign,
                        int& outStatus, String& outBody) {
  outStatus = -1;
  outBody = "";

  if (!online()) return false;

  const String url = scheme_ + "://" + host_ + ":" + String(port_) + prefix_ + path;
  const bool tls = (scheme_ == "https");

  HTTPClient http;
  http.setConnectTimeout(kConnectTimeoutMs);
  http.setTimeout(kReadTimeoutMs);
  http.setReuse(false);
  http.setUserAgent("smart_monitor_v1/" SM_FW_VERSION);

  // Arduino-ESP32 2.x HTTPClient has no begin(Client&, url) overload - only
  // begin(String url) / begin(String url, const char* CAcert). Plain http
  // uses the simple form; https-insecure-dev passes nullptr CA (accepted on
  // this core revision); https-prod passes the embedded root CA.
  bool begun = false;
  if (!tls) {
    begun = http.begin(url);
  } else if (SM_TLS_INSECURE) {
    begun = http.begin(url, nullptr);
  } else if (strlen(SM_TLS_ROOT_CA) > 0) {
    begun = http.begin(url, SM_TLS_ROOT_CA);
  } else {
    outBody = "no root CA configured for https";
    return false;
  }
  if (!begun) {
    outBody = "url rejected";
    return false;
  }

  http.addHeader("Content-Type", "application/json");

  if (doSign) {
    // PATH exactly as the server reconstructs it: originalUrl minus query.
    HmacSigner::SignedHeaders h = HmacSigner::sign(secret, method, path, body);
    http.addHeader("X-Device-Id", Config.deviceId());
    http.addHeader("X-Timestamp", h.timestamp);
    http.addHeader("X-Nonce", h.nonce);
    http.addHeader("X-Body-SHA256", h.bodySha256);
    http.addHeader("X-Signature", h.signature);
  }
  if (bearer.length()) {
    http.addHeader("Authorization", "Bearer " + bearer);
  }

  int code = (method == "GET") ? http.GET() : http.POST(body);
  if (code > 0) {
    outStatus = code;
    outBody = http.getString();
  } else {
    // Negative code = transport failure (connect/DNS/timeout).
    outStatus = -1;
    outBody = http.errorToString(code);
  }

  http.end();
  return outStatus > 0;
}
