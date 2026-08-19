'use strict';
/**
 * MixLens Vocal Analysis Engine — Module 1: Recording Health Analysis
 * Evaluates the raw recording quality before any mixing decisions:
 * - Digital clipping & True Peak oversampling
 * - Background noise floor, SNR & noise profile estimation
 * - 50 Hz / 60 Hz mains electrical hum & harmonic series
 * - DC offset detection
 * - Nonlinear distortion / analog saturation behavior
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./dsp'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./dsp'));
  } else {
    root.VocalHealth = factory(root.VocalDSP);
  }
}(typeof self !== 'undefined' ? self : this, function(DSP) {

  const { db20, db10, mean, stdDev, sortedCopy, percentile, measureTruePeak, FFT, createHannWindow, applyWindow } = DSP;

  /**
   * Analyze recording health of audio channels
   * @param {Float32Array} mono - Mono mix samples
   * @param {number} sampleRate - Audio sample rate (e.g. 44100, 48000)
   * @param {Array<Float32Array>} [channels] - Optional multi-channel array
   */
  function analyzeRecordingHealth(mono, sampleRate, channels) {
    const N = mono.length;
    if (!N) {
      return {
        score: 0,
        clipping: { samples: 0, percent: 0, longestRun: 0, peakSample: 0, peakSampleDb: -144, truePeak: 0, truePeakDb: -144, severity: 'clean' },
        noiseFloor: { floorDb: -144, snrDb: 0, variationDb: 0, character: 'silent' },
        hum: { detected: false, freq: 0, levelDb: -144, harmonics: [], confidence: 0, severity: 0 },
        dcOffset: { mean: 0, db: -144, detected: false },
        distortion: { detected: false, type: 'clean', confidence: 0 },
        healthVerdict: 'Silent or empty recording'
      };
    }

    // 1. Digital Clipping Analysis
    let clippedCount = 0;
    let currentRun = 0;
    let longestRun = 0;
    let peakSample = 0;
    let dcSum = 0;

    const CLIP_THRESHOLD = 0.999;

    for (let i = 0; i < N; i++) {
      const s = mono[i];
      const abs = Math.abs(s);
      dcSum += s;

      if (abs > peakSample) peakSample = abs;

      if (abs >= CLIP_THRESHOLD) {
        clippedCount++;
        currentRun++;
        if (currentRun > longestRun) longestRun = currentRun;
      } else {
        currentRun = 0;
      }
    }

    const clippedPercent = (clippedCount / N) * 100;
    const peakSampleDb = db20(peakSample);
    const truePeak = measureTruePeak(mono);
    const truePeakDb = db20(truePeak);

    let clipSeverity = 'clean';
    let clipConfidence = 0.98;
    if (clippedCount > 0 || truePeakDb > 0.05) {
      if (clippedCount >= 100 || longestRun >= 6 || clippedPercent > 0.1 || truePeakDb > 2.0) {
        clipSeverity = 'severe';
      } else if (clippedCount >= 15 || longestRun >= 3 || clippedPercent > 0.01 || truePeakDb > 0.5) {
        clipSeverity = 'significant';
      } else {
        clipSeverity = 'slight';
      }
    }

    // 2. DC Offset Detection
    const dcMean = dcSum / N;
    const dcDb = db20(Math.abs(dcMean));
    const dcDetected = Math.abs(dcMean) > 0.0005; // > -66 dBFS

    // 3. Noise Floor & SNR Analysis via Short-Term Windowing
    const frameSize = Math.floor(sampleRate * 0.05); // 50ms frames
    const hopSize = Math.floor(frameSize / 2);
    const numFrames = Math.floor((N - frameSize) / hopSize);

    const frameRmsList = [];
    const quietFramesData = [];

    for (let f = 0; f < numFrames; f++) {
      const start = f * hopSize;
      let sumSq = 0;
      for (let i = 0; i < frameSize; i++) {
        const v = mono[start + i];
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / frameSize);
      frameRmsList.push(rms);
    }

    const sortedRms = sortedCopy(frameRmsList);
    const p05 = percentile(sortedRms, 0.05);
    const p10 = percentile(sortedRms, 0.10);
    const p90 = percentile(sortedRms, 0.90);
    const p98 = percentile(sortedRms, 0.98);

    const noiseFloorRms = Math.max(1e-7, (p05 + p10) / 2);
    const noiseFloorDb = db20(noiseFloorRms);
    const voicedSignalRms = Math.max(noiseFloorRms * 2, (p90 + p98) / 2);
    const voicedSignalDb = db20(voicedSignalRms);
    const snrDb = Math.max(0, voicedSignalDb - noiseFloorDb);

    // Calculate noise floor variation in bottom 15% frames
    const quietFrameEnergies = sortedRms.slice(0, Math.max(2, Math.floor(sortedRms.length * 0.15)));
    const quietDbVals = quietFrameEnergies.map(v => db20(v));
    const noiseVariationDb = stdDev(quietDbVals);

    // 4. Electrical Hum Detection (50 Hz, 60 Hz and Harmonic Series)
    // Run high-resolution FFT on quiet frames to detect stationary tones
    const fftSize = 4096;
    const fft = new FFT(fftSize);
    const hann = createHannWindow(fftSize);
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);
    const avgQuietPower = new Float32Array(fftSize / 2);
    let quietFftCount = 0;

    // Collect quiet frames
    for (let f = 0; f < numFrames && quietFftCount < 40; f++) {
      if (frameRmsList[f] <= p10 * 1.5) {
        const start = f * hopSize;
        if (start + fftSize <= N) {
          for (let i = 0; i < fftSize; i++) {
            re[i] = mono[start + i];
            im[i] = 0;
          }
          applyWindow(re, hann, re);
          fft.transform(re, im);
          const p = fft.powerSpectrum(re, im);
          for (let k = 0; k < fftSize / 2; k++) avgQuietPower[k] += p[k];
          quietFftCount++;
        }
      }
    }

    let humDetected = false;
    let humBaseFreq = 0;
    let humLevelDb = -144;
    let humConfidence = 0;
    let humSeverity = 0;
    const humHarmonics = [];

    if (quietFftCount > 0) {
      for (let k = 0; k < fftSize / 2; k++) avgQuietPower[k] /= quietFftCount;

      const binToHz = sampleRate / fftSize;
      const getPowerAt = (hz) => {
        const bin = Math.round(hz / binToHz);
        if (bin <= 0 || bin >= fftSize / 2) return 0;
        return avgQuietPower[bin];
      };

      const getLocalFloorAt = (hz) => {
        const bin = Math.round(hz / binToHz);
        let sum = 0, count = 0;
        for (let b = Math.max(1, bin - 5); b <= Math.min(fftSize / 2 - 1, bin + 5); b++) {
          if (Math.abs(b - bin) > 1) {
            sum += avgQuietPower[b];
            count++;
          }
        }
        return count > 0 ? sum / count : 1e-12;
      };

      // Check 50 Hz vs 60 Hz
      for (const base of [50, 60]) {
        const pBase = getPowerAt(base);
        const fBase = getLocalFloorAt(base);
        const ratio = pBase / Math.max(1e-12, fBase);

        if (ratio > 4.0) { // +6 dB peak above local quiet floor
          const series = [];
          let seriesEnergy = pBase;
          for (let h = 1; h <= 6; h++) {
            const fH = base * h;
            const pH = getPowerAt(fH);
            const fHFloor = getLocalFloorAt(fH);
            const hRatio = pH / Math.max(1e-12, fHFloor);
            if (hRatio > 2.5) {
              series.push({
                freq: fH,
                levelDb: db10(pH),
                ratioDb: db10(hRatio),
                harmonicNumber: h
              });
              if (h > 1) seriesEnergy += pH;
            }
          }

          if (series.length >= 1) {
            const hLevel = db10(seriesEnergy);
            const conf = Math.min(0.98, 0.5 + 0.12 * series.length + (ratio > 10 ? 0.2 : 0.05));
            if (conf > humConfidence) {
              humDetected = true;
              humBaseFreq = base;
              humLevelDb = hLevel;
              humConfidence = conf;
              humHarmonics.length = 0;
              humHarmonics.push(...series);
              humSeverity = Math.min(1.0, Math.max(0.1, (hLevel - noiseFloorDb) / 25));
            }
          }
        }
      }
    }

    // 5. Estimate Noise Character
    let noiseCharacter = 'clean';
    let noiseSourceHint = 'Clean, low-noise recording';
    if (noiseFloorDb > -45) {
      noiseCharacter = 'severe_noise';
      noiseSourceHint = 'High background noise floor. Gating or noise suppression recommended.';
    } else if (noiseFloorDb > -58) {
      noiseCharacter = 'moderate_noise';
      noiseSourceHint = 'Noticeable background ambient noise.';
    } else if (noiseFloorDb > -72) {
      noiseCharacter = 'slight_noise';
      noiseSourceHint = 'Normal studio background level.';
    }

    // 6. Nonlinear Distortion / Saturation Analysis
    let distDetected = false;
    let distType = 'clean';
    let distConfidence = 0.85;

    if (clipSeverity === 'severe' || clipSeverity === 'significant') {
      distDetected = true;
      distType = 'digital_clipping';
      distConfidence = 0.95;
    } else if (peakSampleDb >= -0.3 && crestFactorFromVoiced(p90, peakSample) < 7.0) {
      distDetected = true;
      distType = 'heavy_saturation_or_limiting';
      distConfidence = 0.78;
    }

    // 7. Compute Overall Recording Health Score (0–100)
    let healthScore = 100;
    if (clipSeverity === 'severe') healthScore -= 45;
    else if (clipSeverity === 'significant') healthScore -= 25;
    else if (clipSeverity === 'slight') healthScore -= 10;

    if (snrDb < 18) healthScore -= 30;
    else if (snrDb < 30) healthScore -= 18;
    else if (snrDb < 45) healthScore -= 8;

    if (humDetected) healthScore -= Math.round(humSeverity * 20);
    if (dcDetected) healthScore -= 8;

    healthScore = Math.max(0, Math.min(100, healthScore));

    // Summary verdict
    let healthVerdict = 'Excellent recording quality — clean, noise-free, and unclipped.';
    if (healthScore < 50) {
      healthVerdict = 'Significant recording health issues detected. Needs cleanup before mixing.';
    } else if (healthScore < 80) {
      healthVerdict = 'Acceptable recording with minor background noise or slight peak issues.';
    }

    return {
      score: healthScore,
      healthVerdict,
      clipping: {
        samples: clippedCount,
        percent: clippedPercent,
        longestRun,
        peakSample,
        peakSampleDb,
        truePeak,
        truePeakDb,
        severity: clipSeverity,
        confidence: clipConfidence,
        note: 'Clipping is irreversible waveform truncation. Do not use EQ to repair clipping.'
      },
      noiseFloor: {
        floorDb: noiseFloorDb,
        snrDb,
        variationDb: noiseVariationDb,
        character: noiseCharacter,
        hint: noiseSourceHint
      },
      hum: {
        detected: humDetected,
        freq: humBaseFreq,
        levelDb: humLevelDb,
        harmonics: humHarmonics,
        confidence: humConfidence,
        severity: humSeverity
      },
      dcOffset: {
        mean: dcMean,
        db: dcDb,
        detected: dcDetected,
        percent: dcMean * 100
      },
      distortion: {
        detected: distDetected,
        type: distType,
        confidence: distConfidence
      }
    };
  }

  function crestFactorFromVoiced(rms, peak) {
    if (rms <= 1e-6) return 20;
    return 20 * Math.log10(Math.max(1e-6, peak) / rms);
  }

  return {
    analyzeRecordingHealth
  };
}));
