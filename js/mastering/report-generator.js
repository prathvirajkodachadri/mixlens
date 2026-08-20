'use strict';
/**
 * MixLens Final Mastering Analysis 1.0 — HTML report for the in-page viewer.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'));
  } else {
    root.MAReport = factory(root.MAUtilities);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function buildHtmlReport(json) {
    const ex = json.executive_summary || {};
    const f = json.file || {};
    const qc = json.qc_score || {};
    let html = '<article class="full-report" aria-label="MixLens final mastering analysis report">';
    html += '<div class="rpt-cover">';
    html += '<div class="rpt-cover-kicker">MIXLENS FINAL MASTERING ANALYSIS</div>';
    html += '<h3 class="rpt-cover-title">' + esc(f.name || 'Untitled') + '</h3>';
    html += '<p class="rpt-cover-meta">Final Mastering Analysis ' + esc(json.engine_version) + ' · ' + esc(json.analysis_timestamp) + (json.demo ? ' · DEMO DATA' : '') + '</p>';
    html += '<div class="rpt-score-row">';
    html += '<div class="rpt-score-pill"><span>Final Master QC</span><strong>' + esc(qc.score) + '</strong><em>/100</em></div>';
    html += '<div class="rpt-score-pill"><span>Delivery</span><strong style="font-size:16px">' + esc(json.delivery_status) + '</strong></div>';
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
      ['Sample rate', f.sample_rate], ['Channels', f.channel_layout],
      ['Codec', f.codec], ['Bit depth', f.bit_depth], ['Format', f.format]
    ]));

    const t = json.technical || {};
    section('Technical Integrity', grid([
      ['Sample Peak', t.sample_peak_dbfs + ' dBFS'],
      ['Estimated True Peak', t.true_peak_dbtp + ' dBTP'],
      ['Integrated', t.integrated_lufs + ' LUFS'],
      ['Crest', t.crest_factor_db + ' dB'],
      ['Headroom', t.headroom_db + ' dB'],
      ['Clipping', json.clipping && json.clipping.classification],
      ['Status', t.status]
    ]));

    let findings = '<ul class="rpt-bullets">';
    (ex.major_findings || []).forEach(function (x) { findings += '<li>' + esc(x) + '</li>'; });
    findings += '</ul>';
    section('Major Findings', findings);

    const pa = json.platform_analysis || {};
    section('Platform Delivery', grid([
      ['Platform', pa.platform_name],
      ['Measured LUFS', pa.measured_lufs],
      ['Reference LUFS', pa.loudness_reference_lufs],
      ['Loudness difference', pa.loudness_difference_lu != null ? pa.loudness_difference_lu + ' LU' : null],
      ['Estimated True Peak', pa.measured_true_peak_dbtp],
      ['TP reference', pa.true_peak_reference_dbtp],
      ['Status', pa.status]
    ]) + '<p class="rpt-note">' + esc(pa.disclaimer || '') + '</p>');

    const br = (qc.breakdown || {});
    let scoreHtml = '<div class="rpt-grid">';
    Object.keys(br).forEach(function (k) {
      scoreHtml += '<div class="rpt-kv"><span class="rpt-k">' + esc(k.replace(/_/g, ' ')) + '</span><span class="rpt-v">' + esc(br[k].score) + '/100</span></div>';
    });
    scoreHtml += '</div><p class="rpt-note">' + esc(qc.weights_note || '') + '</p>';
    section('QC Score Breakdown', scoreHtml);

    let obs = '';
    (json.engineering_observations || []).forEach(function (o) {
      obs += '<div class="rec-card"><div class="rec-title">' + esc(o.measurement) + '</div>';
      obs += '<div class="rec-evidence">' + esc(o.evidence) + '</div>';
      obs += '<p class="rec-body">' + esc(o.interpretation) + '</p>';
      obs += '<p class="rec-advice">' + esc(o.engineering_observation) + '</p></div>';
    });
    section('Engineering Observations', obs || '<p class="rpt-empty">None</p>');

    html += '<p class="rpt-foot">' + esc(json.disclaimer || '') + '</p>';
    html += '</article>';
    return html;
  }

  return { buildHtmlReport: buildHtmlReport };
}));
