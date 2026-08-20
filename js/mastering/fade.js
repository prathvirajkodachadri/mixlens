'use strict';
/**
 * MixLens Final Mastering Analysis 1.0 — Fade-in / fade-out / abrupt start-end detection.
 * Analysis only — nothing is applied to the audio.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.MAFade = factory(root.MAUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

  function envelope(mono, sampleRate, windowSec) {
    const frame = Math.max(32, Math.round(sampleRate * (windowSec || 0.05)));
    const hop = frame;
    const env = [];
    for (let i = 0; i + frame <= mono.length; i += hop) {
      env.push({ t: i / sampleRate, db: U.db20(U.rms(mono, i, i + frame)) });
    }
    return env;
  }

  function detectFade(env, fromStart, lookSec) {
    if (!env.length) return { present: false, duration_s: null, abrupt: false, shape: 'Insufficient data' };
    const dir = fromStart ? 1 : -1;
    const startIdx = fromStart ? 0 : env.length - 1;
    const t0 = env[startIdx].t;
    const slice = [];
    for (let i = startIdx; i >= 0 && i < env.length; i += dir) {
      if (Math.abs(env[i].t - t0) > lookSec) break;
      slice.push(env[i]);
    }
    if (!fromStart) slice.reverse();
    if (slice.length < 3) return { present: false, duration_s: null, abrupt: false, shape: 'Insufficient data' };

    const first = slice[0].db;
    const last = slice[slice.length - 1].db;
    const peak = Math.max.apply(null, slice.map(function (s) { return s.db; }));
    const rise = last - first;
    const fromFloor = peak - first;

    let present = false;
    let abrupt = false;
    let duration = null;
    let shape = 'None detected';

    if (first > -24 && fromFloor < 8) {
      abrupt = true;
      shape = fromStart ? 'Abrupt start' : 'Abrupt ending';
    } else if (first < -45 && fromFloor >= 12) {
      present = true;
      /* duration until within 6 dB of local peak */
      let hit = slice[slice.length - 1];
      for (let i = 0; i < slice.length; i++) {
        if (slice[i].db >= peak - 6) { hit = slice[i]; break; }
      }
      duration = Math.abs(hit.t - slice[0].t);
      shape = fromStart ? 'Fade-in' : 'Fade-out';
    } else if (fromFloor >= 10 && first < -30) {
      present = true;
      duration = Math.abs(slice[slice.length - 1].t - slice[0].t);
      shape = fromStart ? 'Possible fade-in' : 'Possible fade-out';
    }

    return {
      present: present,
      duration_s: duration == null ? null : U.round(duration, 3),
      abrupt: abrupt,
      shape: shape,
      start_level_dbfs: U.round(first, 2),
      end_level_dbfs: U.round(last, 2),
      rise_db: U.round(rise, 2)
    };
  }

  function analyzeFade(mono, sampleRate, silence) {
    const env = envelope(mono, sampleRate, 0.05);
    const fadeIn = detectFade(env, true, 2.5);
    const fadeOut = detectFade(env, false, 4.0);

    let ending = 'Unclassified';
    if (fadeOut.abrupt) ending = 'Abrupt';
    else if (fadeOut.present) ending = 'Smooth';
    else if (silence && silence.trailing_seconds >= 0.05) ending = 'Ends in silence';

    let starting = 'Unclassified';
    if (fadeIn.abrupt) starting = 'Abrupt';
    else if (fadeIn.present) starting = 'Smooth';
    else if (silence && silence.leading_seconds >= 0.05) starting = 'Starts after silence';

    return {
      fade_in: fadeIn,
      fade_out: fadeOut,
      starting: starting,
      ending: ending,
      note: 'Fade detection uses a 50 ms RMS envelope over the first ~2.5 s and last ~4 s. It does not modify the file.'
    };
  }

  return { analyzeFade: analyzeFade };
}));
