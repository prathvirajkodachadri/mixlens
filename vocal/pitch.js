'use strict';
/**
 * MixLens Vocal Analysis Engine — Modules 3 & 4: Pitch (F0) & Harmonics
 * - YIN fundamental frequency extraction with confidence scoring
 * - Voiced / unvoiced segmentation
 * - Vibrato rate (Hz) and depth (cents)
 * - Pitch stability & drift
 * - Harmonic-to-Noise Ratio (HNR), harmonic roll-off & odd/even balance
 * - Vocal tonal character derivation from harmonic structure
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./dsp'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./dsp'));
  } else {
    root.VocalPitch = factory(root.VocalDSP);
  }
}(typeof self !== 'undefined' ? self : this, function(DSP) {

  const { db20, db10, mean, stdDev, sortedCopy, percentile, median, freqToNote, YinPitchDetector, computeFrameHNR, FFT, createHannWindow, applyWindow } = DSP;

  /**
   * Analyze pitch and harmonic structure across audio recording
   * @param {Float32Array} samples - Audio mono samples
   * @param {number} sampleRate - Sample rate
   * @param {Object} [options]
   */
  function analyzePitchAndHarmonics(samples, sampleRate, options = {}) {
    const N = samples.length;
    const frameSize = options.frameSize || 2048;
    const hopSize = options.hopSize || 512; // ~10.6ms at 48kHz for fine pitch resolution
    const yin = new YinPitchDetector(sampleRate, frameSize, 0.15);

    const totalFrames = Math.max(1, Math.floor((N - frameSize) / hopSize));
    const pitchTrack = [];
    const voicedF0s = [];
    const confidences = [];
    const frameHNRs = [];

    const frameBuf = new Float32Array(frameSize);
    let voicedFramesCount = 0;
    let unvoicedFramesCount = 0;

    for (let f = 0; f < totalFrames; f++) {
      const offset = f * hopSize;
      if (offset + frameSize > N) break;

      // Extract frame
      for (let i = 0; i < frameSize; i++) {
        frameBuf[i] = samples[offset + i];
      }

      // Check frame energy
      let energy = 0;
      for (let i = 0; i < frameSize; i++) energy += frameBuf[i] * frameBuf[i];
      const rms = Math.sqrt(energy / frameSize);
      const rmsDb = db20(rms);

      const timeSec = (offset + frameSize / 2) / sampleRate;

      if (rmsDb < -55) {
        // Silence / near-silent
        pitchTrack.push({
          time: timeSec,
          f0: 0,
          confidence: 0,
          voiced: false,
          rmsDb,
          hnrDb: 0
        });
        unvoicedFramesCount++;
        continue;
      }

      const res = yin.detect(frameBuf);

      let hnrDb = 0;
      if (res.voiced && res.tau > 0) {
        hnrDb = computeFrameHNR(frameBuf, Math.round(res.tau));
        frameHNRs.push(hnrDb);
      }

      const isVoiced = res.voiced && rmsDb >= -48 && res.confidence >= 0.65;

      pitchTrack.push({
        time: timeSec,
        f0: isVoiced ? res.f0 : 0,
        confidence: res.confidence,
        voiced: isVoiced,
        rmsDb,
        hnrDb
      });

      if (isVoiced) {
        voicedFramesCount++;
        voicedF0s.push(res.f0);
        confidences.push(res.confidence);
      } else {
        unvoicedFramesCount++;
      }
    }

    const totalAudibleFrames = voicedFramesCount + unvoicedFramesCount;
    const voicedPct = totalAudibleFrames > 0 ? (voicedFramesCount / totalAudibleFrames) * 100 : 0;
    const unvoicedPct = 100 - voicedPct;

    // Pitch Statistics
    let medianF0 = 0, minF0 = 0, maxF0 = 0, meanF0 = 0, pitchStdDev = 0;
    let primaryNote = { note: '—', cents: 0, midi: 0 };

    if (voicedF0s.length > 0) {
      const sortedF0 = sortedCopy(voicedF0s);
      medianF0 = median(sortedF0);
      minF0 = percentile(sortedF0, 0.05);
      maxF0 = percentile(sortedF0, 0.95);
      meanF0 = mean(voicedF0s);
      pitchStdDev = stdDev(voicedF0s, meanF0);
      primaryNote = freqToNote(medianF0);
    }

    // Vibrato Detection & Pitch Stability
    const vibratoResult = detectVibrato(pitchTrack, sampleRate, hopSize);

    // Harmonic Analysis (Harmonic Spectrum Stack)
    const harmonicResult = analyzeHarmonicStack(samples, sampleRate, pitchTrack, medianF0);

    return {
      f0: {
        medianF0,
        meanF0,
        minF0,
        maxF0,
        note: primaryNote.note,
        cents: primaryNote.cents,
        midi: primaryNote.midi,
        voicedPercent: voicedPct,
        unvoicedPercent: unvoicedPct,
        confidence: confidences.length ? mean(confidences) : 0,
        pitchStability: Math.max(0, Math.min(1, 1 - (pitchStdDev / Math.max(20, medianF0)) * 2))
      },
      vibrato: vibratoResult,
      harmonics: {
        meanHnrDb: frameHNRs.length ? mean(frameHNRs) : 0,
        ...harmonicResult
      },
      pitchTrack
    };
  }

  /**
   * Detect vibrato rate (Hz) and depth (cents) in sustained voiced segments
   */
  function detectVibrato(pitchTrack, sampleRate, hopSize) {
    const frameDuration = hopSize / sampleRate;

    // Find continuous voiced segments > 300ms
    const segments = [];
    let currentSeg = [];

    for (let i = 0; i < pitchTrack.length; i++) {
      const pt = pitchTrack[i];
      if (pt.voiced && pt.f0 > 0) {
        currentSeg.push(pt);
      } else {
        if (currentSeg.length * frameDuration >= 0.28) {
          segments.push(currentSeg);
        }
        currentSeg = [];
      }
    }
    if (currentSeg.length * frameDuration >= 0.28) {
      segments.push(currentSeg);
    }

    if (segments.length === 0) {
      return {
        detected: false,
        rateHz: 0,
        depthCents: 0,
        confidence: 0,
        note: 'No sustained voiced segments of sufficient duration for vibrato analysis.'
      };
    }

    const rates = [];
    const depths = [];

    for (const seg of segments) {
      const f0s = seg.map(p => p.f0);
      const segMean = mean(f0s);
      // Convert to cents relative to segment mean
      const cents = f0s.map(f => 1200 * Math.log2(Math.max(1, f) / Math.max(1, segMean)));

      // Zero-crossing on de-trended cents to estimate frequency
      let zeroCrossings = 0;
      for (let i = 1; i < cents.length; i++) {
        if ((cents[i] >= 0 && cents[i - 1] < 0) || (cents[i] < 0 && cents[i - 1] >= 0)) {
          zeroCrossings++;
        }
      }

      const segDur = seg.length * frameDuration;
      const estimatedRate = (zeroCrossings / 2) / segDur;

      // Realistic vocal vibrato is 4.0 Hz to 8.0 Hz
      if (estimatedRate >= 4.0 && estimatedRate <= 8.5) {
        // Measure peak-to-peak depth in cents
        const sortedCents = sortedCopy(cents);
        const p10 = percentile(sortedCents, 0.10);
        const p90 = percentile(sortedCents, 0.90);
        const depth = (p90 - p10) / 2;

        if (depth >= 15 && depth <= 160) {
          rates.push(estimatedRate);
          depths.push(depth);
        }
      }
    }

    if (rates.length > 0) {
      const avgRate = mean(rates);
      const avgDepth = mean(depths);
      const conf = Math.min(0.95, 0.5 + 0.1 * rates.length);
      return {
        detected: true,
        rateHz: Math.round(avgRate * 10) / 10,
        depthCents: Math.round(avgDepth),
        confidence: conf,
        note: `Vibrato detected at ~${avgRate.toFixed(1)} Hz with ±${Math.round(avgDepth)} cents depth.`
      };
    }

    return {
      detected: false,
      rateHz: 0,
      depthCents: 0,
      confidence: 0.8,
      note: 'Natural straight tone / minimal vibrato.'
    };
  }

  /**
   * Extract harmonic peaks at integer multiples of F0
   */
  function analyzeHarmonicStack(samples, sampleRate, pitchTrack, medianF0) {
    if (!medianF0 || medianF0 < 50) {
      return {
        harmonics: [],
        harmonicRollOff: 0,
        oddEvenRatio: 1.0,
        character: 'Indeterminate / Unvoiced'
      };
    }

    const fftSize = 4096;
    const fft = new FFT(fftSize);
    const hann = createHannWindow(fftSize);
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);
    const binWidth = sampleRate / fftSize;

    const numHarmonics = 12;
    const harmonicPowers = new Float64Array(numHarmonics);
    let sampleCount = 0;

    for (let i = 0; i < pitchTrack.length; i += 4) {
      const pt = pitchTrack[i];
      if (!pt.voiced || pt.f0 <= 50) continue;

      const centerIdx = Math.round(pt.time * sampleRate);
      const startIdx = centerIdx - fftSize / 2;
      if (startIdx < 0 || startIdx + fftSize > samples.length) continue;

      for (let j = 0; j < fftSize; j++) {
        re[j] = samples[startIdx + j];
        im[j] = 0;
      }
      applyWindow(re, hann, re);
      fft.transform(re, im);
      const power = fft.powerSpectrum(re, im);

      // Measure harmonics H1 to H12
      for (let h = 1; h <= numHarmonics; h++) {
        const targetFreq = pt.f0 * h;
        if (targetFreq >= sampleRate * 0.48) break;
        const targetBin = Math.round(targetFreq / binWidth);

        // Find local peak around target bin
        let peakP = 0;
        for (let b = Math.max(1, targetBin - 2); b <= Math.min(fftSize / 2 - 1, targetBin + 2); b++) {
          if (power[b] > peakP) peakP = power[b];
        }
        harmonicPowers[h - 1] += peakP;
      }
      sampleCount++;
    }

    if (sampleCount === 0) {
      return {
        harmonics: [],
        harmonicRollOff: -6.0,
        oddEvenRatio: 1.0,
        character: 'Balanced'
      };
    }

    const harmonicLevels = [];
    let oddSum = 0, evenSum = 0;
    for (let h = 0; h < numHarmonics; h++) {
      const p = harmonicPowers[h] / sampleCount;
      const db = db10(p);
      harmonicLevels.push({
        harmonic: h + 1,
        freq: Math.round(medianF0 * (h + 1)),
        levelDb: db
      });
      if (h % 2 === 0) {
        oddSum += p; // 1st, 3rd, 5th, etc.
      } else {
        evenSum += p; // 2nd, 4th, 6th, etc.
      }
    }

    // Linear regression of harmonic slope (dB per octave)
    // log2(harmonicNumber) vs dB
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    const n = Math.min(8, harmonicLevels.length);
    for (let i = 0; i < n; i++) {
      const x = Math.log2(i + 1);
      const y = harmonicLevels[i].levelDb;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumXX += x * x;
    }
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX + 1e-9);
    const harmonicRollOff = isFinite(slope) ? slope : -6.0;

    const oddEvenRatio = evenSum > 0 ? oddSum / evenSum : 1.0;

    // Harmonic character classification
    let character = 'Balanced harmonic cascade';
    if (harmonicRollOff > -4.5) {
      character = 'Dense and bright harmonic presence';
    } else if (harmonicRollOff < -12.0) {
      character = 'Dark and warm with rapid harmonic roll-off';
    } else if (oddEvenRatio > 1.8) {
      character = 'Edgy / slightly hollow odd-harmonic dominance';
    } else if (oddEvenRatio < 0.6) {
      character = 'Warm even-harmonic roundness';
    }

    return {
      harmonics: harmonicLevels,
      harmonicRollOff: Math.round(harmonicRollOff * 10) / 10,
      oddEvenRatio: Math.round(oddEvenRatio * 100) / 100,
      character
    };
  }

  return {
    analyzePitchAndHarmonics
  };
}));
