#pragma once

/**
 * Compile-time configuration for smart_monitor_v1.
 *
 * HARD RULE (prompt §42): nothing secret lives in this file. Wi-Fi credentials,
 * the API base URL and the device secret are written to NVS at runtime by the
 * provisioning portal; they are never compiled into the firmware image.
 */

#define SM_MODEL            "smart_monitor_v1"
#define SM_FW_VERSION       "1.0.0"
#define SM_HW_REVISION      "1.0"

// ---------------------------------------------------------------------------
// Pin map (ARCHITECTURE.md §8.1)
// ---------------------------------------------------------------------------
#define PIN_DHT             4    // DHT11 data
#define PIN_ANEMO           16   // A3144 Hall sensor (pulse in, ISR)
#define PIN_BUTTON          0    // BOOT button: long = portal, very long = reset
#define PIN_LED             2    // status LED

#define PIN_I2C_SDA         21
#define PIN_I2C_SCL         22

#define PIN_SD_CS           5
#define PIN_SD_SCK          18
#define PIN_SD_MISO         19
#define PIN_SD_MOSI         23

// ---------------------------------------------------------------------------
// Cooperative scheduler periods (ARCHITECTURE.md §8.2 - no delay() anywhere)
// ---------------------------------------------------------------------------
#define TASK_SENSOR_POLL_MS   500    // one driver per tick (round-robin)
#define TASK_AGGREGATE_MS     60000  // one sample = all currently-valid capabilities
#define TASK_NET_CHECK_MS     5000
#define TASK_HEARTBEAT_MS     30000
#define TASK_SYNC_MS          3000
#define TASK_BUTTON_MS        50
#define TASK_SERIAL_MS        50

// A reading older than this is considered stale: the sensor is down and its
// capability is OMITTED from the sample (never reported as 0).
#define READING_MAX_AGE_MS    30000

// ---------------------------------------------------------------------------
// Offline buffer / upload
// ---------------------------------------------------------------------------
#define SYNC_BATCH_MAX        20     // samples per POST (fits in RAM comfortably)
#define SYNC_BACKOFF_MIN_MS   2000
#define SYNC_BACKOFF_MAX_MS   60000
#define SD_SEGMENT_MAX        2000   // rotate the NDJSON segment after N records
#define RAM_QUEUE_MAX         64     // fallback queue when no card is fitted

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
// Development default ONLY. Overridable at runtime from the provisioning portal
// (stored in NVS as `server.base`), and must be an https:// origin in production.
#define SM_DEFAULT_SERVER     "http://192.168.1.90:5000"
#define SM_API_PREFIX         "/api/v1"

// 1 = accept any TLS certificate (DEVELOPMENT ONLY, printed loudly at boot).
// Set to 0 in production and supply SM_TLS_ROOT_CA below.
#define SM_TLS_INSECURE       1
#define SM_TLS_ROOT_CA        ""

// ---------------------------------------------------------------------------
// Portal (ARCHITECTURE.md §14 - SoftAP captive portal, no credentials in code)
// ---------------------------------------------------------------------------
#define SM_AP_PREFIX          "SmartMonitor-"
#define SM_AP_PASSWORD        ""      // open AP; short-lived and physical-presence only
#define SM_PORTAL_IP          "192.168.4.1"

// ---------------------------------------------------------------------------
// Button timing
// ---------------------------------------------------------------------------
#define BUTTON_LONG_MS        3000    // long press  -> start the portal
#define BUTTON_VERY_LONG_MS   10000   // very long   -> forget Wi-Fi + server
