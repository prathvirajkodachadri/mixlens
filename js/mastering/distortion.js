'use strict';
/**
 * MixLens Final Mastering Analysis 1.0 — Conservative distortion indicators.
 * Does not claim "distortion detected" unless evidence is strong.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.MADistortion = factory(root.MAUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

  function analyzeDistortion(clipping, truePeak, spectrum, dynamics, loudness) {
    const indicators = [];
    let confidence = 'NONE';

    if (clipping && clipping.classification === 'SIGNIFICANT CLIPPING') {
      indicators.push({
        type: 'digital_clipping',
        confidence: 'HIGH',
        statement: 'Hard-clipping evidence is present (consecutive full-scale or flat-top samples). This is a strong digital-clipping indicator.'
      });
      confidence = 'HIGH';
    } else if (clipping && clipping.classification === 'POSSIBLE CLIPPING') {
      indicators.push({
        type: 'possible_digital_clipping',
        confidence: 'MODERATE',
        statement: 'Possible clipping indicators were measured. Confidence is moderate; isolated peaks near full scale are not treated as proven distortion.'
      });
      if (confidence === 'NONE') confidence = 'MODERATE';
    }

    const hf = spectrum && spectrum.high_frequency_energy_percent;
    const crest = dynamics && dynamics.crest_factor_db;
    const tp = truePeak && truePeak.value_dbtp;
    const integrated = loudness && loudness.integrated_lufs;

    if (hf != null && hf >= 18 && crest != null && crest < 8 && tp != null && tp > -0.3) {
      indicators.push({
        type: 'harsh_high_frequency',
        confidence: 'MODERATE',
        statement: 'Possible distortion indicators: elevated high-frequency energy together with a low crest factor and true-peak values near full scale. This may reflect saturation or clipping harmonics, or simply a bright, dense master.'
      });
      if (confidence === 'NONE') confidence = 'MODERATE';
    }

    const flux = spectrum && spectrum.flux;
    if (flux != null && flux > 0.08 && clipping && clipping.detected && integrated != null && integrated > -10) {
      indicators.push({
        type: 'nonlinear_spectral_behavior',
        confidence: 'LOW',
        statement: 'Possible distortion indicators: high spectral flux coinciding with clipping evidence and high integrated loudness. Confidence is low on a full mix.'
      });
      if (confidence === 'NONE') confidence = 'LOW';
    }

    const narrow = (spectrum && spectrum.extremes || []).filter(function (e) { return e.type === 'narrow_peak'; });
    if (narrow.length >= 4 && crest != null && crest < 7.5) {
      indicators.push({
        type: 'spectral_crowding',
        confidence: 'LOW',
        statement: 'Multiple narrow spectral peaks with a very low crest factor. This is a weak indicator of nonlinear density, not proof of distortion.'
      });
      if (confidence === 'NONE') confidence = 'LOW';
    }

    const claim = confidence === 'HIGH'
      ? 'Digital clipping evidence is strong.'
      : (indicators.length
        ? 'Possible distortion indicators (see evidence). Distortion is not claimed as proven.'
        : 'No strong distortion indicators were measured.');

    return {
      claimed: confidence === 'HIGH',
      confidence: confidence,
      summary: claim,
      indicators: indicators,
      note: 'Distortion analysis is conservative. Full-mix harmonic distortion cannot be isolated with high confidence from a stereo bounce alone.'
    };
  }

  return { analyzeDistortion: analyzeDistortion };
}));
