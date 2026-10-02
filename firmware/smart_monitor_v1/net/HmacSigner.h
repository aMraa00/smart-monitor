#pragma once

#include <Arduino.h>

/**
 * Per-request HMAC-SHA256 signing - the ONLY way a device may write data.
 *
 * Must stay byte-identical to server/src/utils/crypto.util.js:
 *
 *   canonical  = METHOD \n PATH \n X-Timestamp \n X-Nonce \n X-Body-SHA256
 *   X-Signature= hex( HMAC-SHA256(deviceSecret, canonical) )
 *
 * The `deviceId` sent alongside is PUBLIC and authenticates nothing: without
 * the secret a captured request cannot be resigned for a different body, and
 * the single-use nonce stops it being replayed (threats T1, T2, prompt §42).
 */
namespace HmacSigner {

/** Lowercase hex SHA-256 of `data`. */
String sha256Hex(const String& data);

/** UUID v4 from the hardware RNG (single-use nonce). */
String makeNonce();

/** Build the five signed headers plus Content-Type for a POST. */
struct SignedHeaders {
  String deviceId;
  String timestamp;
  String nonce;
  String bodySha256;
  String signature;
};

/**
 * @param secret   the per-device secret (NVS, never in source)
 * @param method   HTTP method, e.g. "POST"
 * @param path     request path WITHOUT query, e.g. "/api/v1/telemetry"
 * @param body     the exact bytes that will be transmitted
 */
SignedHeaders sign(const String& secret,
                   const String& method,
                   const String& path,
                   const String& body);

}  // namespace HmacSigner
