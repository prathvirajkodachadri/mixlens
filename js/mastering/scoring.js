'use strict';
/**
 * MixLens Final Mastering Analysis 1.0 — Transparent QC score and delivery status.
 * Score calculation is fully disclosed in the payload (weights + deductions).
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.MAScoring = factory(root.MAUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

  const WEIGHTS = {
    technical_integrity: 0.18,
    loudness: 0.12,
    true_peak: 0.16,
    dynamics: 0.10,
    stereo: 0.10,
    phase: 0.10,
    spectral: 0.10,
    delivery: 0.14
  };

  function deduct(list, points, reason) {
    if (!(points > 0)) return 0;
    const p = Math.round(points);
    list.push({ points: p, reason: reason });
    return p;
  }

  function clampScore(x) { return U.clamp(Math.round(x), 0, 100); }

  function compute(ctx) {
    const clip = ctx.clipping || {};
    const tp = ctx.true_peak || {};
    const loud = ctx.loudness || {};
    const dyn = ctx.dynamics || {};
    const stereo = ctx.stereo || {};
    const phase = ctx.phase || {};
    const mono = ctx.mono || {};
    const spec = ctx.spectrum || {};
    const dc = ctx.dc || {};
    const plat = ctx.platform || {};
    const silence = ctx.silence || {};
    const dist = ctx.distortion || {};

    const techD = [];
    let technical = 100;
    if (clip.classification === 'SIGNIFICANT CLIPPING') {
      technical -= deduct(techD, clip.severity === 'CRITICAL' ? 45 : 30, clip.evidence || 'Significant clipping.');
    } else if (clip.classification === 'POSSIBLE CLIPPING') {
      technical -= deduct(techD, 12, clip.evidence || 'Possible clipping.');
    }
    if (dc.severity === 'HIGH' || dc.severity === 'CRITICAL') {
      technical -= deduct(techD, 10, dc.evidence || 'DC offset.');
    } else if (dc.severity === 'MODERATE') {
      technical -= deduct(techD, 4, dc.evidence || 'Moderate DC offset.');
    }
    if (silence.noise_floor_dbfs != null && silence.noise_floor_dbfs > -45) {
      technical -= deduct(techD, 8, 'Elevated noise floor (' + silence.noise_floor_dbfs + ' dBFS) in quiet regions.');
    }
    technical = clampScore(technical);

    const loudD = [];
    let loudness = 100;
    if (!loud.available) {
      loudness -= deduct(loudD, 20, 'Loudness measurement not available.');
    } else if (loud.confidence === 'LOW') {
      loudness -= deduct(loudD, 8, 'Low-confidence loudness (short or sparse signal).');
    }
    if (plat.loudness_difference_lu != null && Math.abs(plat.loudness_difference_lu) >= 6) {
      loudness -= deduct(loudD, 10, 'Integrated loudness is far from the selected platform reference (' + plat.loudness_difference_lu + ' LU).');
    } else if (plat.loudness_difference_lu != null && Math.abs(plat.loudness_difference_lu) >= 3) {
      loudness -= deduct(loudD, 5, 'Integrated loudness differs from the selected platform reference.');
    }
    loudness = clampScore(loudness);

    const tpD = [];
    let truePeak = 100;
    if (!tp.available) {
      truePeak -= deduct(tpD, 15, 'True-peak estimation unavailable for this source.');
    } else {
      if (plat.true_peak_difference_db != null && plat.true_peak_difference_db > 1) {
        truePeak -= deduct(tpD, 22, 'Estimated true peak exceeds the selected ceiling by ' + plat.true_peak_difference_db + ' dB.');
      } else if (plat.true_peak_difference_db != null && plat.true_peak_difference_db > 0.05) {
        truePeak -= deduct(tpD, 10, 'Estimated true peak is above the selected delivery reference.');
      }
      if (tp.inter_sample_peak_risk && tp.inter_sample_peak_risk.status === 'WARNING') {
        truePeak -= deduct(tpD, 6, tp.inter_sample_peak_risk.note);
      }
      if (tp.value_dbtp != null && tp.value_dbtp > 0) {
        truePeak -= deduct(tpD, 18, 'Estimated true peak is above 0 dBTP.');
      }
    }
    truePeak = clampScore(truePeak);

    const dynD = [];
    let dynamics = 100;
    /* Density is descriptive; only extreme values affect the technical score. */
    if (dyn.crest_factor_db != null && dyn.crest_factor_db < 6) {
      dynamics -= deduct(dynD, 10, 'Very low crest factor (' + dyn.crest_factor_db + ' dB) — extremely dense peak-to-RMS relationship.');
    } else if (dyn.dynamic_character === 'Very Dense') {
      dynamics -= deduct(dynD, 4, 'Dynamic character is very dense (descriptive, not a quality fail).');
    }
    if (dyn.lra_lu != null && dyn.lra_lu < 1.5 && loud.integrated_lufs != null && loud.integrated_lufs > -10) {
      dynamics -= deduct(dynD, 6, 'Very small LRA together with high loudness.');
    }
    dynamics = clampScore(dynamics);

    const stD = [];
    let stereoScore = 100;
    if (stereo.applicable) {
      if (Math.abs(stereo.lr_balance_db || 0) >= 6) {
        stereoScore -= deduct(stD, 16, 'Channel imbalance ' + stereo.lr_balance_db + ' dB.');
      } else if (Math.abs(stereo.lr_balance_db || 0) >= 3) {
        stereoScore -= deduct(stD, 8, 'Channel imbalance ' + stereo.lr_balance_db + ' dB.');
      }
      if (stereo.excessive_stereo) {
        stereoScore -= deduct(stD, 6, 'Side energy is very high (' + stereo.stereo_width_percent + '% of mid+side).');
      }
    }
    stereoScore = clampScore(stereoScore);

    const phD = [];
    let phaseScore = 100;
    if (phase.applicable) {
      if (phase.status === 'FAIL') phaseScore -= deduct(phD, 28, phase.interpretation || 'Negative / critical correlation.');
      else if (phase.status === 'WARNING') phaseScore -= deduct(phD, 12, phase.note || phase.interpretation);
      if (mono.rating === 'Critical' || mono.rating === 'Poor') {
        phaseScore -= deduct(phD, 14, mono.note || 'Poor mono compatibility.');
      } else if (mono.rating === 'Moderate') {
        phaseScore -= deduct(phD, 6, mono.note || 'Moderate mono compatibility.');
      }
    }
    phaseScore = clampScore(phaseScore);

    const spD = [];
    let spectral = 100;
    const extremes = spec.extremes || [];
    extremes.forEach(function (e) {
      if (e.type === 'sub_energy' || e.type === 'low_frequency_buildup') {
        spectral -= deduct(spD, 5, e.statement);
      } else if (e.type === 'high_frequency_energy') {
        spectral -= deduct(spD, 4, e.statement);
      } else if (e.type === 'narrow_peak') {
        spectral -= deduct(spD, 2, e.statement);
      }
    });
    if (dist && dist.confidence === 'HIGH') {
      spectral -= deduct(spD, 10, dist.summary);
    }
    spectral = clampScore(spectral);

    const delD = [];
    let delivery = 100;
    if (plat.status === 'NOT READY') delivery -= deduct(delD, 30, 'Selected platform delivery status is NOT READY.');
    else if (plat.status === 'REVIEW') delivery -= deduct(delD, 14, 'Selected platform delivery status is REVIEW.');
    else if (plat.status === 'READY WITH NOTES') delivery -= deduct(delD, 6, 'Selected platform delivery has notes.');
    (plat.findings || []).forEach(function (f) {
      if (/clip/i.test(f)) delivery -= deduct(delD, 4, f);
    });
    delivery = clampScore(delivery);

    const breakdown = {
      technical_integrity: { score: technical, weight: WEIGHTS.technical_integrity, deductions: techD },
      loudness: { score: loudness, weight: WEIGHTS.loudness, deductions: loudD },
      true_peak: { score: truePeak, weight: WEIGHTS.true_peak, deductions: tpD },
      dynamics: { score: dynamics, weight: WEIGHTS.dynamics, deductions: dynD },
      stereo: { score: stereoScore, weight: WEIGHTS.stereo, deductions: stD },
      phase: { score: phaseScore, weight: WEIGHTS.phase, deductions: phD },
      spectral: { score: spectral, weight: WEIGHTS.spectral, deductions: spD },
      delivery: { score: delivery, weight: WEIGHTS.delivery, deductions: delD }
    };

    let overall = 0;
    Object.keys(breakdown).forEach(function (k) {
      overall += breakdown[k].score * breakdown[k].weight;
    });
    overall = clampScore(overall);

    const positives = [];
    const issues = [];
    if (clip.classification === 'NO CLIPPING') positives.push('No hard clipping detected');
    else issues.push(clip.classification);
    if (phase.applicable && phase.correlation >= 0.85) positives.push('Good stereo correlation');
    if (mono.rating === 'Excellent' || mono.rating === 'Good') positives.push('Good mono compatibility');
    if (stereo.applicable && stereo.lr_balance_status === 'GOOD') positives.push('Stable channel balance');
    if (tp.available && plat.true_peak_status === 'PASS') positives.push('True peak within selected reference');
    else if (tp.available && plat.true_peak_status !== 'PASS') issues.push('True peak vs selected ceiling');
    if (plat.loudness_status === 'WARNING') issues.push('Loudness vs selected platform reference');
    if (dyn.dynamic_character === 'Dense' || dyn.dynamic_character === 'Very Dense') issues.push('Dynamic density is relatively high');
    extremes.forEach(function (e) {
      if (e.type === 'sub_energy') issues.push('Elevated sub-frequency energy');
    });
    if (dc.severity === 'GOOD') positives.push('Negligible DC offset');

    let deliveryStatus = plat.status || 'REVIEW';
    if (clip.status === 'FAIL' || phase.status === 'FAIL' || (tp.value_dbtp != null && tp.value_dbtp > 0.5)) {
      deliveryStatus = 'NOT READY';
    } else if (deliveryStatus === 'READY' && issues.length) {
      deliveryStatus = 'READY WITH NOTES';
    }

    return {
      score: overall,
      label: overall + '/100',
      weights: WEIGHTS,
      weights_note: 'Overall = weighted mean of category scores. Deduction lists below show every subtracted point.',
      breakdown: breakdown,
      technical_integrity: technical,
      loudness: loudness,
      true_peak: truePeak,
      dynamics: dynamics,
      stereo: stereoScore,
      phase: phaseScore,
      spectral: spectral,
      delivery: delivery,
      positives: positives,
      issues: issues,
      delivery_status: deliveryStatus
    };
  }

  function observations(ctx, scores) {
    const out = [];
    const tp = ctx.true_peak || {};
    const loud = ctx.loudness || {};
    const dyn = ctx.dynamics || {};
    const spec = ctx.spectrum || {};
    const clip = ctx.clipping || {};
    const stereo = ctx.stereo || {};
    const phase = ctx.phase || {};
    const plat = ctx.platform || {};

    out.push({
      measurement: 'Technical integrity',
      evidence: clip.evidence || '',
      interpretation: clip.classification === 'NO CLIPPING'
        ? 'The submitted master has no detected hard clipping.'
        : 'Clipping criteria were met on one or more events.',
      engineering_observation: 'These are analytical observations only. Mix/mastering decisions should be made by the engineer based on artistic intent and monitoring conditions.'
    });

    if (tp.available) {
      out.push({
        measurement: 'Estimated true peak ' + tp.value_dbtp + ' dBTP',
        evidence: 'Method: ' + (tp.method || '4× interpolation') + '. Inter-sample difference ' + tp.inter_sample_difference_db + ' dB.',
        interpretation: plat.true_peak_difference_db != null && plat.true_peak_difference_db > 0
          ? 'Measured true peak exceeds the selected delivery target\'s configured ceiling.'
          : 'Estimated true peak is within the selected delivery reference.',
        engineering_observation: 'True-peak figures are estimated. Confirm with a calibrated meter before commercial delivery.'
      });
    }

    if (loud.available) {
      out.push({
        measurement: 'Integrated loudness ' + loud.integrated_lufs + ' LUFS',
        evidence: 'Short-term max ' + loud.short_term_max_lufs + ' LUFS; momentary max ' + loud.momentary_max_lufs + ' LUFS; LRA ' + loud.lra_lu + ' LU.',
        interpretation: plat.loudness_difference_lu != null
          ? (plat.loudness_difference_lu > 0
            ? 'Integrated loudness is above the selected platform reference.'
            : 'Integrated loudness is below the selected platform reference.')
          : 'Loudness measured against ITU-R BS.1770-4.',
        engineering_observation: 'Platform loudness normalization is playback-dependent and is not guaranteed by this report.'
      });
    }

    out.push({
      measurement: 'Dynamics',
      evidence: dyn.evidence || '',
      interpretation: 'Dynamic character: ' + (dyn.dynamic_character || 'Not available') + '.',
      engineering_observation: 'Dynamic density is descriptive, not a universal quality judgement.'
    });

    if (stereo.applicable) {
      out.push({
        measurement: 'Stereo / phase',
        evidence: 'Correlation ' + (phase.correlation) + '; width ' + stereo.stereo_width_label + ' (' + stereo.stereo_width_percent + '% side).',
        interpretation: phase.interpretation || stereo.note,
        engineering_observation: 'Frequency-dependent phase issues, if listed, should be checked in mono on the monitoring system.'
      });
    }

    (spec.extremes || []).slice(0, 6).forEach(function (e) {
      out.push({
        measurement: 'Spectral observation',
        evidence: e.statement,
        interpretation: e.statement,
        engineering_observation: 'This is a relative measurement against the master\'s own spectral baseline. It is not an EQ instruction.'
      });
    });

    return out;
  }

  function executiveSummary(ctx, scores) {
    const loud = ctx.loudness || {};
    const tp = ctx.true_peak || {};
    const dyn = ctx.dynamics || {};
    const parts = [];
    parts.push('The submitted master ' +
      ((ctx.clipping && ctx.clipping.classification === 'NO CLIPPING') ? 'has no detected hard clipping' : 'shows clipping evidence') +
      ((ctx.phase && ctx.phase.applicable) ? ' and records stereo correlation of ' + ctx.phase.correlation + '.' : '.'));
    if (tp.available) parts.push('Estimated true peak is ' + tp.value_dbtp + ' dBTP.');
    if (loud.available) {
      parts.push('Integrated loudness is ' + loud.integrated_lufs + ' LUFS' +
        (ctx.platform && ctx.platform.loudness_difference_lu != null
          ? ', which is ' + (ctx.platform.loudness_difference_lu > 0 ? 'above' : 'below') + ' the selected platform reference by ' + Math.abs(ctx.platform.loudness_difference_lu).toFixed(1) + ' LU.'
          : '.'));
    }
    if (dyn.crest_factor_db != null) {
      parts.push('The master exhibits ' + String(dyn.dynamic_character || 'unclassified').toLowerCase() +
        ' dynamics with a crest factor of ' + dyn.crest_factor_db + ' dB' +
        (dyn.lra_lu != null ? ' and LRA of ' + dyn.lra_lu + ' LU.' : '.'));
    }
    parts.push('These are analytical observations only. Mix/mastering decisions should be made by the engineer based on artistic intent and monitoring conditions.');

    return {
      text: parts.join(' '),
      qc_score: scores.score,
      delivery_status: scores.delivery_status,
      major_findings: (scores.positives || []).map(function (x) { return '✓ ' + x; })
        .concat((scores.issues || []).map(function (x) { return '⚠ ' + x; }))
    };
  }

  return { compute: compute, observations: observations, executiveSummary: executiveSummary, WEIGHTS: WEIGHTS };
}));
