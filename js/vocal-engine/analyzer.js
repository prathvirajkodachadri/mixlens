'use strict';
/**
 * MixLens Vocal Engine 3.0 — Pipeline coordinator.
 *
 * Upload → decode (host) → preprocess → analyze modules → scores → report.
 * Analysis only. No automatic EQ, compression, de-ess, or VST presets.
 */

(function (root, factory) {
  const deps = [
    './utilities', './preprocessing', './clipping', './loudness', './dynamics',
    './spectrum', './tonal-balance', './resonance', './sibilance', './plosive',
    './breath', './noise', './hum', './pitch', './vibrato', './stereo',
    './masking', './scoring', './interpretation', './timeline',
    './json-export', './report-generator'
  ];
  if (typeof module === 'object' && module.exports) {
    module.exports = factory.apply(null, deps.map(require));
  } else {
    root.VEAnalyzer = factory(
      root.VEUtilities, root.VEPreprocessing, root.VEClipping, root.VELoudness, root.VEDynamics,
      root.VESpectrum, root.VETonal, root.VEResonance, root.VESibilance, root.VEPlosive,
      root.VEBreath, root.VENoise, root.VEHum, root.VEPitch, root.VEVibrato, root.VEStereo,
      root.VEMasking, root.VEScoring, root.VEInterpretation, root.VETimeline,
      root.VEJson, root.VEReport
    );
  }
}(typeof self !== 'undefined' ? self : this, function (
  U, Pre, Clip, Loud, Dyn, Spec, Tonal, Res, Sib, Plo, Breath, Noise, Hum, Pitch, Vib, Stereo,
  Mask, Score, Interp, Time, Json, Report
) {

  const STAGES = [
    { id: 'load', label: 'Loading Audio' },
    { id: 'decode', label: 'Decoding' },
    { id: 'technical', label: 'Technical Analysis' },
    { id: 'spectrum', label: 'Spectrum Analysis' },
    { id: 'tonal', label: 'Tonal Analysis' },
    { id: 'resonance', label: 'Resonance Analysis' },
    { id: 'sibilance', label: 'Sibilance Analysis' },
    { id: 'plosive', label: 'Plosive Analysis' },
    { id: 'breath', label: 'Breath Analysis' },
    { id: 'noise', label: 'Noise Analysis' },
    { id: 'pitch', label: 'Pitch Analysis' },
    { id: 'dynamics', label: 'Dynamics Analysis' },
    { id: 'stereo', label: 'Stereo Analysis' },
    { id: 'report', label: 'Generating Report' }
  ];

  function progressApi(onProgress) {
    const done = {};
    return function (id, percent, extra) {
      done[id] = true;
      if (typeof onProgress === 'function') {
        onProgress({
          stage: id,
          label: (STAGES.find(function (s) { return s.id === id; }) || {}).label || id,
          percent: percent,
          completed: Object.keys(done),
          stages: STAGES.map(function (s) { return { id: s.id, label: s.label, done: !!done[s.id] }; }),
          extra: extra || null
        });
      }
    };
  }

  function dcOffset(mono) {
    let acc = 0;
    for (let i = 0; i < mono.length; i++) acc += mono[i];
    const mean = mono.length ? acc / mono.length : 0;
    const abs = Math.abs(mean);
    const dbfs = U.db20(abs);
    let severity = 'GOOD';
    if (abs >= 0.02) severity = 'HIGH';
    else if (abs >= 0.005) severity = 'MODERATE';
    else if (abs >= 0.001) severity = 'LOW';
    return {
      mean: mean,
      absolute: abs,
      dbfs: U.round(dbfs, 2),
      severity: severity,
      evidence: 'Mean sample value ' + mean.toExponential(3) + ' (' + dbfs.toFixed(1) + ' dBFS). Tiny offsets are not exaggerated.'
    };
  }

  function waveformPeaks(mono, points) {
    return U.downsampleMax(mono, points || 1400);
  }

  /**
   * @param {object} input
   *   left, right?, sampleRate, duration, channels, file meta
   */
  async function analyze(input, options, onProgress) {
    const opt = options || {};
    const reportProg = progressApi(onProgress);
    const start = Date.now();
    const warnings = [];

    reportProg('load', 4);
    await U.yieldTick();

    const sampleRate = input.sampleRate;
    const left = input.left;
    const right = input.right || null;
    const channels = right ? 2 : 1;
    const length = left.length;
    const duration = length / sampleRate;

    const val = Pre.validateAudio(length, sampleRate, duration);
    if (val.errors.length) throw new Error(val.errors[0]);
    val.warnings.forEach(function (w) { warnings.push(w); });

    reportProg('decode', 8);
    await U.yieldTick();

    const mono = Pre.mixToMono(left, right);
    const silence = Pre.analyzeSilence(mono, sampleRate);
    const peakLin = U.peak(mono);
    const rmsLin = U.rms(mono);
    const truePeak = U.measureTruePeak(mono);
    const dc = dcOffset(mono);

    if (peakLin < U.dbToLinear(-55)) warnings.push('Very low-level file. Some detectors will report insufficient signal.');
    if (silence.silence_ratio > 0.97) warnings.push('File is nearly silent.');

    reportProg('technical', 16);
    await U.yieldTick();

    const clipping = Clip.analyzeClipping(mono, sampleRate);
    const loudness = Loud.analyzeLoudness(mono, sampleRate, left, right);

    reportProg('dynamics', 24);
    await U.yieldTick();
    const dynamics = Dyn.analyzeDynamics(mono, sampleRate, loudness);

    reportProg('spectrum', 36);
    await U.yieldTick();
    const spectrum = Spec.analyzeSpectrum(mono, sampleRate);

    reportProg('tonal', 46);
    await U.yieldTick();
    const tonal = Tonal.analyzeTonalBalance(spectrum);

    reportProg('pitch', 58);
    await U.yieldTick();
    const pitch = Pitch.analyzePitch(mono, sampleRate);
    const vibrato = Vib.analyzeVibrato(pitch);

    reportProg('resonance', 66);
    await U.yieldTick();
    const resonances = Res.analyzeResonances(spectrum, pitch);

    reportProg('sibilance', 74);
    await U.yieldTick();
    const sibilance = Sib.analyzeSibilance(mono, sampleRate);

    reportProg('plosive', 80);
    await U.yieldTick();
    const plosives = Plo.analyzePlosives(mono, sampleRate);

    reportProg('breath', 85);
    await U.yieldTick();
    const breaths = Breath.analyzeBreaths(mono, sampleRate, pitch._track);

    reportProg('noise', 90);
    await U.yieldTick();
    const noise = Noise.analyzeNoise(mono, sampleRate, pitch._track);
    const hum = Hum.analyzeHum(mono, sampleRate);

    reportProg('stereo', 93);
    await U.yieldTick();
    const stereo = Stereo.analyzeStereo(left, right);

    let masking = { enabled: false, collisions: [], note: 'No instrumental file loaded.' };
    let reference = { enabled: false, zones: [], note: 'No reference vocal loaded.' };
    if (opt.instrumental && opt.instrumental.left) {
      const instMono = Pre.mixToMono(opt.instrumental.left, opt.instrumental.right || null);
      masking = Mask.analyzeMasking(spectrum, instMono, opt.instrumental.sampleRate);
    }
    if (opt.reference && opt.reference.left) {
      const refMono = Pre.mixToMono(opt.reference.left, opt.reference.right || null);
      reference = Mask.analyzeReference(spectrum, dynamics, tonal, refMono, opt.reference.sampleRate);
    }

    const technical = {
      sample_peak_dbfs: U.round(U.db20(peakLin), 2),
      true_peak_dbtp: U.round(U.db20(truePeak), 2),
      rms_dbfs: U.round(U.db20(rmsLin), 2),
      integrated_lufs: loudness.integrated_lufs,
      short_term_lufs: loudness.short_term_lufs,
      momentary_lufs: loudness.momentary_lufs,
      lra_lu: loudness.lra_lu,
      crest_factor_db: U.round(U.db20(peakLin) - U.db20(rmsLin), 2),
      dc_offset: dc.mean,
      dc_offset_dbfs: dc.dbfs,
      headroom_db: U.round(-U.db20(peakLin), 2),
      peak_to_loudness_db: (loudness.integrated_lufs > -140) ? U.round(U.db20(truePeak) - loudness.integrated_lufs, 2) : null,
      silence_ratio: U.round(silence.silence_ratio, 4),
      clipping: clipping
    };

    const ctx = {
      clipping: clipping, dc: dc, noise: noise, hum: hum, technical: technical,
      stereo: stereo, sibilance: sibilance, plosives: plosives, resonances: resonances,
      dynamics: dynamics, tonal: tonal, pitch: pitch, breaths: breaths
    };

    const scores = Score.computeScores(ctx);
    const character = Score.characterProfile(tonal, dynamics, sibilance, noise, stereo, spectrum);
    const observations = Interp.interpret(ctx);
    const executive = Interp.executiveSummary(ctx, scores);
    const wave = waveformPeaks(mono, 1600);
    const timeline = Time.buildTimeline(ctx, wave);

    reportProg('report', 97);
    await U.yieldTick();

    const file = {
      name: input.fileName || 'untitled',
      size_bytes: input.fileSize == null ? null : input.fileSize,
      size_label: input.fileSize == null ? 'Not available' : formatBytes(input.fileSize),
      duration_seconds: U.round(duration, 3),
      duration_label: U.fmtDuration(duration),
      sample_rate: sampleRate,
      channels: channels,
      channel_layout: channels === 1 ? 'Mono' : 'Stereo',
      sample_count: length,
      format: input.format || 'Not available',
      codec: input.codec || 'Not available',
      bit_depth: input.bitDepth == null ? 'Not available' : input.bitDepth
    };

    const assembled = {
      analysis_timestamp: new Date().toISOString(),
      demo: !!opt.demo,
      warnings: warnings,
      file: file,
      technical: technical,
      clipping: clipping,
      dc: dc,
      loudness: loudness,
      dynamics: dynamics,
      spectrum: spectrum,
      tonal: tonal,
      resonances: resonances,
      sibilance: sibilance,
      plosives: plosives,
      breaths: breaths,
      noise: noise,
      hum: hum,
      pitch: pitch,
      vibrato: vibrato,
      stereo: stereo,
      timeline: timeline,
      character: character,
      scores: scores,
      reference: reference,
      masking: masking,
      observations: observations,
      executive: executive,
      analysis_ms: Date.now() - start
    };

    const json = Json.buildJson(assembled);
    const textReport = Report.buildTextReport(json);
    const htmlReport = Report.buildHtmlReport(json);

    reportProg('report', 100);

    return {
      json: json,
      textReport: textReport,
      htmlReport: htmlReport,
      visualization: {
        waveform: wave,
        spectrum: spectrum.display,
        spectrogram: {
          times: spectrum.spectrogram.times,
          logFreqs: spectrum.spectrogram.log_freq_hz,
          columns: spectrum.spectrogram.columns
        },
        pitchContour: pitch.contour,
        loudnessTimeline: loudness.timeline,
        tonal: tonal.zones,
        character: character.scores,
        stereo: stereo,
        events: timeline.events
      }
    };
  }

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function makeDemoBuffer(sampleRate) {
    const sr = sampleRate || 48000;
    const dur = 6.5;
    const n = Math.floor(sr * dur);
    const left = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const f0 = 180 * Math.pow(2, (0.04 * Math.sin(2 * Math.PI * 5.4 * t)) / 12);
      let v = 0;
      // voiced vowel except at event windows
      const voiced = !((t >= 0.95 && t < 1.08) || (t >= 2.15 && t < 2.32) || (t >= 4.15 && t < 4.55));
      if (voiced) {
        const env = 0.28 + 0.08 * Math.sin(2 * Math.PI * 0.35 * t);
        v += env * 0.55 * Math.sin(2 * Math.PI * f0 * t);
        v += env * 0.28 * Math.sin(2 * Math.PI * 2 * f0 * t);
        v += env * 0.16 * Math.sin(2 * Math.PI * 3 * f0 * t);
        v += env * 0.09 * Math.sin(2 * Math.PI * 4 * f0 * t);
        v += env * 0.04 * Math.sin(2 * Math.PI * 5 * f0 * t);
      }
      if (t >= 0.98 && t < 1.05) {
        v += 0.72 * Math.sin(2 * Math.PI * 58 * (t - 0.98)) * Math.exp(-(t - 0.98) * 40);
      }
      if (t >= 2.18 && t < 2.30) {
        v += 0.42 * (Math.random() * 2 - 1) * Math.sin(2 * Math.PI * 7400 * t);
      }
      if (t >= 4.18 && t < 4.52) {
        v += 0.045 * (Math.random() * 2 - 1);
        v += 0.03 * Math.sin(2 * Math.PI * 2800 * t) * (Math.random());
      }
      v += 0.004 * (Math.random() * 2 - 1);
      v += 0.012 * Math.sin(2 * Math.PI * 50 * t);
      left[i] = Math.max(-0.98, Math.min(0.98, v));
    }
    return {
      left: left,
      right: null,
      sampleRate: sr,
      fileName: 'mixlens-demo-vocal.wav',
      fileSize: n * 2,
      format: 'WAV (generated)',
      codec: 'PCM (generated demo)',
      bitDepth: 16,
      demo: true
    };
  }

  return {
    analyze: analyze,
    STAGES: STAGES,
    makeDemoBuffer: makeDemoBuffer
  };
}));
