'use strict';
/**
 * MixLens Vocal Analysis Engine — Module 15: Mix Masking Analysis
 * Comparative spectral overlap analysis between Vocal and Instrumental / Beat:
 * - Detects critical frequency masking & collision regions
 * - Computes Masking Probability (0–100%)
 * - Prescribes targeted instrument bus carving vs vocal sidechain dynamic EQ
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./dsp', './spectrum'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./dsp'), require('./spectrum'));
  } else {
    root.VocalMasking = factory(root.VocalDSP, root.VocalSpectrum);
  }
}(typeof self !== 'undefined' ? self : this, function(DSP, Spectrum) {

  const { db10, db20, fmtFreq, fmtDb } = DSP;
  const { analyzeSpectrum } = Spectrum;

  /**
   * Compare Vocal audio against Instrumental audio
   * @param {Object} vocalSpectrum - Spectrum output of vocal
   * @param {Float32Array} instMono - Instrumental audio channel
   * @param {number} sampleRate - Sample rate
   */
  function analyzeMixMasking(vocalSpectrum, instMono, sampleRate) {
    if (!instMono || !instMono.length) {
      return {
        enabled: false,
        collisions: [],
        overallMaskingIndex: 0,
        summary: 'No instrumental track loaded. Upload an instrumental or beat file to analyze mix masking.'
      };
    }

    // Run STFT on instrumental
    const instSpectrum = analyzeSpectrum(instMono, sampleRate, { fftSize: vocalSpectrum.fftSize, hopSize: vocalSpectrum.hopSize });
    const numBins = vocalSpectrum.numBins;
    const binWidth = vocalSpectrum.binWidth;

    const COLLISION_BANDS = [
      {
        id: 'low_foundation',
        name: 'Vocal Foundation vs Bass/Kick',
        from: 80,
        to: 220,
        centerHz: 140,
        role: 'Clutter in the bass pocket',
        preferredAction: 'Vocal HPF / Low Cut on vocal + sidechain ducking on bass'
      },
      {
        id: 'mud_body',
        name: 'Low-Mid Masking (Guitars/Keys/Snare)',
        from: 250,
        to: 550,
        centerHz: 350,
        role: 'Mud buildup obscuring vocal weight',
        preferredAction: 'Carve -1.5 dB on instrument bus at 350 Hz'
      },
      {
        id: 'nasal_vowel',
        name: 'Midrange Core (Lead synths/Horns)',
        from: 800,
        to: 1800,
        centerHz: 1200,
        role: 'Vocal body crowding',
        preferredAction: 'Carve -1.0 dB on competing synths/guitars'
      },
      {
        id: 'intelligibility',
        name: 'Vocal Presence vs Guitars/Synths',
        from: 2000,
        to: 4500,
        centerHz: 3200,
        role: 'Vocal articulation & intelligibility masked by guitars/cymbals',
        preferredAction: 'Carve -2.0 dB pocket on instrument bus at 3.2 kHz (Q=1.8)'
      },
      {
        id: 'air_sheen',
        name: 'High Sheen vs Cymbals/Hi-Hats',
        from: 7000,
        to: 14000,
        centerHz: 9500,
        role: 'Vocal air obscured by drum overheads',
        preferredAction: 'Gentle dynamic ducking or sidechain high-shelf'
      }
    ];

    const collisions = [];
    let totalMaskingScore = 0;

    for (const band of COLLISION_BANDS) {
      const startBin = Math.max(1, Math.round(band.from / binWidth));
      const endBin = Math.min(numBins - 1, Math.round(band.to / binWidth));

      let voxPower = 0, instPower = 0, count = 0;
      for (let k = startBin; k <= endBin; k++) {
        voxPower += Math.pow(10, vocalSpectrum.avgSpectrumDb[k] / 10);
        instPower += Math.pow(10, instSpectrum.avgSpectrumDb[k] / 10);
        count++;
      }

      const voxDb = db10(voxPower / Math.max(1, count));
      const instDb = db10(instPower / Math.max(1, count));
      const deltaDb = instDb - voxDb;

      // Masking probability calculation: higher if instrument power exceeds vocal in critical intelligibility zones
      let maskingProb = 0;
      if (deltaDb > 6.0) maskingProb = 0.95;
      else if (deltaDb > 2.0) maskingProb = 0.80;
      else if (deltaDb > -3.0) maskingProb = 0.55;
      else if (deltaDb > -8.0) maskingProb = 0.30;
      else maskingProb = 0.10;

      // Higher weighting for upper-mid presence zone (2-4.5 kHz)
      const weight = band.id === 'intelligibility' ? 1.5 : 1.0;
      totalMaskingScore += maskingProb * weight;

      let action = 'LEAVE_UNCHANGED';
      let recommendation = 'Vocal clearly sits on top of the instrument in this zone.';

      if (maskingProb >= 0.70) {
        if (band.id === 'intelligibility') {
          action = 'INSTRUMENT_BUS_CARVE';
          recommendation = `Instrument power exceeds vocal presence by ${fmtDb(deltaDb)} in the ${band.name} zone. Carve -2.0 dB at ~3.2 kHz on the instrumental bus rather than over-boosting the vocal.`;
        } else if (band.id === 'mud_body') {
          action = 'INSTRUMENT_BUS_CARVE';
          recommendation = `Instrument low-mids are masking vocal warmth by ${fmtDb(deltaDb)}. Cut 1.5–2 dB at 350 Hz on competing rhythm instruments.`;
        } else if (band.id === 'low_foundation') {
          action = 'DYNAMIC_DUCKING';
          recommendation = `Kick/bass clashes with vocal low-end. Apply subtle sidechain ducking (1–2 dB) on bass when vocal speaks.`;
        } else {
          action = 'DYNAMIC_EQ';
          recommendation = `Moderate clash at ${fmtFreq(band.centerHz)}. Dynamic EQ or sidechain recommended.`;
        }
      }

      collisions.push({
        bandId: band.id,
        name: band.name,
        from: band.from,
        to: band.to,
        centerHz: band.centerHz,
        vocalLevelDb: Math.round(voxDb * 10) / 10,
        instrumentLevelDb: Math.round(instDb * 10) / 10,
        deltaDb: Math.round(deltaDb * 10) / 10,
        maskingProbability: Math.round(maskingProb * 100),
        action,
        recommendation
      });
    }

    const overallMaskingIndex = Math.min(100, Math.round((totalMaskingScore / (COLLISION_BANDS.length * 1.1)) * 100));

    let summary = 'Vocal cuts through the mix cleanly with minimal instrument masking.';
    if (overallMaskingIndex > 65) {
      summary = 'High mix masking detected. Competing instruments (especially in the 350 Hz mud and 3.2 kHz presence zones) are fighting the lead vocal. Instrumental pocket EQ carving is strongly recommended.';
    } else if (overallMaskingIndex > 40) {
      summary = 'Moderate mix masking in the midrange. Carving 1.5 dB on rhythm guitars/keys around 3 kHz will create a clean pocket for the vocal.';
    }

    return {
      enabled: true,
      collisions,
      overallMaskingIndex,
      summary
    };
  }

  return {
    analyzeMixMasking
  };
}));
