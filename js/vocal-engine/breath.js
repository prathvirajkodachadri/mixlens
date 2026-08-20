'use strict';
/**
 * MixLens Vocal Engine 3.0 — Inhalation / breath interval detector.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.VEBreath = factory(root.VEUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

  function analyzeBreaths(mono, sampleRate, pitchTrack) {
    const frame = Math.max(32, Math.round(sampleRate * 0.025));
    const hop = Math.max(16, Math.round(sampleRate * 0.012));
    const nF = Math.max(1, Math.floor((mono.length - frame) / hop));
    const hf = U.applyBiquad(mono, U.designBiquad('highpass', sampleRate, 2500, 0, 0.7));
    const fullDb = new Float32Array(nF);
    const hfDb = new Float32Array(nF);
    const zcr = new Float32Array(nF);
    const buf = new Float32Array(frame);

    const voicedAt = function (t) {
      if (!pitchTrack || !pitchTrack.length) return false;
      // Binary search-ish linear scan is fine for modest tracks.
      let best = pitchTrack[0];
      let bestD = Math.abs(best.time - t);
      for (let i = 1; i < pitchTrack.length; i += Math.max(1, Math.floor(pitchTrack.length / 400))) {
        const d = Math.abs(pitchTrack[i].time - t);
        if (d < bestD) { bestD = d; best = pitchTrack[i]; }
      }
      return !!(best && best.voiced);
    };

    for (let f = 0; f < nF; f++) {
      const s = f * hop;
      let e = 0, eH = 0;
      for (let i = 0; i < frame; i++) {
        buf[i] = mono[s + i];
        e += buf[i] * buf[i];
        eH += hf[s + i] * hf[s + i];
      }
      fullDb[f] = U.db20(Math.sqrt(e / frame));
      hfDb[f] = U.db20(Math.sqrt(eH / frame));
      zcr[f] = U.zeroCrossingRate(buf);
    }

    const events = [];
    let on = false, startF = 0, peak = -144, peakF = 0;

    for (let f = 0; f < nF; f++) {
      const t = (f * hop + frame / 2) / sampleRate;
      const lvl = fullDb[f];
      const like = lvl >= -50 && lvl <= -20 && zcr[f] >= 0.07 && zcr[f] <= 0.35 && (hfDb[f] > lvl - 16) && !voicedAt(t);
      if (like) {
        if (!on) { on = true; startF = f; peak = lvl; peakF = f; }
        else if (lvl > peak) { peak = lvl; peakF = f; }
      } else if (on) {
        const dur = (f - startF) * hop / sampleRate;
        if (dur >= 0.14 && dur <= 0.90) {
          events.push({
            start_s: U.round(startF * hop / sampleRate, 3),
            end_s: U.round(f * hop / sampleRate, 3),
            peak_s: U.round((peakF * hop) / sampleRate, 3),
            duration_ms: Math.round(dur * 1000),
            peak_level_db: U.round(peak, 2),
            strong: peak > -28,
            confidence: U.round(U.clamp(0.55 + (dur > 0.25 ? 0.15 : 0) + (peak < -24 ? 0.1 : 0), 0.2, 0.9) * 100, 1)
          });
        }
        on = false;
      }
    }

    const durs = events.map(function (e) { return e.duration_ms; });
    const strong = events.filter(function (e) { return e.strong; });
    return {
      breath_count: events.length,
      average_duration_ms: durs.length ? Math.round(U.mean(durs)) : null,
      strong_breaths: strong.length,
      events: events.slice(0, 200),
      timestamps: events.slice(0, 40).map(function (e) { return e.start_s; }),
      evidence: events.length
        ? (events.length + ' unvoiced broadband intervals (140–900 ms) with elevated high-frequency energy.')
        : 'No inhalation-like intervals met the level, ZCR, duration, and unvoiced criteria.'
    };
  }

  return { analyzeBreaths };
}));
