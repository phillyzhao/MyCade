// Every motion threshold lives here so tuning happens in one place.
export const MOTION = {
  inputHz: 60,
  gravity: 9.81,
  // low-pass factor for gravity estimate (0..1, higher = snappier)
  gravityAlpha: 0.25,
  tilt: { deadzone: 0.06, maxTilt: 0.55, smoothing: 0.35 },
  steer: { deadzone: 0.05, maxAngleDeg: 55, smoothing: 0.4 },
  swing: {
    // linear-accel magnitude (m/s^2) needed to count as a swing
    minPeak: 13,
    // magnitude where power hits 1.0
    fullPeak: 42,
    // gyro magnitude (deg/s) that must accompany a swing
    minGyro: 160,
    debounceMs: 380,
    // a swing is reported once the magnitude drops below this fraction of the peak
    settleRatio: 0.55,
    // downward component needed for a smash
    smashDown: 0.55,
  },
  release: {
    // look-back window for the forward swing before A is released
    windowMs: 450,
    minPeak: 6,
    fullPeak: 34,
    // wrist twist (deg/s) mapped to full spin
    fullTwist: 520,
  },
  shake: { spike: 16, windowMs: 900, count: 4, debounceMs: 700 },
  flick: { minUp: 9, debounceMs: 600 },
};
