'use strict';
/**
 * MixLens Final Mastering Analysis 1.0 — Pipeline coordinator.
 *
 * ANALYSIS ONLY. Does not EQ, compress, limit, normalize, or modify the uploaded audio.
 */

(function (root, factory) {
  const deps = [
    './utilities', './clipping', './loudness', './true-peak', './dynamics',
    './spectrum', './stereo', './phase', './mono', './silence', './fade',
    './distortion', './platform-profiles', './platform-analysis', './scoring',
    './export-json', './export-txt', './report-generator'
  ];
  if (typeof module === 'object' && module.exports) {
    module.exports = factory.apply(null, deps.map(require));
  } else {
    root.MAAnalyzer = factory(
      root.MAUtilities, root.MAClipping, root.MALoudness, root.MATruePeak, root.MADynamics,
      root.MASpectrum, root.MAStereo, root.MAPhase, root.MAMono, root.MASilence, root.MAFade,
      root.MADistortion, root.MAPlatformProfiles, root.MAPlatformAnalysis, root.MAScoring,
      root.MAJson, root.MATxt, root.MAReport
    );
  }
}(typeof self !== 'undefined' ? self : this, function (
  U, Clip, Loud, TP, Dyn, Spec, Stereo, Phase, Mono, Silence, Fade,
  Dist, Profiles, Plat, Score, Json, Txt, Report
) {

  const STAGES = [
    { id: 'load', label: 'Loading Audio' },
    { id: 'decode', label: 'Decoding' },
    { id: 'technical', label: 'Technical Analysis' },
    { id: 'truepeak', label: 'True Peak' },
    { id: 'loudness', label: 'Loudness' },
    { id: 'dynamics', label: 'Dynamics' },
    { id: 'spectrum', label: 'Spectrum' },
    { id: 'stereo', label: 'Stereo / Phase' },
    { id: 'silence', label: 'Silence / Fade' },
    { id: 'platform', label: 'Platform Analysis' },
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
    let pos = 0, neg = 0;
    for (let i = 0; i < mono.length; i++) {
      const v = mono[i];
      acc += v;
      if (v >= 0) pos += v; else neg += v;
    }
    const mean = mono.length ? acc / mono.length : 0;
    const abs = Math.abs(mean);
    const dbfs = U.db20(abs);
    let severity = 'GOOD';
    let status = 'PASS';
    if (abs >= 0.02) { severity = 'HIGH'; status = 'FAIL'; }
    else if (abs >= 0.005) { severity = 'MODERATE'; status = 'WARNING'; }
    else if (abs >= 0.001) { severity = 'LOW'; status = 'PASS'; }
    return {
      mean: mean,
      absolute: abs,
      dbfs: U.round(dbfs, 2),
      positive_bias: U.round(pos / Math.max(1, mono.length), 6),
      negative_bias: U.round(neg / Math.max(1, mono.length), 6),
      severity: severity,
      status: status,
      evidence: 'Mean sample value ' + mean.toExponential(3) + ' (' + dbfs.toFixed(1) + ' dBFS). Tiny offsets are not exaggerated.'
    };
  }

  function samplePeakAnalysis(left, right, sampleRate) {
    const sL = U.peakSigned(left);
    const sR = right ? U.peakSigned(right) : null;
    const maxPos = sR ? Math.max(sL.pos, sR.pos) : sL.pos;
    const maxNeg = sR ? Math.min(sL.neg, sR.neg) : sL.neg;
    const absLin = Math.max(maxPos, Math.abs(maxNeg));
    const dbfs = U.db20(absLin);
    const posIsWinner = maxPos >= Math.abs(maxNeg);
    const idx = posIsWinner ? (sR && sR.pos > sL.pos ? sR.posIndex : sL.posIndex)
      : (sR && sR.neg < sL.neg ? sR.negIndex : sL.negIndex);
    let status = 'PASS';
    if (dbfs >= -0.05) status = 'WARNING';
    /* Near full-scale is a headroom note, not clipping. */
    return {
      maximum_positive_sample: U.round(maxPos, 6),
      maximum_negative_sample: U.round(maxNeg, 6),
      peak_dbfs: U.round(dbfs, 2),
      peak_timestamp_s: U.round(idx / sampleRate, 4),
      left_peak_dbfs: U.round(U.db20(Math.max(sL.pos, Math.abs(sL.neg))), 2),
      right_peak_dbfs: sR ? U.round(U.db20(Math.max(sR.pos, Math.abs(sR.neg))), 2) : null,
      status: status,
      note: 'Sample peak near 0 dBFS is not automatically classified as clipping.'
    };
  }

  function masterFormat(channels, sampleRate, bitDepth, duration, stereo) {
    let layout = channels === 1 ? 'Mono' : (channels === 2 ? 'Stereo' : (channels + '-channel'));
    if (stereo && stereo.dual_mono) layout = 'Dual mono';
    else if (stereo && stereo.master_format && stereo.master_format !== 'Stereo' && stereo.master_format !== 'Mono') {
      layout = stereo.master_format;
    }
    return {
      layout: layout,
      sample_rate_hz: sampleRate,
      bit_depth: bitDepth == null ? 'Not available' : bitDepth,
      duration_label: U.fmtDuration(duration),
      label: [layout, (sampleRate / 1000) + ' kHz', bitDepth == null ? null : (bitDepth + '-bit'), U.fmtDuration(duration)].filter(Boolean).join(' · ')
    };
  }

  function technicalStatus(clip, tp, dc, samplePeak) {
    const list = [clip.status, dc.status, samplePeak.status];
    if (tp && tp.available && tp.value_dbtp != null && tp.value_dbtp > 0) list.push('WARNING');
    const worst = U.worstStatus(list);
    return worst === 'FAIL' ? 'FAIL' : (worst === 'WARNING' ? 'WARNING' : 'PASS');
  }

  function comparePair(a, b, label) {
    function delta(x, y) {
      if (x == null || y == null || !isFinite(x) || !isFinite(y)) return null;
      return U.round(x - y, 2);
    }
    return {
      enabled: true,
      label: label,
      loudness_difference_lu: delta(a.loudness && a.loudness.integrated_lufs, b.loudness && b.loudness.integrated_lufs),
      true_peak_difference_db: delta(a.true_peak && a.true_peak.value_dbtp, b.true_peak && b.true_peak.value_dbtp),
      rms_difference_db: delta(a.technical && a.technical.rms_dbfs, b.technical && b.technical.rms_dbfs),
      crest_difference_db: delta(a.dynamics && a.dynamics.crest_factor_db, b.dynamics && b.dynamics.crest_factor_db),
      lra_difference_lu: delta(a.dynamics && a.dynamics.lra_lu, b.dynamics && b.dynamics.lra_lu),
      centroid_difference_hz: delta(a.spectrum && a.spectrum.centroid_hz, b.spectrum && b.spectrum.centroid_hz),
      width_difference_pct: delta(a.stereo && a.stereo.stereo_width_percent, b.stereo && b.stereo.stereo_width_percent),
      correlation_difference: delta(a.phase && a.phase.correlation, b.phase && b.phase.correlation),
      your: summarize(a),
      other: summarize(b),
      tonal: compareTonal(a.spectrum, b.spectrum),
      loudness_matched_note: (function () {
        const d = delta(a.loudness && a.loudness.integrated_lufs, b.loudness && b.loudness.integrated_lufs);
        if (d == null) return 'Loudness-matched comparison not available.';
        return 'LOUDNESS-MATCHED COMPARISON: a level offset of ' + (-d).toFixed(2) +
          ' dB would align the comparison file to this master\'s integrated loudness. Offset applied to interpretation only — audio is not changed.';
      })()
    };
  }

  function summarize(r) {
    return {
      integrated_lufs: r.loudness && r.loudness.integrated_lufs,
      true_peak_dbtp: r.true_peak && r.true_peak.value_dbtp,
      rms_dbfs: r.technical && r.technical.rms_dbfs,
      crest_factor_db: r.dynamics && r.dynamics.crest_factor_db,
      lra_lu: r.dynamics && r.dynamics.lra_lu,
      centroid_hz: r.spectrum && r.spectrum.centroid_hz,
      stereo_width_percent: r.stereo && r.stereo.stereo_width_percent,
      correlation: r.phase && r.phase.correlation
    };
  }

  function compareTonal(sa, sb) {
    if (!sa || !sb || !sa.regions || !sb.regions) return [];
    return sa.regions.map(function (r) {
      const o = sb.regions.find(function (x) { return x.id === r.id; });
      return {
        id: r.id,
        name: r.name,
        yours_percent: r.energy_percent,
        other_percent: o ? o.energy_percent : null,
        difference_percent: o ? U.round(r.energy_percent - o.energy_percent, 2) : null
      };
    });
  }

  async function analyzeCore(input, options, onProgress) {
    const opt = options || {};
    const reportProg = progressApi(onProgress);
    const start = Date.now();
    const warnings = [];

    reportProg('load', 4);
    await U.yieldTick();

    const sampleRate = input.sampleRate;
    const left = input.left;
    const right = input.right || null;
    const channels = right ? 2 : (input.channels || 1);
    const length = left.length;
    const duration = length / sampleRate;

    const val = U.validateAudio(length, sampleRate, duration);
    if (val.errors.length) throw new Error(val.errors[0]);
    val.warnings.forEach(function (w) { warnings.push(w); });
    if (channels > 2) warnings.push('Unsupported multichannel layout for full analysis. Channels 1–2 are used.');

    reportProg('decode', 8);
    await U.yieldTick();

    const mono = U.mixToMono(left, right);
    const peakLin = U.peak(mono);
    const rmsLin = U.rms(mono);
    const dc = dcOffset(mono);
    const samplePeak = samplePeakAnalysis(left, right, sampleRate);

    if (peakLin < U.dbToLinear(-55)) warnings.push('Very low-level file. Some detectors will report insufficient signal.');

    reportProg('technical', 14);
    await U.yieldTick();
    const clipping = Clip.analyzeClipping(left, right, sampleRate);

    reportProg('truepeak', 22);
    await U.yieldTick();
    const truePeak = TP.analyzeTruePeak(left, right, sampleRate);

    reportProg('loudness', 36);
    await U.yieldTick();
    const loudness = Loud.analyzeLoudness(mono, sampleRate, left, right);
    if (!loudness.available) warnings.push('Insufficient signal for reliable loudness analysis.');

    reportProg('dynamics', 48);
    await U.yieldTick();
    const dynamics = Dyn.analyzeDynamics(mono, sampleRate, loudness, truePeak.value_dbtp, samplePeak.peak_dbfs);
    const loudPeakCorr = Dyn.correlateLoudnessAndPeaks(loudness, clipping, truePeak, dynamics);

    reportProg('spectrum', 62);
    await U.yieldTick();
    const spectrum = Spec.analyzeSpectrum(mono, sampleRate, left, right);

    reportProg('stereo', 74);
    await U.yieldTick();
    const stereo = Stereo.analyzeStereo(left, right, sampleRate);
    const phase = Phase.analyzePhase(left, right, sampleRate);
    const monoComp = Mono.analyzeMono(left, right, sampleRate);

    reportProg('silence', 82);
    await U.yieldTick();
    const silence = Silence.analyzeSilence(mono, sampleRate);
    const fade = Fade.analyzeFade(mono, sampleRate, silence);
    const distortion = Dist.analyzeDistortion(clipping, truePeak, spectrum, dynamics, loudness);

    const format = masterFormat(channels, sampleRate, input.bitDepth, duration, stereo);

    const technical = {
      sample_peak_dbfs: samplePeak.peak_dbfs,
      true_peak_dbtp: truePeak.available ? truePeak.value_dbtp : null,
      rms_dbfs: U.round(U.db20(rmsLin), 2),
      integrated_lufs: loudness.integrated_lufs,
      short_term_lufs: loudness.short_term_max_lufs,
      momentary_lufs: loudness.momentary_max_lufs,
      lra_lu: loudness.lra_lu,
      crest_factor_db: U.round(U.db20(peakLin) - U.db20(rmsLin), 2),
      peak_to_loudness_ratio_db: (loudness.integrated_lufs > -140 && truePeak.available)
        ? U.round(truePeak.value_dbtp - loudness.integrated_lufs, 2) : null,
      dc_offset: dc.mean,
      dc_offset_dbfs: dc.dbfs,
      headroom_db: U.round(-samplePeak.peak_dbfs, 2),
      status: technicalStatus(clipping, truePeak, dc, samplePeak)
    };

    const customTarget = opt.customTarget || null;
    const platformId = opt.platformId || 'spotify';
    const measured = {
      integrated_lufs: loudness.integrated_lufs,
      true_peak_dbtp: truePeak.value_dbtp
    };
    const file = {
      name: input.fileName || 'untitled',
      size_bytes: input.fileSize == null ? null : input.fileSize,
      size_label: input.fileSize == null ? 'Not available' : U.fmtBytes(input.fileSize),
      duration_seconds: U.round(duration, 3),
      duration_label: U.fmtDuration(duration),
      sample_rate: sampleRate,
      channels: channels,
      channel_layout: format.layout,
      sample_count: length,
      format: input.format || 'Not available',
      codec: input.codec || 'Not available',
      bit_depth: input.bitDepth == null ? 'Not available' : input.bitDepth
    };

    reportProg('platform', 90);
    await U.yieldTick();
    const platform = Plat.analyzeSelected(platformId, measured, file, clipping, customTarget);
    const platformComparison = Plat.compareAll(measured, file, clipping, customTarget);
    const customFile = Plat.evaluateCustomFile(file, customTarget, clipping);

    const ctx = {
      clipping: clipping, true_peak: truePeak, loudness: loudness, dynamics: dynamics,
      stereo: stereo, phase: phase, mono: monoComp, spectrum: spectrum, dc: dc,
      platform: platform, silence: silence, distortion: distortion
    };
    const scores = Score.compute(ctx);
    const observations = Score.observations(ctx, scores);
    const executive = Score.executiveSummary(ctx, scores);
    const wave = U.downsampleMax(mono, 1800);

    let reference = { enabled: false, note: 'No reference master loaded.' };
    let ab = { enabled: false, note: 'No Master B loaded.' };

    if (!opt._skipNested && opt.reference && opt.reference.left) {
      const refRes = await analyzeCore(opt.reference, { platformId: platformId, customTarget: customTarget, _skipNested: true }, null);
      reference = comparePair(
        { loudness: loudness, true_peak: truePeak, technical: technical, dynamics: dynamics, spectrum: spectrum, stereo: stereo, phase: phase },
        refRes,
        'YOUR MASTER vs REFERENCE'
      );
      reference.file_name = opt.reference.fileName || 'reference';
    }
    if (!opt._skipNested && opt.masterB && opt.masterB.left) {
      const bRes = await analyzeCore(opt.masterB, { platformId: platformId, customTarget: customTarget, _skipNested: true }, null);
      ab = comparePair(
        { loudness: loudness, true_peak: truePeak, technical: technical, dynamics: dynamics, spectrum: spectrum, stereo: stereo, phase: phase },
        bRes,
        'MASTER A vs MASTER B'
      );
      ab.file_name = opt.masterB.fileName || 'master-b';
    }

    reportProg('report', 97);
    await U.yieldTick();

    const assembled = {
      analysis_timestamp: new Date().toISOString(),
      demo: !!opt.demo,
      warnings: warnings,
      file: file,
      master_format: format,
      technical: technical,
      sample_peak: samplePeak,
      true_peak: truePeak,
      clipping: clipping,
      dc: dc,
      loudness: loudness,
      dynamics: dynamics,
      loudness_peak_correlation: loudPeakCorr,
      spectrum: spectrum,
      stereo: stereo,
      phase: phase,
      mono: monoComp,
      silence: silence,
      fade: fade,
      distortion: distortion,
      platform: platform,
      platform_comparison: platformComparison,
      custom_file: customFile,
      scores: scores,
      observations: observations,
      executive: executive,
      reference: reference,
      ab: ab,
      analysis_ms: Date.now() - start
    };

    if (opt._skipNested) return Json.stripInternal(assembled);

    assembled.spectrum = Json.stripInternal(assembled.spectrum);
    assembled.loudness = Json.stripInternal(assembled.loudness);
    assembled.true_peak = Json.stripInternal(assembled.true_peak);

    const json = Json.buildJson(assembled);
    const textReport = Txt.buildTextReport(json);
    const htmlReport = Report.buildHtmlReport(json);

    reportProg('report', 100);

    return {
      json: json,
      textReport: textReport,
      htmlReport: htmlReport,
      assembled: assembled,
      visualization: {
        waveform: wave,
        spectrum: spectrum.display,
        spectrogram: {
          times: spectrum.spectrogram.times,
          logFreqs: spectrum.spectrogram.log_freq_hz,
          columns: spectrum.spectrogram.columns
        },
        loudnessTimeline: loudness.timeline,
        truePeakTimeline: truePeak.timeline,
        widthTimeline: stereo.width_timeline,
        dynamicsProfile: dynamics.profile,
        tonal: spectrum.groups,
        regions: spectrum.regions,
        stereo: stereo,
        phase: phase,
        clippingEvents: clipping.timestamps,
        truePeakEvents: truePeak.events,
        silence: silence,
        fade: fade
      }
    };
  }

  function recomputePlatform(assembled, platformId, customTarget) {
    const measured = {
      integrated_lufs: assembled.loudness.integrated_lufs,
      true_peak_dbtp: assembled.true_peak.value_dbtp
    };
    const platform = Plat.analyzeSelected(platformId, measured, assembled.file, assembled.clipping, customTarget);
    const platformComparison = Plat.compareAll(measured, assembled.file, assembled.clipping, customTarget);
    const customFile = Plat.evaluateCustomFile(assembled.file, customTarget, assembled.clipping);
    const ctx = {
      clipping: assembled.clipping, true_peak: assembled.true_peak, loudness: assembled.loudness,
      dynamics: assembled.dynamics, stereo: assembled.stereo, phase: assembled.phase,
      mono: assembled.mono, spectrum: assembled.spectrum, dc: assembled.dc,
      platform: platform, silence: assembled.silence, distortion: assembled.distortion
    };
    const scores = Score.compute(ctx);
    const observations = Score.observations(ctx, scores);
    const executive = Score.executiveSummary(ctx, scores);
    assembled.platform = platform;
    assembled.platform_comparison = platformComparison;
    assembled.custom_file = customFile;
    assembled.scores = scores;
    assembled.observations = observations;
    assembled.executive = executive;
    const json = Json.buildJson(assembled);
    return {
      json: json,
      textReport: Txt.buildTextReport(json),
      htmlReport: Report.buildHtmlReport(json),
      assembled: assembled
    };
  }

  /**
   * Stereo-ish demo master: bass, mid harmonics, stereo width, fade-in/out, leading silence.
   * Clearly labelled DEMO DATA by the caller.
   */
  function makeDemoBuffer(sampleRate) {
    const sr = sampleRate || 48000;
    const dur = 8.0;
    const n = Math.floor(sr * dur);
    const left = new Float32Array(n);
    const right = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let env = 1;
      if (t < 0.18) env = 0;
      else if (t < 0.55) env = (t - 0.18) / 0.37;
      else if (t > 7.1) env = Math.max(0, 1 - (t - 7.1) / 0.85);
      const section = (t > 2.4 && t < 5.2) ? 1.0 : 0.62;
      const bass = 0.22 * Math.sin(2 * Math.PI * 55 * t) + 0.12 * Math.sin(2 * Math.PI * 110 * t);
      const mid = 0.10 * Math.sin(2 * Math.PI * 330 * t) + 0.07 * Math.sin(2 * Math.PI * 660 * t);
      const high = 0.03 * Math.sin(2 * Math.PI * 4400 * t) + 0.02 * Math.sin(2 * Math.PI * 8800 * t);
      const width = 0.05 * Math.sin(2 * Math.PI * 920 * t + 0.7);
      const kick = ((t * 2) % 1 < 0.04) ? 0.35 * Math.exp(-((t * 2) % 1) * 40) * Math.sin(2 * Math.PI * 60 * t) : 0;
      const v = env * section * (bass + mid + high + kick);
      left[i] = Math.max(-0.97, Math.min(0.97, v + env * width));
      right[i] = Math.max(-0.97, Math.min(0.97, v - env * width * 0.85));
    }
    return {
      left: left,
      right: right,
      sampleRate: sr,
      fileName: 'mixlens-demo-master.wav',
      fileSize: n * 4,
      format: 'WAV (generated)',
      codec: 'PCM (generated demo)',
      bitDepth: 24,
      demo: true
    };
  }

  return {
    analyze: analyzeCore,
    recomputePlatform: recomputePlatform,
    STAGES: STAGES,
    makeDemoBuffer: makeDemoBuffer,
    Profiles: Profiles
  };
}));
