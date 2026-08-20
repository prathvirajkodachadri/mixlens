'use strict';
/**
 * MixLens Vocal Engine 3.0 — Machine-readable JSON assembly.
 * Raw measurements are retained; visualization-only buffers are stripped.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.VEJson = factory(root.VEUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

  function stripInternal(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(stripInternal);
    const out = {};
    Object.keys(obj).forEach(function (k) {
      if (k.charAt(0) === '_') return;
      const v = obj[k];
      if (v instanceof Float32Array || v instanceof Float64Array) out[k] = Array.from(v);
      else if (v && typeof v === 'object') out[k] = stripInternal(v);
      else out[k] = v;
    });
    return out;
  }

  function buildJson(report) {
    const spectrum = stripInternal(report.spectrum);
    if (spectrum.spectrogram && spectrum.spectrogram.columns) {
      spectrum.spectrogram = {
        times: spectrum.spectrogram.times,
        log_freq_hz: spectrum.spectrogram.log_freq_hz,
        note: 'Full spectrogram columns omitted from JSON for size. Available in-session for visualization.',
        column_count: report.spectrum.spectrogram.columns.length
      };
    }
    const pitch = stripInternal(report.pitch);
    if (pitch.contour && pitch.contour.length > 800) {
      pitch.contour = pitch.contour.filter(function (_, i) { return i % 2 === 0; });
    }

    return {
      mixlens_version: U.ENGINE_VERSION,
      schema_version: U.SCHEMA_VERSION,
      engine_version: U.ENGINE_VERSION,
      analysis_version: U.ANALYSIS_VERSION,
      analysis_engine: 'Vocal Engine',
      analysis_timestamp: report.analysis_timestamp,
      demo: !!report.demo,
      warnings: report.warnings || [],
      file: report.file,
      technical: report.technical,
      clipping: report.clipping,
      dc_offset: report.dc,
      loudness: stripInternal(report.loudness),
      dynamics: report.dynamics,
      spectrum: spectrum,
      tonal_zones: report.tonal.zones,
      tonal: report.tonal,
      resonances: report.resonances.candidates,
      sibilance: report.sibilance,
      plosives: report.plosives,
      breaths: report.breaths,
      noise: report.noise,
      hum: report.hum,
      pitch: pitch,
      vibrato: report.vibrato,
      stereo: report.stereo,
      timeline_events: report.timeline.events,
      character_profile: report.character,
      recording_health: report.scores.recording_health,
      mix_readiness: report.scores.mix_readiness,
      reference_comparison: report.reference || {},
      masking: report.masking || {},
      engineering_observations: report.observations,
      executive_summary: report.executive
    };
  }

  return { buildJson, stripInternal };
}));
