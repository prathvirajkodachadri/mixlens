'use strict';
/**
 * MixLens Vocal Engine 3.0 — UI controller.
 * Local playback, progressive module progress, charts from measured data only.
 */
(function (root) {
  const $ = function (id) { return document.getElementById(id); };
  const U = root.VEUtilities;
  const Analyzer = root.VEAnalyzer;
  const Loader = root.VEAudioLoader;
  const Pdf = root.VEPdf;

  if (!Analyzer || !U) {
    showBootError();
    return;
  }

  const state = {
    result: null,
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
    drawn: {},
    compare: { reference: null, instrumental: null }
  };

  function showBootError() {
    try {
      const el = document.createElement('div');
      el.id = 'mixlensBootError';
      el.className = 'analysis-error';
      el.textContent = 'Vocal Engine 3.0 failed to load. Hard-refresh (Ctrl/Cmd+Shift+R) to bypass a stale cache.';
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
    setText('vocalProgressLabel', p.label || p.stage);
    setText('vocalProgressPct', Math.round(p.percent) + '%');
    const fill = $('vocalProgressFill');
    if (fill) fill.style.width = Math.max(0, Math.min(100, p.percent)) + '%';
    const bar = $('vocalProgressBar');
    if (bar) bar.setAttribute('aria-valuenow', String(Math.round(p.percent)));
    if (p.stages) {
      p.stages.forEach(function (s) {
        const li = $('chk-' + s.id);
        if (li) li.classList.toggle('done', !!s.done);
      });
    } else if (p.stage) {
      const li = $('chk-' + p.stage);
      if (li) li.classList.add('done');
    }
  }

  function bindUpload() {
    const zone = $('vocalDropZone');
    const input = $('vocalFileInput');
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
    $('vocalPlayBtn') && $('vocalPlayBtn').addEventListener('click', play);
    $('vocalPauseBtn') && $('vocalPauseBtn').addEventListener('click', pause);
    $('vocalStopBtn') && $('vocalStopBtn').addEventListener('click', stop);
    const seek = $('vocalSeek');
    if (seek) seek.addEventListener('input', function () {
      const t = (Number(seek.value) / 1000) * state.duration;
      seekTo(t);
    });
    const vol = $('vocalVolume');
    if (vol) vol.addEventListener('input', function () {
      if (state.gain) state.gain.gain.value = Number(vol.value) / 100;
    });
    const spd = $('vocalSpeed');
    if (spd) spd.addEventListener('change', function () {
      if (state.source) state.source.playbackRate.value = Number(spd.value);
    });
  }

  function bindExports() {
    $('exportJsonBtn') && $('exportJsonBtn').addEventListener('click', function () {
      if (!state.result) return;
      downloadBlob(JSON.stringify(state.result.json, null, 2), 'mixlens-vocal-report.json', 'application/json');
    });
    $('exportTxtBtn') && $('exportTxtBtn').addEventListener('click', function () {
      if (!state.result) return;
      downloadBlob(state.result.textReport, 'mixlens-vocal-report.txt', 'text/plain');
    });
    $('copyReportBtn') && $('copyReportBtn').addEventListener('click', function () {
      if (!state.result) return;
      const txt = state.result.textReport;
      if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
        root.navigator.clipboard.writeText(txt);
      }
    });
    $('exportPdfBtn') && $('exportPdfBtn').addEventListener('click', exportPdf);
    $('refFileInput') && $('refFileInput').addEventListener('change', onRefFile);
    $('instFileInput') && $('instFileInput').addEventListener('change', onInstFile);
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
    drawVisible('tab-character');
    const spec = $('spectrumCanvas');
    const radar = $('radarCanvas');
    const images = {};
    if (spec && spec.width > 0) images.spectrum = await Pdf.canvasToJpeg(spec, 0.85);
    if (radar && radar.width > 0) images.radar = await Pdf.canvasToJpeg(radar, 0.85);
    const bytes = Pdf.buildPdf(state.result.json, images);
    downloadBlob(new Blob([bytes], { type: 'application/pdf' }), 'mixlens-vocal-report.pdf', 'application/pdf');
  }

  function currentTime() {
    if (!state.ctx) return state.pauseAt;
    if (!state.playing) return state.pauseAt;
    return Math.min(state.duration, state.pauseAt + (state.ctx.currentTime - state.startAt) * playbackRate());
  }

  function playbackRate() {
    const spd = $('vocalSpeed');
    return spd ? Number(spd.value) : 1;
  }

  function play() {
    if (!state.audioBuffer) return;
    const ctx = ensureAudio();
    ctx.resume && ctx.resume();
    stopSourceOnly();
    const src = ctx.createBufferSource();
    src.buffer = state.audioBuffer;
    src.playbackRate.value = playbackRate();
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
      try { state.source.stop(); } catch (e) { /* already stopped */ }
      try { state.source.disconnect(); } catch (e2) { /* */ }
      state.source = null;
    }
  }

  function seekTo(t) {
    state.pauseAt = Math.max(0, Math.min(state.duration, t));
    if (state.playing) play();
    else updateClock();
    if (state.drawn.timeline) drawTimeline();
  }

  function loopClock() {
    updateClock();
    if (state.playing) state.raf = requestAnimationFrame(loopClock);
  }

  function updateClock() {
    const t = currentTime();
    setText('vocalTimeLabel', U.fmtTime(t) + ' / ' + U.fmtTime(state.duration));
    const seek = $('vocalSeek');
    if (seek && state.duration) seek.value = String(Math.round((t / state.duration) * 1000));
  }

  function showError(msg) {
    const el = $('analysisError');
    if (!el) return;
    el.textContent = msg;
    hide(el, false);
  }

  function clearError() {
    hide($('analysisError'), true);
  }

  async function handleFile(file) {
    clearError();
    state.demo = false;
    hide($('demoBanner'), true);
    hide($('vocalProgressWrap'), false);
    hide($('vocalDashboard'), true);
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
        bitDepth: decoded.bitDepth
      }, { demo: false });
    } catch (err) {
      showError(err && err.message ? err.message : String(err));
      hide($('vocalProgressWrap'), true);
    }
  }

  async function loadDemo() {
    clearError();
    state.demo = true;
    hide($('vocalProgressWrap'), false);
    hide($('vocalDashboard'), true);
    initChecklist();
    applyProgress({ stage: 'load', label: 'Loading Audio', percent: 4 });
    try {
      const ctx = ensureAudio();
      const demo = Analyzer.makeDemoBuffer(48000);
      const buf = ctx.createBuffer(1, demo.left.length, demo.sampleRate);
      buf.getChannelData(0).set(demo.left);
      state.audioBuffer = buf;
      state.duration = demo.left.length / demo.sampleRate;
      await runAnalysis(demo, { demo: true });
    } catch (err) {
      showError(err && err.message ? err.message : String(err));
      hide($('vocalProgressWrap'), true);
    }
  }

  function runOnMain(input, options) {
    return Analyzer.analyze(input, options, applyProgress);
  }

  function cloneF32(arr) {
    if (!arr) return null;
    const copy = new Float32Array(arr.length);
    copy.set(arr);
    return copy;
  }

  function runInWorker(input, options) {
    return new Promise(function (resolve, reject) {
      let worker;
      try {
        worker = new Worker('js/vocal-engine/worker.js');
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
        left: left,
        right: right,
        sampleRate: input.sampleRate,
        fileName: input.fileName,
        fileSize: input.fileSize,
        format: input.format,
        codec: input.codec,
        bitDepth: input.bitDepth
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
    const opts = Object.assign({}, options || {});
    if (state.compare.reference) opts.reference = state.compare.reference;
    if (state.compare.instrumental) opts.instrumental = state.compare.instrumental;

    let result;
    try {
      result = await runInWorker(input, opts);
    } catch (e) {
      result = await runOnMain(input, opts);
    }
    state.result = result;
    renderAll(result);
    hide($('vocalProgressWrap'), true);
    hide($('vocalDashboard'), false);
    hide($('demoBanner'), !opts.demo);
    updateClock();
  }

  function renderAll(result) {
    const j = result.json;
    const f = j.file;
    setText('vocalFileName', f.name);
    setText('vocalFileMeta', [f.duration_label, f.sample_rate + ' Hz', f.channel_layout].join(' · '));
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

    setText('dashMix', j.mix_readiness.score);
    setText('dashHealth', j.recording_health.score);
    setText('dashNoise', (j.noise && j.noise.classification) || '—');
    setText('dashDyn', (j.dynamics && j.dynamics.classification) || '—');
    setText('dashSib', (j.sibilance && j.sibilance.severity) || '—');
    setText('dashClip', clipShort(j.clipping));
    setText('dashPhase', j.stereo && j.stereo.applicable ? j.stereo.phase_status : 'MONO');
    setText('dashHead', headLabel(j.technical.headroom_db));

    setText('overviewSummaryText', j.executive_summary.text || '');
    const ul = $('execFindings');
    if (ul) {
      ul.innerHTML = (j.executive_summary.major_findings || []).map(function (x) {
        return '<li>' + escapeHtml(x) + '</li>';
      }).join('');
    }

    const report = $('fullReportViewer');
    if (report) report.innerHTML = result.htmlReport;

    const jsonEl = $('reportJsonViewer');
    if (jsonEl) jsonEl.textContent = JSON.stringify(j, null, 2);

    renderTonalTable(j);
    renderResonanceTable(j);
    renderEvents(j);
    renderPitchMeta(j);
    renderHealth(j);
    renderCharacter(j);
    renderCompare(j);
    renderLoudnessMeta(j);

    state.drawn = {};
    drawVisible('tab-report');
    const active = document.querySelector('.v-tab-btn.active');
    if (active) drawVisible(active.getAttribute('data-tab'));
  }

  function clipShort(c) {
    if (!c) return '—';
    if (c.classification === 'NO CLIPPING') return 'NONE';
    if (c.classification === 'SIGNIFICANT CLIPPING') return 'SIGNIFICANT';
    return 'POSSIBLE';
  }

  function headLabel(db) {
    if (db == null) return '—';
    if (db >= 3) return 'GOOD';
    if (db >= 1) return 'OK';
    if (db >= 0.3) return 'LOW';
    return 'NONE';
  }

  function renderTonalTable(j) {
    const tb = $('tonalTableBody');
    if (!tb) return;
    tb.innerHTML = (j.tonal_zones || []).map(function (z) {
      const cls = /Elevated|Strong/.test(z.status) ? 'warn' : (z.status === 'Balanced' ? 'ok' : 'warn');
      return '<tr><td>' + escapeHtml(z.name) + '</td><td class="mono">' + escapeHtml(z.frequency_label) +
        '</td><td class="mono">' + z.energy_percent + '%</td><td class="mono">' +
        (z.median_level_db == null ? 'Not available' : z.median_level_db.toFixed(1) + ' dB') +
        '</td><td class="mono">' + (z.deviation_from_vocal_baseline_db == null ? '—' : U.fmtDb(z.deviation_from_vocal_baseline_db)) +
        '</td><td><span class="status-chip ' + cls + '">' + escapeHtml(z.status) + '</span></td></tr>';
    }).join('');
  }

  function renderResonanceTable(j) {
    const tb = $('resonancesTableBody');
    if (!tb) return;
    const rows = j.resonances || [];
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="8">Insufficient evidence for confident resonance classification.</td></tr>';
      return;
    }
    tb.innerHTML = rows.map(function (r, i) {
      return '<tr><td>' + (i + 1) + '</td><td class="mono">' + r.frequency_hz + ' Hz</td><td class="mono">' +
        U.fmtDb(r.peak_excess_db) + '</td><td class="mono">' + r.bandwidth_hz + ' Hz</td><td class="mono">' +
        r.q + '</td><td class="mono">' + r.persistence + '%</td><td class="mono">' + r.confidence +
        '%</td><td>' + escapeHtml(r.classification) + '</td></tr>';
    }).join('');
  }

  function chipList(el, events, type) {
    if (!el) return;
    el.innerHTML = '';
    (events || []).slice(0, 80).forEach(function (e) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'event-chip ' + type;
      const t = e.start_s != null ? e.start_s : e.time_s;
      b.textContent = U.fmtTime(t);
      b.setAttribute('aria-label', type + ' at ' + U.fmtTime(t));
      b.addEventListener('click', function () { seekTo(Math.max(0, t - 0.05)); play(); });
      el.appendChild(b);
    });
  }

  function renderEvents(j) {
    setText('sibCount', String(j.sibilance.event_count));
    setText('sibDomFreq', j.sibilance.dominant_frequency_hz != null ? U.fmtFreq(j.sibilance.dominant_frequency_hz) : '—');
    setText('sibVerdict', j.sibilance.severity || '—');
    setText('sibAdvice', j.sibilance.evidence || '');
    chipList($('sibEventsList'), j.sibilance.events, 'sibilance');
    setText('ploCount', String(j.plosives.event_count));
    setText('ploStrong', String(j.plosives.strong_events));
    setText('ploAdvice', j.plosives.evidence || '');
    chipList($('ploEventsList'), j.plosives.events, 'plosive');
    setText('breathCount', String(j.breaths.breath_count));
    setText('breathAvg', j.breaths.average_duration_ms != null ? j.breaths.average_duration_ms + ' ms' : '—');
    setText('breathStrong', String(j.breaths.strong_breaths));
    setText('breathAdvice', j.breaths.evidence || '');
    chipList($('breathEventsList'), j.breaths.events, 'breath');
    chipList($('timelineEventsList'), j.timeline_events, 'timeline');
  }

  function renderPitchMeta(j) {
    const p = j.pitch || {};
    setText('pitchF0Val', p.median_f0_hz != null ? p.median_f0_hz.toFixed(1) + ' Hz' : '—');
    setText('pitchNoteVal', p.primary_note || '—');
    setText('pitchVoicedPct', p.voiced_ratio != null ? (p.voiced_ratio * 100).toFixed(1) + '%' : '—');
    const v = j.vibrato || {};
    setText('pitchVibratoVal', v.rate_hz != null ? (v.rate_hz + ' Hz ±' + v.depth_cents + '¢') : (v.note || 'Unavailable'));
    setText('pitchNote', p.evidence || v.note || '');
  }

  function renderLoudnessMeta(j) {
    const l = j.loudness || {};
    const t = j.technical || {};
    setText('dynIntegratedLufs', l.integrated_lufs != null ? l.integrated_lufs.toFixed(1) : '—');
    setText('dynShortLufs', l.short_term_lufs != null ? l.short_term_lufs.toFixed(1) : '—');
    setText('dynMomLufs', l.momentary_lufs != null ? l.momentary_lufs.toFixed(1) : '—');
    setText('dynLra', l.lra_lu != null ? l.lra_lu.toFixed(1) + ' LU' : '—');
    setText('dynTp', t.true_peak_dbtp != null ? t.true_peak_dbtp.toFixed(1) : '—');
    setText('dynCrest', t.crest_factor_db != null ? t.crest_factor_db.toFixed(1) + ' dB' : '—');
    setText('dynEvidence', (j.dynamics && j.dynamics.evidence) || '');
  }

  function renderHealth(j) {
    setText('healthScoreVal', j.recording_health.score + '/100');
    setText('mixScoreVal', j.mix_readiness.score + '/100');
    setText('healthClipVal', j.clipping.classification);
    setText('healthNoiseVal', j.noise.available ? (j.noise.noise_floor_dbfs + ' dBFS / ' + j.noise.estimated_snr_db + ' dB') : 'Insufficient Signal');
    setText('healthHumVal', j.hum.detected ? (j.hum.fundamental_hz + ' Hz · ' + j.hum.confidence + '%') : 'None');
    setText('healthDcVal', j.dc_offset ? (j.dc_offset.dbfs + ' dBFS · ' + j.dc_offset.severity) : '—');
    const box = $('healthExplain');
    if (box) {
      let html = '';
      (j.recording_health.positives || []).forEach(function (x) {
        html += '<div class="rec-card p4"><div class="rec-title">✓ ' + escapeHtml(x) + '</div></div>';
      });
      (j.recording_health.issues || []).forEach(function (x) {
        html += '<div class="rec-card p2"><div class="rec-title">⚠ ' + escapeHtml(x) + '</div></div>';
      });
      (j.mix_readiness.contributing_factors || []).forEach(function (x) {
        html += '<div class="rec-evidence">' + escapeHtml(x.reason) + (x.points ? ' (−' + x.points + ')' : '') + '</div>';
      });
      box.innerHTML = html;
    }
    const st = j.stereo || {};
    const needle = $('phaseNeedle');
    const lab = $('phaseLabel');
    if (needle && st.applicable) {
      const x = ((1 - st.correlation) / 2) * 100;
      needle.style.left = x + '%';
    }
    if (lab) lab.textContent = st.applicable ? ('ρ = ' + st.correlation + ' · ' + st.mono_compatibility) : (st.note || 'Mono');
  }

  function renderCharacter(j) {
    const grid = $('overviewCharGrid');
    const scores = (j.character_profile && j.character_profile.scores) || {};
    if (!grid) return;
    grid.innerHTML = Object.keys(scores).map(function (k) {
      const v = scores[k];
      return '<div class="char-card"><div class="char-head"><span class="char-name">' + escapeHtml(k.replace(/_/g, ' ')) +
        '</span><span class="char-val">' + v + '</span></div><div class="char-bar-track"><div class="char-bar-fill" style="width:' + v + '%"></div></div></div>';
    }).join('');
  }

  function renderCompare(j) {
    const ref = $('refCompareList');
    const mask = $('maskingList');
    if (ref) {
      const r = j.reference_comparison || {};
      if (!r.enabled) ref.innerHTML = '<p class="rpt-empty">' + escapeHtml(r.note || 'No reference vocal loaded.') + '</p>';
      else {
        ref.innerHTML = (r.zones || []).map(function (z) {
          return '<div class="rec-card"><div class="rec-title">' + escapeHtml(z.name) + '</div><div class="rec-evidence">Your vocal: ' +
            (z.your_vocal_relative_db == null ? 'n/a' : U.fmtDb(z.your_vocal_relative_db) + ' relative') + '</div></div>';
        }).join('');
      }
    }
    if (mask) {
      const m = j.masking || {};
      if (!m.enabled) mask.innerHTML = '<p class="rpt-empty">' + escapeHtml(m.note || 'No instrumental file loaded.') + '</p>';
      else {
        mask.innerHTML = (m.collisions || []).map(function (c) {
          return '<div class="rec-card"><div class="rec-title">' + escapeHtml(c.region) + ' · ' + escapeHtml(c.collision) +
            '</div><div class="rec-evidence">' + escapeHtml(c.evidence) + '</div></div>';
        }).join('');
      }
    }
  }

  async function onRefFile() {
    const input = $('refFileInput');
    if (!input.files || !input.files[0] || !state.audioBuffer) return;
    const decoded = await Loader.decodeFile(input.files[0], ensureAudio());
    state.compare.reference = { left: decoded.left, right: decoded.right, sampleRate: decoded.sampleRate };
    reanalyzeCurrent();
  }

  async function onInstFile() {
    const input = $('instFileInput');
    if (!input.files || !input.files[0] || !state.audioBuffer) return;
    const decoded = await Loader.decodeFile(input.files[0], ensureAudio());
    state.compare.instrumental = { left: decoded.left, right: decoded.right, sampleRate: decoded.sampleRate };
    reanalyzeCurrent();
  }

  async function reanalyzeCurrent() {
    if (!state.audioBuffer) return;
    hide($('vocalProgressWrap'), false);
    const left = state.audioBuffer.getChannelData(0);
    const right = state.audioBuffer.numberOfChannels > 1 ? state.audioBuffer.getChannelData(1) : null;
    const copyL = new Float32Array(left.length); copyL.set(left);
    let copyR = null;
    if (right) { copyR = new Float32Array(right.length); copyR.set(right); }
    await runAnalysis({
      left: copyL,
      right: copyR,
      sampleRate: state.audioBuffer.sampleRate,
      fileName: state.result && state.result.json.file.name,
      fileSize: state.result && state.result.json.file.size_bytes,
      format: state.result && state.result.json.file.format,
      codec: state.result && state.result.json.file.codec,
      bitDepth: state.result && state.result.json.file.bit_depth
    }, { demo: state.demo });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
    if (tabId === 'tab-timeline') drawTimeline();
    if (tabId === 'tab-tonal') drawTonal();
    if (tabId === 'tab-resonances') drawResonance();
    if (tabId === 'tab-loudness') drawLoudness();
    if (tabId === 'tab-pitch') drawPitch();
    if (tabId === 'tab-character') drawRadar();
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
      const y = yOf(vis.p90_db[i]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    for (let i = n - 1; i >= 0; i--) {
      const f = vis.freq_hz[i];
      if (f < fMin || f > fMax) continue;
      const x = logX(f, fMin, fMax, pad.l, innerW);
      ctx.lineTo(x, yOf(vis.p10_db[i]));
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

    const desc = $('spectrumDesc');
    if (desc) {
      const sp = state.result.json.spectrum;
      desc.textContent = 'Centroid ' + sp.centroid_hz + ' Hz · spread ' + sp.spread_hz + ' Hz · rolloff ' + sp.rolloff_hz + ' Hz · flatness ' + sp.flatness + ' · FFT ' + sp.fft_size;
    }
    state.drawn.spectrum = true;
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
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tmp, 40, 8, W - 52, H - 28);
    ctx.fillStyle = '#5e6678';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText('20 Hz', 4, H - 14);
    ctx.fillText('20 kHz', 4, 16);
    canvas.onclick = function (ev) {
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const frac = (x - 40) / (rect.width - 52);
      if (frac >= 0 && frac <= 1 && state.duration) seekTo(frac * state.duration);
    };
    state.drawn.spectrogram = true;
  }

  function magma(t) {
    const x = Math.max(0, Math.min(1, t));
    return [
      Math.round(255 * Math.pow(x, 0.6)),
      Math.round(80 * x + 40 * Math.pow(x, 3)),
      Math.round(20 + 160 * Math.pow(x, 1.4))
    ];
  }

  function drawTimeline() {
    const canvas = $('timelineCanvas');
    const box = canvasSize(canvas, 150);
    if (!box) return;
    const wave = state.result.visualization.waveform || [];
    const events = state.result.visualization.events || [];
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
    const colors = { sibilance: '#ff5d5d', plosive: '#f28334', breath: '#3ecfcf', clipping: '#ff5d5d', loud: '#f5a623', quiet: '#5ab0ff' };
    events.forEach(function (e) {
      if (e.time_s == null || !state.duration) return;
      const x = (e.time_s / state.duration) * W;
      ctx.fillStyle = colors[e.type] || '#9aa1b2';
      ctx.fillRect(x, 0, 2, H);
    });
    if (state.duration) {
      const px = (currentTime() / state.duration) * W;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px, 0, 1, H);
    }
    canvas.onclick = function (ev) {
      const rect = canvas.getBoundingClientRect();
      const frac = (ev.clientX - rect.left) / rect.width;
      seekTo(frac * state.duration);
    };
    state.drawn.timeline = true;
  }

  function drawTonal() {
    const canvas = $('tonalCanvas');
    const box = canvasSize(canvas, 220);
    if (!box) return;
    const zones = state.result.json.tonal_zones || [];
    const ctx = box.ctx, W = box.w, H = box.h;
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, W, H);
    const pad = 36;
    const bw = (W - 20) / Math.max(1, zones.length);
    zones.forEach(function (z, i) {
      const dev = z.deviation_from_vocal_baseline_db || 0;
      const mid = H / 2;
      const h = Math.max(2, Math.min(mid - 10, Math.abs(dev) * 8));
      ctx.fillStyle = dev >= 0 ? '#f5a623' : '#5ab0ff';
      const y = dev >= 0 ? mid - h : mid;
      ctx.fillRect(10 + i * bw + 4, y, bw - 8, h);
      ctx.fillStyle = '#5e6678';
      ctx.save();
      ctx.translate(10 + i * bw + bw / 2, H - 8);
      ctx.rotate(-0.6);
      ctx.font = '9px ui-monospace, monospace';
      ctx.fillText(z.name, 0, 0);
      ctx.restore();
    });
    ctx.strokeStyle = '#232938';
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    state.drawn.tonal = true;
  }

  function drawResonance() {
    const canvas = $('resonanceCanvas');
    const box = canvasSize(canvas, 200);
    if (!box) return;
    const vis = state.result.visualization.spectrum;
    const res = state.result.json.resonances || [];
    const ctx = box.ctx, W = box.w, H = box.h;
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, W, H);
    if (vis && vis.freq_hz) {
      ctx.strokeStyle = '#3a4258';
      ctx.beginPath();
      for (let i = 0; i < vis.freq_hz.length; i++) {
        const x = logX(vis.freq_hz[i], 20, 20000, 40, W - 56);
        const y = 16 + (-vis.average_db[i]) / 96 * (H - 36);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    res.forEach(function (r) {
      const x = logX(r.frequency_hz, 20, 20000, 40, W - 56);
      ctx.strokeStyle = 'rgba(255,93,93,0.85)';
      ctx.beginPath(); ctx.moveTo(x, 10); ctx.lineTo(x, H - 16); ctx.stroke();
      ctx.fillStyle = '#ffc862';
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(Math.round(r.frequency_hz) + ' Hz', x + 4, 18);
    });
    state.drawn.res = true;
  }

  function drawLoudness() {
    const canvas = $('loudnessCanvas');
    const box = canvasSize(canvas, 180);
    if (!box) return;
    const tl = state.result.visualization.loudnessTimeline || [];
    const ctx = box.ctx, W = box.w, H = box.h;
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, W, H);
    if (!tl.length) return;
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
    state.drawn.loud = true;
  }

  function drawPitch() {
    const canvas = $('pitchCanvas');
    const box = canvasSize(canvas, 220);
    if (!box) return;
    const c = state.result.visualization.pitchContour || [];
    const ctx = box.ctx, W = box.w, H = box.h;
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, W, H);
    const voiced = c.filter(function (p) { return p.voiced && p.frequency_hz; });
    if (!voiced.length) {
      ctx.fillStyle = '#8a90a0';
      ctx.fillText('Insufficient reliable voiced material.', 16, H / 2);
      return;
    }
    const minF = Math.min.apply(null, voiced.map(function (p) { return p.frequency_hz; })) * 0.9;
    const maxF = Math.max.apply(null, voiced.map(function (p) { return p.frequency_hz; })) * 1.1;
    const dur = state.duration || voiced[voiced.length - 1].time_s;
    ctx.strokeStyle = '#5ab0ff';
    ctx.beginPath();
    let pen = false;
    c.forEach(function (p) {
      if (!p.voiced || !p.frequency_hz) { pen = false; return; }
      const x = 40 + (p.time_s / dur) * (W - 56);
      const y = 12 + (maxF - p.frequency_hz) / (maxF - minF) * (H - 32);
      if (!pen) { ctx.moveTo(x, y); pen = true; }
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = '#5e6678';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText(maxF.toFixed(0) + ' Hz', 4, 16);
    ctx.fillText(minF.toFixed(0) + ' Hz', 4, H - 8);
    state.drawn.pitch = true;
  }

  function drawRadar() {
    const canvas = $('radarCanvas');
    const box = canvasSize(canvas, 320);
    if (!box) return;
    const scores = state.result.json.character_profile.scores || {};
    const keys = Object.keys(scores);
    const ctx = box.ctx, W = box.w, H = box.h;
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2 + 6, r = Math.min(W, H) * 0.36;
    const n = keys.length;
    ctx.strokeStyle = '#232938';
    for (let ring = 1; ring <= 4; ring++) {
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const a = -Math.PI / 2 + (i % n) * 2 * Math.PI / n;
        const x = cx + Math.cos(a) * r * ring / 4;
        const y = cy + Math.sin(a) * r * ring / 4;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.stroke();
    }
    ctx.beginPath();
    keys.forEach(function (k, i) {
      const a = -Math.PI / 2 + i * 2 * Math.PI / n;
      const rr = r * (scores[k] / 100);
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = 'rgba(245,166,35,0.28)';
    ctx.strokeStyle = '#ffc862';
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#c9c4b8';
    ctx.font = '11px sans-serif';
    keys.forEach(function (k, i) {
      const a = -Math.PI / 2 + i * 2 * Math.PI / n;
      const x = cx + Math.cos(a) * (r + 18);
      const y = cy + Math.sin(a) * (r + 18);
      ctx.textAlign = 'center';
      ctx.fillText(k.replace(/_/g, ' '), x, y);
    });
    state.drawn.radar = true;
  }

  function boot() {
    bindUpload();
    bindTabs();
    bindPlayer();
    bindExports();
    initChecklist();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  root.VEUI = { seekTo: seekTo, state: state };
})(typeof self !== 'undefined' ? self : this);
