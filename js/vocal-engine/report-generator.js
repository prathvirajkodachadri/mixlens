'use strict';
/**
 * MixLens Vocal Engine 3.0 — Professional TXT / HTML report.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.VEReport = factory(root.VEUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

  function line(label, value) {
    return label + ':\n' + (value == null || value === '' ? 'Not available' : String(value)) + '\n';
  }

  function kv(label, value) {
    return label + ': ' + (value == null || value === '' ? 'Not available' : String(value));
  }

  function buildTextReport(json) {
    const f = json.file || {};
    const t = json.technical || {};
    const ex = json.executive_summary || {};
    const L = [];
    L.push('MIXLENS VOCAL ANALYSIS REPORT');
    L.push('================================');
    L.push('Vocal Engine ' + json.engine_version + '  ·  schema ' + json.schema_version + '  ·  analysis ' + json.analysis_version);
    L.push('100% LOCAL DSP ANALYSIS');
    L.push('Your audio stays on your device.');
    if (json.demo) L.push('DEMO DATA');
    L.push('');
    L.push(kv('File', f.name));
    L.push(kv('Duration', f.duration_label || f.duration_seconds));
    L.push(kv('Sample Rate', f.sample_rate ? (f.sample_rate / 1000) + ' kHz' : null));
    L.push(kv('Channels', f.channel_layout || f.channels));
    L.push(kv('Analyzed', json.analysis_timestamp));
    L.push('');
    L.push('--------------------------------');
    L.push('01. EXECUTIVE SUMMARY');
    L.push('--------------------------------');
    L.push(kv('Mix-Readiness', (ex.mix_readiness != null ? ex.mix_readiness + '/100' : null)));
    L.push(kv('Recording Health', (ex.recording_health != null ? ex.recording_health + '/100' : null)));
    L.push('');
    L.push('Major Findings:');
    (ex.major_findings || []).forEach(function (x, i) { L.push((i + 1) + '. ' + x); });
    L.push('');
    L.push('--------------------------------');
    L.push('02. FILE INFORMATION');
    L.push('--------------------------------');
    L.push(kv('Filename', f.name));
    L.push(kv('File size', f.size_label));
    L.push(kv('Duration', f.duration_label));
    L.push(kv('Sample rate', f.sample_rate));
    L.push(kv('Channels', f.channels));
    L.push(kv('Channel layout', f.channel_layout));
    L.push(kv('Sample count', f.sample_count));
    L.push(kv('Codec', f.codec));
    L.push(kv('Bit depth', f.bit_depth));
    L.push(kv('Format', f.format));
    L.push('');
    L.push('--------------------------------');
    L.push('03. TECHNICAL QUALITY');
    L.push('--------------------------------');
    L.push(kv('Peak', t.sample_peak_dbfs != null ? t.sample_peak_dbfs + ' dBFS' : null));
    L.push(kv('True Peak', t.true_peak_dbtp != null ? t.true_peak_dbtp + ' dBTP' : null));
    L.push(kv('RMS', t.rms_dbfs != null ? t.rms_dbfs + ' dBFS' : null));
    L.push(kv('Integrated Loudness', t.integrated_lufs != null ? t.integrated_lufs + ' LUFS' : null));
    L.push(kv('Crest Factor', t.crest_factor_db != null ? t.crest_factor_db + ' dB' : null));
    L.push(kv('DC Offset', t.dc_offset != null ? t.dc_offset : null));
    L.push(kv('Headroom', t.headroom_db != null ? t.headroom_db + ' dB' : null));
    L.push(kv('Clipping', json.clipping && json.clipping.classification));
    L.push(kv('Silence ratio', t.silence_ratio != null ? (t.silence_ratio * 100).toFixed(1) + '%' : null));
    L.push('');
    L.push('--------------------------------');
    L.push('04. LOUDNESS');
    L.push('--------------------------------');
    const ld = json.loudness || {};
    L.push(kv('Integrated LUFS', ld.integrated_lufs));
    L.push(kv('Short-term max LUFS', ld.short_term_lufs));
    L.push(kv('Momentary max LUFS', ld.momentary_lufs));
    L.push(kv('Loudness Range', ld.lra_lu != null ? ld.lra_lu + ' LU' : null));
    L.push(kv('Peak-to-loudness ratio', t.peak_to_loudness_db != null ? t.peak_to_loudness_db + ' dB' : null));
    if (ld.timeline && ld.timeline.length) {
      L.push('');
      L.push('Time       Short-Term LUFS');
      ld.timeline.slice(0, 40).forEach(function (row) {
        L.push(U.fmtTime(row.time_s).padEnd(10) + '  ' + row.short_term_lufs);
      });
    }
    L.push('');
    L.push('--------------------------------');
    L.push('05. DYNAMICS');
    L.push('--------------------------------');
    const d = json.dynamics || {};
    L.push(kv('Quiet Average', d.quiet_average_dbfs != null ? d.quiet_average_dbfs + ' dBFS' : null));
    L.push(kv('Loud Average', d.loud_average_dbfs != null ? d.loud_average_dbfs + ' dBFS' : null));
    L.push(kv('Variation', d.variation_db != null ? d.variation_db + ' dB' : null));
    L.push(kv('Classification', d.classification));
    L.push(kv('Crest factor', d.crest_factor_db != null ? d.crest_factor_db + ' dB' : null));
    if (d.evidence) L.push('Evidence: ' + d.evidence);
    L.push('');
    L.push('--------------------------------');
    L.push('06. FREQUENCY SPECTRUM');
    L.push('--------------------------------');
    const sp = json.spectrum || {};
    L.push(kv('FFT size', sp.fft_size));
    L.push(kv('Centroid', sp.centroid_hz != null ? sp.centroid_hz + ' Hz' : null));
    L.push(kv('Spread', sp.spread_hz != null ? sp.spread_hz + ' Hz' : null));
    L.push(kv('Rolloff (85%)', sp.rolloff_hz != null ? sp.rolloff_hz + ' Hz' : null));
    L.push(kv('Flatness', sp.flatness));
    L.push(kv('Flux', sp.flux));
    L.push('');
    L.push('--------------------------------');
    L.push('07. 16-ZONE TONAL ANALYSIS');
    L.push('--------------------------------');
    (json.tonal_zones || []).forEach(function (z) {
      L.push(z.name.toUpperCase());
      L.push((z.frequency_label || '') + '  Energy: ' + z.energy_percent + '%  Deviation: ' + (z.deviation_from_vocal_baseline_db == null ? 'n/a' : U.fmtDb(z.deviation_from_vocal_baseline_db)) + '  Status: ' + z.status);
      L.push('');
    });
    L.push('--------------------------------');
    L.push('08. RESONANCE ANALYSIS');
    L.push('--------------------------------');
    const res = json.resonances || [];
    if (!res.length) L.push('No resonance candidates met the prominence / Q / persistence tests.');
    res.forEach(function (r, i) {
      L.push('#' + (i + 1));
      L.push(r.frequency_hz + ' Hz');
      L.push(U.fmtDb(r.peak_excess_db));
      L.push('Q ' + r.q);
      L.push('Persistence ' + r.persistence + '%');
      L.push('Confidence ' + r.confidence + '%');
      L.push('Classification: ' + r.classification);
      L.push('Evidence: ' + r.evidence);
      L.push('');
    });
    L.push('--------------------------------');
    L.push('09. SIBILANCE ANALYSIS');
    L.push('--------------------------------');
    const sb = json.sibilance || {};
    L.push(kv('Events', sb.event_count));
    L.push(kv('Dominant Frequency', sb.dominant_frequency_hz != null ? U.fmtFreq(sb.dominant_frequency_hz) : null));
    L.push(kv('Average Excess', sb.average_excess_db != null ? U.fmtDb(sb.average_excess_db) : null));
    L.push(kv('Maximum Excess', sb.maximum_excess_db != null ? U.fmtDb(sb.maximum_excess_db) : null));
    L.push(kv('Severity', sb.severity));
    L.push('');
    L.push('--------------------------------');
    L.push('10. PLOSIVE ANALYSIS');
    L.push('--------------------------------');
    const pl = json.plosives || {};
    L.push(kv('Plosive Events', pl.event_count));
    L.push(kv('Strong Events', pl.strong_events));
    (pl.timestamps || []).slice(0, 20).forEach(function (t0) { L.push(U.fmtTime(t0)); });
    L.push('');
    L.push('--------------------------------');
    L.push('11. BREATH ANALYSIS');
    L.push('--------------------------------');
    const br = json.breaths || {};
    L.push(kv('Breaths', br.breath_count));
    L.push(kv('Average Duration', br.average_duration_ms != null ? br.average_duration_ms + ' ms' : null));
    L.push(kv('Strong Breaths', br.strong_breaths));
    L.push('');
    L.push('--------------------------------');
    L.push('12. NOISE ANALYSIS');
    L.push('--------------------------------');
    const ns = json.noise || {};
    L.push(kv('Noise Floor', ns.noise_floor_dbfs != null ? ns.noise_floor_dbfs + ' dBFS' : ns.classification));
    L.push(kv('Estimated SNR', ns.estimated_snr_db != null ? ns.estimated_snr_db + ' dB' : null));
    L.push(kv('Noise Stability', ns.noise_stability));
    L.push(kv('Classification', ns.classification));
    if (ns.evidence) L.push('Evidence: ' + ns.evidence);
    L.push('');
    L.push('--------------------------------');
    L.push('13. HUM ANALYSIS');
    L.push('--------------------------------');
    const hm = json.hum || {};
    L.push(kv('Detected', hm.detected ? 'Yes' : 'No'));
    L.push(kv('Fundamental', hm.fundamental_hz));
    L.push(kv('Harmonics', (hm.harmonics && hm.harmonics.length) ? hm.harmonics.join(' / ') : null));
    L.push(kv('Confidence', hm.confidence != null ? hm.confidence + '%' : null));
    if (hm.evidence) L.push('Evidence: ' + hm.evidence);
    L.push('');
    L.push('--------------------------------');
    L.push('14. PITCH / F0 ANALYSIS');
    L.push('--------------------------------');
    const p = json.pitch || {};
    L.push(kv('Median F0', p.median_f0_hz != null ? p.median_f0_hz + ' Hz' : null));
    L.push(kv('Observed Range', p.pitch_range_hz ? p.pitch_range_hz[0] + '–' + p.pitch_range_hz[1] + ' Hz' : null));
    L.push(kv('Primary Pitch Center', p.primary_note));
    L.push(kv('Voiced ratio', p.voiced_ratio != null ? (p.voiced_ratio * 100).toFixed(1) + '%' : null));
    L.push('Observed Pitch Profile — not a definitive voice type.');
    if (p.evidence) L.push('Evidence: ' + p.evidence);
    L.push('');
    L.push('--------------------------------');
    L.push('15. VIBRATO ANALYSIS');
    L.push('--------------------------------');
    const vb = json.vibrato || {};
    if (!vb.available || vb.rate_hz == null) L.push(vb.note || 'Vibrato analysis unavailable due to insufficient sustained voiced material.');
    else {
      L.push(kv('Vibrato Rate', vb.rate_hz + ' Hz'));
      L.push(kv('Estimated Depth', '±' + vb.depth_cents + ' cents'));
      L.push(kv('Consistency', vb.consistency));
      L.push(kv('Confidence', vb.confidence));
    }
    L.push('');
    L.push('--------------------------------');
    L.push('16. STEREO / PHASE');
    L.push('--------------------------------');
    const st = json.stereo || {};
    if (!st.applicable) L.push(st.note || 'Mono vocal detected. Stereo-width analysis is not applicable.');
    else {
      L.push(kv('L RMS', st.l_rms_dbfs));
      L.push(kv('R RMS', st.r_rms_dbfs));
      L.push(kv('Correlation', st.correlation));
      L.push(kv('Stereo width', st.stereo_width_percent != null ? st.stereo_width_percent + '%' : null));
      L.push(kv('Mono compatibility', st.mono_compatibility));
    }
    L.push('');
    L.push('--------------------------------');
    L.push('17. TEMPORAL EVENT TIMELINE');
    L.push('--------------------------------');
    (json.timeline_events || []).slice(0, 80).forEach(function (e) {
      L.push(U.fmtTime(e.time_s) + '  ' + e.type);
    });
    L.push('');
    L.push('--------------------------------');
    L.push('18. VOCAL CHARACTER PROFILE');
    L.push('--------------------------------');
    const ch = (json.character_profile && json.character_profile.scores) || {};
    Object.keys(ch).forEach(function (k) { L.push(kv(k, ch[k])); });
    if (json.character_profile && json.character_profile.note) L.push(json.character_profile.note);
    L.push('');
    L.push('--------------------------------');
    L.push('19. RECORDING HEALTH');
    L.push('--------------------------------');
    const rh = json.recording_health || {};
    L.push(kv('Recording Health', rh.score != null ? rh.score + '/100' : null));
    (rh.positives || []).forEach(function (x) { L.push('✓ ' + x); });
    (rh.issues || []).forEach(function (x) { L.push('⚠ ' + x); });
    L.push('');
    L.push('--------------------------------');
    L.push('20. MIX-READINESS');
    L.push('--------------------------------');
    const mr = json.mix_readiness || {};
    L.push(kv('Mix-Readiness', mr.score != null ? mr.score + '/100' : null));
    if (mr.note) L.push(mr.note);
    (mr.contributing_factors || []).forEach(function (x) { L.push('- ' + x.reason + (x.points ? ' (−' + x.points + ')' : '')); });
    L.push('');
    L.push('--------------------------------');
    L.push('21. REFERENCE COMPARISON');
    L.push('--------------------------------');
    const rf = json.reference_comparison || {};
    if (!rf.enabled) L.push(rf.note || 'No reference vocal loaded.');
    else {
      (rf.zones || []).forEach(function (z) {
        L.push(z.name + '  Your vocal: ' + (z.your_vocal_relative_db == null ? 'n/a' : U.fmtDb(z.your_vocal_relative_db) + ' relative'));
      });
    }
    L.push('');
    L.push('--------------------------------');
    L.push('22. ENGINEERING OBSERVATIONS');
    L.push('--------------------------------');
    (json.engineering_observations || []).forEach(function (o, i) {
      L.push((i + 1) + '. MEASUREMENT: ' + o.measurement);
      L.push('   EVIDENCE: ' + o.evidence);
      L.push('   INTERPRETATION: ' + o.interpretation);
      L.push('   ENGINEERING OBSERVATION: ' + o.engineering_observation);
      L.push('');
    });
    L.push('These measurements should be evaluated during mixing rather');
    L.push('than treated as automatic processing instructions.');
    L.push('');
    L.push('--------------------------------');
    L.push('23. COMPLETE RAW MEASUREMENTS');
    L.push('--------------------------------');
    L.push('See the companion JSON export for the full numeric payload');
    L.push('(schema_version ' + json.schema_version + ', engine_version ' + json.engine_version + ').');
    L.push('');
    L.push('================================');
    L.push('END OF REPORT');
    L.push('================================');
    return L.join('\n');
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function buildHtmlReport(json) {
    const ex = json.executive_summary || {};
    const f = json.file || {};
    let html = '<article class="full-report" aria-label="MixLens vocal analysis report">';
    html += '<div class="rpt-cover">';
    html += '<div class="rpt-cover-kicker">MIXLENS VOCAL ANALYSIS REPORT</div>';
    html += '<h3 class="rpt-cover-title">' + esc(f.name || 'Untitled') + '</h3>';
    html += '<p class="rpt-cover-meta">Vocal Engine ' + esc(json.engine_version) + ' · ' + esc(json.analysis_timestamp) + (json.demo ? ' · DEMO DATA' : '') + '</p>';
    html += '<div class="rpt-score-row">';
    html += '<div class="rpt-score-pill"><span>Mix-Readiness</span><strong>' + esc(ex.mix_readiness) + '</strong><em>/100</em></div>';
    html += '<div class="rpt-score-pill"><span>Recording Health</span><strong>' + esc(ex.recording_health) + '</strong><em>/100</em></div>';
    html += '<p class="rpt-exec">' + esc(ex.text || '') + '</p>';
    html += '</div></div>';

    function section(title, body) {
      html += '<section class="rpt-section"><h4>' + esc(title) + '</h4>' + body + '</section>';
    }
    function grid(pairs) {
      let g = '<div class="rpt-grid">';
      pairs.forEach(function (p) {
        g += '<div class="rpt-kv"><span class="rpt-k">' + esc(p[0]) + '</span><span class="rpt-v">' + esc(p[1] == null ? 'Not available' : p[1]) + '</span></div>';
      });
      return g + '</div>';
    }

    section('File Information', grid([
      ['Filename', f.name], ['Size', f.size_label], ['Duration', f.duration_label],
      ['Sample rate', f.sample_rate], ['Channels', f.channel_layout], ['Codec', f.codec], ['Bit depth', f.bit_depth]
    ]));
    const t = json.technical || {};
    section('Technical Quality', grid([
      ['Peak', t.sample_peak_dbfs + ' dBFS'], ['True Peak', t.true_peak_dbtp + ' dBTP'],
      ['Integrated', t.integrated_lufs + ' LUFS'], ['Crest', t.crest_factor_db + ' dB'],
      ['Headroom', t.headroom_db + ' dB'], ['Clipping', json.clipping && json.clipping.classification]
    ]));
    let findings = '<ul class="rpt-bullets">';
    (ex.major_findings || []).forEach(function (x) { findings += '<li>' + esc(x) + '</li>'; });
    findings += '</ul>';
    section('Major Findings', findings);

    let obs = '';
    (json.engineering_observations || []).forEach(function (o) {
      obs += '<div class="rec-card"><div class="rec-title">' + esc(o.measurement) + '</div>';
      obs += '<div class="rec-evidence">' + esc(o.evidence) + '</div>';
      obs += '<p class="rec-body">' + esc(o.interpretation) + '</p>';
      obs += '<p class="rec-advice">' + esc(o.engineering_observation) + '</p></div>';
    });
    section('Engineering Observations', obs || '<p class="rpt-empty">None</p>');
    html += '<p class="rpt-foot">Evidence-based local DSP analysis. Measurements are not automatic processing instructions.</p>';
    html += '</article>';
    return html;
  }

  return { buildTextReport, buildHtmlReport };
}));
