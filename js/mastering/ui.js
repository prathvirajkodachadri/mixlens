'use strict';
/**
 * MixLens Final Mastering Analysis 1.0 — QC workstation UI.
 * Local playback, progressive analysis, charts from measured data only.
 */
(function (root) {
  const $ = function (id) { return document.getElementById(id); };
  const U = root.MAUtilities;
  const Analyzer = root.MAAnalyzer;
  const Loader = root.MAAudioLoader;
  const Pdf = root.MAPdf;
  const Profiles = root.MAPlatformProfiles;

  if (!Analyzer || !U) {
    showBootError();
    return;
  }

  const state = {
    result: null,
    assembled: null,
    audioBuffer: null,
    ctx: null,
    source: null,
    gain: null,
    playing: false,
    startAt: 0,
    pauseAt: 0,
    raf: 0,
    duration: 0,
    demo: false,
    specZoom: null,
    loudZoom: null,
    drawn: {},
    platformId: 'spotify',
    compare: { reference: null, masterB: null }
  };

  function showBootError() {
    try {
      const el = document.createElement('div');
      el.id = 'mixlensBootError';
      el.className = 'analysis-error';
      el.textContent = 'Final Mastering Analysis failed to load. Hard-refresh (Ctrl/Cmd+Shift+R) to bypass a stale cache.';
      document.body.appendChild(el);
    } catch (e) { /* ignore */ }
  }

  function hide(el, yes) {
    if (!el) return;
    el.classList.toggle('hidden', !!yes);
  }

  function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function ensureAudio() {
    if (!state.ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      state.ctx = new AC();
      state.gain = state.ctx.createGain();
      state.gain.gain.value = 0.9;
      state.gain.connect(state.ctx.destination);
    }
    return state.ctx;
  }

  function initChecklist() {
    const ol = $('progressChecklist');
    if (!ol || !Analyzer.STAGES) return;
    ol.innerHTML = '';
    Analyzer.STAGES.forEach(function (s) {
      const li = document.createElement('li');
      li.id = 'chk-' + s.id;
      li.textContent = s.label;
      ol.appendChild(li);
    });
  }

  function applyProgress(p) {
    setText('masterProgressLabel', p.label || p.stage);
    setText('masterProgressPct', Math.round(p.percent) + '%');
    const fill = $('masterProgressFill');
    if (fill) fill.style.width = Math.max(0, Math.min(100, p.percent)) + '%';
    const bar = $('masterProgressBar');
    if (bar) bar.setAttribute('aria-valuenow', String(Math.round(p.percent)));
    if (p.stages) {
      p.stages.forEach(function (s) {
        const li = $('chk-' + s.id);
        if (li) li.classList.toggle('done', !!s.done);
      });
    }
  }

  function readCustomTarget() {
    return {
      target_lufs: Number($('customLufs').value),
      max_true_peak_dbtp: Number($('customTp').value),
      min_sample_rate_hz: Number($('customSr').value),
      preferred_bit_depth: Number($('customBd').value),
      channels: $('customCh').value
    };
  }

  function buildPlatformChips() {
    const host = $('platformChips');
    if (!host || !Profiles) return;
    host.innerHTML = '';
    Profiles.list().forEach(function (p) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'platform-chip' + (p.id === state.platformId ? ' active' : '');
      b.textContent = p.name;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', p.id === state.platformId ? 'true' : 'false');
      b.addEventListener('click', function () {
        state.platformId = p.id;
        host.querySelectorAll('.platform-chip').forEach(function (c) {
          c.classList.toggle('active', c === b);
          c.setAttribute('aria-checked', c === b ? 'true' : 'false');
        });
        if (state.assembled) applyPlatformChange();
      });
      host.appendChild(b);
    });
  }

  function applyPlatformChange() {
    if (!state.assembled || !Analyzer.recomputePlatform) return;
    const pack = Analyzer.recomputePlatform(state.assembled, state.platformId, readCustomTarget());
    state.result.json = pack.json;
    state.result.textReport = pack.textReport;
    state.result.htmlReport = pack.htmlReport;
    state.assembled = pack.assembled;
    renderAll(state.result);
  }

  function bindUpload() {
    const zone = $('masterDropZone');
    const input = $('masterFileInput');
    const browse = $('browseFileBtn');
    if (browse) browse.addEventListener('click', function (e) {
      e.stopPropagation();
      if (input) input.click();
    });
    if (zone) {
      zone.addEventListener('click', function (e) {
        if (e.target && (e.target.id === 'browseFileBtn' || e.target.id === 'loadDemoBtn')) return;
        if (input) input.click();
      });
      zone.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (input) input.click(); }
      });
      zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('drag-over'); });
      zone.addEventListener('dragleave', function () { zone.classList.remove('drag-over'); });
      zone.addEventListener('drop', function (e) {
        e.preventDefault();
        zone.classList.remove('drag-over');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) handleFile(f);
      });
    }
    if (input) input.addEventListener('change', function () {
      if (input.files && input.files[0]) handleFile(input.files[0]);
    });
    const demo = $('loadDemoBtn');
    if (demo) demo.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      return loadDemo();
    });
  }

  function bindTabs() {
    const btns = document.querySelectorAll('.v-tab-btn');
    const panels = document.querySelectorAll('.v-tab-content');
    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.getAttribute('data-tab');
        btns.forEach(function (b) {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
        panels.forEach(function (p) { hide(p, p.id !== id); });
        drawVisible(id);
      });
    });
  }

  function bindPlayer() {
    $('masterPlayBtn') && $('masterPlayBtn').addEventListener('click', play);
    $('masterPauseBtn') && $('masterPauseBtn').addEventListener('click', pause);
    $('masterStopBtn') && $('masterStopBtn').addEventListener('click', stop);
    const seek = $('masterSeek');
    if (seek) seek.addEventListener('input', function () {
      const t = (Number(seek.value) / 1000) * state.duration;
      seekTo(t);
    });
    const vol = $('masterVolume');
    if (vol) vol.addEventListener('input', function () {
      if (state.gain) state.gain.gain.value = Number(vol.value) / 100;
    });
  }

  function bindExports() {
    $('exportJsonBtn') && $('exportJsonBtn').addEventListener('click', function () {
      if (!state.result) return;
      downloadBlob(JSON.stringify(state.result.json, null, 2), 'mixlens-mastering-report.json', 'application/json');
    });
    $('exportTxtBtn') && $('exportTxtBtn').addEventListener('click', function () {
      if (!state.result) return;
      downloadBlob(state.result.textReport, 'mixlens-mastering-report.txt', 'text/plain');
    });
    $('copyReportBtn') && $('copyReportBtn').addEventListener('click', function () {
      if (!state.result) return;
      if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
        root.navigator.clipboard.writeText(state.result.textReport);
      }
    });
    $('exportPdfBtn') && $('exportPdfBtn').addEventListener('click', exportPdf);
    $('refFileInput') && $('refFileInput').addEventListener('change', onRefFile);
    $('bFileInput') && $('bFileInput').addEventListener('change', onBFile);
    $('applyCustomBtn') && $('applyCustomBtn').addEventListener('click', function () {
      if (state.assembled) applyPlatformChange();
    });
  }

  function downloadBlob(data, name, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  async function exportPdf() {
    if (!state.result || !Pdf) return;
    drawVisible('tab-spectrum');
    drawVisible('tab-loudness');
    drawVisible('tab-waveform');
    const images = {};
    if ($('spectrumCanvas') && $('spectrumCanvas').width > 0) images.spectrum = await Pdf.canvasToJpeg($('spectrumCanvas'), 0.85);
    if ($('loudnessCanvas') && $('loudnessCanvas').width > 0) images.loudness = await Pdf.canvasToJpeg($('loudnessCanvas'), 0.85);
    if ($('waveCanvas') && $('waveCanvas').width > 0) images.waveform = await Pdf.canvasToJpeg($('waveCanvas'), 0.85);
    const bytes = Pdf.buildPdf(state.result.json, images);
    downloadBlob(new Blob([bytes], { type: 'application/pdf' }), 'mixlens-mastering-report.pdf', 'application/pdf');
  }

  function currentTime() {
    if (!state.ctx) return state.pauseAt;
    if (!state.playing) return state.pauseAt;
    return Math.min(state.duration, state.pauseAt + (state.ctx.currentTime - state.startAt));
  }

  function play() {
    if (!state.audioBuffer) return;
    const ctx = ensureAudio();
    ctx.resume && ctx.resume();
    stopSourceOnly();
    const src = ctx.createBufferSource();
    src.buffer = state.audioBuffer;
    src.connect(state.gain);
    const offset = state.pauseAt;
    src.start(0, offset);
    src.onended = function () {
      if (state.source === src) {
        state.playing = false;
        state.pauseAt = 0;
      }
    };
    state.source = src;
    state.playing = true;
    state.startAt = ctx.currentTime;
    loopClock();
  }

  function pause() {
    if (!state.playing) return;
    state.pauseAt = currentTime();
    stopSourceOnly();
    state.playing = false;
  }

  function stop() {
    stopSourceOnly();
    state.playing = false;
    state.pauseAt = 0;
    updateClock();
  }

  function stopSourceOnly() {
    if (state.source) {
      try { state.source.stop(); } catch (e) { /* */ }
      try { state.source.disconnect(); } catch (e2) { /* */ }
      state.source = null;
    }
  }

  function seekTo(t) {
    state.pauseAt = Math.max(0, Math.min(state.duration, t));
    if (state.playing) play();
    else updateClock();
    if (state.drawn.wave) drawWave();
  }

  function loopClock() {
    updateClock();
    if (state.playing) state.raf = requestAnimationFrame(loopClock);
  }

  function updateClock() {
    const t = currentTime();
    setText('masterTimeLabel', U.fmtTime(t) + ' / ' + U.fmtTime(state.duration));
    const seek = $('masterSeek');
    if (seek && state.duration) seek.value = String(Math.round((t / state.duration) * 1000));
  }

  function showError(msg) {
    const el = $('analysisError');
    if (!el) return;
    el.textContent = msg;
    hide(el, false);
  }

  function clearError() { hide($('analysisError'), true); }

  async function handleFile(file) {
    clearError();
    state.demo = false;
    hide($('demoBanner'), true);
    hide($('masterProgressWrap'), false);
    hide($('masterDashboard'), true);
    initChecklist();
    applyProgress({ stage: 'load', label: 'Loading Audio', percent: 3, stages: Analyzer.STAGES.map(function (s) { return { id: s.id, label: s.label, done: s.id === 'load' }; }) });
    try {
      const ctx = ensureAudio();
      const decoded = await Loader.decodeFile(file, ctx);
      applyProgress({ stage: 'decode', label: 'Decoding', percent: 8 });
      state.audioBuffer = decoded.audioBuffer;
      state.duration = decoded.duration;
      await runAnalysis({
        left: decoded.left,
        right: decoded.right,
        sampleRate: decoded.sampleRate,
        fileName: decoded.fileName,
        fileSize: decoded.fileSize,
        format: decoded.format,
        codec: decoded.codec,
        bitDepth: decoded.bitDepth,
        channels: decoded.channels
      }, { demo: false });
    } catch (err) {
      showError(err && err.message ? err.message : String(err));
      hide($('masterProgressWrap'), true);
    }
  }

  async function loadDemo() {
    clearError();
    state.demo = true;
    hide($('masterProgressWrap'), false);
    hide($('masterDashboard'), true);
    initChecklist();
    applyProgress({ stage: 'load', label: 'Loading Audio', percent: 4 });
    try {
      const ctx = ensureAudio();
      const demo = Analyzer.makeDemoBuffer(48000);
      const buf = ctx.createBuffer(2, demo.left.length, demo.sampleRate);
      buf.getChannelData(0).set(demo.left);
      buf.getChannelData(1).set(demo.right);
      state.audioBuffer = buf;
      state.duration = demo.left.length / demo.sampleRate;
      await runAnalysis(demo, { demo: true });
    } catch (err) {
      showError(err && err.message ? err.message : String(err));
      hide($('masterProgressWrap'), true);
    }
  }

  function cloneF32(arr) {
    if (!arr) return null;
    const copy = new Float32Array(arr.length);
    copy.set(arr);
    return copy;
  }

  function runOnMain(input, options) {
    return Analyzer.analyze(input, options, applyProgress);
  }

  function runInWorker(input, options) {
    return new Promise(function (resolve, reject) {
      let worker;
      try {
        worker = new Worker('js/mastering/worker.js');
      } catch (e) {
        reject(e);
        return;
      }
      worker.onmessage = function (ev) {
        const msg = ev.data || {};
        if (msg.type === 'progress') applyProgress(msg.progress);
        else if (msg.type === 'done') {
          worker.terminate();
          resolve(msg.result);
        } else if (msg.type === 'error') {
          worker.terminate();
          reject(new Error(msg.message));
        }
      };
      worker.onerror = function (e) {
        try { worker.terminate(); } catch (x) { /* */ }
        reject(e.error || new Error(e.message || 'Worker failed'));
      };
      const left = cloneF32(input.left);
      const right = cloneF32(input.right);
      const payload = {
        left: left, right: right, sampleRate: input.sampleRate,
        fileName: input.fileName, fileSize: input.fileSize, format: input.format,
        codec: input.codec, bitDepth: input.bitDepth, channels: input.channels
      };
      const transfer = [left.buffer];
      if (right) transfer.push(right.buffer);
      try {
        worker.postMessage({ type: 'analyze', input: payload, options: options }, transfer);
      } catch (err) {
        worker.terminate();
        reject(err);
      }
    });
  }

  async function runAnalysis(input, options) {
    const opts = Object.assign({
      platformId: state.platformId,
      customTarget: readCustomTarget()
    }, options || {});
    if (state.compare.reference) opts.reference = state.compare.reference;
    if (state.compare.masterB) opts.masterB = state.compare.masterB;

    let result;
    try {
      result = await runInWorker(input, opts);
    } catch (e) {
      result = await runOnMain(input, opts);
    }
    state.result = result;
    state.assembled = result.assembled || null;
    renderAll(result);
    hide($('masterProgressWrap'), true);
    hide($('masterDashboard'), false);
    hide($('demoBanner'), !opts.demo);
    updateClock();
  }

  function deliveryClass(s) {
    if (s === 'READY') return 'd-ready';
    if (s === 'READY WITH NOTES') return 'd-notes';
    if (s === 'REVIEW') return 'd-review';
    return 'd-fail';
  }

  function renderAll(result) {
    const j = result.json;
    const f = j.file;
    setText('masterFileName', f.name);
    setText('masterFileMeta', [f.duration_label, f.sample_rate + ' Hz', f.channel_layout].join(' · '));
    setText('masterFormatLine', 'MASTER FORMAT · ' + ((j.master_format && j.master_format.label) || f.channel_layout));
    const grid = $('fileMetaGrid');
    if (grid) {
      const rows = [
        ['Filename', f.name], ['Size', f.size_label], ['Duration', f.duration_label],
        ['Sample rate', f.sample_rate + ' Hz'], ['Channels', f.channel_layout],
        ['Codec', f.codec], ['Bit depth', f.bit_depth], ['Format', f.format]
      ];
      grid.innerHTML = rows.map(function (r) {
        return '<div><span>' + escapeHtml(r[0]) + '</span><strong>' + escapeHtml(String(r[1])) + '</strong></div>';
      }).join('');
    }

    const qc = j.qc_score || {};
    setText('dashQc', qc.score != null ? qc.score + '/100' : '—');
    setText('dashTp', j.true_peak && j.true_peak.value_dbtp != null ? j.true_peak.value_dbtp.toFixed(2) : '—');
    setText('dashLufs', j.loudness && j.loudness.integrated_lufs != null ? j.loudness.integrated_lufs.toFixed(1) : '—');
    setText('dashDyn', (j.dynamics && j.dynamics.lra_lu != null ? j.dynamics.lra_lu.toFixed(1) + ' LU' : '—'));
    setText('dashStereo', (j.stereo && j.stereo.stereo_width_label) || '—');
    setText('dashPhase', j.phase && j.phase.correlation != null ? ((j.phase.correlation >= 0 ? '+' : '') + j.phase.correlation.toFixed(2)) : '—');
    setText('dashClip', j.clipping && j.clipping.classification === 'NO CLIPPING' ? 'NONE' : ((j.clipping && j.clipping.classification) || '—'));
    setText('dashDelivery', j.delivery_status || '—');

    setText('overviewSummaryText', (j.executive_summary && j.executive_summary.text) || '');
    const ul = $('execFindings');
    if (ul) {
      ul.innerHTML = ((j.executive_summary && j.executive_summary.major_findings) || []).map(function (x) {
        return '<li>' + escapeHtml(x) + '</li>';
      }).join('');
    }

    renderPlatform(j);
    renderQc(j);
    renderLoudness(j);
    renderTruePeak(j);
    renderDynamics(j);
    renderTonal(j);
    renderStereo(j);
    renderCompare(j);

    const report = $('fullReportViewer');
    if (report) report.innerHTML = result.htmlReport;
    const jsonEl = $('reportJsonViewer');
    if (jsonEl) jsonEl.textContent = JSON.stringify(j, null, 2);

    setText('platformDisclaimer', (j.platform_analysis && j.platform_analysis.disclaimer) || (Profiles && Profiles.DISCLAIMER) || '');

    state.drawn = {};
    const active = document.querySelector('.v-tab-btn.active');
    drawVisible(active ? active.getAttribute('data-tab') : 'tab-report');
  }

  function renderPlatform(j) {
    const pa = j.platform_analysis || {};
    setText('platName', pa.platform_name || '—');
    setText('platStatus', pa.status || '—');
    const stEl = $('platStatus');
    if (stEl) stEl.className = 'd-status ' + deliveryClass(pa.status);
    setText('platNormNote', pa.normalization_note || '');
    setText('platRefLufs', pa.loudness_reference_lufs != null ? pa.loudness_reference_lufs + ' LUFS' : 'None (this profile)');
    setText('platRefTp', pa.true_peak_reference_dbtp != null ? pa.true_peak_reference_dbtp + ' dBTP' : '—');
    setText('platMeasLufs', pa.measured_lufs != null ? pa.measured_lufs + ' LUFS' : '—');
    setText('platMeasTp', pa.measured_true_peak_dbtp != null ? pa.measured_true_peak_dbtp + ' dBTP' : '—');
    setText('platLufsDiff', pa.loudness_difference_lu != null ? ((pa.loudness_difference_lu >= 0 ? '+' : '') + pa.loudness_difference_lu + ' LU') : '—');
    setText('platTpDiff', pa.true_peak_difference_db != null ? ((pa.true_peak_difference_db >= 0 ? '+' : '') + pa.true_peak_difference_db + ' dB') : '—');
    setText('platNorm', pa.estimated_normalization_gain_db != null ? pa.estimated_normalization_gain_db + ' dB' : '—');
    setText('platTech', pa.technical_status || '—');

    const tb = $('platformTableBody');
    if (tb) {
      tb.innerHTML = (j.platform_comparison || []).map(function (r) {
        const cls = r.status === 'READY' ? 'ok' : (r.status === 'NOT READY' ? 'bad' : 'warn');
        return '<tr><td>' + escapeHtml(r.platform_name) + '</td><td class="mono">' + na(r.measured_lufs) +
          '</td><td class="mono">' + na(r.loudness_reference_lufs) + '</td><td class="mono">' + na(r.loudness_difference_lu) +
          '</td><td class="mono">' + na(r.measured_true_peak_dbtp) + '</td><td class="mono">' + na(r.true_peak_reference_dbtp) +
          '</td><td class="mono">' + na(r.true_peak_difference_db) + '</td><td><span class="status-chip ' + cls + '">' +
          escapeHtml(r.status) + '</span></td></tr>';
      }).join('');
    }
    const ct = j.custom_target || {};
    setText('customStatus', ct.enabled ? ('Custom file checks: ' + ct.status + (ct.findings && ct.findings.length ? ' — ' + ct.findings.join(' ') : '')) : '');
  }

  function na(v) { return v == null ? '—' : v; }

  function renderQc(j) {
    const host = $('qcBreakdown');
    if (!host) return;
    const br = (j.qc_score && j.qc_score.breakdown) || {};
    host.innerHTML = Object.keys(br).map(function (k) {
      const b = br[k];
      const deds = (b.deductions || []).map(function (d) {
        return '<li>−' + d.points + ' ' + escapeHtml(d.reason) + '</li>';
      }).join('');
      return '<div class="qc-item"><div class="k">' + escapeHtml(k.replace(/_/g, ' ')) +
        '</div><div class="v">' + b.score + '</div><ul>' + deds + '</ul></div>';
    }).join('');
  }

  function renderLoudness(j) {
    const l = j.loudness || {};
    setText('dynIntegratedLufs', l.integrated_lufs != null ? l.integrated_lufs.toFixed(1) : '—');
    setText('dynShortLufs', l.short_term_max_lufs != null ? l.short_term_max_lufs.toFixed(1) : '—');
    setText('dynMomLufs', l.momentary_max_lufs != null ? l.momentary_max_lufs.toFixed(1) : '—');
    setText('dynLra', l.lra_lu != null ? l.lra_lu.toFixed(1) + ' LU' : '—');
    setText('dynMed', l.short_term_median_lufs != null ? l.short_term_median_lufs.toFixed(1) : '—');
    setText('dynConf', l.confidence || '—');
    const bits = [];
    if (l.loudest_section) bits.push('Loudest: ' + U.fmtTime(l.loudest_section.time_s) + ' · ' + l.loudest_section.lufs + ' LUFS');
    if (l.quietest_section) bits.push('Quietest: ' + U.fmtTime(l.quietest_section.time_s) + ' · ' + l.quietest_section.lufs + ' LUFS');
    if (l.loudness_jumps && l.loudness_jumps.length) bits.push(l.loudness_jumps.length + ' short-term jumps ≥ 6 LU');
    setText('loudSections', bits.join('\n') || 'No sectional extremes flagged.');
  }

  function renderTruePeak(j) {
    const tp = j.true_peak || {};
    setText('tpVal', tp.value_dbtp != null ? tp.value_dbtp.toFixed(2) : '—');
    setText('spVal', tp.sample_peak_dbfs != null ? tp.sample_peak_dbfs.toFixed(2) : '—');
    setText('ispDiff', tp.inter_sample_difference_db != null ? ((tp.inter_sample_difference_db >= 0 ? '+' : '') + tp.inter_sample_difference_db.toFixed(2) + ' dB') : '—');
    setText('tpEvents', tp.event_count != null ? String(tp.event_count) : '—');
    setText('tpNote', (tp.label || 'Estimated True Peak') + ' · ' + (tp.method || '') + ' · ' + ((tp.inter_sample_peak_risk && tp.inter_sample_peak_risk.note) || ''));
    const host = $('tpEventChips');
    if (host) {
      host.innerHTML = '';
      (tp.events || []).slice(0, 40).forEach(function (e) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'event-chip';
        b.textContent = U.fmtTime(e.start_s) + '  ' + e.peak_dbtp + ' dBTP';
        b.addEventListener('click', function () { seekTo(Math.max(0, e.start_s - 0.05)); play(); });
        host.appendChild(b);
      });
    }
  }

  function renderDynamics(j) {
    const d = j.dynamics || {};
    setText('crestVal', d.crest_factor_db != null ? d.crest_factor_db.toFixed(1) + ' dB' : '—');
    setText('plrVal', d.peak_to_loudness_ratio_db != null ? d.peak_to_loudness_ratio_db.toFixed(1) + ' dB' : '—');
    setText('lraVal', d.lra_lu != null ? d.lra_lu.toFixed(1) + ' LU' : '—');
    setText('charVal', d.dynamic_character || '—');
    setText('dynEvidence', d.evidence || '');
    setText('dynCorrNote', (j.loudness_peak_correlation && j.loudness_peak_correlation.note) || '');
  }

  function renderTonal(j) {
    const sp = j.spectrum || {};
    const gHost = $('tonalGroups');
    if (gHost) {
      gHost.innerHTML = (sp.groups || []).map(function (g) {
        return '<div class="tonal-g"><div class="n">' + escapeHtml(g.name) + '</div><div class="p">' + g.energy_percent + '%</div></div>';
      }).join('');
    }
    const tb = $('tonalTableBody');
    if (tb) {
      tb.innerHTML = (sp.regions || []).map(function (z) {
        const cls = /Elevated|Concentrated/.test(z.status) ? 'warn' : (z.status === 'Measured' ? 'ok' : 'warn');
        return '<tr><td>' + escapeHtml(z.name) + '</td><td class="mono">' + z.frequency_range_hz[0] + '–' + z.frequency_range_hz[1] +
          ' Hz</td><td class="mono">' + z.energy_percent + '%</td><td class="mono">' + z.expected_pink_percent +
          '%</td><td class="mono">' + (z.median_energy_db == null ? 'Not available' : z.median_energy_db.toFixed(1) + ' dB') +
          '</td><td><span class="status-chip ' + cls + '">' + escapeHtml(z.status) + '</span></td></tr>';
      }).join('');
    }
    const ex = $('spectralExtremes');
    if (ex) {
      ex.innerHTML = (sp.extremes || []).map(function (e) {
        return '<div class="rec-card p2"><div class="rec-title">' + escapeHtml(e.statement) + '</div></div>';
      }).join('') || '<p class="rpt-empty">No spectral extremes met the evidence thresholds.</p>';
    }
    const desc = $('spectrumDesc');
    if (desc && sp.centroid_hz != null) {
      desc.textContent = 'Centroid ' + sp.centroid_hz + ' Hz · spread ' + sp.spread_hz + ' Hz · rolloff ' + sp.rolloff_hz +
        ' Hz · flatness ' + sp.flatness + ' · density ' + sp.spectral_density + ' · FFT ' + sp.fft_size;
    }
  }

  function renderStereo(j) {
    const st = j.stereo || {};
    const ph = j.phase || {};
    const mo = j.mono_compatibility || {};
    setText('widthVal', st.applicable ? (st.stereo_width_label + ' (' + st.stereo_width_percent + '%)') : 'Mono');
    setText('midVal', st.mid_energy_dbfs != null ? st.mid_energy_dbfs + ' dBFS' : '—');
    setText('sideVal', st.side_energy_dbfs != null ? st.side_energy_dbfs + ' dBFS' : '—');
    setText('lrVal', st.lr_balance_db != null ? st.lr_balance_db + ' dB · ' + st.lr_balance_status : '—');
    setText('stereoNote', st.note || '');
    setText('phaseLabel', ph.applicable ? ('ρ = ' + ph.correlation + ' · ' + ph.interpretation) : (ph.interpretation || 'Mono'));
    const needle = $('phaseNeedle');
    if (needle && ph.correlation != null) {
      const x = ((ph.correlation + 1) / 2) * 100;
      needle.style.left = x + '%';
    }
    setText('monoBox', (mo.rating || '') + (mo.note ? ' — ' + mo.note : ''));
    const tb = $('phaseBandBody');
    if (tb) {
      tb.innerHTML = (ph.bands || []).map(function (b) {
        const cls = b.status === 'PASS' ? 'ok' : (b.status === 'FAIL' ? 'bad' : 'warn');
        return '<tr><td>' + escapeHtml(b.name) + '</td><td class="mono">' + b.correlation +
          '</td><td><span class="status-chip ' + cls + '">' + escapeHtml(b.status) + '</span></td></tr>';
      }).join('') || '<tr><td colspan="3">Not applicable (mono)</td></tr>';
    }
  }

  function kvCompare(host, cmp) {
    if (!host) return;
    if (!cmp || !cmp.enabled) {
      host.innerHTML = '<p class="rpt-empty">' + escapeHtml((cmp && cmp.note) || 'Not loaded.') + '</p>';
      return;
    }
    const rows = [
      ['Loudness difference', cmp.loudness_difference_lu != null ? cmp.loudness_difference_lu + ' LU' : '—'],
      ['True peak difference', cmp.true_peak_difference_db != null ? cmp.true_peak_difference_db + ' dB' : '—'],
      ['Crest difference', cmp.crest_difference_db != null ? cmp.crest_difference_db + ' dB' : '—'],
      ['LRA difference', cmp.lra_difference_lu != null ? cmp.lra_difference_lu + ' LU' : '—'],
      ['Centroid difference', cmp.centroid_difference_hz != null ? cmp.centroid_difference_hz + ' Hz' : '—'],
      ['Width difference', cmp.width_difference_pct != null ? cmp.width_difference_pct + ' %' : '—']
    ];
    let html = '<p class="ref-note">' + escapeHtml(cmp.label || '') + (cmp.file_name ? ' · ' + cmp.file_name : '') + '</p>';
    html += '<div class="rpt-grid">';
    rows.forEach(function (r) {
      html += '<div class="rpt-kv"><span class="rpt-k">' + escapeHtml(r[0]) + '</span><span class="rpt-v">' + escapeHtml(r[1]) + '</span></div>';
    });
    html += '</div>';
    if (cmp.loudness_matched_note) html += '<p class="chart-desc">' + escapeHtml(cmp.loudness_matched_note) + '</p>';
    host.innerHTML = html;
  }

  function renderCompare(j) {
    kvCompare($('refCompareList'), j.reference_comparison);
    kvCompare($('abCompareList'), j.ab_comparison);
  }

  async function onRefFile() {
    const input = $('refFileInput');
    if (!input.files || !input.files[0] || !state.audioBuffer) return;
    const decoded = await Loader.decodeFile(input.files[0], ensureAudio());
    state.compare.reference = {
      left: decoded.left, right: decoded.right, sampleRate: decoded.sampleRate,
      fileName: decoded.fileName, fileSize: decoded.fileSize, format: decoded.format,
      codec: decoded.codec, bitDepth: decoded.bitDepth
    };
    reanalyzeCurrent();
  }

  async function onBFile() {
    const input = $('bFileInput');
    if (!input.files || !input.files[0] || !state.audioBuffer) return;
    const decoded = await Loader.decodeFile(input.files[0], ensureAudio());
    state.compare.masterB = {
      left: decoded.left, right: decoded.right, sampleRate: decoded.sampleRate,
      fileName: decoded.fileName, fileSize: decoded.fileSize, format: decoded.format,
      codec: decoded.codec, bitDepth: decoded.bitDepth
    };
    reanalyzeCurrent();
  }

  async function reanalyzeCurrent() {
    if (!state.audioBuffer) return;
    hide($('masterProgressWrap'), false);
    const left = state.audioBuffer.getChannelData(0);
    const right = state.audioBuffer.numberOfChannels > 1 ? state.audioBuffer.getChannelData(1) : null;
    const copyL = new Float32Array(left.length); copyL.set(left);
    let copyR = null;
    if (right) { copyR = new Float32Array(right.length); copyR.set(right); }
    await runAnalysis({
      left: copyL, right: copyR, sampleRate: state.audioBuffer.sampleRate,
      fileName: state.result && state.result.json.file.name,
      fileSize: state.result && state.result.json.file.size_bytes,
      format: state.result && state.result.json.file.format,
      codec: state.result && state.result.json.file.codec,
      bitDepth: state.result && state.result.json.file.bit_depth === 'Not available' ? null : (state.result && state.result.json.file.bit_depth)
    }, { demo: state.demo });
  }

  /* ---------------- charts ---------------- */

  function canvasSize(canvas, cssH) {
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const w = Math.floor(rect.width);
    const h = Math.floor(cssH || rect.height || 260);
    if (w <= 0 || h <= 0) return null;
    const dpr = root.devicePixelRatio || 1;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }

  function drawVisible(tabId) {
    if (!state.result) return;
    if (tabId === 'tab-spectrum') drawSpectrum();
    if (tabId === 'tab-spectrogram') drawSpectrogram();
    if (tabId === 'tab-loudness') drawLoudness();
    if (tabId === 'tab-truepeak') drawTp();
    if (tabId === 'tab-dynamics') drawDyn();
    if (tabId === 'tab-tonal') drawTonal();
    if (tabId === 'tab-stereo') { drawWidth(); drawCorr(); }
    if (tabId === 'tab-waveform') drawWave();
    if (tabId === 'tab-platform') drawPlat();
  }

  function logX(f, f0, f1, x, w) {
    const a = Math.log(Math.max(f0, 20));
    const b = Math.log(Math.max(f1, f0 * 2));
    return x + (Math.log(Math.max(f, f0)) - a) / (b - a) * w;
  }

  function drawSpectrum() {
    const canvas = $('spectrumCanvas');
    const box = canvasSize(canvas, 280);
    if (!box) return;
    const vis = state.result.visualization.spectrum;
    if (!vis || !vis.freq_hz) return;
    const ctx = box.ctx, W = box.w, H = box.h;
    const pad = { l: 48, r: 16, t: 16, b: 28 };
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, W, H);
    const fMin = state.specZoom ? state.specZoom.f0 : 20;
    const fMax = state.specZoom ? state.specZoom.f1 : 20000;
    const dbMin = -96, dbMax = 0;
    const innerW = W - pad.l - pad.r;
    const innerH = H - pad.t - pad.b;
    function yOf(db) { return pad.t + (dbMax - db) / (dbMax - dbMin) * innerH; }

    ctx.strokeStyle = '#232938';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillStyle = '#5e6678';
    [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].forEach(function (f) {
      if (f < fMin || f > fMax) return;
      const x = logX(f, fMin, fMax, pad.l, innerW);
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + innerH); ctx.stroke();
      ctx.fillText(f >= 1000 ? (f / 1000) + 'k' : String(f), x - 8, H - 8);
    });
    for (let db = 0; db >= -90; db -= 12) {
      const y = yOf(db);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
      ctx.fillText(db + ' dB', 6, y + 3);
    }

    const n = vis.freq_hz.length;
    function pathOf(arr, dash) {
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < n; i++) {
        const f = vis.freq_hz[i];
        if (f < fMin || f > fMax) continue;
        const x = logX(f, fMin, fMax, pad.l, innerW);
        const y = yOf(arr[i]);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.setLineDash(dash || []);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#f5a623';
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const f = vis.freq_hz[i];
      if (f < fMin || f > fMax) continue;
      const x = logX(f, fMin, fMax, pad.l, innerW);
      if (i === 0) ctx.moveTo(x, yOf(vis.p90_db[i])); else ctx.lineTo(x, yOf(vis.p90_db[i]));
    }
    for (let i = n - 1; i >= 0; i--) {
      const f = vis.freq_hz[i];
      if (f < fMin || f > fMax) continue;
      ctx.lineTo(logX(f, fMin, fMax, pad.l, innerW), yOf(vis.p10_db[i]));
    }
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#8a90a0';
    ctx.lineWidth = 1;
    pathOf(vis.median_db, [4, 3]);
    ctx.strokeStyle = '#ffc862';
    ctx.lineWidth = 1.6;
    pathOf(vis.average_db, []);

    const tip = $('spectrumTooltip');
    canvas.onmousemove = function (ev) {
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const frac = (x - pad.l) / innerW;
      if (frac < 0 || frac > 1) { if (tip) tip.style.display = 'none'; return; }
      const f = fMin * Math.pow(fMax / fMin, frac);
      let best = 0, bestD = 1e9;
      for (let i = 0; i < n; i++) {
        const d = Math.abs(vis.freq_hz[i] - f);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (tip) {
        tip.style.display = 'block';
        tip.style.left = x + 'px';
        tip.style.top = (ev.clientY - rect.top) + 'px';
        tip.textContent = U.fmtFreq(vis.freq_hz[best]) + '  ' + vis.average_db[best].toFixed(1) + ' dB';
      }
    };
    canvas.onmouseleave = function () { if (tip) tip.style.display = 'none'; };
    let drag = null;
    canvas.onmousedown = function (ev) {
      const rect = canvas.getBoundingClientRect();
      drag = ev.clientX - rect.left;
    };
    canvas.onmouseup = function (ev) {
      if (drag == null) return;
      const rect = canvas.getBoundingClientRect();
      const x2 = ev.clientX - rect.left;
      const a = Math.min(drag, x2), b = Math.max(drag, x2);
      drag = null;
      if (b - a < 12) return;
      const fa = fMin * Math.pow(fMax / fMin, (a - pad.l) / innerW);
      const fb = fMin * Math.pow(fMax / fMin, (b - pad.l) / innerW);
      state.specZoom = { f0: Math.max(20, fa), f1: Math.min(20000, fb) };
      drawSpectrum();
    };
    const reset = $('specZoomOut');
    if (reset) reset.onclick = function () { state.specZoom = null; drawSpectrum(); };
    state.drawn.spectrum = true;
  }

  function magma(t) {
    const x = Math.max(0, Math.min(1, t));
    return [
      Math.round(255 * Math.pow(x, 0.6)),
      Math.round(80 * x + 40 * Math.pow(x, 3)),
      Math.round(20 + 160 * Math.pow(x, 1.4))
    ];
  }

  function drawSpectrogram() {
    const canvas = $('spectrogramCanvas');
    const box = canvasSize(canvas, 260);
    if (!box) return;
    const sg = state.result.visualization.spectrogram;
    if (!sg || !sg.columns || !sg.columns.length) return;
    const ctx = box.ctx, W = box.w, H = box.h;
    const img = ctx.createImageData(sg.columns.length, sg.logFreqs.length);
    let min = 0, max = -160;
    for (let x = 0; x < sg.columns.length; x++) {
      const col = sg.columns[x];
      for (let y = 0; y < col.length; y++) {
        if (col[y] > max) max = col[y];
        if (col[y] < min) min = col[y];
      }
    }
    if (max - min < 1) max = min + 1;
    for (let x = 0; x < sg.columns.length; x++) {
      const col = sg.columns[x];
      for (let y = 0; y < col.length; y++) {
        const ny = col.length - 1 - y;
        const t = (col[ny] - min) / (max - min);
        const i = (y * sg.columns.length + x) * 4;
        const c = magma(t);
        img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
      }
    }
    const tmp = document.createElement('canvas');
    tmp.width = sg.columns.length;
    tmp.height = sg.logFreqs.length;
    tmp.getContext('2d').putImageData(img, 0, 0);
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(tmp, 40, 8, W - 52, H - 28);
    ctx.fillStyle = '#5e6678';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText('20 Hz', 4, H - 14);
    ctx.fillText('20 kHz', 4, 16);
    const tip = $('sgTooltip');
    canvas.onmousemove = function (ev) {
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const fx = (x - 40) / (rect.width - 52);
      const fy = 1 - (y - 8) / (rect.height - 28);
      if (fx < 0 || fx > 1 || fy < 0 || fy > 1) { if (tip) tip.style.display = 'none'; return; }
      const t = fx * state.duration;
      const f = 20 * Math.pow(20000 / 20, fy);
      if (tip) {
        tip.style.display = 'block';
        tip.style.left = x + 'px';
        tip.style.top = y + 'px';
        tip.textContent = U.fmtTime(t) + '  ' + U.fmtFreq(f);
      }
    };
    canvas.onmouseleave = function () { if (tip) tip.style.display = 'none'; };
    canvas.onclick = function (ev) {
      const rect = canvas.getBoundingClientRect();
      const frac = (ev.clientX - rect.left - 40) / (rect.width - 52);
      if (frac >= 0 && frac <= 1 && state.duration) seekTo(frac * state.duration);
    };
    state.drawn.spectrogram = true;
  }

  function drawLoudness() {
    const canvas = $('loudnessCanvas');
    const box = canvasSize(canvas, 200);
    if (!box) return;
    let tl = state.result.visualization.loudnessTimeline || [];
    const ctx = box.ctx, W = box.w, H = box.h;
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, W, H);
    if (!tl.length) return;
    if (state.loudZoom) {
      tl = tl.filter(function (p) { return p.time_s >= state.loudZoom.t0 && p.time_s <= state.loudZoom.t1; });
      if (!tl.length) tl = state.result.visualization.loudnessTimeline;
    }
    const vals = tl.map(function (p) { return p.short_term_lufs; });
    const mn = Math.min.apply(null, vals) - 2;
    const mx = Math.max.apply(null, vals) + 2;
    ctx.strokeStyle = '#3ecf8e';
    ctx.beginPath();
    tl.forEach(function (p, i) {
      const x = (i / Math.max(1, tl.length - 1)) * (W - 50) + 44;
      const y = 10 + (mx - p.short_term_lufs) / (mx - mn) * (H - 28);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = '#5e6678';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText(mx.toFixed(0) + ' LUFS', 4, 16);
    ctx.fillText(mn.toFixed(0), 4, H - 8);
    const tip = $('loudnessTooltip');
    canvas.onmousemove = function (ev) {
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const frac = (x - 44) / (rect.width - 50);
      const i = Math.round(U.clamp(frac, 0, 1) * (tl.length - 1));
      const p = tl[i];
      if (!p || !tip) return;
      tip.style.display = 'block';
      tip.style.left = x + 'px';
      tip.style.top = (ev.clientY - rect.top) + 'px';
      tip.textContent = U.fmtTime(p.time_s) + '  ' + p.short_term_lufs + ' LUFS';
    };
    canvas.onmouseleave = function () { if (tip) tip.style.display = 'none'; };
    canvas.onclick = function (ev) {
      const rect = canvas.getBoundingClientRect();
      const frac = (ev.clientX - rect.left - 44) / (rect.width - 50);
      const i = Math.round(U.clamp(frac, 0, 1) * (tl.length - 1));
      if (tl[i]) seekTo(tl[i].time_s);
    };
    let drag = null;
    canvas.onmousedown = function (ev) { drag = ev.clientX; };
    canvas.onmouseup = function (ev) {
      if (drag == null) return;
      const dx = ev.clientX - drag;
      drag = null;
      if (Math.abs(dx) < 16) return;
      const rect = canvas.getBoundingClientRect();
      const a = U.clamp((Math.min(ev.clientX, ev.clientX - dx) - rect.left - 44) / (rect.width - 50), 0, 1);
      const b = U.clamp((Math.max(ev.clientX, ev.clientX - dx) - rect.left - 44) / (rect.width - 50), 0, 1);
      const t0 = tl[Math.round(a * (tl.length - 1))].time_s;
      const t1 = tl[Math.round(b * (tl.length - 1))].time_s;
      state.loudZoom = { t0: Math.min(t0, t1), t1: Math.max(t0, t1) };
      drawLoudness();
    };
    const reset = $('loudZoomOut');
    if (reset) reset.onclick = function () { state.loudZoom = null; drawLoudness(); };
    state.drawn.loud = true;
  }

  function drawTp() {
    const canvas = $('tpCanvas');
    const box = canvasSize(canvas, 180);
    if (!box) return;
    const tl = state.result.visualization.truePeakTimeline || [];
    const ctx = box.ctx, W = box.w, H = box.h;
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, W, H);
    if (!tl.length) return;
    ctx.strokeStyle = '#f28334';
    ctx.beginPath();
    tl.forEach(function (p, i) {
      const x = (i / Math.max(1, tl.length - 1)) * (W - 16) + 8;
      const y = 8 + (-p.sample_peak_dbfs) / 60 * (H - 20);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    const events = state.result.visualization.truePeakEvents || [];
    ctx.fillStyle = '#ff5d5d';
    events.forEach(function (e) {
      if (!state.duration) return;
      const x = 8 + (e.start_s / state.duration) * (W - 16);
      ctx.fillRect(x, 4, 2, H - 8);
    });
    state.drawn.tp = true;
  }

  function drawDyn() {
    const canvas = $('dynCanvas');
    const box = canvasSize(canvas, 180);
    if (!box) return;
    const pf = state.result.visualization.dynamicsProfile || [];
    const ctx = box.ctx, W = box.w, H = box.h;
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, W, H);
    if (!pf.length) return;
    ctx.strokeStyle = '#5ab0ff';
    ctx.beginPath();
    pf.forEach(function (p, i) {
      const x = (i / Math.max(1, pf.length - 1)) * W;
      const y = 10 + (-p.rms_dbfs) / 80 * (H - 20);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.strokeStyle = '#ffc862';
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    pf.forEach(function (p, i) {
      const x = (i / Math.max(1, pf.length - 1)) * W;
      const y = 10 + (-p.peak_dbfs) / 80 * (H - 20);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
    state.drawn.dyn = true;
  }

  function drawTonal() {
    const canvas = $('tonalCanvas');
    const box = canvasSize(canvas, 220);
    if (!box) return;
    const zones = state.result.json.spectrum.regions || [];
    const ctx = box.ctx, W = box.w, H = box.h;
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, W, H);
    const bw = (W - 20) / Math.max(1, zones.length);
    const maxP = Math.max.apply(null, zones.map(function (z) { return z.energy_percent; }).concat([1]));
    zones.forEach(function (z, i) {
      const h = Math.max(2, (z.energy_percent / maxP) * (H - 40));
      ctx.fillStyle = '#f5a623';
      ctx.fillRect(10 + i * bw + 4, H - 24 - h, bw - 8, h);
      ctx.fillStyle = 'rgba(90,176,255,0.45)';
      const eh = Math.max(1, (z.expected_pink_percent / maxP) * (H - 40));
      ctx.fillRect(10 + i * bw + 4, H - 24 - eh, bw - 8, 2);
    });
    state.drawn.tonal = true;
  }

  function drawWidth() {
    const canvas = $('widthCanvas');
    const box = canvasSize(canvas, 160);
    if (!box) return;
    const tl = state.result.visualization.widthTimeline || [];
    const ctx = box.ctx, W = box.w, H = box.h;
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, W, H);
    if (!tl.length) return;
    ctx.strokeStyle = '#9b72cf';
    ctx.beginPath();
    tl.forEach(function (p, i) {
      const x = (i / Math.max(1, tl.length - 1)) * W;
      const y = H - 8 - (p.width_percent / 60) * (H - 16);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    state.drawn.width = true;
  }

  function drawCorr() {
    const canvas = $('corrCanvas');
    const box = canvasSize(canvas, 160);
    if (!box) return;
    const tl = state.result.visualization.widthTimeline || [];
    const ctx = box.ctx, W = box.w, H = box.h;
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#232938';
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    if (!tl.length) return;
    ctx.strokeStyle = '#3ecf8e';
    ctx.beginPath();
    tl.forEach(function (p, i) {
      const x = (i / Math.max(1, tl.length - 1)) * W;
      const y = H / 2 - p.correlation * (H / 2 - 8);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    state.drawn.corr = true;
  }

  function drawWave() {
    const canvas = $('waveCanvas');
    const box = canvasSize(canvas, 160);
    if (!box) return;
    const wave = state.result.visualization.waveform || [];
    const ctx = box.ctx, W = box.w, H = box.h;
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, W, H);
    const mid = H / 2;
    ctx.strokeStyle = '#ffc862';
    ctx.beginPath();
    for (let i = 0; i < wave.length; i++) {
      const x = (i / Math.max(1, wave.length - 1)) * W;
      const y = mid - wave[i] * (H * 0.42);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    function mark(list, color, tkey) {
      ctx.fillStyle = color;
      (list || []).forEach(function (e) {
        const t = e[tkey] != null ? e[tkey] : e.start_s;
        if (t == null || !state.duration) return;
        ctx.fillRect((t / state.duration) * W, 0, 2, H);
      });
    }
    mark(state.result.visualization.clippingEvents, 'rgba(255,93,93,0.85)', 'start_s');
    mark(state.result.visualization.truePeakEvents, 'rgba(242,131,52,0.85)', 'start_s');
    const sil = state.result.visualization.silence;
    if (sil && state.duration) {
      ctx.fillStyle = 'rgba(90,176,255,0.18)';
      ctx.fillRect(0, 0, (sil.leading_seconds / state.duration) * W, H);
      ctx.fillRect(W - (sil.trailing_seconds / state.duration) * W, 0, (sil.trailing_seconds / state.duration) * W, H);
    }
    if (state.duration) {
      const px = (currentTime() / state.duration) * W;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px, 0, 1, H);
    }
    canvas.onclick = function (ev) {
      const rect = canvas.getBoundingClientRect();
      seekTo(((ev.clientX - rect.left) / rect.width) * state.duration);
    };
    state.drawn.wave = true;
  }

  function drawPlat() {
    const canvas = $('platCanvas');
    const box = canvasSize(canvas, 220);
    if (!box) return;
    const rows = state.result.json.platform_comparison || [];
    const ctx = box.ctx, W = box.w, H = box.h;
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, W, H);
    if (!rows.length) return;
    const bw = (W - 40) / rows.length;
    const measured = state.result.json.loudness.integrated_lufs;
    rows.forEach(function (r, i) {
      const ref = r.loudness_reference_lufs;
      const x = 20 + i * bw;
      ctx.fillStyle = '#2a3144';
      ctx.fillRect(x + 6, 20, bw - 14, H - 50);
      if (ref != null) {
        const y = 20 + ((-ref) / 30) * (H - 50);
        ctx.fillStyle = '#5ab0ff';
        ctx.fillRect(x + 6, y, bw - 14, 3);
      }
      if (measured != null) {
        const y = 20 + ((-measured) / 30) * (H - 50);
        ctx.fillStyle = '#ffc862';
        ctx.fillRect(x + 6, y, bw - 14, 3);
      }
      ctx.fillStyle = '#8a90a0';
      ctx.save();
      ctx.translate(x + bw / 2, H - 8);
      ctx.rotate(-0.6);
      ctx.font = '9px ui-monospace, monospace';
      ctx.fillText(r.platform_name, 0, 0);
      ctx.restore();
    });
    state.drawn.plat = true;
  }

  function boot() {
    bindUpload();
    bindTabs();
    bindPlayer();
    bindExports();
    buildPlatformChips();
    initChecklist();
    setText('platformDisclaimer', (Profiles && Profiles.DISCLAIMER) || '');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  root.MAUI = { seekTo: seekTo, state: state };
})(typeof self !== 'undefined' ? self : this);
