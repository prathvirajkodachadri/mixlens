'use strict';
/**
 * MixLens Vocal Engine 3.0 — 16-zone tonal measurement.
 * Energy shares and deviations from a pink-tilt vocal baseline. Not an EQ recipe.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.VETonal = factory(root.VEUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

  const ZONES = [
    { id: 'sub', name: 'Sub', lo: 20, hi: 40, description: 'Infra / unused vocal energy' },
    { id: 'rumble', name: 'Rumble', lo: 40, hi: 80, description: 'Mic stand / HVAC rumble region' },
    { id: 'low_bass', name: 'Low Bass', lo: 80, hi: 120, description: 'Lowest vocal fundamentals / boom' },
    { id: 'bass', name: 'Bass', lo: 120, hi: 180, description: 'Chest / weight' },
    { id: 'warmth', name: 'Warmth', lo: 180, hi: 250, description: 'Warmth and proximity' },
    { id: 'low_mid', name: 'Low Mid', lo: 250, hi: 350, description: 'Low-mid density' },
    { id: 'mud', name: 'Mud', lo: 350, hi: 500, description: 'Box / mud accumulation' },
    { id: 'body', name: 'Body', lo: 500, hi: 800, description: 'Vocal body' },
    { id: 'mid', name: 'Mid', lo: 800, hi: 1500, description: 'Speech intelligibility core' },
    { id: 'nasal', name: 'Nasal', lo: 1500, hi: 2500, description: 'Nasal / honk region' },
    { id: 'presence', name: 'Presence', lo: 2500, hi: 4000, description: 'Presence and edge' },
    { id: 'upper_presence', name: 'Upper Presence', lo: 4000, hi: 6000, description: 'Definition / hardness' },
    { id: 'sibilance', name: 'Sibilance', lo: 6000, hi: 8000, description: 'Primary sibilant band' },
    { id: 'brilliance', name: 'Brilliance', lo: 8000, hi: 12000, description: 'Fricative brilliance' },
    { id: 'air', name: 'Air', lo: 12000, hi: 16000, description: 'Air band' },
    { id: 'ultra_air', name: 'Ultra Air', lo: 16000, hi: 20000, description: 'Ultra-high residual' }
  ];

  /**
   * Pink-tilt expectation: equal energy per octave → level ~ −3 dB/oct vs 1 kHz.
   * Used only as a relative baseline, not a “correct” vocal target.
   */
  function expectedDb(lo, hi) {
    const geo = Math.sqrt(lo * hi);
    return -3 * Math.log2(Math.max(20, geo) / 1000);
  }

  function analyzeTonalBalance(spectrum) {
    const stft = spectrum._stft;
    const freqs = stft.frequencies;
    const avg = stft.avgSpectrumDb;
    const med = stft.medianSpectrumDb;
    const nyq = freqs[freqs.length - 1] || 20000;

    const bands = [];
    let totalLin = 0;
    for (let z = 0; z < ZONES.length; z++) {
      const zone = ZONES[z];
      if (zone.lo >= nyq) {
        bands.push({ zone: zone, energyLin: 0, levels: [], medianDb: null });
        continue;
      }
      const hi = Math.min(zone.hi, nyq);
      let e = 0;
      const levels = [];
      for (let i = 0; i < freqs.length; i++) {
        if (freqs[i] >= zone.lo && freqs[i] < hi) {
          const lin = U.fromDbPower(avg[i]);
          e += lin;
          levels.push(med[i]);
        }
      }
      totalLin += e;
      bands.push({ zone: zone, energyLin: e, levels: levels, medianDb: levels.length ? U.median(U.sortedCopy(levels)) : null });
    }

    // Vocal baseline = mean of Body + Mid + Presence median levels (where data exists).
    const coreIds = { body: 1, mid: 1, presence: 1 };
    const coreLevels = [];
    for (let i = 0; i < bands.length; i++) {
      if (coreIds[bands[i].zone.id] && bands[i].medianDb != null) coreLevels.push(bands[i].medianDb);
    }
    const vocalBaseline = coreLevels.length ? U.mean(coreLevels) : -30;

    const zones = bands.map(function (b) {
      const energyPct = totalLin > 0 ? (b.energyLin / totalLin) * 100 : 0;
      const medianLevel = b.medianDb;
      const expect = vocalBaseline + expectedDb(b.zone.lo, b.zone.hi) * 0.35;
      const deviation = medianLevel == null ? 0 : medianLevel - expect;
      let status = 'Balanced';
      if (medianLevel == null) status = 'Insufficient Signal';
      else if (deviation >= 6) status = 'Strongly Elevated';
      else if (deviation >= 3) status = 'Elevated';
      else if (deviation <= -6) status = 'Strongly Recessed';
      else if (deviation <= -3) status = 'Recessed';

      return {
        id: b.zone.id,
        name: b.zone.name,
        frequency_range_hz: [b.zone.lo, b.zone.hi],
        frequency_label: b.zone.lo + '–' + (b.zone.hi >= 1000 ? (b.zone.hi / 1000) + 'k' : b.zone.hi) + ' Hz',
        energy: U.round(b.energyLin, 8),
        energy_percent: U.round(energyPct, 2),
        median_level_db: medianLevel == null ? null : U.round(medianLevel, 2),
        deviation_from_vocal_baseline_db: medianLevel == null ? null : U.round(deviation, 2),
        status: status,
        description: b.zone.description
      };
    });

    return {
      vocal_baseline_db: U.round(vocalBaseline, 2),
      baseline_note: 'Baseline is the mean of Body / Mid / Presence median levels, with a mild pink-tilt offset. This is a measurement reference, not a mix target.',
      zones: zones
    };
  }

  return { analyzeTonalBalance, ZONES };
}));
