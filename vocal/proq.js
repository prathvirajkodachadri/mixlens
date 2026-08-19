'use strict';
/**
 * MixLens Vocal Analysis Engine — FabFilter Pro-Q 4 Preset Generator
 * Transforms the measured EQ plan into machine-readable preset format:
 * - Compatible with FabFilter Pro-Q 4 / Pro-Q 3
 * - Generates clean JSON schema and downloadable .ffp preset file
 * - Maps filter types: HPF (Bell/Shelf/Notch), Q factors, dynamic range & thresholds
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./dsp'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./dsp'));
  } else {
    root.VocalProQ = factory(root.VocalDSP);
  }
}(typeof self !== 'undefined' ? self : this, function(DSP) {

  const { fmtFreq, fmtDb } = DSP;

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

    for (let i = 0; i < eqPlan.length; i++) {
      const b = eqPlan[i];
      const shapeCode = PRO_Q_SHAPES[b.type.toLowerCase()] !== undefined ? PRO_Q_SHAPES[b.type.toLowerCase()] : 0;

      bands.push({
        index: i + 1,
        enabled: true,
        frequency: Math.round(b.frequency * 10) / 10,
        gainDb: Math.round(b.gain * 10) / 10,
        q: Math.round(b.q * 100) / 100,
        shape: b.type,
        shapeCode,
        dynamic: !!b.dynamic,
        dynamicRangeDb: b.dynamic ? Math.round(b.dynamicRange * 10) / 10 : 0,
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
