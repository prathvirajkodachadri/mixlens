'use strict';
/**
 * MixLens Vocal Analysis Engine — UI Controller & Canvas Visualizers
 * - Interactive logarithmic spectrum analyzer with tonal zones & EQ curve overlay
 * - High-resolution Time vs Frequency spectrogram heatmap
 * - Synchronized multi-lane timeline with clickable vocal event markers
 * - F0 pitch intonation & vibrato graph
 * - DAW transport audio player with seek & event jumping
 * - Real-time demo audio synthesizer
 * - Deterministic report export & FabFilter Pro-Q 4 preset downloads
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['./dsp', './engine', './proq'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./dsp'), require('./engine'), require('./proq'));
  } else {
    root.VocalUI = factory(root.VocalDSP, root.VocalEngine, root.VocalProQ);
  }
}(typeof self !== 'undefined' ? self : this, function(DSP, Engine, ProQ) {

  const $ = id => document.getElementById(id);
  const { fmtFreq, fmtDb, freqToNote } = DSP;

  // Global state
  let currentAudioBuffer = null;
  let currentAnalysisResult = null;
  let audioCtx = null;
  let sourceNode = null;
  let isPlaying = false;
  let playStartTime = 0;
  let playStartOffset = 0;
  let animFrameId = null;

  /**
   * Initialize UI bindings and drag/drop handlers
   */
  function init() {
    setupDropzone();
    setupTabs();
    setupTransport();
    setupExportButtons();
    setupDemoButton();
    setupOptionalDropzones();
  }

  /* =========================================================================
     1. DROPZONE & FILE LOADING
     ========================================================================= */

  function setupDropzone() {
    const dz = $('vocalDropZone');
    const fileInput = $('vocalFileInput');
    if (!dz || !fileInput) return;

    dz.addEventListener('click', (e) => {
      // The file input lives inside the dropzone, so ignore its bubbling click
      // rather than recursively calling fileInput.click().
      if (e.target !== fileInput) fileInput.click();
    });
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleAudioFile(file);
    });

    dz.addEventListener('dragover', (e) => {
      e.preventDefault();
      dz.classList.add('drag-over');
    });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) handleAudioFile(file);
    });
  }

  async function handleAudioFile(file) {
    showProgress(true);
    updateProgress('Reading audio file…', 10);

    let decodedBuffer;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') await audioCtx.resume();

      const arrayBuffer = await file.arrayBuffer();
      updateProgress('Decoding audio data…', 20);
      decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);

      if (!decodedBuffer || !Number.isFinite(decodedBuffer.duration) || decodedBuffer.duration <= 0) {
        throw new Error('The file contains no decodable audio samples.');
      }
    } catch (err) {
      console.error('Error reading or decoding audio:', err);
      alert('Failed to decode audio file: ' + (err.message || 'Unknown format or corrupted audio.'));
      showProgress(false);
      return;
    }

    currentAudioBuffer = decodedBuffer;
    const fileMeta = {
      name: file.name,
      size: file.size,
      type: file.type,
      bitDepth: file.name.toLowerCase().endsWith('.wav') ? 24 : 16
    };

    try {
      await runAnalysisPipeline(decodedBuffer, fileMeta);
    } catch (err) {
      console.error('Error analyzing audio:', err);
      alert('Audio decoded successfully, but analysis failed: ' + (err.message || 'Unknown analysis error.'));
      showProgress(false);
    }
  }

  /* =========================================================================
     2. SYNTHETIC DEMO VOCAL GENERATOR
     ========================================================================= */

  function setupDemoButton() {
    const btn = $('loadDemoBtn');
    if (!btn) return;

    btn.addEventListener('click', async () => {
      showProgress(true);
      updateProgress('Synthesizing demo vocal phrase…', 15);

      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') await audioCtx.resume();

      const fs = 48000;
      const duration = 6.0;
      const totalSamples = fs * duration;
      const buffer = audioCtx.createBuffer(1, totalSamples, fs);
      const ch = buffer.getChannelData(0);

      // Generate rich synthetic vocal phrase with vowels, vibrato, sibilance, and plosives
      for (let i = 0; i < totalSamples; i++) {
        const t = i / fs;
        let s = 0;

        // Phrase 1: 0.5s - 2.5s ("Ah" vowel with A3 pitch 220 Hz and gentle vibrato)
        if (t >= 0.5 && t <= 2.5) {
          const env = Math.sin(Math.PI * (t - 0.5) / 2.0);
          const vibrato = 4 * Math.sin(2 * Math.PI * 5.4 * t);
          const f0 = 220 + vibrato;
          s += 0.28 * Math.sin(2 * Math.PI * f0 * t) * env;
          s += 0.18 * Math.sin(2 * Math.PI * 2 * f0 * t) * env;
          s += 0.12 * Math.sin(2 * Math.PI * 3 * f0 * t) * env;
          s += 0.08 * Math.sin(2 * Math.PI * 4 * f0 * t) * env;
          s += 0.05 * Math.sin(2 * Math.PI * 5 * f0 * t) * env;
        }

        // Plosive 'P' at 0.48s
        if (t >= 0.45 && t <= 0.52) {
          s += 0.55 * Math.sin(2 * Math.PI * 52 * (t - 0.45));
        }

        // Sibilant 'S' burst at 2.4s - 2.55s (7.4 kHz noise burst)
        if (t >= 2.4 && t <= 2.55) {
          s += 0.38 * (Math.random() * 2 - 1) * Math.sin(2 * Math.PI * 7400 * t);
        }

        // Breath inhalation at 2.8s - 3.2s
        if (t >= 2.8 && t <= 3.2) {
          s += 0.08 * (Math.random() * 2 - 1) * Math.sin(2 * Math.PI * 1800 * t);
        }

        // Phrase 2: 3.3s - 5.5s ("Ee/Oh" loud belting note with upper-mid harshness at 3.3 kHz)
        if (t >= 3.3 && t <= 5.5) {
          const env = Math.sin(Math.PI * (t - 3.3) / 2.2);
          const vibrato = 6 * Math.sin(2 * Math.PI * 5.8 * t);
          const f0 = 261.63 + vibrato; // C4 note
          s += 0.42 * Math.sin(2 * Math.PI * f0 * t) * env;
          s += 0.26 * Math.sin(2 * Math.PI * 2 * f0 * t) * env;
          s += 0.20 * Math.sin(2 * Math.PI * 3 * f0 * t) * env;
          s += 0.15 * Math.sin(2 * Math.PI * 4 * f0 * t) * env;
          // Loud belting harshness surge at 3300 Hz
          s += 0.25 * Math.sin(2 * Math.PI * 3300 * t) * env;
        }

        ch[i] = s;
      }

      currentAudioBuffer = buffer;
      const fileMeta = {
        name: 'Demo_Lead_Vocal_Session.wav',
        size: 576000,
        type: 'audio/wav',
        bitDepth: 24
      };

      await runAnalysisPipeline(buffer, fileMeta);
    });
  }

  /* =========================================================================
     3. MASTER ANALYSIS PIPELINE RUNNER
     ========================================================================= */

  async function runAnalysisPipeline(audioBuffer, fileMeta, options = {}) {
    showProgress(true);

    const result = await Engine.analyzeVocal(
      audioBuffer,
      fileMeta,
      ({ stage, percent }) => {
        updateProgress(stage, percent);
      },
      options
    );

    currentAnalysisResult = result;
    showProgress(false);
    showDashboard(true);

    // Populate File Meta
    renderFileMeta(result.reportJson.file);

    // Populate Overview
    renderOverview(result);

    // Populate Tabs
    renderSpectrumTab(result);
    renderSpectrogramTab(result);
    renderTimelineTab(result);
    renderTonalTab(result);
    renderResonancesTab(result);
    renderDynamicsTab(result);
    renderSibilanceTab(result);
    renderPlosivesTab(result);
    renderBreathTab(result);
    renderPitchTab(result);
    renderHealthTab(result);
    renderMaskingTab(result);
    renderReferenceTab(result);
    renderRecommendationsTab(result);
    renderEqPlanTab(result);
    renderJsonTab(result);
  }

  /* =========================================================================
     4. PROGRESS & DASHBOARD DISPLAY
     ========================================================================= */

  function showProgress(show) {
    const wrap = $('vocalProgressWrap');
    if (wrap) wrap.classList.toggle('hidden', !show);
  }

  function updateProgress(label, pct) {
    const lblEl = $('vocalProgressLabel');
    const pctEl = $('vocalProgressPct');
    const fillEl = $('vocalProgressFill');
    if (lblEl) lblEl.textContent = label;
    if (pctEl) pctEl.textContent = Math.round(pct) + '%';
    if (fillEl) fillEl.style.width = Math.round(pct) + '%';
  }

  function showDashboard(show) {
    const dash = $('vocalDashboard');
    if (dash) dash.classList.toggle('hidden', !show);
  }

  /**
   * Prepare a canvas for crisp, responsive drawing.
   *
   * Hidden tab panels have a 0 × 0 bounding box. Browsers reject
   * createImageData(0, 0), so callers must defer drawing until the tab is
   * visible instead of treating that rendering error as an audio decode error.
   */
  function prepareCanvas(canvas) {
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const rawDpr = Number(window.devicePixelRatio) || 1;
    const dpr = Math.max(1, Math.min(3, rawDpr));
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));

    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    ctx.scale(dpr, dpr);

    return { ctx, width, height, pixelWidth, pixelHeight, dpr };
  }

  function renderFileMeta(file) {
    const nameEl = $('vocalFileName');
    const metaEl = $('vocalFileMeta');
    if (nameEl) nameEl.textContent = file.name;
    if (metaEl) {
      metaEl.textContent = `${file.duration.toFixed(1)}s · ${file.sampleRate} Hz · ${file.channels === 1 ? 'Mono' : 'Stereo'} · ${file.bitDepth}-bit · Peak: ${fmtDb(file.peakDb)} · RMS: ${fmtDb(file.rmsDb)} · ${file.integratedLufs.toFixed(1)} LUFS`;
    }
  }

  /* =========================================================================
     5. TAB CONTROLLER
     ========================================================================= */

  function setupTabs() {
    const tabBtns = document.querySelectorAll('.v-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const targetTab = btn.getAttribute('data-tab');
        document.querySelectorAll('.v-tab-content').forEach(content => {
          content.classList.toggle('hidden', content.id !== targetTab);
        });

        // Trigger canvas resize/redraw if needed
        if (targetTab === 'tab-spectrum') drawSpectrum();
        if (targetTab === 'tab-spectrogram') drawSpectrogram();
        if (targetTab === 'tab-timeline') drawTimeline();
        if (targetTab === 'tab-pitch') drawPitchPlot();
        if (targetTab === 'tab-eqplan') drawEqCurve();
      });
    });
  }

  /* =========================================================================
     6. RENDERERS FOR ALL TABS
     ========================================================================= */

  // OVERVIEW TAB
  function renderOverview(result) {
    const { reportJson, raw } = result;

    // Mix Readiness Score
    const scoreValEl = $('overviewScoreVal');
    if (scoreValEl) {
      scoreValEl.textContent = reportJson.mixReadinessScore;
      scoreValEl.style.color = reportJson.mixReadinessScore >= 80 ? 'var(--v-green)' : (reportJson.mixReadinessScore >= 60 ? 'var(--v-amber)' : 'var(--v-red)');
    }

    // Executive Summary
    const summaryTextEl = $('overviewSummaryText');
    if (summaryTextEl) summaryTextEl.textContent = reportJson.executiveSummary;

    // Character Radar Grid
    const charGrid = $('overviewCharGrid');
    if (charGrid) {
      const scores = reportJson.tonalProfile.scores;
      charGrid.innerHTML = Object.entries(scores).map(([k, v]) => `
        <div class="char-card">
          <div class="char-head">
            <span class="char-name">${k}</span>
            <span class="char-val">${v}/100</span>
          </div>
          <div class="char-bar-track">
            <div class="char-bar-fill" style="width: ${v}%;"></div>
          </div>
        </div>
      `).join('');
    }

    // Top Recommendations
    const topRecsList = $('overviewTopRecs');
    if (topRecsList) {
      topRecsList.innerHTML = reportJson.recommendations.slice(0, 4).map(r => renderRecommendationCard(r)).join('');
    }
  }

  function renderRecommendationCard(r) {
    const pClass = r.priority.toLowerCase();
    const actionClass = r.action.toLowerCase();
    return `
      <div class="rec-card ${pClass}">
        <div class="rec-header">
          <div class="rec-title-wrap">
            <span class="p-badge ${pClass}">${r.priority}</span>
            <span class="action-pill ${actionClass}">${r.action}</span>
            <span class="rec-title">${r.title}</span>
          </div>
          <span class="status-chip ${r.confidence >= 0.85 ? 'ok' : 'warn'}">Conf: ${Math.round(r.confidence * 100)}%</span>
        </div>
        <div class="rec-body">${r.reason}</div>
        <div class="rec-evidence"><b>Evidence:</b> ${r.evidence}</div>
        <div class="rec-advice"><b>Action:</b> ${r.actionAdvice}</div>
      </div>
    `;
  }

  // SPECTRUM TAB & CANVAS
  function renderSpectrumTab(result) {
    drawSpectrum();
    setupSpectrumTooltip();
  }

  function drawSpectrum() {
    const canvas = $('spectrumCanvas');
    if (!canvas || !currentAnalysisResult) return;
    const prepared = prepareCanvas(canvas);
    if (!prepared) return;

    const { ctx, width: w, height: h } = prepared;
    const { spectrum, tonal, decision } = currentAnalysisResult.raw;
    const { frequencies, avgSpectrumDb, medianSpectrumDb, p90SpectrumDb } = spectrum;

    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, w, h);

    const minF = 20, maxF = 20000;
    const minDb = -90, maxDb = 0;
    const freqToX = f => (Math.log10(Math.max(minF, f) / minF) / Math.log10(maxF / minF)) * w;
    const dbToY = db => h - ((Math.max(minDb, Math.min(maxDb, db)) - minDb) / (maxDb - minDb)) * h;

    // Draw Tonal Zones background shading
    tonal.zones.forEach((z, i) => {
      const x1 = freqToX(z.from);
      const x2 = freqToX(z.to);
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'rgba(0,0,0,0.2)';
      ctx.fillRect(x1, 0, x2 - x1, h);

      // Zone label at bottom
      ctx.fillStyle = 'rgba(154, 161, 178, 0.4)';
      ctx.font = '10px sans-serif';
      ctx.fillText(z.name, x1 + 4, h - 8);
    });

    // Draw grid lines
    ctx.strokeStyle = '#1b202d';
    ctx.lineWidth = 1;
    [50, 100, 250, 500, 1000, 2500, 5000, 10000].forEach(f => {
      const x = freqToX(f);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();

      ctx.fillStyle = '#4f566b';
      ctx.font = '10px var(--v-mono)';
      ctx.fillText(fmtFreq(f), x + 3, 14);
    });

    [-12, -24, -36, -48, -60, -72].forEach(db => {
      const y = dbToY(db);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();

      ctx.fillStyle = '#4f566b';
      ctx.font = '10px var(--v-mono)';
      ctx.fillText(db + ' dB', 6, y - 3);
    });

    // Draw 90th percentile envelope
    ctx.strokeStyle = 'rgba(255, 200, 98, 0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    for (let k = 0; k < frequencies.length; k++) {
      const x = freqToX(frequencies[k]);
      const y = dbToY(p90SpectrumDb[k]);
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw Average Spectrum (Solid Cyan Line with Gradient Fill)
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(62, 207, 207, 0.25)');
    grad.addColorStop(1, 'rgba(62, 207, 207, 0.0)');

    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let k = 0; k < frequencies.length; k++) {
      const x = freqToX(frequencies[k]);
      const y = dbToY(avgSpectrumDb[k]);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.strokeStyle = '#3ecfcf';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let k = 0; k < frequencies.length; k++) {
      const x = freqToX(frequencies[k]);
      const y = dbToY(avgSpectrumDb[k]);
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Draw EQ Response Overlay (Yellow line)
    if (decision.eqPlan && decision.eqPlan.length > 0) {
      ctx.strokeStyle = 'var(--v-amber)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x < w; x += 2) {
        const f = minF * Math.pow(maxF / minF, x / w);
        let totalGain = 0;
        for (const band of decision.eqPlan) {
          if (band.type === 'hpf') {
            if (f < band.frequency) {
              const oct = Math.log2(band.frequency / f);
              totalGain -= oct * 18;
            }
          } else if (band.type === 'bell' || band.type === 'peaking') {
            const ratio = f / band.frequency;
            const logRatio = Math.log2(ratio);
            const g = band.gain / (1 + Math.pow(logRatio * band.q * 2, 2));
            totalGain += g;
          } else if (band.type === 'highshelf') {
            if (f >= band.frequency) totalGain += band.gain;
            else if (f > band.frequency * 0.5) totalGain += band.gain * (f - band.frequency * 0.5) / (band.frequency * 0.5);
          }
        }
        const eqY = dbToY(-36 + totalGain); // Offset to center at -36 dB
        if (x === 0) ctx.moveTo(x, eqY); else ctx.lineTo(x, eqY);
      }
      ctx.stroke();
    }
  }

  function setupSpectrumTooltip() {
    const canvas = $('spectrumCanvas');
    const tooltip = $('spectrumTooltip');
    if (!canvas || !tooltip) return;

    canvas.addEventListener('mousemove', (e) => {
      if (!currentAnalysisResult) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const w = rect.width;
      const h = rect.height;

      const minF = 20, maxF = 20000;
      const freq = minF * Math.pow(maxF / minF, x / w);
      const db = -90 + (1 - y / h) * 90;
      const note = freqToNote(freq);

      const zone = currentAnalysisResult.raw.tonal.zones.find(z => freq >= z.from && freq <= z.to);
      const zoneName = zone ? zone.name : '';

      tooltip.style.display = 'block';
      tooltip.style.left = `${x}px`;
      tooltip.style.top = `${y}px`;
      tooltip.innerHTML = `<b>${fmtFreq(freq)}</b> (${note.note}) · ${fmtDb(db)}<br><span style="color:var(--v-amber)">${zoneName}</span>`;
    });

    canvas.addEventListener('mouseleave', () => {
      tooltip.style.display = 'none';
    });
  }

  // SPECTROGRAM TAB
  function renderSpectrogramTab(result) {
    drawSpectrogram();
  }

  function drawSpectrogram() {
    const canvas = $('spectrogramCanvas');
    if (!canvas || !currentAnalysisResult) return;
    const prepared = prepareCanvas(canvas);
    if (!prepared) return;

    const { ctx, width: w, height: h, pixelWidth, pixelHeight } = prepared;
    const { spectrum, events } = currentAnalysisResult.raw;
    const { timeFrames, numBins } = spectrum;

    if (!timeFrames.length) return;

    // ImageData uses backing-store pixels and ignores the context transform.
    // Rendering at the physical canvas size keeps the heatmap sharp on HiDPI
    // displays while vector overlays below continue to use CSS coordinates.
    const imgData = ctx.createImageData(pixelWidth, pixelHeight);
    const data = imgData.data;

    const minF = 50, maxF = 18000;
    const totalDuration = timeFrames[timeFrames.length - 1].time;
    const safeDuration = totalDuration > 0 ? totalDuration : 1;

    for (let px = 0; px < pixelWidth; px++) {
      const t = (px / pixelWidth) * safeDuration;
      // Find nearest frame
      const frameIdx = Math.min(timeFrames.length - 1, Math.max(0, Math.floor((t / safeDuration) * timeFrames.length)));
      const frame = timeFrames[frameIdx];

      for (let py = 0; py < pixelHeight; py++) {
        // Logarithmic frequency mapping
        const f = minF * Math.pow(maxF / minF, (pixelHeight - py) / pixelHeight);
        const bin = Math.min(numBins - 1, Math.max(0, Math.round(f / spectrum.binWidth)));
        const db = frame.magDb ? frame.magDb[bin] : -100;

        // Normalized intensity (0 to 1 for -90 to -10 dBFS)
        const intensity = Math.max(0, Math.min(1, (db + 90) / 80));

        // Magma / Studio colormap
        const r = Math.round(255 * Math.pow(intensity, 0.8));
        const g = Math.round(200 * Math.pow(intensity, 1.8));
        const b = Math.round(255 * Math.pow(intensity, 3.5));

        const pixelIdx = (py * pixelWidth + px) * 4;
        data[pixelIdx] = r;
        data[pixelIdx + 1] = g;
        data[pixelIdx + 2] = b;
        data[pixelIdx + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);

    // Overlay event markers
    if (events && events.allEvents) {
      events.allEvents.forEach(ev => {
        const x = (ev.start / safeDuration) * w;
        ctx.strokeStyle = ev.type === 'sibilance' ? 'var(--v-red)' : (ev.type === 'plosive' ? 'var(--v-orange)' : 'var(--v-cyan)');
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      });
    }
  }

  // TIMELINE TAB
  function renderTimelineTab(result) {
    drawTimeline();
    renderTimelineEventsList(result);
  }

  function drawTimeline() {
    const canvas = $('timelineCanvas');
    if (!canvas || !currentAnalysisResult) return;
    const prepared = prepareCanvas(canvas);
    if (!prepared) return;

    const { ctx, width: w, height: h } = prepared;
    const { mono, duration, events } = currentAnalysisResult.raw;

    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, w, h);

    // Center line
    ctx.strokeStyle = '#1b202d';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    // Waveform
    const step = Math.ceil(mono.length / w);
    const ampScale = (h / 2) * 0.9;

    ctx.strokeStyle = '#5ab0ff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const idx = x * step;
      let min = 1.0, max = -1.0;
      for (let j = 0; j < step && idx + j < mono.length; j++) {
        const s = mono[idx + j];
        if (s < min) min = s;
        if (s > max) max = s;
      }
      ctx.moveTo(x, h / 2 + min * ampScale);
      ctx.lineTo(x, h / 2 + max * ampScale);
    }
    ctx.stroke();

    // Draw Event Markers on timeline
    if (events && events.allEvents) {
      events.allEvents.forEach(ev => {
        const x = (ev.start / duration) * w;
        const color = ev.type === 'sibilance' ? '#ff5d5d' : (ev.type === 'plosive' ? '#f28334' : '#3ecfcf');
        ctx.fillStyle = color;
        ctx.fillRect(x - 2, 4, 4, h - 8);

        ctx.font = '10px var(--v-mono)';
        ctx.fillText(ev.subType || ev.type, x + 4, 16);
      });
    }

    // Interactive seek on click
    canvas.onclick = (e) => {
      const clickX = e.clientX - canvas.getBoundingClientRect().left;
      const targetTime = (clickX / w) * duration;
      seekAudio(targetTime);
    };
  }

  function renderTimelineEventsList(result) {
    const listEl = $('timelineEventsList');
    if (!listEl) return;
    const { events } = result.raw;
    listEl.innerHTML = events.allEvents.map(ev => `
      <div class="event-chip ${ev.type}" onclick="VocalUI.seekAudio(${ev.start})">
        <b>${ev.start.toFixed(2)}s:</b> ${ev.label}
      </div>
    `).join('');
  }

  // TONAL BALANCE TAB
  function renderTonalTab(result) {
    const tableBody = $('tonalTableBody');
    if (!tableBody) return;
    const { tonal } = result.raw;
    tableBody.innerHTML = tonal.zones.map(z => `
      <tr>
        <td><span style="color:${z.color}">●</span> <b>${z.name}</b></td>
        <td class="mono">${z.from}–${z.to} Hz</td>
        <td class="mono">${fmtDb(z.levelDb)}</td>
        <td class="mono" style="color:${z.deviationDb > 0 ? 'var(--v-amber)' : 'var(--v-blue)'}">${fmtDb(z.deviationDb)}</td>
        <td class="mono">${z.energyPercent}%</td>
        <td><span class="status-chip ${z.status === 'balanced' ? 'ok' : (z.status.includes('severe') ? 'bad' : 'warn')}">${z.status}</span></td>
        <td style="font-size:11.5px;color:var(--v-text-dim)">${z.description}</td>
      </tr>
    `).join('');
  }

  // RESONANCES TAB
  function renderResonancesTab(result) {
    const tableBody = $('resonancesTableBody');
    if (!tableBody) return;
    const { resonances } = result.raw;
    if (!resonances.resonances || !resonances.resonances.length) {
      tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--v-green)">No problematic acoustic resonances detected. Spectral peaks track natural pitch harmonics.</td></tr>`;
      return;
    }

    tableBody.innerHTML = resonances.resonances.map(r => `
      <tr>
        <td class="mono"><b>${fmtFreq(r.centerFreq)}</b></td>
        <td class="mono">${r.note}</td>
        <td class="mono">Q=${r.q}</td>
        <td class="mono" style="color:var(--v-amber)">+${r.excessDb} dB</td>
        <td class="mono">${r.persistencePct}%</td>
        <td><span class="status-chip ${r.type === 'persistent_resonance' ? 'bad' : (r.type === 'harmonic' ? 'ok' : 'warn')}">${r.type}</span></td>
        <td><span class="action-pill ${r.action.toLowerCase()}">${r.action}</span></td>
        <td style="font-size:11.5px;color:var(--v-text-dim)">${r.reason}</td>
      </tr>
    `).join('');
  }

  // DYNAMICS TAB
  function renderDynamicsTab(result) {
    const { dynamics } = result.raw;
    const lufsEl = $('dynIntegratedLufs');
    const lraEl = $('dynLra');
    const crestEl = $('dynCrest');
    const compStyleEl = $('dynCompStyle');

    if (lufsEl) lufsEl.textContent = dynamics.loudness.integrated + ' LUFS';
    if (lraEl) lraEl.textContent = dynamics.loudness.lra + ' LU';
    if (crestEl) crestEl.textContent = dynamics.crestDb + ' dB';
    if (compStyleEl) compStyleEl.textContent = dynamics.compressionProfile.style;

    const planBox = $('dynPlanBox');
    if (planBox) {
      planBox.innerHTML = `
        <div style="line-height:1.7">
          <b>Suggested Ratio:</b> ${dynamics.compressionProfile.suggestedRatio}<br>
          <b>Target Gain Reduction:</b> ${dynamics.compressionProfile.targetGR}<br>
          <b>Attack & Release:</b> ${dynamics.compressionProfile.attackReleaseHint}<br>
          <b>Level Consistency:</b> ${dynamics.phraseConsistency.verdict} (${dynamics.phraseConsistency.detectedPhrases} detected phrases, phrase standard deviation ${dynamics.phraseConsistency.phraseStdDevDb} dB)
        </div>
      `;
    }
  }

  // SIBILANCE TAB
  function renderSibilanceTab(result) {
    const { events } = result.raw;
    const sib = events.sibilance;
    const domFreqEl = $('sibDomFreq');
    const countEl = $('sibCount');
    const verdictEl = $('sibVerdict');
    const adviceEl = $('sibAdvice');

    if (domFreqEl) domFreqEl.textContent = fmtFreq(sib.dominantFrequency);
    if (countEl) countEl.textContent = sib.eventsCount;
    if (verdictEl) verdictEl.textContent = sib.severity;
    if (adviceEl) adviceEl.textContent = sib.recommendation;

    const listEl = $('sibEventsList');
    if (listEl && sib.events) {
      listEl.innerHTML = sib.events.map(e => `
        <div class="event-chip sibilance" onclick="VocalUI.seekAudio(${e.start})">
          ▶ <b>${e.start.toFixed(2)}s:</b> ${e.label} (${e.durationMs}ms)
        </div>
      `).join('');
    }
  }

  // PLOSIVES TAB
  function renderPlosivesTab(result) {
    const { events } = result.raw;
    const plo = events.plosives;
    const countEl = $('ploCount');
    const verdictEl = $('ploVerdict');
    const adviceEl = $('ploAdvice');

    if (countEl) countEl.textContent = plo.eventsCount;
    if (verdictEl) verdictEl.textContent = plo.severity;
    if (adviceEl) adviceEl.textContent = plo.recommendation;

    const listEl = $('ploEventsList');
    if (listEl && plo.events) {
      listEl.innerHTML = plo.events.map(e => `
        <div class="event-chip plosive" onclick="VocalUI.seekAudio(${e.start})">
          ▶ <b>${e.start.toFixed(2)}s:</b> ${e.label} (${e.durationMs}ms)
        </div>
      `).join('');
    }
  }

  // BREATH TAB
  function renderBreathTab(result) {
    const { events } = result.raw;
    const breath = events.breaths;
    const countEl = $('breathCount');
    const adviceEl = $('breathAdvice');

    if (countEl) countEl.textContent = breath.eventsCount;
    if (adviceEl) adviceEl.textContent = breath.recommendation;

    const listEl = $('breathEventsList');
    if (listEl && breath.events) {
      listEl.innerHTML = breath.events.map(e => `
        <div class="event-chip breath" onclick="VocalUI.seekAudio(${e.start})">
          ▶ <b>${e.start.toFixed(2)}s:</b> ${e.label}
        </div>
      `).join('');
    }
  }

  // PITCH TAB & CANVAS
  function renderPitchTab(result) {
    const { pitch } = result.raw;
    const f0El = $('pitchF0Val');
    const noteEl = $('pitchNoteVal');
    const voicedEl = $('pitchVoicedPct');
    const vibEl = $('pitchVibratoVal');

    if (f0El) f0El.textContent = pitch.f0.medianF0 ? `${pitch.f0.medianF0.toFixed(1)} Hz` : '—';
    if (noteEl) noteEl.textContent = pitch.f0.note;
    if (voicedEl) voicedEl.textContent = `${pitch.f0.voicedPercent.toFixed(1)}%`;
    if (vibEl) vibEl.textContent = pitch.vibrato.detected ? `${pitch.vibrato.rateHz} Hz (±${pitch.vibrato.depthCents}c)` : 'Straight tone';

    drawPitchPlot();
  }

  function drawPitchPlot() {
    const canvas = $('pitchCanvas');
    if (!canvas || !currentAnalysisResult) return;
    const prepared = prepareCanvas(canvas);
    if (!prepared) return;

    const { ctx, width: w, height: h } = prepared;
    const { pitch, duration } = currentAnalysisResult.raw;
    const { pitchTrack } = pitch;

    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, w, h);

    if (!pitchTrack || !pitchTrack.length) return;

    const minMidi = 40; // E2 ~82 Hz
    const maxMidi = 76; // E5 ~659 Hz
    const midiToY = m => h - ((m - minMidi) / (maxMidi - minMidi)) * h;

    // Draw note grid lines
    ctx.strokeStyle = '#1b202d';
    ctx.lineWidth = 1;
    [48, 60, 72].forEach(m => { // C3, C4, C5
      const y = midiToY(m);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();

      ctx.fillStyle = '#4f566b';
      ctx.font = '10px var(--v-mono)';
      ctx.fillText(`C${Math.floor(m / 12) - 1} (${DSP.noteToFreq(m).toFixed(0)} Hz)`, 6, y - 3);
    });

    // Draw Pitch Trace
    ctx.strokeStyle = 'var(--v-amber)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    let drawing = false;

    for (let i = 0; i < pitchTrack.length; i++) {
      const pt = pitchTrack[i];
      const x = (pt.time / duration) * w;
      if (pt.voiced && pt.f0 > 50) {
        const midi = 69 + 12 * Math.log2(pt.f0 / 440);
        const y = midiToY(midi);
        if (!drawing) {
          ctx.moveTo(x, y);
          drawing = true;
        } else {
          ctx.lineTo(x, y);
        }
      } else {
        drawing = false;
      }
    }
    ctx.stroke();
  }

  // RECORDING HEALTH TAB
  function renderHealthTab(result) {
    const { health } = result.raw;
    const scoreEl = $('healthScoreVal');
    const clipEl = $('healthClipVal');
    const noiseEl = $('healthNoiseVal');
    const humEl = $('healthHumVal');

    if (scoreEl) scoreEl.textContent = health.score + '/100';
    if (clipEl) clipEl.textContent = `${health.clipping.samples} samples (${health.clipping.severity})`;
    if (noiseEl) noiseEl.textContent = `${health.noiseFloor.floorDb.toFixed(1)} dBFS (SNR: ${health.noiseFloor.snrDb.toFixed(1)} dB)`;
    if (humEl) humEl.textContent = health.hum.detected ? `${health.hum.freq} Hz (${health.hum.levelDb.toFixed(1)} dB)` : 'None detected';
  }

  // MIX MASKING TAB
  function renderMaskingTab(result) {
    const { mixMasking } = result.reportJson;
    const listEl = $('maskingList');
    if (!listEl) return;

    if (!mixMasking.enabled) {
      listEl.innerHTML = `<p style="color:var(--v-text-dim);font-size:13px">No instrumental file uploaded. Drop an instrumental/beat below to check for frequency collisions.</p>`;
      return;
    }

    listEl.innerHTML = mixMasking.collisions.map(c => `
      <div class="rec-card ${c.maskingProbability >= 65 ? 'p1' : 'p3'}">
        <div class="rec-header">
          <span class="rec-title">${c.name} (${c.from}–${c.to} Hz)</span>
          <span class="status-chip ${c.maskingProbability >= 65 ? 'bad' : 'ok'}">${c.maskingProbability}% Masking</span>
        </div>
        <div class="rec-body">Vocal: ${c.vocalLevelDb} dB | Instrument: ${c.instrumentLevelDb} dB (Δ ${c.deltaDb > 0 ? '+' : ''}${c.deltaDb} dB)</div>
        <div class="rec-advice"><b>Action:</b> ${c.recommendation}</div>
      </div>
    `).join('');
  }

  // REFERENCE VOCAL TAB
  function renderReferenceTab(result) {
    const { referenceCompare } = result.reportJson;
    const listEl = $('refCompareList');
    if (!listEl) return;

    if (!referenceCompare.enabled) {
      listEl.innerHTML = `<p style="color:var(--v-text-dim);font-size:13px">No reference vocal file uploaded. Drop a reference vocal below to compare tonal balance.</p>`;
      return;
    }

    listEl.innerHTML = referenceCompare.deltas.map(d => `
      <div class="band-row">
        <span class="band-name">${d.name}</span>
        <span class="band-level mono">${d.sourceRelDb} vs ${d.refRelDb} dB</span>
        <span class="band-dev mono ${Math.abs(d.deltaDb) < 2 ? 'dev-ok' : 'dev-warn'}">${d.deltaDb > 0 ? '+' : ''}${d.deltaDb} dB</span>
      </div>
    `).join('');
  }

  // RECOMMENDATIONS TAB
  function renderRecommendationsTab(result) {
    const { recommendations } = result.reportJson;
    const listEl = $('allRecsList');
    if (listEl) {
      listEl.innerHTML = recommendations.map(r => renderRecommendationCard(r)).join('');
    }
  }

  // EQ PLAN & PRO-Q TAB
  function renderEqPlanTab(result) {
    const { eqPlan, proQ4Preset } = result.reportJson;
    const tableBody = $('eqPlanTableBody');
    if (tableBody) {
      tableBody.innerHTML = eqPlan.map((b, idx) => `
        <tr>
          <td class="mono">Band ${idx + 1}</td>
          <td class="mono"><b>${fmtFreq(b.frequency)}</b></td>
          <td class="mono" style="color:${b.gain > 0 ? 'var(--v-green)' : (b.gain < 0 ? 'var(--v-red)' : 'var(--v-text)')}">${b.type === 'hpf' ? 'HPF' : fmtDb(b.gain)}</td>
          <td class="mono">Q=${b.q}</td>
          <td class="mono">${b.type}</td>
          <td><span class="status-chip ${b.mode === 'dynamic' ? 'warn' : 'ok'}">${b.mode.toUpperCase()}</span></td>
          <td style="font-size:11.5px;color:var(--v-text-dim)">${b.reason}</td>
        </tr>
      `).join('');
    }

    drawEqCurve();
  }

  function drawEqCurve() {
    const canvas = $('eqCurveCanvas');
    if (!canvas || !currentAnalysisResult) return;
    const prepared = prepareCanvas(canvas);
    if (!prepared) return;

    const { ctx, width: w, height: h } = prepared;
    const { decision } = currentAnalysisResult.raw;
    const eqPlan = decision.eqPlan || [];

    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, w, h);

    const minF = 20, maxF = 20000;
    const minDb = -24, maxDb = 24;
    const freqToX = f => (Math.log10(Math.max(minF, f) / minF) / Math.log10(maxF / minF)) * w;
    const dbToY = db => h / 2 - (db / 24) * (h / 2);

    // Center line (0 dB)
    ctx.strokeStyle = '#2b3345';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    // Frequency grid
    [100, 1000, 10000].forEach(f => {
      const x = freqToX(f);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    });

    // Draw combined EQ Curve
    ctx.strokeStyle = 'var(--v-amber)';
    ctx.lineWidth = 3;
    ctx.beginPath();

    for (let x = 0; x < w; x += 2) {
      const f = minF * Math.pow(maxF / minF, x / w);
      let totalGain = 0;

      for (const band of eqPlan) {
        if (band.type === 'hpf') {
          if (f < band.frequency) {
            const oct = Math.log2(band.frequency / f);
            totalGain -= oct * 18;
          }
        } else if (band.type === 'bell' || band.type === 'peaking' || band.type === 'notch') {
          const ratio = f / band.frequency;
          const logRatio = Math.log2(ratio);
          const g = band.gain / (1 + Math.pow(logRatio * band.q * 2, 2));
          totalGain += g;
        } else if (band.type === 'highshelf') {
          if (f >= band.frequency) totalGain += band.gain;
          else if (f > band.frequency * 0.5) totalGain += band.gain * (f - band.frequency * 0.5) / (band.frequency * 0.5);
        } else if (band.type === 'lowshelf') {
          if (f <= band.frequency) totalGain += band.gain;
          else if (f < band.frequency * 2.0) totalGain += band.gain * (band.frequency * 2.0 - f) / (band.frequency);
        }
      }

      const y = dbToY(Math.max(-24, Math.min(24, totalGain)));
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Draw individual band node handles
    eqPlan.forEach(band => {
      const bx = freqToX(band.frequency);
      const by = dbToY(band.type === 'hpf' ? 0 : band.gain);
      ctx.fillStyle = band.mode === 'dynamic' ? 'var(--v-orange)' : 'var(--v-amber)';
      ctx.beginPath();
      ctx.arc(bx, by, 6, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  }

  // JSON TAB
  function renderJsonTab(result) {
    const jsonBox = $('reportJsonViewer');
    if (jsonBox) {
      jsonBox.textContent = JSON.stringify(result.reportJson, null, 2);
    }
  }

  /* =========================================================================
     7. TRANSPORT & AUDIO PLAYBACK
     ========================================================================= */

  function setupTransport() {
    const playBtn = $('vocalPlayBtn');
    const stopBtn = $('vocalStopBtn');
    if (playBtn) playBtn.addEventListener('click', togglePlay);
    if (stopBtn) stopBtn.addEventListener('click', stopAudio);
  }

  function togglePlay() {
    if (isPlaying) {
      pauseAudio();
    } else {
      playAudio();
    }
  }

  function playAudio(offset = playStartOffset) {
    if (!currentAudioBuffer || !audioCtx) return;
    if (sourceNode) {
      try { sourceNode.stop(); sourceNode.disconnect(); } catch (e) {}
    }

    sourceNode = audioCtx.createBufferSource();
    sourceNode.buffer = currentAudioBuffer;
    sourceNode.connect(audioCtx.destination);

    playStartTime = audioCtx.currentTime;
    playStartOffset = offset % currentAudioBuffer.duration;

    sourceNode.start(0, playStartOffset);
    isPlaying = true;

    const playBtn = $('vocalPlayBtn');
    if (playBtn) playBtn.textContent = '⏸ Pause';

    sourceNode.onended = () => {
      if (isPlaying && (audioCtx.currentTime - playStartTime + playStartOffset) >= currentAudioBuffer.duration - 0.05) {
        stopAudio();
      }
    };

    startTransportLoop();
  }

  function pauseAudio() {
    if (!isPlaying) return;
    playStartOffset = (audioCtx.currentTime - playStartTime) + playStartOffset;
    if (sourceNode) {
      try { sourceNode.stop(); sourceNode.disconnect(); } catch (e) {}
    }
    isPlaying = false;
    const playBtn = $('vocalPlayBtn');
    if (playBtn) playBtn.textContent = '▶ Play';
    cancelAnimationFrame(animFrameId);
  }

  function stopAudio() {
    if (sourceNode) {
      try { sourceNode.stop(); sourceNode.disconnect(); } catch (e) {}
    }
    isPlaying = false;
    playStartOffset = 0;
    const playBtn = $('vocalPlayBtn');
    if (playBtn) playBtn.textContent = '▶ Play';
    cancelAnimationFrame(animFrameId);
    updateTimeLabel(0);
  }

  function seekAudio(targetSec) {
    const wasPlaying = isPlaying;
    pauseAudio();
    playStartOffset = targetSec;
    updateTimeLabel(targetSec);
    if (wasPlaying) playAudio(targetSec);
  }

  function startTransportLoop() {
    function loop() {
      if (isPlaying && currentAudioBuffer) {
        const curTime = (audioCtx.currentTime - playStartTime) + playStartOffset;
        updateTimeLabel(curTime);
        animFrameId = requestAnimationFrame(loop);
      }
    }
    loop();
  }

  function updateTimeLabel(curSec) {
    const lbl = $('vocalTimeLabel');
    if (!lbl || !currentAudioBuffer) return;
    const totalSec = currentAudioBuffer.duration;
    lbl.textContent = `${fmtTime(curSec)} / ${fmtTime(totalSec)}`;
  }

  function fmtTime(s) {
    const m = Math.floor(s / 60);
    const ss = (s % 60).toFixed(1);
    return `${m}:${s % 60 < 10 ? '0' : ''}${ss}`;
  }

  /* =========================================================================
     8. EXPORT BUTTON HANDLERS
     ========================================================================= */

  function setupExportButtons() {
    // Download JSON
    const dlJsonBtn = $('downloadJsonBtn');
    if (dlJsonBtn) {
      dlJsonBtn.addEventListener('click', () => {
        if (!currentAnalysisResult) return;
        downloadFile(
          JSON.stringify(currentAnalysisResult.reportJson, null, 2),
          `MixLens_${currentAnalysisResult.reportJson.file.name}_Report.json`,
          'application/json'
        );
      });
    }

    // Copy JSON
    const cpJsonBtn = $('copyJsonBtn');
    if (cpJsonBtn) {
      cpJsonBtn.addEventListener('click', () => {
        if (!currentAnalysisResult) return;
        navigator.clipboard.writeText(JSON.stringify(currentAnalysisResult.reportJson, null, 2));
        alert('Report JSON copied to clipboard!');
      });
    }

    // Download Pro-Q 4 Preset (.ffp)
    const dlProQBtn = $('downloadProQBtn');
    if (dlProQBtn) {
      dlProQBtn.addEventListener('click', () => {
        if (!currentAnalysisResult) return;
        downloadFile(
          currentAnalysisResult.proQ4Xml,
          `${currentAnalysisResult.proQ4Preset.name}.ffp`,
          'application/xml'
        );
      });
    }

    // Copy Pro-Q 4 JSON
    const cpProQBtn = $('copyProQBtn');
    if (cpProQBtn) {
      cpProQBtn.addEventListener('click', () => {
        if (!currentAnalysisResult) return;
        navigator.clipboard.writeText(JSON.stringify(currentAnalysisResult.proQ4Preset, null, 2));
        alert('FabFilter Pro-Q 4 Preset JSON copied to clipboard!');
      });
    }

    // Download Text Report
    const dlTextBtn = $('downloadTextReportBtn');
    if (dlTextBtn) {
      dlTextBtn.addEventListener('click', () => {
        if (!currentAnalysisResult) return;
        const r = currentAnalysisResult.reportJson;
        let txt = `====================================================\n`;
        txt += `MIXLENS VOCAL ANALYSIS REPORT\n`;
        txt += `====================================================\n\n`;
        txt += `File: ${r.file.name}\n`;
        txt += `Duration: ${r.file.duration}s | Sample Rate: ${r.file.sampleRate} Hz\n`;
        txt += `Peak: ${fmtDb(r.file.peakDb)} | RMS: ${fmtDb(r.file.rmsDb)} | Integrated: ${r.file.integratedLufs} LUFS\n`;
        txt += `Mix-Readiness Score: ${r.mixReadinessScore}/100\n\n`;
        txt += `EXECUTIVE SUMMARY:\n${r.executiveSummary}\n\n`;
        txt += `RECOMMENDED ACTIONS:\n`;
        r.recommendations.forEach((rec, idx) => {
          txt += `${idx + 1}. [${rec.priority}] [${rec.action}] ${rec.title}\n`;
          txt += `   Evidence: ${rec.evidence}\n`;
          txt += `   Action: ${rec.actionAdvice}\n\n`;
        });
        txt += `FABFILTER PRO-Q 4 EQ PLAN:\n`;
        r.eqPlan.forEach((b, idx) => {
          txt += `Band ${idx + 1}: ${fmtFreq(b.frequency)} | ${b.type.toUpperCase()} | ${fmtDb(b.gain)} | Q=${b.q} | ${b.mode.toUpperCase()}\n`;
          txt += `  Reason: ${b.reason}\n`;
        });
        downloadFile(txt, `MixLens_${r.file.name}_Summary.txt`, 'text/plain');
      });
    }
  }

  function downloadFile(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* =========================================================================
     9. OPTIONAL DUAL DROPZONES (INSTRUMENTAL & REFERENCE)
     ========================================================================= */

  function setupOptionalDropzones() {
    // Instrumental input
    const instInput = $('instFileInput');
    if (instInput) {
      instInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file || !currentAudioBuffer) return;
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const ab = await file.arrayBuffer();
        const instBuf = await audioCtx.decodeAudioData(ab);
        await runAnalysisPipeline(currentAudioBuffer, currentAnalysisResult.reportJson.file, { instrumentalBuffer: instBuf });
        alert('Instrumental track loaded! Check the MIX MASKING tab.');
      });
    }

    // Reference vocal input
    const refInput = $('refFileInput');
    if (refInput) {
      refInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file || !currentAudioBuffer) return;
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const ab = await file.arrayBuffer();
        const refBuf = await audioCtx.decodeAudioData(ab);
        await runAnalysisPipeline(currentAudioBuffer, currentAnalysisResult.reportJson.file, { referenceBuffer: refBuf });
        alert('Reference vocal loaded! Check the REFERENCE VOCAL tab.');
      });
    }
  }

  // Auto initialize when DOM is ready
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

  return {
    init,
    seekAudio,
    handleAudioFile
  };
}));
