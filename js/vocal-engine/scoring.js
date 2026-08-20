'use strict';
/**
 * MixLens Vocal Engine 3.0 — Transparent 0–100 scores.
 * Mix-readiness is technical readiness for further mixing, not “professional quality”.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.VEScoring = factory(root.VEUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

  function deduct(list, points, reason) {
    if (points <= 0) return 0;
    list.push({ points: points, reason: reason });
    return points;
  }

  function computeScores(ctx) {
    const positives = [];
    const issues = [];
    const healthFactors = [];
    const mixFactors = [];

    let health = 100;
    const clip = ctx.clipping;
    if (clip.classification === 'SIGNIFICANT CLIPPING') {
      health -= deduct(healthFactors, clip.severity === 'CRITICAL' ? 40 : 26, clip.evidence);
      issues.push('Clipping: ' + clip.classification);
    } else if (clip.classification === 'POSSIBLE CLIPPING') {
      health -= deduct(healthFactors, 10, clip.evidence);
      issues.push('Possible clipping events');
    } else {
      positives.push('No clipping');
    }

    const noise = ctx.noise;
    if (!noise.available) {
      mixFactors.push({ points: 0, reason: 'Noise floor: insufficient quiet material' });
    } else if (noise.classification === 'High') {
      health -= deduct(healthFactors, 22, noise.evidence);
      issues.push('High background noise');
    } else if (noise.classification === 'Moderate') {
      health -= deduct(healthFactors, 12, noise.evidence);
      issues.push('Moderate background noise');
    } else if (noise.classification === 'Low–Moderate') {
      health -= deduct(healthFactors, 5, noise.evidence);
      issues.push('Low–moderate noise floor');
    } else {
      positives.push('Low measured noise floor');
    }

    const dc = ctx.dc;
    if (dc.severity === 'HIGH' || dc.severity === 'CRITICAL') {
      health -= deduct(healthFactors, 8, dc.evidence);
      issues.push('DC offset');
    } else if (dc.severity === 'MODERATE') {
      health -= deduct(healthFactors, 3, dc.evidence);
    } else {
      positives.push('Negligible DC offset');
    }

    if (ctx.hum.detected) {
      const pts = ctx.hum.confidence >= 85 ? 14 : 8;
      health -= deduct(healthFactors, pts, ctx.hum.evidence);
      issues.push('Possible mains hum around ' + ctx.hum.fundamental_hz + ' Hz');
    } else {
      positives.push('No mains-hum family detected');
    }

    const headroom = ctx.technical.headroom_db;
    if (headroom != null && headroom < 0.3) {
      health -= deduct(healthFactors, 12, 'Sample peak leaves <0.3 dB headroom.');
      issues.push('Little or no headroom');
    } else if (headroom != null && headroom < 1) {
      health -= deduct(healthFactors, 5, 'Sample peak leaves <1 dB headroom.');
    } else {
      positives.push('Good headroom');
    }

    if (ctx.stereo.applicable && ctx.stereo.phase_status === 'CRITICAL') {
      health -= deduct(healthFactors, 22, ctx.stereo.note);
      issues.push('Critical phase / mono compatibility');
    } else if (ctx.stereo.applicable && (ctx.stereo.phase_status === 'HIGH')) {
      health -= deduct(healthFactors, 12, ctx.stereo.note);
      issues.push('Phase / width concern');
    } else if (ctx.stereo.applicable) {
      positives.push('Stable phase');
    }

    health = U.clamp(Math.round(health), 0, 100);

    let mix = health;
    const sib = ctx.sibilance;
    if (sib.severity === 'HIGH') {
      mix -= deduct(mixFactors, 10, sib.evidence);
      issues.push('Strong sibilance activity');
    } else if (sib.severity === 'MODERATE') {
      mix -= deduct(mixFactors, 5, sib.evidence);
    }

    if (ctx.plosives.strong_events >= 3) {
      mix -= deduct(mixFactors, 6, ctx.plosives.evidence);
      issues.push('Multiple strong plosive transients');
    } else if (ctx.plosives.event_count >= 4) {
      mix -= deduct(mixFactors, 3, ctx.plosives.evidence);
    }

    const resHi = ctx.resonances.candidates.filter(function (c) { return c.confidence >= 70 && c.peak_excess_db >= 4.5; });
    if (resHi.length) {
      mix -= deduct(mixFactors, Math.min(12, 4 * resHi.length), resHi[0].evidence);
      issues.push('Persistent narrow-band feature near ' + Math.round(resHi[0].frequency_hz) + ' Hz');
    }

    if (ctx.dynamics.classification === 'Very Wide' || ctx.dynamics.classification === 'Wide') {
      mix -= deduct(mixFactors, 4, ctx.dynamics.evidence);
      issues.push('Wide vocal-level variation');
    }

    mix = U.clamp(Math.round(mix), 0, 100);

    const categories = {
      clipping: clip.severity,
      noise: noise.available ? (noise.classification === 'Low' ? 'GOOD' : noise.classification === 'Low–Moderate' ? 'LOW' : noise.classification === 'Moderate' ? 'MODERATE' : 'HIGH') : 'LOW',
      headroom: headroom == null ? 'LOW' : headroom >= 3 ? 'GOOD' : headroom >= 1 ? 'LOW' : headroom >= 0.3 ? 'MODERATE' : 'HIGH',
      dynamic_integrity: ctx.dynamics.classification,
      spectral_integrity: resHi.length ? 'MODERATE' : 'GOOD',
      phase_stereo: ctx.stereo.applicable ? ctx.stereo.phase_status : 'GOOD',
      artifacts: (sib.severity === 'HIGH' || ctx.plosives.strong_events >= 3) ? 'MODERATE' : 'GOOD',
      signal_quality: health >= 85 ? 'GOOD' : health >= 70 ? 'LOW' : health >= 50 ? 'MODERATE' : 'HIGH'
    };

    return {
      recording_health: {
        score: health,
        label: health + '/100',
        positives: positives,
        issues: issues.filter(function (v, i, a) { return a.indexOf(v) === i; }),
        deductions: healthFactors,
        categories: categories
      },
      mix_readiness: {
        score: mix,
        label: mix + '/100',
        note: 'Technical readiness for further mixing work — not a professional-quality rating.',
        contributing_factors: healthFactors.concat(mixFactors),
        deductions: mixFactors
      }
    };
  }

  function characterProfile(tonal, dynamics, sibilance, noise, stereo, spectrum) {
    function zoneDev(id) {
      const z = tonal.zones.find(function (x) { return x.id === id; });
      return z && z.deviation_from_vocal_baseline_db != null ? z.deviation_from_vocal_baseline_db : 0;
    }
    function scale(dev, posGain, negGain) {
      return U.clamp(50 + dev * (dev >= 0 ? posGain : negGain), 0, 100);
    }
    const scores = {
      brightness: scale(zoneDev('brilliance') * 0.6 + zoneDev('upper_presence') * 0.4, 6, 5),
      warmth: scale(zoneDev('warmth'), 7, 6),
      body: scale(zoneDev('body'), 7, 6),
      presence: scale(zoneDev('presence'), 6, 6),
      air: scale(zoneDev('air') * 0.7 + zoneDev('ultra_air') * 0.3, 6, 5),
      nasality: scale(zoneDev('nasal'), 8, 5),
      sibilance: sibilance.severity === 'HIGH' ? 82 : sibilance.severity === 'MODERATE' ? 64 : sibilance.event_count ? 42 : 22,
      dynamics: dynamics.classification === 'Very Wide' ? 88 : dynamics.classification === 'Wide' ? 72 : dynamics.classification === 'Moderate' ? 55 : 35,
      density: scale(zoneDev('low_mid') * 0.5 + zoneDev('mud') * 0.5, 6, 5),
      noise_cleanliness: !noise.available ? 50 : U.clamp(100 - Math.max(0, (noise.noise_floor_dbfs + 70) * 2.2), 5, 100),
      stereo_stability: !stereo.applicable ? 90 : U.clamp(50 + stereo.correlation * 45, 0, 100)
    };
    Object.keys(scores).forEach(function (k) { scores[k] = U.round(scores[k], 1); });
    return {
      scores: scores,
      note: 'Acoustic description from measured features. Not AI analysis.'
    };
  }

  return { computeScores, characterProfile };
}));
