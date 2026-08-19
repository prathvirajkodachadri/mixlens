'use strict';
/**
 * MixLens Vocal Analysis Engine — FabFilter Pro-Q 4 Preset Generator
 * (legacy compatibility module)
 *
 * The current analysis engine ships a plugin-agnostic EQ plan and no longer
 * calls this generator. The file is kept because older cached versions of
 * index.html still reference it, and a missing/undefined module here used to
 * abort analysis with:
 *   "Cannot read properties of undefined (reading 'generateProQ4Preset')"
 *
 * The module is therefore fully self-contained: it defines window.VocalProQ
 * (or the CommonJS export) even if the shared DSP module is unavailable.
 * Transforms the measured EQ plan into machine-readable preset format:
 * - Compatible with FabFilter Pro-Q 4 / Pro-Q 3
 * - Generates clean JSON schema and downloadable .ffp preset file
 * - Maps filter types: HPF (Bell/Shelf/Notch), Q factors, dynamic range & thresholds
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./dsp'], factory);
  } else if (typeof module === 'object' && module.exports) {
    let DSP = null;
    try { DSP = require('./dsp'); } catch (e) { DSP = null; }
    module.exports = factory(DSP);
  } else {
    root.VocalProQ = factory(root.VocalDSP);
  }
}(typeof self !== 'undefined' ? self : this, function(DSP) {

  // Local formatting fallbacks keep this module usable even when the shared
  // DSP module failed to load (stale cache / partial bundle).
  const dsp = DSP || {};
  const fmtFreq = dsp.fmtFreq || function(hz) {
    if (!isFinite(hz) || hz <= 0) return '—';
    if (hz >= 1000) return (hz / 1000).toFixed(hz >= 10000 ? 1 : 2) + ' kHz';
    return Math.round(hz) + ' Hz';
  };
  const fmtDb = dsp.fmtDb || function(x, d) {
    d = (d === undefined) ? 1 : d;
    return isFinite(x) ? (x > 0 ? '+' : '') + x.toFixed(d) + ' dB' : '—';
  };

  /**
   * Map internal filter type to Pro-Q shape codes
   * 0: Bell, 1: Low Shelf, 2: Low Cut (HPF), 3: High Shelf, 4: High Cut (LPF), 5: Notch
   */
  const PRO_Q_SHAPES = {
    'bell': 0,
    'peaking': 0,
    'lowshelf': 1,
    'hpf': 2,
    'highpass': 2,
    'lowcut': 2,
    'highshelf': 3,
    'lpf': 4,
    'lowpass': 4,
    'highcut': 4,
    'notch': 5
  };

  /**
   * Generate Pro-Q 4 JSON preset model
   */
  function generateProQ4Preset(eqPlan, fileMeta = {}) {
    const bands = [];
    const plan = Array.isArray(eqPlan) ? eqPlan : [];

    for (let i = 0; i < plan.length; i++) {
      const b = plan[i] || {};
      const type = String(b.type || 'bell').toLowerCase();
      const shapeCode = PRO_Q_SHAPES[type] !== undefined ? PRO_Q_SHAPES[type] : 0;

      bands.push({
        index: i + 1,
        enabled: true,
        frequency: Math.round((Number(b.frequency) || 0) * 10) / 10,
        gainDb: Math.round((Number(b.gain) || 0) * 10) / 10,
        q: Math.round((Number(b.q) || 1) * 100) / 100,
        shape: type,
        shapeCode,
        dynamic: !!b.dynamic,
        dynamicRangeDb: b.dynamic ? Math.round((Number(b.dynamicRange) || 0) * 10) / 10 : 0,
        thresholdDb: b.dynamic ? (b.threshold || -22.0) : 0,
        stereoPlacement: 'Stereo',
        reason: b.reason,
        evidence: b.evidence,
        confidence: b.confidence
      });
    }

    const presetName = `MixLens_${(fileMeta.name || 'Vocal').replace(/[^a-zA-Z0-9_-]/g, '_')}_ProQ4`;

    return {
      name: presetName,
      plugin: 'FabFilter Pro-Q 4',
      pluginCompatibility: ['FabFilter Pro-Q 4', 'FabFilter Pro-Q 3'],
      version: '4.0',
      created: new Date().toISOString(),
      sourceFile: fileMeta.name || 'Unknown',
      bandCount: bands.length,
      bands,
      notes: 'Generated deterministically from measured spectral and dynamic features by MixLens Vocal Analysis Engine.'
    };
  }

  /**
   * Build downloadable .ffp (FabFilter Preset binary chunk format / XML envelope)
   */
  function buildProQ4PresetFile(presetData) {
    // FabFilter Pro-Q preset text / XML container format
    let xml = `<?xml version="1.0" encoding="utf-8"?>\n`;
    xml += `<!-- MixLens Vocal Analysis Engine — FabFilter Pro-Q 4 Preset -->\n`;
    xml += `<FabFilterPreset Version="4.0" Plugin="Pro-Q 4" Name="${presetData.name}">\n`;
    xml += `  <Bands Count="${presetData.bands.length}">\n`;

    for (const b of presetData.bands) {
      xml += `    <Band Index="${b.index}" Enabled="1" Frequency="${b.frequency}" Gain="${b.gainDb}" Q="${b.q}" Shape="${b.shapeCode}" Dynamic="${b.dynamic ? '1' : '0'}" DynamicRange="${b.dynamicRangeDb}" Threshold="${b.thresholdDb}">\n`;
      xml += `      <!-- ${b.reason} -->\n`;
      xml += `    </Band>\n`;
    }

    xml += `  </Bands>\n`;
    xml += `  <Metadata>\n`;
    xml += `    <SourceFile>${presetData.sourceFile}</SourceFile>\n`;
    xml += `    <GeneratedBy>MixLens Vocal Analysis Engine</GeneratedBy>\n`;
    xml += `    <Timestamp>${presetData.created}</Timestamp>\n`;
    xml += `  </Metadata>\n`;
    xml += `</FabFilterPreset>\n`;

    return xml;
  }

  return {
    PRO_Q_SHAPES,
    generateProQ4Preset,
    buildProQ4PresetFile
  };
}));
