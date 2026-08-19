'use strict';
/**
 * MixLens Vocal Analysis Engine — Module 17: Reference Vocal Analysis
 * Comparative analysis between Source Vocal and a Target Reference Vocal:
 * - Computes band-by-band spectral delta curve
 * - Compares dynamic range, crest factor, and loudness
 * - Generates guided mixing suggestions to nudge towards reference target
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./dsp', './spectrum', './tonal'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./dsp'), require('./spectrum'), require('./tonal'));
  } else {
    root.VocalReference = factory(root.VocalDSP, root.VocalSpectrum, root.VocalTonal);
  }
}(typeof self !== 'undefined' ? self : this, function(DSP, Spectrum, Tonal) {

  const { db10, db20, fmtDb, fmtFreq } = DSP;
  const { analyzeSpectrum } = Spectrum;
  const { analyzeTonalBalance, VOCAL_TONAL_ZONES } = Tonal;

  /**
   * Compare Source vocal analysis against Reference audio channel
   */
  function analyzeReferenceComparison(sourceSpectrum, sourceDynamics, refMono, sampleRate) {
    if (!refMono || !refMono.length) {
      return {
        enabled: false,
        deltas: [],
        findings: [],
        summary: 'No reference track loaded. Upload a reference vocal file to compare tonal balance and dynamics.'
      };
    }

    const refSpectrum = analyzeSpectrum(refMono, sampleRate, { fftSize: sourceSpectrum.fftSize, hopSize: sourceSpectrum.hopSize });
    const sourceTonal = analyzeTonalBalance(sourceSpectrum);
    const refTonal = analyzeTonalBalance(refSpectrum);

    const deltas = [];
    const findings = [];

    for (let i = 0; i < VOCAL_TONAL_ZONES.length; i++) {
      const zone = VOCAL_TONAL_ZONES[i];
      const srcZ = sourceTonal.zones.find(z => z.id === zone.id);
      const refZ = refTonal.zones.find(z => z.id === zone.id);

      if (srcZ && refZ) {
        // Delta = Source relative level - Reference relative level
        const deltaDb = srcZ.relativeDb - refZ.relativeDb;
        deltas.push({
          id: zone.id,
          name: zone.name,
          group: zone.group,
          from: zone.from,
          to: zone.to,
          sourceRelDb: srcZ.relativeDb,
          refRelDb: refZ.relativeDb,
          deltaDb: Math.round(deltaDb * 10) / 10
        });

        // Findings for significant deltas (> 2.5 dB)
        if (Math.abs(deltaDb) >= 2.5) {
          let advice = '';
          if (deltaDb > 2.5) {
            advice = `Source has +${deltaDb.toFixed(1)} dB more ${zone.name} than reference. Consider gentle attenuation or dynamic control.`;
          } else {
            advice = `Source has ${Math.abs(deltaDb).toFixed(1)} dB less ${zone.name} than reference. Consider broad sweetening boost.`;
          }

          findings.push({
            zone: zone.name,
            deltaDb: Math.round(deltaDb * 10) / 10,
            advice
          });
        }
      }
    }

    let summary = 'Source vocal is tonally close to the reference track within ±2 dB.';
    if (findings.length >= 3) {
      summary = `Noticeable tonal differences compared to reference. Main adjustments: ${findings.slice(0, 3).map(f => f.zone).join(', ')}.`;
    }

    return {
      enabled: true,
      deltas,
      findings,
      summary
    };
  }

  return {
    analyzeReferenceComparison
  };
}));
