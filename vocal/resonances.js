'use strict';
/**
 * MixLens Vocal Analysis Engine — Resonance Analysis
 * Peak detection and discrimination between musical harmonics and unwanted acoustic resonances:
 * - Distinguishes F0 harmonics from fixed room/mic resonances
 * - Measures center frequency, Q bandwidth, excess above baseline, persistence
 * - Classifies: Harmonic | Natural Vocal Formant | Persistent Resonance | Intermittent Resonance
 * - Computes confidence and severity for precision corrective decisions
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./dsp'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./dsp'));
  } else {
    root.VocalResonances = factory(root.VocalDSP);
  }
}(typeof self !== 'undefined' ? self : this, function(DSP) {

  const { db10, db20, fmtDb, fmtFreq, freqToNote } = DSP;

  /**
   * Detect and classify spectral resonances
   * @param {Object} spectrumData - Output from VocalSpectrum.analyzeSpectrum
   * @param {Object} pitchData - Output from VocalPitch.analyzePitchAndHarmonics
   * @param {Object} [formantData] - Output from VocalFormants.analyzeFormants
   */
  function analyzeResonances(spectrumData, pitchData, formantData) {
    const { frequencies, avgSpectrumDb, envelopeDb, binWidth, timeFrames } = spectrumData;
    const numBins = frequencies.length;
    const medianF0 = pitchData && pitchData.f0 ? pitchData.f0.medianF0 : 0;

    // 1. Find candidate spectral peaks exceeding the local smoothed envelope
    const candidates = [];

    // Skip sub-bass < 80 Hz and extreme top > 16 kHz
    const minBin = Math.max(2, Math.round(80 / binWidth));
    const maxBin = Math.min(numBins - 3, Math.round(16000 / binWidth));

    for (let k = minBin; k <= maxBin; k++) {
      const level = avgSpectrumDb[k];
      const env = envelopeDb[k];
      const diff = level - env;

      // Peak condition: strictly higher than neighbors by at least 1.5 dB above local envelope
      if (level > avgSpectrumDb[k - 1] && level > avgSpectrumDb[k + 1] &&
          level > avgSpectrumDb[k - 2] && level > avgSpectrumDb[k + 2] &&
          diff >= 1.8) {

        // Refine peak frequency via 3-point parabolic interpolation
        const y1 = avgSpectrumDb[k - 1];
        const y2 = avgSpectrumDb[k];
        const y3 = avgSpectrumDb[k + 1];
        const delta = (y3 - y1) / (2 * (2 * y2 - y1 - y3) + 1e-9);
        const refinedBin = k + Math.max(-0.5, Math.min(0.5, delta));
        const centerFreq = refinedBin * binWidth;

        // Measure -3dB bandwidth and Q factor
        const halfPowerLevel = y2 - 3.0;
        let leftBin = k;
        while (leftBin > 1 && avgSpectrumDb[leftBin] > halfPowerLevel) leftBin--;
        let rightBin = k;
        while (rightBin < numBins - 2 && avgSpectrumDb[rightBin] > halfPowerLevel) rightBin++;

        const bandwidthHz = Math.max(binWidth, (rightBin - leftBin) * binWidth);
        const q = centerFreq / bandwidthHz;

        candidates.push({
          bin: k,
          centerFreq: Math.round(centerFreq),
          peakDb: Math.round(level * 10) / 10,
          excessDb: Math.round(diff * 10) / 10,
          bandwidthHz: Math.round(bandwidthHz),
          q: Math.round(q * 10) / 10
        });
      }
    }

    // 2. Measure Frame-by-Frame Persistence & Stationary Behavior
    // Check if the peak appears at the EXACT same frequency across different pitch notes
    const activeFrames = timeFrames.filter(tf => tf.active && tf.magDb);
    const totalActive = activeFrames.length;

    const classifiedResonances = [];

    for (const cand of candidates) {
      let frameHitCount = 0;
      let loudFrameHitCount = 0;
      let totalLoudFrames = 0;

      for (const tf of activeFrames) {
        const bin = cand.bin;
        const frameVal = tf.magDb[bin];
        const localFloor = (tf.magDb[Math.max(0, bin - 4)] + tf.magDb[Math.min(numBins - 1, bin + 4)]) / 2;
        if (frameVal - localFloor > 2.5) {
          frameHitCount++;
          if (tf.rmsDb > -24) loudFrameHitCount++;
        }
        if (tf.rmsDb > -24) totalLoudFrames++;
      }

      const persistencePct = totalActive > 0 ? (frameHitCount / totalActive) * 100 : 0;
      const loudOccurrencePct = totalLoudFrames > 0 ? (loudFrameHitCount / totalLoudFrames) * 100 : 0;

      // 3. Check Harmonic Relationship with F0
      let isHarmonic = false;
      let harmonicNumber = 0;
      if (medianF0 > 50) {
        const hNum = Math.round(cand.centerFreq / medianF0);
        const harmonicFreq = hNum * medianF0;
        const freqDiff = Math.abs(cand.centerFreq - harmonicFreq);
        if (hNum >= 1 && hNum <= 16 && (freqDiff / cand.centerFreq < 0.045 || freqDiff < 15)) {
          isHarmonic = true;
          harmonicNumber = hNum;
        }
      }

      // 4. Check Formant Relationship
      let isFormant = false;
      if (formantData) {
        const f1 = formantData.f1 ? formantData.f1.freq : 0;
        const f2 = formantData.f2 ? formantData.f2.freq : 0;
        const f3 = formantData.f3 ? formantData.f3.freq : 0;
        if ((f1 && Math.abs(cand.centerFreq - f1) < 80) ||
            (f2 && Math.abs(cand.centerFreq - f2) < 140) ||
            (f3 && Math.abs(cand.centerFreq - f3) < 200)) {
          isFormant = true;
        }
      }

      // 5. Classification
      let type = 'unknown';
      let confidence = 0.70;
      let severity = 0;
      let recommendedAction = 'LEAVE_UNCHANGED';
      let actionReason = '';

      if (isHarmonic && cand.q < 5.0 && !isFormant) {
        type = 'harmonic';
        confidence = 0.92;
        recommendedAction = 'LEAVE_UNCHANGED';
        actionReason = `Natural pitch harmonic H${harmonicNumber} at ${cand.centerFreq} Hz (${freqToNote(cand.centerFreq).note}). Do not cut with static EQ.`;
      } else if (isFormant && cand.q < 3.5) {
        type = 'natural_formant';
        confidence = 0.88;
        recommendedAction = 'LEAVE_UNCHANGED';
        actionReason = `Natural vocal tract formant resonance. Preserves vocal intelligibility and vowel timbre.`;
      } else if (cand.q >= 4.0 && persistencePct > 35) {
        // High Q stationary peak present in >35% of frames = genuine room/mic/acoustic resonance
        type = 'persistent_resonance';
        severity = Math.min(1.0, (cand.excessDb / 6.0) * (persistencePct / 60));
        confidence = Math.min(0.96, 0.65 + (persistencePct / 100) * 0.3);
        recommendedAction = 'CUT';
        actionReason = `Stationary ${cand.centerFreq} Hz peak persists in ${Math.round(persistencePct)}% of frames (+${cand.excessDb} dB above baseline, Q=${cand.q}). Narrow notch or corrective bell cut recommended.`;
      } else if (loudOccurrencePct > 45 && cand.excessDb >= 3.0) {
        // Intermittent resonance triggered during loud belting notes
        type = 'intermittent_resonance';
        severity = Math.min(1.0, (cand.excessDb / 5.0) * (loudOccurrencePct / 80));
        confidence = 0.84;
        recommendedAction = 'DYNAMIC_CUT';
        actionReason = `Resonance at ${cand.centerFreq} Hz surges by +${cand.excessDb} dB specifically during loud phrases. Dynamic EQ reduction preferred over static cut.`;
      } else {
        type = 'minor_fluctuation';
        confidence = 0.60;
        recommendedAction = 'LEAVE_UNCHANGED';
        actionReason = `Low severity or intermittent fluctuation. No processing required.`;
      }

      classifiedResonances.push({
        centerFreq: cand.centerFreq,
        note: freqToNote(cand.centerFreq).note,
        peakDb: cand.peakDb,
        excessDb: cand.excessDb,
        bandwidthHz: cand.bandwidthHz,
        q: cand.q,
        persistencePct: Math.round(persistencePct),
        type,
        harmonicNumber: isHarmonic ? harmonicNumber : null,
        severity: Math.round(severity * 100) / 100,
        confidence: Math.round(confidence * 100) / 100,
        action: recommendedAction,
        reason: actionReason
      });
    }

    // Sort by severity descending
    classifiedResonances.sort((a, b) => b.severity - a.severity);

    return {
      candidatesCount: candidates.length,
      resonances: classifiedResonances,
      problematicCount: classifiedResonances.filter(r => r.action !== 'LEAVE_UNCHANGED').length
    };
  }

  return {
    analyzeResonances
  };
}));
