'use strict';
/**
 * MixLens Final Mastering Analysis 1.0 — Hann STFT + compact spectrogram.
 * Frame decimation keeps long masters responsive.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'), require('./fft'));
  } else {
    root.MAStft = factory(root.MAUtilities, root.MAFft);
  }
}(typeof self !== 'undefined' ? self : this, function (U, FftMod) {

  const FFT = FftMod.FFT;

  function computeStft(samples, sampleRate, options) {
    const opt = options || {};
    const fftSize = opt.fftSize || 4096;
    const hopSize = opt.hopSize || (fftSize >> 2);
    const maxFrames = opt.maxFrames || 1400;
    const minActiveDb = opt.minActiveDb == null ? -70 : opt.minActiveDb;
    const collectFrames = opt.collectFrames !== false;

    const N = samples.length;
    const numBins = fftSize >> 1;
    const binWidth = sampleRate / fftSize;
    const frequencies = new Float32Array(numBins);
    for (let k = 0; k < numBins; k++) frequencies[k] = k * binWidth;

    const fft = new FFT(fftSize);
    const window = U.hannWindow(fftSize);
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);
    const power = new Float32Array(numBins);

    const totalPossible = Math.max(1, Math.floor((N - fftSize) / hopSize) + 1);
    const frameStep = totalPossible > maxFrames ? Math.ceil(totalPossible / maxFrames) : 1;

    const powerSum = new Float64Array(numBins);
    const binHistories = [];
    for (let k = 0; k < numBins; k++) binHistories.push([]);

    const timeFrames = [];
    const centroids = [];
    const spreads = [];
    const flatnesses = [];
    const fluxes = [];
    const rolloffs = [];
    let prevMag = null;
    let activeCount = 0;
    let processed = 0;

    for (let f = 0; f < totalPossible; f += frameStep) {
      const offset = f * hopSize;
      if (offset + fftSize > N) break;

      let sumSq = 0;
      for (let i = 0; i < fftSize; i++) {
        const s = samples[offset + i];
        re[i] = s;
        im[i] = 0;
        sumSq += s * s;
      }
      const frameRms = Math.sqrt(sumSq / fftSize);
      const frameRmsDb = U.db20(frameRms);

      U.applyWindow(re, window, re);
      fft.transform(re, im);
      fft.powerSpectrum(re, im, power);

      const mag = new Float32Array(numBins);
      for (let k = 0; k < numBins; k++) mag[k] = Math.sqrt(power[k]);

      const descCentroid = U.spectralCentroid(mag, frequencies);
      const descSpread = U.spectralSpread(mag, frequencies, descCentroid);
      const descFlat = U.spectralFlatness(mag);
      const descRoll = U.spectralRolloff(mag, frequencies, 0.85);
      const descFlux = U.spectralFlux(mag, prevMag);
      prevMag = mag;

      const isActive = frameRmsDb >= minActiveDb;
      const t = offset / sampleRate;

      if (collectFrames) {
        timeFrames.push({
          time: t,
          rmsDb: frameRmsDb,
          active: isActive,
          centroid: descCentroid,
          spread: descSpread,
          flatness: descFlat,
          rolloff: descRoll,
          flux: descFlux
        });
      }

      if (isActive) {
        activeCount++;
        centroids.push(descCentroid);
        spreads.push(descSpread);
        flatnesses.push(descFlat);
        fluxes.push(descFlux);
        rolloffs.push(descRoll);
        for (let k = 0; k < numBins; k++) {
          powerSum[k] += power[k];
          binHistories[k].push(power[k]);
        }
      }
      processed++;
    }

    if (activeCount === 0 && processed > 0) {
      for (let f = 0; f < totalPossible; f += frameStep) {
        const offset = f * hopSize;
        if (offset + fftSize > N) break;
        for (let i = 0; i < fftSize; i++) {
          re[i] = samples[offset + i];
          im[i] = 0;
        }
        U.applyWindow(re, window, re);
        fft.transform(re, im);
        fft.powerSpectrum(re, im, power);
        for (let k = 0; k < numBins; k++) {
          powerSum[k] += power[k];
          binHistories[k].push(power[k]);
        }
        activeCount++;
      }
    }

    const avgSpectrumDb = new Float32Array(numBins);
    const medianSpectrumDb = new Float32Array(numBins);
    const p10SpectrumDb = new Float32Array(numBins);
    const p90SpectrumDb = new Float32Array(numBins);
    const denom = Math.max(1, activeCount);

    for (let k = 0; k < numBins; k++) {
      avgSpectrumDb[k] = U.db10(powerSum[k] / denom);
      const hist = binHistories[k];
      if (!hist.length) {
        medianSpectrumDb[k] = avgSpectrumDb[k];
        p10SpectrumDb[k] = avgSpectrumDb[k];
        p90SpectrumDb[k] = avgSpectrumDb[k];
        continue;
      }
      const sorted = U.sortedCopy(hist);
      medianSpectrumDb[k] = U.db10(U.percentile(sorted, 0.5));
      p10SpectrumDb[k] = U.db10(U.percentile(sorted, 0.1));
      p90SpectrumDb[k] = U.db10(U.percentile(sorted, 0.9));
    }

    return {
      fftSize: fftSize,
      hopSize: hopSize,
      frameStep: frameStep,
      binWidth: binWidth,
      numBins: numBins,
      frequencies: frequencies,
      avgSpectrumDb: avgSpectrumDb,
      medianSpectrumDb: medianSpectrumDb,
      p10SpectrumDb: p10SpectrumDb,
      p90SpectrumDb: p90SpectrumDb,
      powerSum: powerSum,
      activeFrameCount: activeCount,
      processedFrames: processed,
      timeFrames: timeFrames,
      descriptors: {
        centroid_hz: centroids.length ? U.mean(centroids) : 0,
        spread_hz: spreads.length ? U.mean(spreads) : 0,
        rolloff_hz: rolloffs.length ? U.mean(rolloffs) : 0,
        flatness: flatnesses.length ? U.mean(flatnesses) : 0,
        flux: fluxes.length ? U.mean(fluxes) : 0
      }
    };
  }

  function computeSpectrogram(samples, sampleRate, options) {
    const opt = options || {};
    const fftSize = opt.fftSize || 2048;
    const hopSize = opt.hopSize || 1024;
    const maxCols = opt.maxCols || 512;
    const logBins = opt.logBins || 128;
    const fMin = 20;
    const fMax = Math.min(20000, sampleRate / 2);

    const N = samples.length;
    const numBins = fftSize >> 1;
    const binWidth = sampleRate / fftSize;
    const totalPossible = Math.max(1, Math.floor((N - fftSize) / hopSize) + 1);
    const frameStep = totalPossible > maxCols ? Math.ceil(totalPossible / maxCols) : 1;

    const fft = new FFT(fftSize);
    const window = U.hannWindow(fftSize);
    const re = new Float32Array(fftSize);
    const im = new Float32Array(fftSize);
    const magDb = new Float32Array(numBins);

    const logFreqs = new Float32Array(logBins);
    for (let i = 0; i < logBins; i++) {
      const t = i / (logBins - 1);
      logFreqs[i] = fMin * Math.pow(fMax / fMin, t);
    }

    const columns = [];
    const times = [];

    for (let f = 0; f < totalPossible; f += frameStep) {
      const offset = f * hopSize;
      if (offset + fftSize > N) break;
      for (let i = 0; i < fftSize; i++) {
        re[i] = samples[offset + i];
        im[i] = 0;
      }
      U.applyWindow(re, window, re);
      fft.transform(re, im);
      fft.magnitudeDb(re, im, magDb);

      const col = new Float32Array(logBins);
      for (let i = 0; i < logBins; i++) {
        const bin = logFreqs[i] / binWidth;
        const b0 = Math.max(0, Math.min(numBins - 1, Math.floor(bin)));
        const b1 = Math.max(0, Math.min(numBins - 1, b0 + 1));
        const frac = bin - b0;
        col[i] = magDb[b0] * (1 - frac) + magDb[b1] * frac;
      }
      columns.push(col);
      times.push(offset / sampleRate);
    }

    return { columns: columns, times: times, logFreqs: logFreqs, fftSize: fftSize, hopSize: hopSize, fMin: fMin, fMax: fMax };
  }

  return { computeStft: computeStft, computeSpectrogram: computeSpectrogram };
}));
