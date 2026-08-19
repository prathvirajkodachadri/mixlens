'use strict';
/**
 * MixLens Vocal Analysis Engine — Module 16: Stereo & Phase Analysis
 * - Inter-channel correlation (-1.0 to +1.0)
 * - Mid / Side power distribution & stereo width percentage
 * - Mono compatibility & phase cancellation risk verdict
 * - Lead vocal stereo placement classification (Mono Center vs Widened vs Phase Risky)
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./dsp'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./dsp'));
  } else {
    root.VocalStereo = factory(root.VocalDSP);
  }
}(typeof self !== 'undefined' ? self : this, function(DSP) {

  const { db20, db10, fmtDb } = DSP;

  /**
   * Run stereo and phase analysis
   * @param {Float32Array} left - Left channel samples
   * @param {Float32Array} right - Right channel samples
   */
  function analyzeStereo(left, right) {
    if (!left || !right || left.length === 0 || right.length === 0) {
      return {
        isStereo: false,
        correlation: 1.0,
        stereoWidthPct: 0,
        midDb: -144,
        sideDb: -144,
        balanceDb: 0,
        monoCompatibility: 'Pure Mono (100% compatible)',
        classification: 'Mono Center',
        phaseRisk: 'None',
        note: 'Audio file is mono. Lead vocal is perfectly centered.'
      };
    }

    const N = Math.min(left.length, right.length);
    let dotProd = 0, sumSqL = 0, sumSqR = 0;
    let sumSqMid = 0, sumSqSide = 0;

    for (let i = 0; i < N; i++) {
      const l = left[i];
      const r = right[i];
      dotProd += l * r;
      sumSqL += l * l;
      sumSqR += r * r;

      const m = (l + r) * 0.70710678; // Mid = (L + R) / sqrt(2)
      const s = (l - r) * 0.70710678; // Side = (L - R) / sqrt(2)
      sumSqMid += m * m;
      sumSqSide += s * s;
    }

    const rmsL = Math.sqrt(sumSqL / N);
    const rmsR = Math.sqrt(sumSqR / N);
    const denom = Math.sqrt(sumSqL * sumSqR);
    const correlation = denom > 1e-12 ? Math.max(-1.0, Math.min(1.0, dotProd / denom)) : 1.0;

    const rmsMid = Math.sqrt(sumSqMid / N);
    const rmsSide = Math.sqrt(sumSqSide / N);

    const midDb = db20(rmsMid);
    const sideDb = db20(rmsSide);
    const balanceDb = db20(rmsL) - db20(rmsR);

    const totalEnergy = sumSqMid + sumSqSide;
    const stereoWidthPct = totalEnergy > 1e-12 ? (sumSqSide / totalEnergy) * 100 : 0;

    // Mono compatibility classification
    let monoCompatibility = 'Excellent (Mono Center)';
    let phaseRisk = 'None';
    let classification = 'Mono Center';
    let note = 'Lead vocal is well-anchored in the center.';

    if (correlation < -0.2) {
      monoCompatibility = 'Severe Phase Cancellation Hazard!';
      phaseRisk = 'Critical';
      classification = 'Anti-Phase Out-of-Phase';
      note = 'Severe out-of-phase audio detected. When summed to mono (smartphones, clubs, radios), this vocal will almost completely cancel out and disappear. Invert one channel polarity immediately.';
    } else if (correlation < 0.3) {
      monoCompatibility = 'Poor — noticeable thinning in mono';
      phaseRisk = 'High';
      classification = 'Excessively Widened / Stereo Chorus';
      note = 'High stereo side energy is creating phase comb filtering. Collapse vocal body to mono or reduce widening effects.';
    } else if (stereoWidthPct < 2.5 || correlation > 0.98) {
      monoCompatibility = 'Perfect Mono Center';
      phaseRisk = 'None';
      classification = 'Mono Center';
      note = 'Standard solid center image for lead vocal.';
    } else if (stereoWidthPct < 20 && correlation >= 0.85) {
      monoCompatibility = 'Good (Natural Stereo Reverb/Ambience)';
      phaseRisk = 'Low';
      classification = 'Center with Subtle Stereo Reverb';
      note = 'Lead vocal has centered core with natural stereo spatial cues.';
    } else {
      monoCompatibility = 'Moderate (Wide Stereo)';
      phaseRisk = 'Moderate';
      classification = 'Wide Stereo Vocal';
      note = 'Vocal contains noticeable stereo spread. Ensure the fundamental remains solid in mono.';
    }

    return {
      isStereo: true,
      correlation: Math.round(correlation * 1000) / 1000,
      stereoWidthPct: Math.round(stereoWidthPct * 10) / 10,
      midDb: Math.round(midDb * 10) / 10,
      sideDb: Math.round(sideDb * 10) / 10,
      balanceDb: Math.round(balanceDb * 10) / 10,
      monoCompatibility,
      classification,
      phaseRisk,
      note
    };
  }

  return {
    analyzeStereo
  };
}));
