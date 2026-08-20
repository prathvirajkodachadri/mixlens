'use strict';
/**
 * MixLens Final Mastering Analysis 1.0 — Leading / trailing / internal silence and noise floor.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.MASilence = factory(root.MAUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

  function analyzeSilence(mono, sampleRate) {
    const N = mono.length;
    const frame = Math.max(32, Math.round(sampleRate * 0.02));
    const hop = frame;
    const silenceThr = U.dbToLinear(-60);
    const digitalThr = 1e-7;
    const frames = [];
    for (let i = 0; i + frame <= N; i += hop) {
      const r = U.rms(mono, i, i + frame);
      let digital = true;
      for (let j = i; j < i + frame; j++) {
        if (Math.abs(mono[j]) > digitalThr) { digital = false; break; }
      }
      frames.push({ rms: r, digital: digital, start: i });
    }

    function countFrom(arr, pred) {
      let n = 0;
      for (let i = 0; i < arr.length; i++) {
        if (pred(arr[i])) n++;
        else break;
      }
      return n;
    }

    const leadSilent = countFrom(frames, function (f) { return f.rms < silenceThr; });
    const trailSilent = countFrom(frames.slice().reverse(), function (f) { return f.rms < silenceThr; });
    const leadDigital = countFrom(frames, function (f) { return f.digital; });
    const trailDigital = countFrom(frames.slice().reverse(), function (f) { return f.digital; });

    const leading = leadSilent * hop / sampleRate;
    const trailing = trailSilent * hop / sampleRate;
    const leadingDigital = leadDigital * hop / sampleRate;
    const trailingDigital = trailDigital * hop / sampleRate;

    const internal = [];
    let run = 0, runStart = 0;
    const minInternal = Math.round(0.40 * sampleRate / hop);
    for (let i = leadSilent; i < frames.length - trailSilent; i++) {
      if (frames[i].rms < silenceThr) {
        if (run === 0) runStart = i;
        run++;
      } else if (run > 0) {
        if (run >= minInternal) {
          internal.push({
            start_s: U.round(frames[runStart].start / sampleRate, 3),
            end_s: U.round((frames[runStart].start + run * hop) / sampleRate, 3),
            duration_s: U.round(run * hop / sampleRate, 3),
            digital: frames.slice(runStart, runStart + run).every(function (f) { return f.digital; })
          });
        }
        run = 0;
      }
    }

    const quietRms = [];
    for (let i = 0; i < frames.length; i++) {
      if (frames[i].rms > 1e-8 && frames[i].rms < U.dbToLinear(-50)) quietRms.push(frames[i].rms);
    }
    const floor = quietRms.length >= 4 ? U.percentile(U.sortedCopy(quietRms), 0.2) : (quietRms.length ? U.mean(quietRms) : 0);
    const floorDb = quietRms.length ? U.db20(floor) : null;

    const contentStart = leadSilent * hop / sampleRate;
    const contentEnd = (N / sampleRate) - trailing;
    const contentDur = Math.max(0, contentEnd - contentStart);

    return {
      leading_seconds: U.round(leading, 3),
      trailing_seconds: U.round(trailing, 3),
      leading_digital_seconds: U.round(leadingDigital, 3),
      trailing_digital_seconds: U.round(trailingDigital, 3),
      internal_events: internal.slice(0, 40),
      internal_count: internal.length,
      threshold_dbfs: -60,
      noise_floor_dbfs: floorDb == null ? null : U.round(floorDb, 2),
      noise_floor_confidence: quietRms.length >= 8 ? 'NORMAL' : (quietRms.length ? 'LOW' : 'NOT AVAILABLE'),
      musical_content_duration_seconds: U.round(contentDur, 3),
      silence_ratio: frames.length ? U.round(frames.filter(function (f) { return f.rms < silenceThr; }).length / frames.length, 4) : 1,
      note: 'Silence uses 20 ms RMS below −60 dBFS. Digital silence is |sample| < 1e-7.'
    };
  }

  return { analyzeSilence: analyzeSilence };
}));
