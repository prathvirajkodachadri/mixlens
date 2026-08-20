'use strict';
/**
 * MixLens Final Mastering Analysis 1.0 — Spectrum, tonal regions, spectral extremes.
 * Measurements only. Elevated energy is never an EQ instruction.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'), require('./stft'));
  } else {
    root.MASpectrum = factory(root.MAUtilities, root.MAStft);
  }
}(typeof self !== 'undefined' ? self : this, function (U, Stft) {

  const REGIONS = [
    { id: 'sub_20_40', name: '20–40 Hz', lo: 20, hi: 40, group: 'Sub' },
    { id: 'sub_40_60', name: '40–60 Hz', lo: 40, hi: 60, group: 'Sub' },
    { id: 'bass_60_100', name: '60–100 Hz', lo: 60, hi: 100, group: 'Bass' },
    { id: 'bass_100_200', name: '100–200 Hz', lo: 100, hi: 200, group: 'Bass' },
    { id: 'lowmid_200_400', name: '200–400 Hz', lo: 200, hi: 400, group: 'Low Mid' },
    { id: 'lowmid_400_800', name: '400–800 Hz', lo: 400, hi: 800, group: 'Low Mid' },
    { id: 'mid_800_1500', name: '800 Hz–1.5 kHz', lo: 800, hi: 1500, group: 'Mid' },
    { id: 'mid_1500_3000', name: '1.5–3 kHz', lo: 1500, hi: 3000, group: 'Mid' },
    { id: 'upper_3000_5000', name: '3–5 kHz', lo: 3000, hi: 5000, group: 'Upper Mid' },
    { id: 'presence_5000_8000', name: '5–8 kHz', lo: 5000, hi: 8000, group: 'Presence' },
    { id: 'brilliance_8000_12000', name: '8–12 kHz', lo: 8000, hi: 12000, group: 'Brilliance' },
    { id: 'air_12000_16000', name: '12–16 kHz', lo: 12000, hi: 16000, group: 'Air' },
    { id: 'air_16000_20000', name: '16–20 kHz', lo: 16000, hi: 20000, group: 'Air' }
  ];

  const GROUPS = [
    { id: 'sub', name: 'Sub', lo: 20, hi: 60 },
    { id: 'bass', name: 'Bass', lo: 60, hi: 200 },
    { id: 'low_mid', name: 'Low Mid', lo: 200, hi: 800 },
    { id: 'mid', name: 'Mid', lo: 800, hi: 3000 },
    { id: 'upper_mid', name: 'Upper Mid', lo: 3000, hi: 5000 },
    { id: 'presence', name: 'Presence', lo: 5000, hi: 8000 },
    { id: 'brilliance', name: 'Brilliance', lo: 8000, hi: 12000 },
    { id: 'air', name: 'Air', lo: 12000, hi: 20000 }
  ];

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

  function bandEnergy(freqs, avgDb, lo, hi) {
    let e = 0;
    const levels = [];
    for (let i = 0; i < freqs.length; i++) {
      if (freqs[i] >= lo && freqs[i] < hi) {
        e += U.fromDbPower(avgDb[i]);
        levels.push(avgDb[i]);
      }
    }
    return { energy: e, levels: levels, median: levels.length ? U.median(levels) : null };
  }

  function findSpectralPeaks(freqs, specDb, sampleRate) {
    const peaks = [];
    const nyq = sampleRate / 2;
    const start = 2;
    const end = specDb.length - 2;
    for (let i = start; i < end; i++) {
      const f = freqs[i];
      if (f < 25 || f > Math.min(18000, nyq * 0.95)) continue;
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

  function analyzeSpectrum(mono, sampleRate, left, right, options) {
    const opt = options || {};
    const duration = mono.length / sampleRate;
    const fftSize = opt.fftSize || (duration > 180 ? 4096 : 8192);
    const hopSize = opt.hopSize || (fftSize >> 2);
    const stft = Stft.computeStft(mono, sampleRate, {
      fftSize: fftSize,
      hopSize: hopSize,
      maxFrames: duration > 240 ? 800 : 1200,
      collectFrames: true
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
    const nyq = stft.frequencies[stft.frequencies.length - 1] || 20000;

    let totalLin = 0;
    const regionRaw = REGIONS.map(function (r) {
      const hi = Math.min(r.hi, nyq);
      const b = r.lo >= nyq ? { energy: 0, levels: [], median: null } : bandEnergy(stft.frequencies, stft.avgSpectrumDb, r.lo, hi);
      totalLin += b.energy;
      const oct = Math.log(r.hi / r.lo) / Math.log(2);
      return { region: r, band: b, octaves: oct };
    });
    const totalOct = regionRaw.reduce(function (s, x) { return s + x.octaves; }, 0);

    const regions = regionRaw.map(function (x) {
      const energyPct = totalLin > 0 ? (x.band.energy / totalLin) * 100 : 0;
      const expectedPct = totalOct > 0 ? (x.octaves / totalOct) * 100 : 0;
      const deviationPct = energyPct - expectedPct;
      const medianDb = x.band.median;
      let status = 'Measured';
      if (medianDb == null) status = 'Insufficient Signal';
      else if (expectedPct > 0 && energyPct / expectedPct >= 3) status = 'Strongly Concentrated';
      else if (expectedPct > 0 && energyPct / expectedPct >= 1.8) status = 'Elevated vs baseline';
      else if (expectedPct > 0 && energyPct / expectedPct <= 0.35) status = 'Recessed vs baseline';
      return {
        id: x.region.id,
        name: x.region.name,
        group: x.region.group,
        frequency_range_hz: [x.region.lo, x.region.hi],
        rms_energy: U.round(x.band.energy, 8),
        energy_percent: U.round(energyPct, 2),
        expected_pink_percent: U.round(expectedPct, 2),
        deviation_percent: U.round(deviationPct, 2),
        median_energy_db: medianDb == null ? null : U.round(medianDb, 2),
        status: status
      };
    });

    const groups = GROUPS.map(function (g) {
      const members = regions.filter(function (r) { return r.group === g.name; });
      const pct = members.reduce(function (s, r) { return s + r.energy_percent; }, 0);
      const meds = members.map(function (r) { return r.median_energy_db; }).filter(function (v) { return v != null; });
      return {
        id: g.id,
        name: g.name,
        frequency_range_hz: [g.lo, g.hi],
        energy_percent: U.round(pct, 2),
        median_energy_db: meds.length ? U.round(U.mean(meds), 2) : null
      };
    });

    let lrRegions = null;
    if (left && right) {
      const stL = Stft.computeStft(left, sampleRate, { fftSize: Math.min(fftSize, 4096), hopSize: hopSize, maxFrames: 600, collectFrames: false });
      const stR = Stft.computeStft(right, sampleRate, { fftSize: Math.min(fftSize, 4096), hopSize: hopSize, maxFrames: 600, collectFrames: false });
      lrRegions = REGIONS.map(function (r) {
        const hi = Math.min(r.hi, nyq);
        const bL = bandEnergy(stL.frequencies, stL.avgSpectrumDb, r.lo, hi);
        const bR = bandEnergy(stR.frequencies, stR.avgSpectrumDb, r.lo, hi);
        const dL = bL.median;
        const dR = bR.median;
        return {
          id: r.id,
          name: r.name,
          left_median_db: dL == null ? null : U.round(dL, 2),
          right_median_db: dR == null ? null : U.round(dR, 2),
          difference_db: (dL == null || dR == null) ? null : U.round(dL - dR, 2)
        };
      });
    }

    const extremes = [];
    const sub = regions.filter(function (r) { return r.frequency_range_hz[1] <= 40; });
    const subPct = sub.reduce(function (s, r) { return s + r.energy_percent; }, 0);
    const subExp = sub.reduce(function (s, r) { return s + r.expected_pink_percent; }, 0);
    if (subExp > 0 && subPct / subExp >= 2.2) {
      extremes.push({
        type: 'sub_energy',
        statement: 'Significant energy concentration detected below 40 Hz relative to the measured spectral baseline.',
        energy_percent: U.round(subPct, 2),
        expected_percent: U.round(subExp, 2)
      });
    }
    const lf = regions.filter(function (r) { return r.frequency_range_hz[0] >= 40 && r.frequency_range_hz[1] <= 100; });
    const lfPct = lf.reduce(function (s, r) { return s + r.energy_percent; }, 0);
    const lfExp = lf.reduce(function (s, r) { return s + r.expected_pink_percent; }, 0);
    if (lfExp > 0 && lfPct / lfExp >= 2.0) {
      extremes.push({
        type: 'low_frequency_buildup',
        statement: 'Unusual low-frequency buildup detected in the 40–100 Hz region relative to the measured spectral baseline.',
        energy_percent: U.round(lfPct, 2)
      });
    }
    const hf = regions.filter(function (r) { return r.frequency_range_hz[0] >= 12000; });
    const hfPct = hf.reduce(function (s, r) { return s + r.energy_percent; }, 0);
    const hfExp = hf.reduce(function (s, r) { return s + r.expected_pink_percent; }, 0);
    if (hfExp > 0 && hfPct / hfExp >= 2.4) {
      extremes.push({
        type: 'high_frequency_energy',
        statement: 'Elevated energy detected above 12 kHz relative to the measured spectral baseline.',
        energy_percent: U.round(hfPct, 2)
      });
    }
    const narrow = peaks.filter(function (p) { return p.q >= 18 && p.level_db > -40; }).slice(0, 8);
    narrow.forEach(function (p) {
      extremes.push({
        type: 'narrow_peak',
        statement: 'Unusually narrow spectral peak measured near ' + U.fmtFreq(p.frequency_hz) + ' (Q ' + p.q + ').',
        frequency_hz: p.frequency_hz,
        q: p.q
      });
    });

    const strongPeaks = peaks.filter(function (p) { return p.level_db >= (stft.descriptors.centroid_hz ? U.mean(Array.from(stft.avgSpectrumDb).filter(isFinite)) : -40) + 8; });
    const peakCount = peaks.filter(function (p) { return p.level_db > -48; }).length;
    let density = 'Balanced';
    if (stft.descriptors.flatness >= 0.45 && peakCount > 80) density = 'Very Dense';
    else if (stft.descriptors.flatness >= 0.28 || peakCount > 50) density = 'Dense';
    else if (stft.descriptors.flatness < 0.08 && peakCount < 12) density = 'Sparse';

    const lowE = groups.find(function (g) { return g.id === 'sub' || g.id === 'bass'; });
    const highE = groups.filter(function (g) { return g.id === 'brilliance' || g.id === 'air'; });
    const lowEnergyPct = groups.filter(function (g) { return g.id === 'sub' || g.id === 'bass'; }).reduce(function (s, g) { return s + g.energy_percent; }, 0);
    const midEnergyPct = groups.filter(function (g) { return g.id === 'low_mid' || g.id === 'mid' || g.id === 'upper_mid'; }).reduce(function (s, g) { return s + g.energy_percent; }, 0);
    const highEnergyPct = groups.filter(function (g) { return g.id === 'presence' || g.id === 'brilliance' || g.id === 'air'; }).reduce(function (s, g) { return s + g.energy_percent; }, 0);

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
      peak_density: peakCount,
      spectral_density: density,
      strong_peak_count: strongPeaks.length,
      peaks: peaks.slice(0, 24),
      regions: regions,
      groups: groups,
      lr_difference: lrRegions,
      extremes: extremes,
      low_frequency_energy_percent: U.round(lowEnergyPct, 2),
      midrange_energy_percent: U.round(midEnergyPct, 2),
      high_frequency_energy_percent: U.round(highEnergyPct, 2),
      baseline_note: 'Region percentages are compared with an equal-energy-per-octave (pink) share of the same master. This is a measurement baseline, not a tonal target.',
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

  return { analyzeSpectrum: analyzeSpectrum, REGIONS: REGIONS, GROUPS: GROUPS, downsampleLogSpectrum: downsampleLogSpectrum };
}));
