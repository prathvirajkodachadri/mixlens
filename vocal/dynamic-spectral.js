'use strict';
/**
 * MixLens Vocal Analysis Engine — Module 7: Dynamic Spectral Analysis
 * Multi-tier spectral comparison across vocal dynamics:
 * - Compares Quiet, Normal, and Loud / High-Energy voiced frames
 * - Detects Level-Dependent Spectral Harshness, Mud, or Proximity Boom
 * - Recommends STATIC vs DYNAMIC processing based on measured delta
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./dsp', './tonal'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./dsp'), require('./tonal'));
  } else {
    root.VocalDynamicSpectral = factory(root.VocalDSP, root.VocalTonal);
  }
}(typeof self !== 'undefined' ? self : this, function(DSP, Tonal) {

  const { db10, db20, sortedCopy, percentile, fmtDb } = DSP;
  const { VOCAL_TONAL_ZONES } = Tonal;

  /**
   * Run dynamic multi-tier spectral analysis
   * @param {Object} spectrumData - Output from VocalSpectrum.analyzeSpectrum
   */
  function analyzeDynamicSpectrum(spectrumData) {
    const { frequencies, timeFrames, binWidth, numBins } = spectrumData;

    // Filter active frames
    const activeFrames = timeFrames.filter(tf => tf.active && tf.magDb);
    if (activeFrames.length < 4) {
      return {
        quietSpectrumDb: new Float32Array(numBins),
        normalSpectrumDb: new Float32Array(numBins),
        loudSpectrumDb: new Float32Array(numBins),
        dynamicIssues: [],
        findings: []
      };
    }

    const rmsList = activeFrames.map(f => f.rmsDb);
    const sortedRms = sortedCopy(rmsList);
    const p25 = percentile(sortedRms, 0.25);
    const p75 = percentile(sortedRms, 0.75);

    const quietFrames = activeFrames.filter(f => f.rmsDb <= p25);
    const normalFrames = activeFrames.filter(f => f.rmsDb > p25 && f.rmsDb < p75);
    const loudFrames = activeFrames.filter(f => f.rmsDb >= p75);

    function computeMeanSpectrum(framesList) {
      const spec = new Float32Array(numBins);
      if (!framesList.length) return spec;
      for (let k = 0; k < numBins; k++) {
        let sum = 0;
        for (let i = 0; i < framesList.length; i++) {
          sum += Math.pow(10, framesList[i].magDb[k] / 10);
        }
        spec[k] = db10(sum / framesList.length);
      }
      return spec;
    }

    const quietSpectrumDb = computeMeanSpectrum(quietFrames);
    const normalSpectrumDb = computeMeanSpectrum(normalFrames);
    const loudSpectrumDb = computeMeanSpectrum(loudFrames);

    // Compute zone-by-zone dynamic deviations
    const dynamicIssues = [];
    const findings = [];

    for (const zone of VOCAL_TONAL_ZONES) {
      const startBin = Math.max(1, Math.round(zone.from / binWidth));
      const endBin = Math.min(numBins - 1, Math.round(zone.to / binWidth));
      if (startBin >= endBin) continue;

      let qPower = 0, nPower = 0, lPower = 0;
      let count = 0;
      for (let k = startBin; k <= endBin; k++) {
        qPower += Math.pow(10, quietSpectrumDb[k] / 10);
        nPower += Math.pow(10, normalSpectrumDb[k] / 10);
        lPower += Math.pow(10, loudSpectrumDb[k] / 10);
        count++;
      }

      const qDb = db10(qPower / count);
      const nDb = db10(nPower / count);
      const lDb = db10(lPower / count);

      // Normalization: compare zone gain relative to overall frame RMS change
      const rmsDeltaLoudVsNormal = (loudFrames.length && normalFrames.length) ? (p75 - ((p25 + p75) / 2)) : 6.0;
      const zoneDeltaLoudVsNormal = lDb - nDb;
      const excessDynamicDelta = zoneDeltaLoudVsNormal - rmsDeltaLoudVsNormal;

      // Classify behavior
      let behavior = 'static';
      let recommendedMode = 'STATIC';
      let confidence = 0.85;
      let evidence = '';

      if (excessDynamicDelta > 3.0) {
        // Zone surges significantly more than overall volume in loud passages
        behavior = 'dynamic_surge';
        recommendedMode = 'DYNAMIC_CUT';
        confidence = Math.min(0.95, 0.75 + (excessDynamicDelta / 10));
        evidence = `${zone.name} (${zone.from}–${zone.to} Hz) shows +${excessDynamicDelta.toFixed(1)} dB dynamic surge specifically during loud frames (loud: ${fmtDb(lDb)}, normal: ${fmtDb(nDb)}).`;
        findings.push({
          zone: zone.name,
          freqRange: `${zone.from}–${zone.to} Hz`,
          behavior: 'Dynamic Excess (Loud notes)',
          mode: 'DYNAMIC_CUT',
          dynamicRangeDb: Math.min(6.0, Math.max(1.5, Math.round(excessDynamicDelta * 10) / 10)),
          thresholdDb: Math.round(p75 * 10) / 10,
          confidence,
          evidence
        });
      } else if (excessDynamicDelta < -3.5 && zone.from > 1500) {
        // Zone collapses when loud (e.g. vocal gets muffled / pinched when belting)
        behavior = 'dynamic_drop';
        recommendedMode = 'DYNAMIC_BOOST';
        confidence = 0.80;
        evidence = `${zone.name} (${zone.from}–${zone.to} Hz) drops by ${Math.abs(excessDynamicDelta).toFixed(1)} dB relative to overall energy during loud phrases.`;
        findings.push({
          zone: zone.name,
          freqRange: `${zone.from}–${zone.to} Hz`,
          behavior: 'Dynamic Loss (Loud notes)',
          mode: 'DYNAMIC_BOOST',
          dynamicRangeDb: Math.min(4.0, Math.max(1.0, Math.round(Math.abs(excessDynamicDelta) * 10) / 10)),
          thresholdDb: Math.round(p75 * 10) / 10,
          confidence,
          evidence
        });
      }

      dynamicIssues.push({
        zoneId: zone.id,
        zoneName: zone.name,
        from: zone.from,
        to: zone.to,
        quietDb: Math.round(qDb * 10) / 10,
        normalDb: Math.round(nDb * 10) / 10,
        loudDb: Math.round(lDb * 10) / 10,
        excessDynamicDelta: Math.round(excessDynamicDelta * 10) / 10,
        behavior,
        recommendedMode
      });
    }

    return {
      quietSpectrumDb,
      normalSpectrumDb,
      loudSpectrumDb,
      dynamicIssues,
      findings,
      quietFrameCount: quietFrames.length,
      normalFrameCount: normalFrames.length,
      loudFrameCount: loudFrames.length
    };
  }

  return {
    analyzeDynamicSpectrum
  };
}));
