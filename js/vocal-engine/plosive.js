'use strict';
/**
 * MixLens Vocal Engine 3.0 — Plosive / low-frequency blast detector.
 * Uses transient rise + low-band energy. Sustained bass is not classified as a plosive.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.VEPlosive = factory(root.VEUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

  function analyzePlosives(mono, sampleRate) {
    const lp = U.applyBiquad(mono, U.designBiquad('lowpass', sampleRate, 110, 0, 0.7));
    const body = U.applyBiquad(mono, U.designBiquad('bandpass', sampleRate, 1400, 0, 0.7));
    const frame = Math.max(32, Math.round(sampleRate * 0.02));
    const hop = Math.max(16, Math.round(sampleRate * 0.01));
    const nF = Math.max(1, Math.floor((mono.length - frame) / hop));
    const lpDb = new Float32Array(nF);
    const bodyDb = new Float32Array(nF);
    const fullDb = new Float32Array(nF);

    for (let f = 0; f < nF; f++) {
      const s = f * hop;
      let eL = 0, eB = 0, eF = 0;
      for (let i = 0; i < frame; i++) {
        const x = mono[s + i];
        eF += x * x;
        eL += lp[s + i] * lp[s + i];
        eB += body[s + i] * body[s + i];
      }
      fullDb[f] = U.db20(Math.sqrt(eF / frame));
      lpDb[f] = U.db20(Math.sqrt(eL / frame));
      bodyDb[f] = U.db20(Math.sqrt(eB / frame));
    }

    const events = [];
    let on = false, startF = 0, peak = -144, peakF = 0, rise = 0;

    for (let f = 1; f < nF; f++) {
      const delta = lpDb[f] - lpDb[f - 1];
      const transient = delta > 6.5;
      const blast = lpDb[f] >= -28 && (lpDb[f] - bodyDb[f] > 1.5 || transient);
      // Reject sustained bass: require a recent rise and short lifetime later.
      if (blast && (transient || on)) {
        if (!on) {
          if (!transient) continue;
          on = true; startF = f; peak = lpDb[f]; peakF = f; rise = delta;
        } else {
          if (lpDb[f] > peak) { peak = lpDb[f]; peakF = f; }
          if (delta > rise) rise = delta;
        }
      } else if (on) {
        const dur = (f - startF) * hop / sampleRate;
        if (dur >= 0.018 && dur <= 0.18 && rise >= 5.5) {
          const t0 = startF * hop / sampleRate;
          const t1 = f * hop / sampleRate;
          const sevN = U.clamp((peak + 12) / 20, 0.1, 1);
          events.push({
            start_s: U.round(t0, 3),
            end_s: U.round(t1, 3),
            peak_s: U.round((peakF * hop) / sampleRate, 3),
            duration_ms: Math.round(dur * 1000),
            peak_level_db: U.round(peak, 2),
            rise_db: U.round(rise, 2),
            severity: sevN >= 0.75 ? 'HIGH' : sevN >= 0.45 ? 'MODERATE' : 'LOW',
            confidence: U.round(U.clamp(0.55 + (rise - 5.5) / 20 + (dur < 0.12 ? 0.1 : 0), 0.2, 0.94) * 100, 1)
          });
        }
        on = false;
      }
    }

    const strong = events.filter(function (e) { return e.severity === 'HIGH' || e.confidence >= 80; });
    return {
      event_count: events.length,
      strong_events: strong.length,
      events: events.slice(0, 200),
      timestamps: events.slice(0, 40).map(function (e) { return e.start_s; }),
      evidence: events.length
        ? (events.length + ' short low-frequency transients with ≥5.5 dB rise; ' + strong.length + ' strong.')
        : 'No short low-frequency air-blast transients met the rise and duration criteria.'
    };
  }

  return { analyzePlosives };
}));
