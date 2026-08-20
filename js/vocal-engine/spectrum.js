'use strict';
/**
 * MixLens Vocal Engine 3.0 — High-resolution spectrum + spectrogram payload.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'), require('./stft'));
  } else {
    root.VESpectrum = factory(root.VEUtilities, root.VEStft);
  }
}(typeof self !== 'undefined' ? self : this, function (U, Stft) {

  function downsampleLogSpectrum(frequencies, valuesDb, points) {
    const n = points || 512;
    const fMin = 20;
    const fMax = Math.max(fMin * 2, frequencies[frequencies.length - 1] || 20000);
    const outF = new Float32Array(n);
    const outV = new Float32Array(n);
    let src = 0;
    for (let i = 0; i < n; i++) {
      const f = fMin * Math.pow(fMax / fMin, i / (n - 1));
      outF[i] = f;
      while (src < frequencies.length - 2 && frequencies[src + 1] < f) src++;
      const f0 = frequencies[src];
      const f1 = frequencies[src + 1] || f0;
      const t = f1 === f0 ? 0 : (f - f0) / (f1 - f0);
      outV[i] = valuesDb[src] * (1 - t) + valuesDb[Math.min(src + 1, valuesDb.length - 1)] * t;
    }
    return { freq: outF, db: outV };
  }

  function analyzeSpectrum(mono, sampleRate, options) {
    const opt = options || {};
    const duration = mono.length / sampleRate;
    const fftSize = opt.fftSize || (duration > 180 ? 4096 : 8192);
    const hopSize = opt.hopSize || (fftSize >> 2);
    const stft = Stft.computeStft(mono, sampleRate, {
      fftSize: fftSize,
      hopSize: hopSize,
      maxFrames: duration > 240 ? 800 : 1200,
      collectFrames: true,
      keepMag: false
    });

    const displayAvg = downsampleLogSpectrum(stft.frequencies, stft.avgSpectrumDb, 560);
    const displayMed = downsampleLogSpectrum(stft.frequencies, stft.medianSpectrumDb, 560);
    const displayP10 = downsampleLogSpectrum(stft.frequencies, stft.p10SpectrumDb, 560);
    const displayP90 = downsampleLogSpectrum(stft.frequencies, stft.p90SpectrumDb, 560);

    const spectrogram = Stft.computeSpectrogram(mono, sampleRate, {
      fftSize: 2048,
      hopSize: duration > 120 ? 2048 : 1024,
      maxCols: duration > 180 ? 360 : 520,
      logBins: 120
    });

    const peaks = findSpectralPeaks(stft.frequencies, stft.avgSpectrumDb, sampleRate);

    return {
      fft_size: stft.fftSize,
      hop_size: stft.hopSize,
      bin_width_hz: stft.binWidth,
      num_bins: stft.numBins,
      active_frames: stft.activeFrameCount,
      processed_frames: stft.processedFrames,
      centroid_hz: U.round(stft.descriptors.centroid_hz, 1),
      spread_hz: U.round(stft.descriptors.spread_hz, 1),
      rolloff_hz: U.round(stft.descriptors.rolloff_hz, 1),
      flatness: U.round(stft.descriptors.flatness, 4),
      flux: U.round(stft.descriptors.flux, 5),
      peaks: peaks.slice(0, 24),
      display: {
        freq_hz: Array.from(displayAvg.freq),
        average_db: Array.from(displayAvg.db),
        median_db: Array.from(displayMed.db),
        p10_db: Array.from(displayP10.db),
        p90_db: Array.from(displayP90.db)
      },
      spectrogram: {
        times: spectrogram.times,
        log_freq_hz: Array.from(spectrogram.logFreqs),
        columns: spectrogram.columns
      },
      _stft: stft
    };
  }

  function findSpectralPeaks(freqs, specDb, sampleRate) {
    const peaks = [];
    const nyq = sampleRate / 2;
    const start = 2;
    const end = specDb.length - 2;
    for (let i = start; i < end; i++) {
      const f = freqs[i];
      if (f < 40 || f > Math.min(16000, nyq * 0.95)) continue;
      if (specDb[i] > specDb[i - 1] && specDb[i] >= specDb[i + 1] && specDb[i] > specDb[i - 2] && specDb[i] > specDb[i + 2]) {
        let lo = i, hi = i;
        const floor = specDb[i] - 3;
        while (lo > start && specDb[lo] > floor) lo--;
        while (hi < end && specDb[hi] > floor) hi++;
        const bw = Math.max(freqs[hi] - freqs[lo], freqs[1] || 1);
        peaks.push({
          frequency_hz: U.round(f, 1),
          level_db: U.round(specDb[i], 2),
          bandwidth_hz: U.round(bw, 1),
          q: U.round(f / bw, 2)
        });
      }
    }
    peaks.sort(function (a, b) { return b.level_db - a.level_db; });
    return peaks;
  }

  return { analyzeSpectrum, downsampleLogSpectrum, findSpectralPeaks };
}));
