'use strict';
/**
 * MixLens Final Mastering Analysis 1.0 — Platform delivery comparison.
 * Compares measured values to configurable REFERENCE profiles.
 * Does not claim guaranteed playback behaviour.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'), require('./platform-profiles'));
  } else {
    root.MAPlatformAnalysis = factory(root.MAUtilities, root.MAPlatformProfiles);
  }
}(typeof self !== 'undefined' ? self : this, function (U, Profiles) {

  function classify(measuredLufs, refLufs, measuredTp, refTp, clipping, file, profile) {
    const notes = [];
    let tpStatus = 'PASS';
    let lufsStatus = 'PASS';
    let techStatus = 'PASS';

    if (clipping && clipping.status === 'FAIL') {
      techStatus = 'FAIL';
      notes.push('Clipping detected.');
    } else if (clipping && clipping.status === 'WARNING') {
      techStatus = 'WARNING';
      notes.push('Possible clipping events.');
    }

    if (refTp != null && measuredTp != null) {
      const d = measuredTp - refTp;
      if (d > 0.5) { tpStatus = 'FAIL'; notes.push('Estimated true peak exceeds the selected delivery ceiling.'); }
      else if (d > 0.05) { tpStatus = 'WARNING'; notes.push('Estimated true peak is above the selected delivery reference.'); }
    }

    if (refLufs != null && measuredLufs != null && measuredLufs > -140) {
      const d = measuredLufs - refLufs;
      if (Math.abs(d) >= 4) {
        lufsStatus = 'WARNING';
        notes.push('Integrated loudness differs from the platform loudness reference by ' + U.round(d, 1) + ' LU.');
      } else if (Math.abs(d) >= 1.5) {
        lufsStatus = 'WARNING';
        notes.push('Integrated loudness is offset from the platform loudness reference.');
      }
    }

    if (profile.recommended_sample_rate_hz && file && file.sample_rate && file.sample_rate < profile.recommended_sample_rate_hz) {
      notes.push('Sample rate (' + file.sample_rate + ' Hz) is below the profile’s typical delivery rate (' + profile.recommended_sample_rate_hz + ' Hz).');
      if (techStatus === 'PASS') techStatus = 'WARNING';
    }

    const rank = Math.max(U.statusRank(tpStatus), U.statusRank(lufsStatus), U.statusRank(techStatus));
    let overall = 'READY';
    if (rank >= 3) overall = 'NOT READY';
    else if (rank >= 2 && (tpStatus === 'FAIL' || techStatus === 'FAIL')) overall = 'NOT READY';
    else if (rank >= 2) overall = notes.length >= 3 ? 'REVIEW' : 'READY WITH NOTES';
    else if (notes.length) overall = 'READY WITH NOTES';

    return {
      true_peak_status: tpStatus,
      loudness_status: lufsStatus,
      technical_status: techStatus,
      overall: overall,
      notes: notes
    };
  }

  function analyzeOne(profile, measured, file, clipping) {
    const mLufs = measured.integrated_lufs;
    const mTp = measured.true_peak_dbtp;
    const refLufs = profile.loudness_reference_lufs;
    const refTp = profile.true_peak_reference_dbtp;
    const lufsDiff = (refLufs != null && mLufs != null && mLufs > -140) ? U.round(mLufs - refLufs, 2) : null;
    const tpDiff = (refTp != null && mTp != null) ? U.round(mTp - refTp, 2) : null;

    let normNote = 'This profile does not assume loudness normalization.';
    if (profile.normalizes && lufsDiff != null) {
      if (lufsDiff > 0.3) {
        normNote = 'If the platform applies loudness normalization toward this reference, playback level may be reduced by approximately ' +
          lufsDiff.toFixed(1) + ' dB relative to the uploaded master.';
      } else if (lufsDiff < -0.3) {
        normNote = 'If the platform applies loudness normalization toward this reference, playback level may be increased by approximately ' +
          Math.abs(lufsDiff).toFixed(1) + ' dB relative to the uploaded master.';
      } else {
        normNote = 'Measured loudness is close to the configured reference; estimated normalization gain is small.';
      }
    }

    const cls = classify(mLufs, refLufs, mTp, refTp, clipping, file, profile);

    return {
      platform_id: profile.id,
      platform_name: profile.name,
      loudness_reference_lufs: refLufs,
      true_peak_reference_dbtp: refTp,
      reference_label: 'REFERENCE / CONFIGURABLE DELIVERY TARGET',
      measured_lufs: mLufs,
      measured_true_peak_dbtp: mTp,
      loudness_difference_lu: lufsDiff,
      true_peak_difference_db: tpDiff,
      estimated_normalization_gain_db: (profile.normalizes && lufsDiff != null) ? U.round(-lufsDiff, 2) : null,
      normalization_note: normNote,
      normalizes: !!profile.normalizes,
      notes: profile.notes,
      technical_status: cls.technical_status,
      true_peak_status: cls.true_peak_status,
      loudness_status: cls.loudness_status,
      status: cls.overall,
      findings: cls.notes
    };
  }

  function analyzeSelected(platformId, measured, file, clipping, customTarget) {
    let profile = Profiles.clone(platformId || 'spotify');
    if (platformId === 'custom' && customTarget) {
      if (customTarget.target_lufs != null) profile.loudness_reference_lufs = customTarget.target_lufs;
      if (customTarget.max_true_peak_dbtp != null) profile.true_peak_reference_dbtp = customTarget.max_true_peak_dbtp;
      if (customTarget.min_sample_rate_hz != null) profile.recommended_sample_rate_hz = customTarget.min_sample_rate_hz;
      if (customTarget.preferred_bit_depth != null) profile.recommended_bit_depth = customTarget.preferred_bit_depth;
      profile.notes = 'User-defined custom delivery target.';
    }
    const row = analyzeOne(profile, measured, file, clipping);
    row.disclaimer = Profiles.DISCLAIMER;
    row.custom_target = platformId === 'custom' ? (customTarget || {}) : null;
    return row;
  }

  function compareAll(measured, file, clipping, customTarget) {
    return Profiles.list().map(function (p) {
      if (p.id === 'custom') {
        const c = Object.assign({}, p);
        if (customTarget) {
          if (customTarget.target_lufs != null) c.loudness_reference_lufs = customTarget.target_lufs;
          if (customTarget.max_true_peak_dbtp != null) c.true_peak_reference_dbtp = customTarget.max_true_peak_dbtp;
        }
        return analyzeOne(c, measured, file, clipping);
      }
      return analyzeOne(p, measured, file, clipping);
    });
  }

  function evaluateCustomFile(file, customTarget, clipping) {
    if (!customTarget) return { enabled: false };
    const findings = [];
    let status = 'PASS';
    if (customTarget.min_sample_rate_hz && file.sample_rate < customTarget.min_sample_rate_hz) {
      findings.push('Sample rate ' + file.sample_rate + ' Hz is below the custom minimum ' + customTarget.min_sample_rate_hz + ' Hz.');
      status = 'FAIL';
    }
    if (customTarget.preferred_bit_depth && file.bit_depth !== 'Not available' && file.bit_depth != null && file.bit_depth < customTarget.preferred_bit_depth) {
      findings.push('Container bit depth ' + file.bit_depth + ' is below the preferred ' + customTarget.preferred_bit_depth + '-bit.');
      if (status === 'PASS') status = 'WARNING';
    }
    if (customTarget.channels === 'stereo' && file.channels < 2) {
      findings.push('Custom target requires stereo; this master is ' + file.channel_layout + '.');
      status = 'FAIL';
    }
    if (customTarget.channels === 'mono' && file.channels !== 1) {
      findings.push('Custom target requires mono; this master is ' + file.channel_layout + '.');
      if (status === 'PASS') status = 'WARNING';
    }
    if (clipping && clipping.detected) {
      findings.push('Clipping evidence is present against a custom delivery target.');
      status = clipping.status === 'FAIL' ? 'FAIL' : (status === 'FAIL' ? 'FAIL' : 'WARNING');
    }
    return { enabled: true, status: status, findings: findings, target: customTarget };
  }

  return {
    analyzeSelected: analyzeSelected,
    compareAll: compareAll,
    evaluateCustomFile: evaluateCustomFile,
    DISCLAIMER: Profiles.DISCLAIMER
  };
}));
