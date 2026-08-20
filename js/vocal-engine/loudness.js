'use strict';
/**
 * MixLens Vocal Engine 3.0 — EBU R128 / ITU-R BS.1770-4 loudness.
 * Momentary 400 ms, short-term 3 s, hop 100 ms, absolute −70 LUFS, relative −10 LU.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.VELoudness = factory(root.VEUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

  function lufsFromMeanPower(meanPower) {
    if (!(meanPower > 1e-12)) return -144;
    return -0.691 + 10 * Math.log10(meanPower);
  }

  function analyzeLoudness(mono, sampleRate, left, right) {
    const N = mono.length;
    const stereo = !!(left && right && right.length);
    const kw = U.kWeightingFilters(sampleRate);
    const flL = U.applyBiquad(U.applyBiquad(stereo ? left : mono, kw.shelf), kw.hp);
    const flR = stereo ? U.applyBiquad(U.applyBiquad(right, kw.shelf), kw.hp) : null;

    const momWin = Math.max(1, Math.floor(sampleRate * 0.40));
    const stWin = Math.max(1, Math.floor(sampleRate * 3.00));
    const hop = Math.max(1, Math.floor(sampleRate * 0.10));

    const cum = new Float64Array(N + 1);
    for (let i = 0; i < N; i++) {
      const pL = flL[i] * flL[i];
      const pR = stereo ? flR[i] * flR[i] : 0;
      cum[i + 1] = cum[i] + (stereo ? (pL + pR) : pL);
    }

    const momentary = [];
    const shortTerm = [];
    const timeline = [];
    const num = Math.max(1, Math.floor((N - Math.min(momWin, N)) / hop) + 1);

    for (let b = 0; b < num; b++) {
      const start = b * hop;
      if (start >= N) break;
      const endM = Math.min(N, start + momWin);
      const meanM = (cum[endM] - cum[start]) / Math.max(1, endM - start);
      const lufsM = lufsFromMeanPower(meanM);
      momentary.push({ power: meanM, lufs: lufsM, time: start / sampleRate });

      const endS = Math.min(N, start + stWin);
      const lenS = endS - start;
      if (lenS >= Math.min(momWin, N)) {
        const meanS = (cum[endS] - cum[start]) / lenS;
        const lufsS = lufsFromMeanPower(meanS);
        shortTerm.push({ power: meanS, lufs: lufsS, time: start / sampleRate });
        if (b % 10 === 0 || start === 0) {
          timeline.push({ time_s: U.round(start / sampleRate, 2), short_term_lufs: U.round(lufsS, 2) });
        }
      }
    }

    let absSum = 0, absN = 0;
    for (let i = 0; i < momentary.length; i++) {
      if (momentary[i].lufs >= -70) {
        absSum += momentary[i].power;
        absN++;
      }
    }

    let integrated = -144;
    let relThr = -70;
    if (absN > 0) {
      const ungated = lufsFromMeanPower(absSum / absN);
      relThr = ungated - 10;
      let relSum = 0, relN = 0;
      for (let i = 0; i < momentary.length; i++) {
        const l = momentary[i].lufs;
        if (l >= -70 && l >= relThr) {
          relSum += momentary[i].power;
          relN++;
        }
      }
      if (relN > 0) integrated = lufsFromMeanPower(relSum / relN);
    }

    let lra = 0;
    if (shortTerm.length > 4) {
      const valid = shortTerm.filter(function (s) { return s.lufs >= -70 && s.lufs >= (integrated - 20); });
      if (valid.length >= 4) {
        const sorted = U.sortedCopy(valid.map(function (s) { return s.lufs; }));
        lra = Math.max(0, U.percentile(sorted, 0.95) - U.percentile(sorted, 0.10));
      }
    }

    const momVals = momentary.map(function (m) { return m.lufs; }).filter(function (l) { return l > -120; });
    const stVals = shortTerm.map(function (s) { return s.lufs; }).filter(function (l) { return l > -120; });

    return {
      integrated_lufs: U.round(integrated, 2),
      short_term_lufs: stVals.length ? U.round(Math.max.apply(null, stVals), 2) : -144,
      short_term_mean_lufs: stVals.length ? U.round(U.mean(stVals), 2) : -144,
      momentary_lufs: momVals.length ? U.round(Math.max.apply(null, momVals), 2) : -144,
      momentary_mean_lufs: momVals.length ? U.round(U.mean(momVals), 2) : -144,
      lra_lu: U.round(lra, 2),
      relative_threshold_lufs: U.round(relThr, 2),
      gated_blocks: absN,
      timeline: timeline.slice(0, 400),
      _momentary: momentary,
      _shortTerm: shortTerm
    };
  }

  return { analyzeLoudness };
}));
