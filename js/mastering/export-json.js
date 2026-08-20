'use strict';
/**
 * MixLens Final Mastering Analysis 1.0 — Machine-readable JSON assembly.
 * Visualization-only spectrogram columns are omitted for size; raw measurements are kept.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.MAJson = factory(root.MAUtilities);
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
    if (spectrum.display && spectrum.display.average_db && spectrum.display.average_db.length > 640) {
      /* keep display; already downsampled */
    }

    const loudness = stripInternal(report.loudness);
    if (loudness.timeline && loudness.timeline.length > 1200) {
      loudness.timeline = loudness.timeline.filter(function (_, i) { return i % 2 === 0; });
    }

    const truePeak = stripInternal(report.true_peak);
    if (truePeak.timeline && truePeak.timeline.length > 1200) {
      truePeak.timeline = truePeak.timeline.filter(function (_, i) { return i % 2 === 0; });
    }

    return {
      mixlens_version: '3.0.0',
      engine: U.ENGINE_NAME,
      engine_version: U.ENGINE_VERSION,
      schema_version: U.SCHEMA_VERSION,
      analysis_version: U.ANALYSIS_VERSION,
      analysis_timestamp: report.analysis_timestamp,
      demo: !!report.demo,
      local_dsp: true,
      warnings: report.warnings || [],
      file: report.file,
      master_format: report.master_format,
      technical: report.technical,
      sample_peak: report.sample_peak,
      true_peak: truePeak,
      clipping: stripInternal(report.clipping),
      inter_sample_peak_risk: truePeak && truePeak.inter_sample_peak_risk,
      loudness: loudness,
      dynamics: stripInternal(report.dynamics),
      loudness_peak_correlation: report.loudness_peak_correlation,
      spectrum: spectrum,
      stereo: stripInternal(report.stereo),
      phase: stripInternal(report.phase),
      mono_compatibility: stripInternal(report.mono),
      channel_balance: {
        lr_balance_db: report.stereo && report.stereo.lr_balance_db,
        status: report.stereo && report.stereo.lr_balance_status,
        l_rms_dbfs: report.stereo && report.stereo.l_rms_dbfs,
        r_rms_dbfs: report.stereo && report.stereo.r_rms_dbfs
      },
      dc_offset: report.dc,
      silence: stripInternal(report.silence),
      fade: stripInternal(report.fade),
      distortion: stripInternal(report.distortion),
      platform_analysis: stripInternal(report.platform),
      platform_comparison: report.platform_comparison || [],
      custom_target: report.custom_file || {},
      qc_score: stripInternal(report.scores),
      delivery_status: report.scores && report.scores.delivery_status,
      reference_comparison: report.reference || { enabled: false },
      ab_comparison: report.ab || { enabled: false },
      engineering_observations: report.observations,
      executive_summary: report.executive,
      analysis_ms: report.analysis_ms,
      disclaimer: 'This report provides objective audio measurements and platform-reference comparisons. Platform loudness normalization and delivery policies may change and may vary by playback mode, codec, device, region, and service configuration. This report does not guarantee platform playback behavior and does not replace final engineering judgment.'
    };
  }

  return { buildJson: buildJson, stripInternal: stripInternal };
}));
