'use strict';
/**
 * MixLens Vocal Engine 3.0 — Vibrato on sustained voiced segments only.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.VEVibrato = factory(root.VEUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

  function analyzeVibrato(pitch) {
    const track = (pitch && pitch._track) || [];
    if (!track.length || !pitch.available) {
      return {
        available: false,
        rate_hz: null,
        depth_cents: null,
        consistency: null,
        voiced_with_vibrato_percent: null,
        confidence: 'Low Confidence',
        note: 'Vibrato analysis unavailable due to insufficient sustained voiced material.'
      };
    }

    const hop = track.length > 1 ? (track[1].time - track[0].time) : 0.01;
    const segs = [];
    let cur = [];
    for (let i = 0; i < track.length; i++) {
      if (track[i].voiced && track[i].f0 > 0) cur.push(track[i]);
      else {
        if (cur.length * hop >= 0.28) segs.push(cur);
        cur = [];
      }
    }
    if (cur.length * hop >= 0.28) segs.push(cur);

    if (!segs.length) {
      return {
        available: false,
        rate_hz: null,
        depth_cents: null,
        consistency: null,
        voiced_with_vibrato_percent: 0,
        confidence: 'Low Confidence',
        note: 'Vibrato analysis unavailable due to insufficient sustained voiced material.'
      };
    }

    const rates = [];
    const depths = [];
    let vibFrames = 0, voicedFrames = 0;

    for (let s = 0; s < segs.length; s++) {
      const seg = segs[s];
      voicedFrames += seg.length;
      const f0s = seg.map(function (p) { return p.f0; });
      const mu = U.mean(f0s);
      const cents = f0s.map(function (f) { return 1200 * Math.log2(Math.max(1, f) / Math.max(1, mu)); });
      let zc = 0;
      for (let i = 1; i < cents.length; i++) {
        if ((cents[i] >= 0 && cents[i - 1] < 0) || (cents[i] < 0 && cents[i - 1] >= 0)) zc++;
      }
      const dur = seg.length * hop;
      const rate = (zc / 2) / Math.max(1e-6, dur);
      if (rate >= 4 && rate <= 8.5) {
        const sorted = U.sortedCopy(cents);
        const depth = (U.percentile(sorted, 0.90) - U.percentile(sorted, 0.10)) / 2;
        if (depth >= 15 && depth <= 160) {
          rates.push(rate);
          depths.push(depth);
          vibFrames += seg.length;
        }
      }
    }

    if (!rates.length) {
      return {
        available: true,
        detected: false,
        rate_hz: null,
        depth_cents: null,
        consistency: null,
        voiced_with_vibrato_percent: 0,
        confidence: 'Moderate',
        note: 'Sustained voiced material was present, but no 4–8.5 Hz modulation in the ±15–160 cent range was measured.'
      };
    }

    const rateSd = U.stdDev(rates);
    let consistency = 'Moderate';
    if (rateSd < 0.35) consistency = 'High';
    else if (rateSd > 0.9) consistency = 'Low';

    const conf = rates.length >= 3 ? 'High' : 'Moderate';
    return {
      available: true,
      detected: true,
      rate_hz: U.round(U.mean(rates), 2),
      depth_cents: Math.round(U.mean(depths)),
      consistency: consistency,
      voiced_with_vibrato_percent: U.round(100 * vibFrames / Math.max(1, voicedFrames), 1),
      confidence: conf,
      note: 'Estimated from ' + rates.length + ' sustained voiced segment(s).'
    };
  }

  return { analyzeVibrato };
}));
