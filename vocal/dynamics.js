'use strict';
/**
 * MixLens Vocal Analysis Engine — Module 8: Dynamics & Loudness Analysis
 * - EBU R128 Integrated Loudness (LUFS), Short-Term Max, Momentary Max, LRA (LU)
 * - Peak, RMS, Crest Factor, Dynamic Range Profile
 * - Phrase-to-phrase level consistency analysis
 * - Intelligent vocal compression style recommendation
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./dsp'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./dsp'));
  } else {
    root.VocalDynamics = factory(root.VocalDSP);
  }
}(typeof self !== 'undefined' ? self : this, function(DSP) {

  const { db20, db10, mean, stdDev, sortedCopy, percentile, median, kWeightingFilters, applyBiquad } = DSP;

  /**
   * Run dynamics and EBU R128 loudness analysis on audio
   * @param {Float32Array} mono - Mono mix channel
   * @param {number} sampleRate - Sample rate
   * @param {Float32Array} [left] - Optional left channel
   * @param {Float32Array} [right] - Optional right channel
   */
  function analyzeDynamics(mono, sampleRate, left, right) {
    const N = mono.length;
    const isStereo = !!(left && right);

    // 1. Basic Sample Peak & Full-Signal RMS
    let peak = 0;
    let sumSq = 0;
    for (let i = 0; i < N; i++) {
      const abs = Math.abs(mono[i]);
      if (abs > peak) peak = abs;
      sumSq += mono[i] * mono[i];
    }
    const rms = N > 0 ? Math.sqrt(sumSq / N) : 0;
    const peakDb = db20(peak);
    const rmsDb = db20(rms);
    const crestDb = Math.max(0, peakDb - rmsDb);

    // 2. EBU R128 Loudness Processing (ITU-R BS.1770-4)
    const { shelf, hp } = kWeightingFilters(sampleRate);
    const flL = applyBiquad(applyBiquad(isStereo ? left : mono, shelf), hp);
    const flR = isStereo ? applyBiquad(applyBiquad(right, shelf), hp) : null;

    // Decimated block power calculation (block size = 400ms, hop = 100ms for momentary; block size = 3000ms for short-term)
    const momentaryWindow = Math.floor(sampleRate * 0.40); // 400ms
    const shortTermWindow = Math.floor(sampleRate * 3.00); // 3.0s
    const hop = Math.floor(sampleRate * 0.10); // 100ms hop

    const numBlocks = Math.max(1, Math.floor((N - momentaryWindow) / hop));
    const momentaryPowers = [];
    const momentaryLufsList = [];
    const shortTermLufsList = [];

    // Pre-calculate cumulative power sums for fast sliding window
    const cumPower = new Float64Array(N + 1);
    for (let i = 0; i < N; i++) {
      const pL = flL[i] * flL[i];
      const pR = isStereo ? flR[i] * flR[i] : 0;
      cumPower[i + 1] = cumPower[i] + (isStereo ? pL + pR : pL);
    }

    for (let b = 0; b < numBlocks; b++) {
      const start = b * hop;
      const endM = Math.min(N, start + momentaryWindow);
      const lenM = endM - start;
      const meanPowerM = (cumPower[endM] - cumPower[start]) / lenM;

      momentaryPowers.push(meanPowerM);
      const lufsM = meanPowerM > 1e-12 ? -0.691 + 10 * Math.log10(meanPowerM) : -144;
      momentaryLufsList.push(lufsM);

      // Short term window (3s)
      const endS = Math.min(N, start + shortTermWindow);
      const lenS = endS - start;
      if (lenS >= momentaryWindow) {
        const meanPowerS = (cumPower[endS] - cumPower[start]) / lenS;
        const lufsS = meanPowerS > 1e-12 ? -0.691 + 10 * Math.log10(meanPowerS) : -144;
        shortTermLufsList.push(lufsS);
      }
    }

    // Integrated Loudness (Absolute threshold -70 LUFS & Relative threshold -10 LU)
    let absGatedSum = 0, absGatedCount = 0;
    for (let i = 0; i < momentaryPowers.length; i++) {
      const p = momentaryPowers[i];
      const l = p > 1e-12 ? -0.691 + 10 * Math.log10(p) : -144;
      if (l >= -70.0) {
        absGatedSum += p;
        absGatedCount++;
      }
    }

    let integratedLufs = -144;
    let relThresholdLufs = -70.0;

    if (absGatedCount > 0) {
      const uncalibratedLufs = -0.691 + 10 * Math.log10(absGatedSum / absGatedCount);
      relThresholdLufs = uncalibratedLufs - 10.0;

      let relGatedSum = 0, relGatedCount = 0;
      for (let i = 0; i < momentaryPowers.length; i++) {
        const p = momentaryPowers[i];
        const l = p > 1e-12 ? -0.691 + 10 * Math.log10(p) : -144;
        if (l >= relThresholdLufs && l >= -70.0) {
          relGatedSum += p;
          relGatedCount++;
        }
      }

      if (relGatedCount > 0) {
        integratedLufs = -0.691 + 10 * Math.log10(relGatedSum / relGatedCount);
      }
    }

    // Loudness Range (LRA) from short-term blocks (Absolute -70 LUFS, Relative -20 LU, 10th to 95th percentile)
    let lra = 0;
    if (shortTermLufsList.length > 4) {
      const validShortTerm = shortTermLufsList.filter(l => l >= -70 && l >= (integratedLufs - 20));
      if (validShortTerm.length >= 4) {
        const sortedSt = sortedCopy(validShortTerm);
        const lraP10 = percentile(sortedSt, 0.10);
        const lraP95 = percentile(sortedSt, 0.95);
        lra = Math.max(0, lraP95 - lraP10);
      }
    }

    // 3. Voiced RMS Distribution & Dynamic Range
    const validMomentary = momentaryLufsList.filter(l => l >= -60);
    const sortedMom = sortedCopy(validMomentary.length ? validMomentary : momentaryLufsList);
    const momMax = sortedMom.length ? sortedMom[sortedMom.length - 1] : -144;
    const momP90 = percentile(sortedMom, 0.90);
    const momP50 = percentile(sortedMom, 0.50);
    const momP10 = percentile(sortedMom, 0.10);

    const dynamicRangeDb = Math.max(0, momP90 - momP10);

    // 4. Phrase-to-Phrase Level Consistency
    // Detect continuous vocal phrases separated by >250ms pauses
    const phrases = [];
    let currentPhrase = [];
    for (let i = 0; i < momentaryLufsList.length; i++) {
      const l = momentaryLufsList[i];
      if (l >= -45) {
        currentPhrase.push(l);
      } else {
        if (currentPhrase.length >= 3) {
          phrases.push(mean(currentPhrase));
        }
        currentPhrase = [];
      }
    }
    if (currentPhrase.length >= 3) phrases.push(mean(currentPhrase));

    const phraseMeanStd = phrases.length >= 2 ? stdDev(phrases) : 1.5;

    // 5. Dynamic Profile & Compression Requirement Classification
    let levelConsistency = 'Medium';
    let compressionRequirement = 'Moderate';
    let suggestedCompressionStyle = 'Two-stage serial (FET peak control -> Opto leveling)';
    let compressionRatio = '3:1 to 4:1';
    let targetGR = '3–5 dB';
    let attackReleaseHint = 'Medium attack (15–30 ms), Auto/Program release';
    let compConfidence = 0.88;

    if (lra < 4.5 && phraseMeanStd < 1.8 && crestDb < 11) {
      levelConsistency = 'High';
      compressionRequirement = 'Light / Transparent';
      suggestedCompressionStyle = 'Gentle optical leveling or transparent bus glue';
      compressionRatio = '1.5:1 to 2:1';
      targetGR = '1–2 dB';
      attackReleaseHint = 'Slow attack (30–50 ms), Smooth release (100–300 ms)';
      compConfidence = 0.92;
    } else if (lra > 11.0 || phraseMeanStd > 4.5 || crestDb > 16.0) {
      levelConsistency = 'Low / Highly Dynamic';
      compressionRequirement = 'Heavy / Two-Stage';
      suggestedCompressionStyle = 'Aggressive 2-stage compression (Fast FET 1176 style to catch transient spikes followed by smooth LA-2A Opto leveling)';
      compressionRatio = 'Stage 1: 4:1 fast FET (3-5 dB GR) | Stage 2: 2:1 slow Opto (2-4 dB GR)';
      targetGR = '5–8 dB total';
      attackReleaseHint = 'Stage 1: Attack 0.5–1 ms, Release 50 ms. Stage 2: Slow smooth optical curve.';
      compConfidence = 0.94;
    } else {
      levelConsistency = 'Medium';
      compressionRequirement = 'Moderate';
      suggestedCompressionStyle = 'Classic musical leveling (VCA or Opto compressor)';
      compressionRatio = '3:1';
      targetGR = '3–4 dB';
      attackReleaseHint = 'Medium attack (15–25 ms), Musical release (~150 ms)';
      compConfidence = 0.90;
    }

    return {
      peakSample: peak,
      peakDb: Math.round(peakDb * 10) / 10,
      rmsDb: Math.round(rmsDb * 10) / 10,
      crestDb: Math.round(crestDb * 10) / 10,
      dynamicRangeDb: Math.round(dynamicRangeDb * 10) / 10,
      loudness: {
        integrated: isFinite(integratedLufs) ? Math.round(integratedLufs * 10) / 10 : -144,
        shortTermMax: shortTermLufsList.length ? Math.round(Math.max(...shortTermLufsList) * 10) / 10 : -144,
        momentaryMax: Math.round(momMax * 10) / 10,
        lra: Math.round(lra * 10) / 10
      },
      phraseConsistency: {
        detectedPhrases: phrases.length,
        phraseStdDevDb: Math.round(phraseMeanStd * 10) / 10,
        verdict: levelConsistency
      },
      compressionProfile: {
        requirement: compressionRequirement,
        style: suggestedCompressionStyle,
        suggestedRatio: compressionRatio,
        targetGR,
        attackReleaseHint,
        confidence: compConfidence
      },
      momentaryLufsList
    };
  }

  return {
    analyzeDynamics
  };
}));
