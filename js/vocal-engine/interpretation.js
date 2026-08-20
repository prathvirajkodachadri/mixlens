'use strict';
/**
 * MixLens Vocal Engine 3.0 — Evidence-based interpretation layer.
 * MEASUREMENT → EVIDENCE → INTERPRETATION → ENGINEERING OBSERVATION
 * Never emits mandatory EQ/compression values.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.VEInterpretation = factory(root.VEUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

  function item(measurement, evidence, interpretation, observation, severity) {
    return {
      measurement: measurement,
      evidence: evidence,
      interpretation: interpretation,
      engineering_observation: observation,
      severity: severity || 'LOW'
    };
  }

  function interpret(ctx) {
    const out = [];
    const clip = ctx.clipping;
    if (clip.classification !== 'NO CLIPPING') {
      out.push(item(
        'Clipping criterion met on ' + clip.clipped_samples + ' samples.',
        clip.evidence,
        clip.classification === 'SIGNIFICANT CLIPPING' ? 'Waveform flattening is present and may be audible as distortion.' : 'A small number of samples meet a clipping test; confirm by listening.',
        'Inspect the listed timestamps before any tonal processing. Clipping is not repaired by EQ.',
        clip.severity
      ));
    }

    if (ctx.dc.severity !== 'GOOD' && ctx.dc.severity !== 'LOW') {
      out.push(item(
        'DC offset mean = ' + ctx.dc.mean.toExponential(2) + ' (' + ctx.dc.dbfs + ' dBFS).',
        ctx.dc.evidence,
        'A constant offset is present in the captured waveform.',
        'Evaluate high-pass / DC-blocking at the conversion or editorial stage if the offset is audible as thumps or wastes headroom.',
        ctx.dc.severity
      ));
    }

    if (ctx.hum.detected) {
      out.push(item(
        'Possible mains-hum family, fundamental ' + ctx.hum.fundamental_hz + ' Hz.',
        ctx.hum.evidence,
        'Stationary low-frequency tones aligned with a 50 or 60 Hz series were measured in quiet frames.',
        'Confirm by soloing a quiet section. Do not assume regional grid frequency beyond the measured fundamental.',
        ctx.hum.classification
      ));
    }

    if (ctx.noise.available && (ctx.noise.classification === 'Moderate' || ctx.noise.classification === 'High')) {
      out.push(item(
        'Noise floor ' + ctx.noise.noise_floor_dbfs + ' dBFS, estimated SNR ' + ctx.noise.estimated_snr_db + ' dB.',
        ctx.noise.evidence,
        'Quiet/unvoiced regions carry a relatively high residual level.',
        'Evaluate gating, editorial fades, or capture conditions. Do not estimate noise from loud vocal sections — this figure already excludes them.',
        ctx.noise.classification === 'High' ? 'HIGH' : 'MODERATE'
      ));
    }

    const res = ctx.resonances.candidates.filter(function (c) { return c.confidence >= 60 && typeof c.peak_excess_db === 'number'; });
    for (let i = 0; i < Math.min(3, res.length); i++) {
      const r = res[i];
      out.push(item(
        r.frequency_hz + ' Hz elevated versus local spectral baseline.',
        r.evidence + ' · confidence ' + r.confidence + '% · ' + r.harmonic_relationship + '.',
        r.classification,
        'Possible resonance or local buildup should be investigated during mixing. This is not an automatic cut amount.',
        r.confidence >= 80 && r.peak_excess_db >= 5 ? 'MODERATE' : 'LOW'
      ));
    }

    if (ctx.sibilance.severity === 'MODERATE' || ctx.sibilance.severity === 'HIGH') {
      out.push(item(
        ctx.sibilance.event_count + ' sibilance events, dominant ' + U.fmtFreq(ctx.sibilance.dominant_frequency_hz) + '.',
        ctx.sibilance.evidence,
        'High-frequency consonant bursts exceed the vocal-body band by a measured margin.',
        'Evaluate de-essing or clip gain on the listed events. Event counts are detections, not a required process.',
        ctx.sibilance.severity
      ));
    }

    if (ctx.plosives.event_count) {
      out.push(item(
        ctx.plosives.event_count + ' possible plosive transients (' + ctx.plosives.strong_events + ' strong).',
        ctx.plosives.evidence,
        'Short low-frequency air blasts were separated from sustained bass by rise-time and duration.',
        'Audition the timestamps. A global low cut is not implied.',
        ctx.plosives.strong_events >= 3 ? 'MODERATE' : 'LOW'
      ));
    }

    if (ctx.dynamics.classification === 'Wide' || ctx.dynamics.classification === 'Very Wide') {
      out.push(item(
        'Large vocal level variation detected.',
        ctx.dynamics.evidence,
        'Quiet and loud frames differ by ' + ctx.dynamics.variation_db + ' dB (' + ctx.dynamics.classification + ').',
        'Level variation is a measurement. Compression is not automatically required.',
        'MODERATE'
      ));
    }

    if (ctx.stereo.applicable && (ctx.stereo.phase_status === 'HIGH' || ctx.stereo.phase_status === 'CRITICAL')) {
      out.push(item(
        'Inter-channel correlation = ' + ctx.stereo.correlation + '.',
        ctx.stereo.note,
        'Stereo image may thin or cancel when summed to mono.',
        'Check polarity and widening devices. Mono compatibility is a measurement, not a mix prescription.',
        ctx.stereo.phase_status
      ));
    }

    if (!ctx.pitch.available) {
      out.push(item(
        'F0 contour unavailable.',
        ctx.pitch.evidence,
        'Too little reliable voiced material for YIN.',
        'Pitch, vibrato, and observed pitch profile should be treated as unavailable — not as zero.',
        'LOW'
      ));
    }

    if (!out.length) {
      out.push(item(
        'No high-severity technical defects were measured.',
        'Clipping, hum, and critical phase tests were negative; remaining modules reported low or moderate characteristics only.',
        'The recording is technically orderly on the measured axes.',
        'Use the raw measurements and timeline when making mix decisions.',
        'GOOD'
      ));
    }

    return out;
  }

  function executiveSummary(ctx, scores) {
    const findings = [];
    const elevated = ctx.tonal.zones.filter(function (z) { return z.status === 'Elevated' || z.status === 'Strongly Elevated'; });
    if (elevated.length) findings.push(elevated[0].name + ' energy ' + (elevated[0].deviation_from_vocal_baseline_db >= 0 ? 'elevated' : 'recessed') + ' (' + elevated[0].frequency_label + ', ' + U.fmtDb(elevated[0].deviation_from_vocal_baseline_db) + ' vs baseline)');
    const r = ctx.resonances.candidates[0];
    if (r && r.confidence >= 60) findings.push('Persistent spectral feature around ' + Math.round(r.frequency_hz) + ' Hz (' + U.fmtDb(r.peak_excess_db) + ', confidence ' + r.confidence + '%)');
    if (ctx.sibilance.event_count) findings.push('Sibilance activity: ' + ctx.sibilance.event_count + ' events' + (ctx.sibilance.dominant_frequency_hz ? ' near ' + U.fmtFreq(ctx.sibilance.dominant_frequency_hz) : '') + ', severity ' + ctx.sibilance.severity);
    if (ctx.dynamics.classification === 'Wide' || ctx.dynamics.classification === 'Very Wide') findings.push('Wide vocal-level variation (' + ctx.dynamics.variation_db + ' dB)');
    findings.push(ctx.clipping.classification === 'NO CLIPPING' ? 'No significant clipping' : ctx.clipping.classification);
    if (ctx.technical.headroom_db != null && ctx.technical.headroom_db >= 1) findings.push('Headroom ' + ctx.technical.headroom_db.toFixed(1) + ' dB');
    if (ctx.noise.available) findings.push('Noise floor ' + ctx.noise.noise_floor_dbfs + ' dBFS (' + ctx.noise.classification + ')');

    return {
      mix_readiness: scores.mix_readiness.score,
      recording_health: scores.recording_health.score,
      major_findings: findings.slice(0, 8),
      text: 'Mix-Readiness ' + scores.mix_readiness.score + '/100 (technical readiness only). Recording Health ' + scores.recording_health.score + '/100. ' + findings.slice(0, 4).join('. ') + '.'
    };
  }

  return { interpret, executiveSummary };
}));
