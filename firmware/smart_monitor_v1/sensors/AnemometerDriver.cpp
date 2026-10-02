#include "AnemometerDriver.h"

AnemometerDriver* AnemometerDriver::s_instance = nullptr;

namespace {
/** A3144 is an open-drain Hall switch: pull-up keeps the idle line HIGH. */
constexpr uint8_t kPulsesPerRotation = 1;
/** Ignore transitions faster than this - contact bounce / mechanical chatter. */
constexpr uint32_t kDebounceUs = 2000;
volatile uint32_t s_lastPulseUs = 0;

void IRAM_ATTR anemometerIsr() {
  const uint32_t now = micros();
  if (now - s_lastPulseUs < kDebounceUs) return;  // debounce only, no logic
  s_lastPulseUs = now;
  AnemometerDriver* self = AnemometerDriver::instance();
  if (self) self->onPulse();
}
}  // namespace

AnemometerDriver* AnemometerDriver::instance() { return s_instance; }

void AnemometerDriver::begin(uint8_t pin) {
  s_instance = this;
  pinMode(pin, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(pin), anemometerIsr, FALLING);
  attached_ = true;
  lastMs_ = millis();
}

void AnemometerDriver::poll(float calibrationCoef) {
  if (!attached_) return;

  const uint32_t now = millis();
  float elapsedS = (now - lastMs_) / 1000.0f;
  if (elapsedS < 0.5f) return;  // too short a window to be meaningful

  // Snapshot and clear atomically so a pulse arriving mid-read is not lost.
  noInterrupts();
  uint32_t delta = pulses_;
  pulses_ = 0;
  interrupts();

  lastMs_ = now;
  totalPulses_ += delta;

  const float rotations = (float)delta / (float)kPulsesPerRotation;
  const float rps = rotations / elapsedS;
  const float rpm = rps * 60.0f;

  const bool calibrated = (calibrationCoef > 0.0f && calibrationCoef != 1.0f);

  // 0 rpm is a real measurement (calm air), not a sensor failure.
  rpm_ = { true, (double)rpm, "rpm", "ok", "a3144", now };
  speed_ = {
    true,
    (double)(rps * calibrationCoef),
    "m/s",
    calibrated ? "ok" : "uncalibrated",
    "a3144",
    now,
  };
}
