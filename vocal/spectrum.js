'use strict';
/**
 * MixLens Vocal Analysis Engine — Module 2: Spectral Analysis
 * High-resolution STFT over time with active vocal frame selection:
 * - Windowed overlapping frames (4096-point Hann)
 * - Average spectrum (linear power mean)
 * - Median spectrum & 10th / 90th percentile spectral envelope
 * - Time-varying spectral descriptors: Centroid, Flux, Flatness, Roll-off
 * - Full 20 Hz to 20 kHz coverage
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./dsp'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./dsp'));
  } else {
    root.VocalSpectrum = factory(root.VocalDSP);
  }
}(typeof self !== 'undefined' ? self : this, function(DSP) {

  const { db20, db10, mean, sortedCopy, percentile, median, FFT, createHannWindow, applyWindow, computeSpectralDescriptors } = DSP;

  /**
   * Run high-resolution STFT spectral analysis on audio samples
   * @param {Float32Array} samples - Audio channel samples
   * @param {number} sampleRate - Sample rate in Hz
   * @param {Object} [options] - Configuration options
   */
  function analyzeSpectrum(samples, sampleRate, options = {}) {
    const N = samples.length;
    const fftSize = options.fftSize || 4096;
    const hopSize = options.hopSize || 1024; // 75% overlap
    const minVoicedDb = options.minVoicedDb || -55;

    const numBins = fftSize / 2;
    const binWidth = sampleRate / fftSize;
    const frequencies = new Float32Array(numBins);
    for (let k = 0; k < numBins; k++) {
      frequencies[k] = k * binWidth;
    }

    const fft = new FFT(fftSize);
    const window = createHannWindow(fftSize);
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);

    const totalFrames = Math.max(1, Math.floor((N - fftSize) / hopSize) + 1);

    // Limit maximum processed frames for very long audio files (e.g. 5+ minutes) while preserving uniform sampling
    const MAX_FRAMES = 1200;
    const frameStep = totalFrames > MAX_FRAMES ? Math.ceil(totalFrames / MAX_FRAMES) : 1;

    // Buffers to accumulate active frames
    const binPowerHistories = [];
    for (let k = 0; k < numBins; k++) {
      binPowerHistories.push([]);
    }

    const timeFrames = [];
    let activeFrameCount = 0;
    let totalEnergySum = 0;
    let prevMag = null;

    const centroids = [];
    const flatnesses = [];
    const fluxes = [];
    const rollOffs85 = [];
    const rollOffs95 = [];

    for (let f = 0; f < totalFrames; f += frameStep) {
      const offset = f * hopSize;
      if (offset + fftSize > N) break;

      // Extract windowed frame
      for (let i = 0; i < fftSize; i++) {
        re[i] = samples[offset + i];
        im[i] = 0;
      }

      // Check frame RMS
      let frameSqSum = 0;
      for (let i = 0; i < fftSize; i++) frameSqSum += re[i] * re[i];
      const frameRms = Math.sqrt(frameSqSum / fftSize);
      const frameRmsDb = db20(frameRms);

      applyWindow(re, window, re);
      fft.transform(re, im);

      const power = fft.powerSpectrum(re, im);
      const magDb = new Float32Array(numBins);
      const magLinear = new Float32Array(numBins);

      for (let k = 0; k < numBins; k++) {
        magLinear[k] = Math.sqrt(power[k]);
        magDb[k] = db10(power[k]);
      }

      const timeSec = offset / sampleRate;
      const desc = computeSpectralDescriptors(magLinear, frequencies, prevMag);
      prevMag = magLinear;

      const isActive = frameRmsDb >= minVoicedDb;

      timeFrames.push({
        time: timeSec,
        rmsDb: frameRmsDb,
        active: isActive,
        magDb,
        centroid: desc.centroid,
        flatness: desc.flatness,
        flux: desc.flux,
        rollOff85: desc.rollOff85,
        rollOff95: desc.rollOff95
      });

      if (isActive) {
        activeFrameCount++;
        centroids.push(desc.centroid);
        flatnesses.push(desc.flatness);
        fluxes.push(desc.flux);
        rollOffs85.push(desc.rollOff85);
        rollOffs95.push(desc.rollOff95);

        for (let k = 0; k < numBins; k++) {
          binPowerHistories[k].push(power[k]);
          totalEnergySum += power[k];
        }
      }
    }

    // Fallback if audio was near silent
    if (activeFrameCount === 0) {
      for (let f = 0; f < timeFrames.length; f++) {
        const tf = timeFrames[f];
        for (let k = 0; k < numBins; k++) {
          binPowerHistories[k].push(Math.pow(10, tf.magDb[k] / 10));
        }
      }
      activeFrameCount = timeFrames.length;
    }

    // Compute statistical spectra across active frames
    const avgSpectrumDb = new Float32Array(numBins);
    const medianSpectrumDb = new Float32Array(numBins);
    const p10SpectrumDb = new Float32Array(numBins);
    const p90SpectrumDb = new Float32Array(numBins);

    for (let k = 0; k < numBins; k++) {
      const hist = binPowerHistories[k];
      let sumP = 0;
      for (let i = 0; i < hist.length; i++) sumP += hist[i];
      const meanPower = sumP / Math.max(1, hist.length);
      avgSpectrumDb[k] = db10(meanPower);

      const sorted = sortedCopy(hist);
      medianSpectrumDb[k] = db10(percentile(sorted, 0.50));
      p10SpectrumDb[k] = db10(percentile(sorted, 0.10));
      p90SpectrumDb[k] = db10(percentile(sorted, 0.90));
    }

    // Compute smoothed spectral envelope (moving gaussian window across bins)
    const envelopeDb = new Float32Array(numBins);
    const smoothRadius = Math.max(3, Math.round(numBins * 0.015));
    for (let k = 0; k < numBins; k++) {
      let sum = 0, weightSum = 0;
      for (let j = Math.max(0, k - smoothRadius); j <= Math.min(numBins - 1, k + smoothRadius); j++) {
        const dist = (k - j) / smoothRadius;
        const w = Math.exp(-0.5 * dist * dist * 4);
        sum += avgSpectrumDb[j] * w;
        weightSum += w;
      }
      envelopeDb[k] = weightSum > 0 ? sum / weightSum : avgSpectrumDb[k];
    }

    // Spectral tilt (slope in dB / decade between 100 Hz and 10 kHz)
    const bin100 = Math.round(100 / binWidth);
    const bin10k = Math.min(numBins - 1, Math.round(10000 / binWidth));
    const val100 = envelopeDb[bin100];
    const val10k = envelopeDb[bin10k];
    const spectralTilt = (val10k - val100) / 2; // dB per decade (log10(10000/100) = 2 decades)

    return {
      fftSize,
      hopSize,
      binWidth,
      numBins,
      frequencies,
      avgSpectrumDb,
      medianSpectrumDb,
      p10SpectrumDb,
      p90SpectrumDb,
      envelopeDb,
      spectralTilt,
      activeFrameCount,
      totalFrames: timeFrames.length,
      descriptors: {
        meanCentroid: centroids.length ? mean(centroids) : 0,
        meanFlatness: flatnesses.length ? mean(flatnesses) : 0,
        meanFlux: fluxes.length ? mean(fluxes) : 0,
        meanRollOff85: rollOffs85.length ? mean(rollOffs85) : 0,
        meanRollOff95: rollOffs95.length ? mean(rollOffs95) : 0
      },
      timeFrames
    };
  }

  return {
    analyzeSpectrum
  };
}));
