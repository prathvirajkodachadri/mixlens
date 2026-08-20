'use strict';
/**
 * MixLens Vocal Engine 3.0 — Optional vocal vs instrumental spectral collision report.
 * Differences only. No automatic EQ.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'), require('./stft'), require('./tonal-balance'));
  } else {
    root.VEMasking = factory(root.VEUtilities, root.VEStft, root.VETonal);
  }
}(typeof self !== 'undefined' ? self : this, function (U, Stft, Tonal) {

  const BANDS = [
    { name: '80–250 Hz', lo: 80, hi: 250 },
    { name: '250–500 Hz', lo: 250, hi: 500 },
    { name: '500–1.5 kHz', lo: 500, hi: 1500 },
    { name: '1.5–3.2 kHz', lo: 1500, hi: 3200 },
    { name: '3.2–6 kHz', lo: 3200, hi: 6000 },
    { name: '6–12 kHz', lo: 6000, hi: 12000 }
  ];

  function bandEnergyDb(freqs, specDb, lo, hi) {
    let e = 0, n = 0;
    for (let i = 0; i < freqs.length; i++) {
      if (freqs[i] >= lo && freqs[i] < hi) {
        e += U.fromDbPower(specDb[i]);
        n++;
      }
    }
    return n ? U.db10(e / n) : -144;
  }

  function compareSpectrum(vocalSpec, otherMono, otherSr, label) {
    const other = Stft.computeStft(otherMono, otherSr, { fftSize: 4096, hopSize: 2048, maxFrames: 600, collectFrames: false });
    const vf = vocalSpec._stft.frequencies;
    const vs = vocalSpec._stft.avgSpectrumDb;
    const collisions = [];
    for (let i = 0; i < BANDS.length; i++) {
      const b = BANDS[i];
      const v = bandEnergyDb(vf, vs, b.lo, b.hi);
      const o = bandEnergyDb(other.frequencies, other.avgSpectrumDb, b.lo, b.hi);
      const delta = o - v;
      let collision = 'None';
      if (delta >= 6) collision = 'High';
      else if (delta >= 3) collision = 'Moderate';
      else if (delta >= 1.5) collision = 'Low';
      collisions.push({
        region: b.name,
        vocal_level_db: U.round(v, 2),
        other_level_db: U.round(o, 2),
        other_minus_vocal_db: U.round(delta, 2),
        collision: collision,
        evidence: label + ' energy is ' + (delta >= 0 ? '+' : '') + delta.toFixed(1) + ' dB relative to the vocal in this region.'
      });
    }
    return collisions;
  }

  function analyzeMasking(vocalSpec, instMono, instSr) {
    if (!instMono || !instMono.length) {
      return { enabled: false, collisions: [], note: 'No instrumental file loaded.' };
    }
    return {
      enabled: true,
      collisions: compareSpectrum(vocalSpec, instMono, instSr, 'Instrumental'),
      note: 'Relative spectral comparison only. Not an EQ instruction.'
    };
  }

  function analyzeReference(vocalSpec, vocalDyn, vocalTonal, refMono, refSr) {
    if (!refMono || !refMono.length) {
      return { enabled: false, zones: [], note: 'No reference vocal loaded.' };
    }
    const refStft = Stft.computeStft(refMono, refSr, { fftSize: 4096, hopSize: 2048, maxFrames: 700, collectFrames: true });
    const refSpec = {
      _stft: refStft,
      centroid_hz: refStft.descriptors.centroid_hz
    };
    const refTonal = Tonal.analyzeTonalBalance(refSpec);
    const zones = [];
    for (let i = 0; i < vocalTonal.zones.length; i++) {
      const a = vocalTonal.zones[i];
      const b = refTonal.zones[i];
      const da = a.median_level_db;
      const db = b.median_level_db;
      zones.push({
        name: a.name,
        frequency_range_hz: a.frequency_range_hz,
        your_vocal_db: da,
        reference_db: db,
        your_vocal_relative_db: (da == null || db == null) ? null : U.round(da - db, 2)
      });
    }
    return {
      enabled: true,
      spectral_centroid_your_hz: vocalSpec.centroid_hz,
      spectral_centroid_reference_hz: U.round(refStft.descriptors.centroid_hz, 1),
      centroid_delta_hz: U.round(vocalSpec.centroid_hz - refStft.descriptors.centroid_hz, 1),
      zones: zones,
      note: 'All comparisons are relative (your vocal minus reference). Not an EQ copy.'
    };
  }

  return { analyzeMasking, analyzeReference };
}));
