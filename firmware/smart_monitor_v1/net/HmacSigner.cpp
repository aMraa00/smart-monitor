#include "HmacSigner.h"

#include <esp_random.h>
#include <mbedtls/md.h>
#include <mbedtls/sha256.h>

namespace {

/** Emit `len` bytes of `raw` as lowercase hex into `out`. */
void toHex(const uint8_t* raw, size_t len, String& out) {
  static const char* kDigits = "0123456789abcdef";
  out.reserve(len * 2);
  for (size_t i = 0; i < len; i += 1) {
    out += kDigits[(raw[i] >> 4) & 0x0F];
    out += kDigits[raw[i] & 0x0F];
  }
}

}  // namespace

namespace HmacSigner {

String sha256Hex(const String& data) {
  uint8_t digest[32];
  mbedtls_sha256_context ctx;
  mbedtls_sha256_init(&ctx);
  mbedtls_sha256_starts(&ctx, 0);
  mbedtls_sha256_update(&ctx, reinterpret_cast<const uint8_t*>(data.c_str()), data.length());
  mbedtls_sha256_finish(&ctx, digest);
  mbedtls_sha256_free(&ctx);

  String out;
  toHex(digest, sizeof(digest), out);
  return out;
}

String makeNonce() {
  // 16 random bytes -> RFC 4122 version 4 layout.
  uint8_t b[16];
  for (uint8_t i = 0; i < 16; i += 1) {
    b[i] = (uint8_t)(esp_random() & 0xFF);
  }
  b[6] = (uint8_t)((b[6] & 0x0F) | 0x40);
  b[8] = (uint8_t)((b[8] & 0x3F) | 0x80);

  const char* hex = "0123456789abcdef";
  char out[37];
  int p = 0;
  for (int i = 0; i < 16; i += 1) {
    if (i == 4 || i == 6 || i == 8 || i == 10) out[p++] = '-';
    out[p++] = hex[(b[i] >> 4) & 0x0F];
    out[p++] = hex[b[i] & 0x0F];
  }
  out[p] = '\0';
  return String(out);
}

SignedHeaders sign(const String& secret,
                   const String& method,
                   const String& path,
                   const String& body) {
  SignedHeaders h;
  // Timestamp must be unix SECONDS of real time, not uptime: the server rejects
  // a skew wider than DEVICE_MAX_CLOCK_SKEW_S. `TimeSync` guarantees wall time
  // before the first signed call; `time(nullptr)` returns 0 until then, which
  // the server refuses - better a rejected request than a forged one.
  h.timestamp = String((long)time(nullptr));
  h.nonce = makeNonce();
  h.bodySha256 = sha256Hex(body);

  // NOTE: the canonical string joins with '\n' and the PATH excludes the query.
  String canonical;
  canonical.reserve(method.length() + path.length() + 96);
  canonical += method;
  canonical += '\n';
  canonical += path;
  canonical += '\n';
  canonical += h.timestamp;
  canonical += '\n';
  canonical += h.nonce;
  canonical += '\n';
  canonical += h.bodySha256;

  uint8_t digest[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  mbedtls_md_setup(&ctx, info, 1);  // 1 = HMAC mode
  mbedtls_md_hmac_starts(&ctx, reinterpret_cast<const uint8_t*>(secret.c_str()), secret.length());
  mbedtls_md_hmac_update(&ctx, reinterpret_cast<const uint8_t*>(canonical.c_str()), canonical.length());
  mbedtls_md_hmac_finish(&ctx, digest);
  mbedtls_md_free(&ctx);

  h.signature = "";
  toHex(digest, sizeof(digest), h.signature);
  return h;
}

}  // namespace HmacSigner
