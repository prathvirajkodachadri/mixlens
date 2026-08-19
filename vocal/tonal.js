'use strict';
/**
 * MixLens Vocal Analysis Engine — Module 6: Complete Tonal Analysis
 * Comprehensive 16-band vocal acoustic spectrum evaluation:
 * - Low: Rumble, Plosive Sub, Boom, Warmth, Body
 * - Low-Mid: Mud, Boxiness, Hollow
 * - Mid: Nasal, Honk, Mid Resonance
 * - Upper-Mid: Clarity, Presence, Harshness, Shrillness
 * - High: Sibilance, Tizziness, Brightness, Air
 *
 * Evaluates energy deviations against normative vocal spectral target.
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./dsp'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./dsp'));
  } else {
    root.VocalTonal = factory(root.VocalDSP);
  }
}(typeof self !== 'undefined' ? self : this, function(DSP) {

  const { db10, db20, fmtDb, fmtFreq } = DSP;

  /**
   * Complete 16-zone vocal frequency definitions with target normative tilts
   */
  const VOCAL_TONAL_ZONES = [
    {
      id: 'rumble',
      name: 'Sub Rumble',
      group: 'Low',
      from: 20,
      to: 60,
      targetRelDb: -26,
      toleranceDb: 6,
      color: '#8f6bff',
      description: 'Inaudible stage vibration, mic handling, AC air rumble. Always candidate for high-pass cut.'
    },
    {
      id: 'plosive_sub',
      name: 'Plosive Sub',
      group: 'Low',
      from: 40,
      to: 100,
      targetRelDb: -18,
      toleranceDb: 5,
      color: '#a77dff',
      description: 'Transient wind blasts and plosive thumps on P/B consonants.'
    },
    {
      id: 'boom',
      name: 'Boominess',
      group: 'Low',
      from: 80,
      to: 150,
      targetRelDb: -6,
      toleranceDb: 4,
      color: '#f5a623',
      description: 'Close-mic proximity bass buildup. Can overpower the mix if excessive.'
    },
    {
      id: 'warmth',
      name: 'Warmth / Foundation',
      group: 'Low',
      from: 140,
      to: 250,
      targetRelDb: -1,
      toleranceDb: 3.5,
      color: '#ffc862',
      description: 'Vocal fundamental foundation, chest resonance, roundness, and intimacy.'
    },
    {
      id: 'body',
      name: 'Vocal Body',
      group: 'Low-Mid',
      from: 200,
      to: 450,
      targetRelDb: 0,
      toleranceDb: 3.5,
      color: '#5ab0ff',
      description: 'Core acoustic mass and vowel substance of the singer.'
    },
    {
      id: 'mud',
      name: 'Mud / Thickness',
      group: 'Low-Mid',
      from: 250,
      to: 450,
      targetRelDb: -1,
      toleranceDb: 3.0,
      color: '#e07b39',
      description: 'Clutter and indistinct thickness that fights guitars, pianos, and snare body.'
    },
    {
      id: 'boxiness',
      name: 'Boxiness',
      group: 'Low-Mid',
      from: 400,
      to: 750,
      targetRelDb: -3,
      toleranceDb: 3.5,
      color: '#d48a37',
      description: 'Enclosed small room reflection / cardboard box vocal character.'
    },
    {
      id: 'hollow',
      name: 'Hollow Cavity',
      group: 'Mid',
      from: 500,
      to: 900,
      targetRelDb: -4,
      toleranceDb: 4.0,
      color: '#65c3ba',
      description: 'Cupped microphone or lacking throat fullness.'
    },
    {
      id: 'nasal',
      name: 'Nasal / Velar',
      group: 'Mid',
      from: 800,
      to: 1500,
      targetRelDb: -6,
      toleranceDb: 3.5,
      color: '#f56262',
      description: 'Velopharyngeal pinch, telephone-like nasality, and narrow throat resonance.'
    },
    {
      id: 'honk',
      name: 'Honk / Bite',
      group: 'Mid',
      from: 1000,
      to: 2000,
      targetRelDb: -7,
      toleranceDb: 3.5,
      color: '#f28334',
      description: 'Aggressive megaphone-like bark or horn resonance in the mid-range.'
    },
    {
      id: 'clarity',
      name: 'Clarity / Vowels',
      group: 'Upper-Mid',
      from: 2000,
      to: 3500,
      targetRelDb: -8,
      toleranceDb: 3.5,
      color: '#3ecf8e',
      description: 'Speech intelligibility, consonant articulation, singer’s formant projection.'
    },
    {
      id: 'harshness',
      name: 'Harshness',
      group: 'Upper-Mid',
      from: 2800,
      to: 4500,
      targetRelDb: -10,
      toleranceDb: 3.5,
      color: '#ff4d4d',
      description: 'Ear fatigue zone; strident belting buildup, cheap mic capsule resonance.'
    },
    {
      id: 'presence',
      name: 'Presence',
      group: 'Upper-Mid',
      from: 3500,
      to: 5500,
      targetRelDb: -11,
      toleranceDb: 3.5,
      color: '#26d0ce',
      description: 'Upfront placement, modern articulation, and edge in dense arrangements.'
    },
    {
      id: 'sibilance',
      name: 'Sibilance Zone',
      group: 'High',
      from: 5000,
      to: 9000,
      targetRelDb: -15,
      toleranceDb: 4.0,
      color: '#ff5d5d',
      description: 'S, Z, SH, CH fricative energy zone. Target for dedicated de-essing.'
    },
    {
      id: 'brightness',
      name: 'Brightness / Sheen',
      group: 'High',
      from: 8000,
      to: 12000,
      targetRelDb: -19,
      toleranceDb: 4.5,
      color: '#90b4fe',
      description: 'Top-end brilliance, glossy finish, and acoustic detail.'
    },
    {
      id: 'air',
      name: 'Air / Openness',
      group: 'High',
      from: 12000,
      to: 20000,
      targetRelDb: -25,
      toleranceDb: 5.0,
      color: '#b7c3ff',
      description: 'High-frequency breathing room, silky openness, and spatial atmosphere.'
    }
  ];

  /**
   * Analyze tonal balance across all 16 zones
   */
  function analyzeTonalBalance(spectrumData) {
    const { frequencies, avgSpectrumDb, medianSpectrumDb, p90SpectrumDb, binWidth } = spectrumData;
    const numBins = frequencies.length;

    // Compute total active energy for normalization
    let totalLinearPower = 0;
    const binPowers = new Float64Array(numBins);
    for (let k = 0; k < numBins; k++) {
      const p = Math.pow(10, avgSpectrumDb[k] / 10);
      binPowers[k] = p;
      totalLinearPower += p;
    }

    // Baseline reference: measure 200–2000 Hz body energy as 0 dB reference
    let refPower = 0, refCount = 0;
    const bin200 = Math.round(200 / binWidth);
    const bin2000 = Math.min(numBins - 1, Math.round(2000 / binWidth));
    for (let k = bin200; k <= bin2000; k++) {
      refPower += binPowers[k];
      refCount++;
    }
    const baselineDb = refCount > 0 ? db10(refPower / refCount) : -20;

    const zonesResults = [];

    for (const zone of VOCAL_TONAL_ZONES) {
      const startBin = Math.max(1, Math.round(zone.from / binWidth));
      const endBin = Math.min(numBins - 1, Math.round(zone.to / binWidth));

      if (startBin >= endBin) continue;

      let zonePower = 0;
      let maxBinPower = 0;
      let count = 0;

      for (let k = startBin; k <= endBin; k++) {
        const p = binPowers[k];
        zonePower += p;
        if (p > maxBinPower) maxBinPower = p;
        count++;
      }

      const meanZonePower = count > 0 ? zonePower / count : 1e-12;
      const zoneLevelDb = db10(meanZonePower);
      const zonePeakDb = db10(maxBinPower);
      const energyPercent = totalLinearPower > 0 ? (zonePower / totalLinearPower) * 100 : 0;

      // Deviation from expected vocal target relative to baseline
      const relativeLevel = zoneLevelDb - baselineDb;
      const deviationDb = relativeLevel - zone.targetRelDb;

      let status = 'balanced';
      let severity = 0;

      if (deviationDb > zone.toleranceDb * 1.8) {
        status = 'severe_excess';
        severity = Math.min(1.0, (deviationDb - zone.toleranceDb) / 6.0);
      } else if (deviationDb > zone.toleranceDb) {
        status = 'excess';
        severity = (deviationDb - zone.toleranceDb) / 4.0;
      } else if (deviationDb < -zone.toleranceDb * 1.8) {
        status = 'severe_deficient';
        severity = Math.min(1.0, Math.abs(deviationDb + zone.toleranceDb) / 6.0);
      } else if (deviationDb < -zone.toleranceDb) {
        status = 'deficient';
        severity = Math.abs(deviationDb + zone.toleranceDb) / 4.0;
      }

      zonesResults.push({
        id: zone.id,
        name: zone.name,
        group: zone.group,
        from: zone.from,
        to: zone.to,
        color: zone.color,
        description: zone.description,
        levelDb: Math.round(zoneLevelDb * 10) / 10,
        peakDb: Math.round(zonePeakDb * 10) / 10,
        relativeDb: Math.round(relativeLevel * 10) / 10,
        targetRelDb: zone.targetRelDb,
        deviationDb: Math.round(deviationDb * 10) / 10,
        energyPercent: Math.round(energyPercent * 10) / 10,
        status,
        severity: Math.round(severity * 100) / 100
      });
    }

    return {
      zones: zonesResults,
      baselineDb: Math.round(baselineDb * 10) / 10
    };
  }

  return {
    VOCAL_TONAL_ZONES,
    analyzeTonalBalance
  };
}));
