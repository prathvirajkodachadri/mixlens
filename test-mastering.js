'use strict';
/**
 * MixLens Final Mastering Analysis 1.0 — synthetic-signal test harness.
 * Every assertion is against real DSP output. No fixture numbers.
 */

const U = require('./js/mastering/utilities');
const Fft = require('./js/mastering/fft');
const Clip = require('./js/mastering/clipping');
const TP = require('./js/mastering/true-peak');
const Stereo = require('./js/mastering/stereo');
const Phase = require('./js/mastering/phase');
const Silence = require('./js/mastering/silence');
const Fade = require('./js/mastering/fade');
const Profiles = require('./js/mastering/platform-profiles');
const Plat = require('./js/mastering/platform-analysis');
const Engine = require('./js/mastering/analyzer');
const Txt = require('./js/mastering/export-txt');
const Pdf = require('./js/mastering/export-pdf');

function makeMono(fs, dur, gen) {
  const n = Math.floor(fs * dur);
  const ch0 = new Float32Array(n);
  for (let i = 0; i < n; i++) ch0[i] = gen(i, fs);
  return {
    left: ch0, right: null, sampleRate: fs, fileName: 't.wav', fileSize: n * 2,
    format: 'WAV', codec: 'PCM', bitDepth: 24, channels: 1
  };
}

function makeStereo(fs, dur, genL, genR) {
  const n = Math.floor(fs * dur);
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = genL(i, fs); R[i] = genR(i, fs); }
  return { left: L, right: R, sampleRate: fs, fileName: 'st.wav', fileSize: n * 4, format: 'WAV', codec: 'PCM', bitDepth: 24, channels: 2 };
}

let fails = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' — ' + detail : ''));
  if (!ok) fails++;
}

(async () => {
  console.log('=== MixLens Final Mastering Analysis 1.0 Test Suite ===\n');
  const fs = 48000;

  console.log('--- DSP core ---');
  check('linearToDb(1) = 0', Math.abs(U.linearToDb(1) - 0) < 1e-6, String(U.linearToDb(1)));
  check('linearToDb(0.5) ≈ -6.02', Math.abs(U.linearToDb(0.5) + 6.0206) < 0.02, String(U.linearToDb(0.5)));
  const fft = new Fft.FFT(1024);
  const re = new Float32Array(1024), im = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) re[i] = Math.sin(2 * Math.PI * 4 * i / 1024);
  fft.transform(re, im);
  const pwr = fft.powerSpectrum(re, im);
  check('FFT peak at bin 4', pwr[4] > pwr[3] && pwr[4] > pwr[5], 'p4=' + pwr[4].toFixed(4));
  check('platform profiles editable module', !!Profiles.get('spotify') && Profiles.get('spotify').loudness_reference_lufs === -14);
  check('disclaimer present', /playback-dependent/i.test(Profiles.DISCLAIMER));

  console.log('\n--- 1. Quiet master ---');
  const quiet = makeMono(fs, 1.4, (i, s) => 0.004 * Math.sin(2 * Math.PI * 220 * i / s));
  const quietA = await Engine.analyze(quiet, { platformId: 'spotify' }, () => {});
  check('schema 1.0', quietA.json.schema_version === '1.0');
  check('engine 1.0.0', quietA.json.engine_version === '1.0.0');
  check('engine name', quietA.json.engine === 'Final Mastering Analysis');
  check('quiet peak < -40 dBFS', quietA.json.technical.sample_peak_dbfs < -40, String(quietA.json.technical.sample_peak_dbfs));
  check('no invented bit depth', quietA.json.file.bit_depth === 24);

  console.log('\n--- 2. Very loud master ---');
  const loud = makeMono(fs, 1.5, (i, s) => 0.89 * Math.sin(2 * Math.PI * 100 * i / s));
  const loudA = await Engine.analyze(loud, { platformId: 'spotify' }, () => {});
  check('loud integrated above -10 LUFS', loudA.json.loudness.integrated_lufs > -10, String(loudA.json.loudness.integrated_lufs));
  check('loudness is a finite number', isFinite(loudA.json.loudness.integrated_lufs));

  console.log('\n--- 3. Clipped master ---');
  const clipped = makeMono(fs, 1.0, (i, s) => Math.max(-0.9996, Math.min(0.9996, 1.7 * Math.sin(2 * Math.PI * 220 * i / s))));
  const clipR = Clip.analyzeClipping(clipped.left, null, fs);
  check('clipping detected', clipR.clipped_samples > 40, String(clipR.clipped_samples));
  check('not classified as none', clipR.classification !== 'NO CLIPPING', clipR.classification);
  const nearFs = makeMono(fs, 0.5, (i, s) => 0.97 * Math.sin(2 * Math.PI * 220 * i / s));
  const nearR = Clip.analyzeClipping(nearFs.left, null, fs);
  check('near 0 dBFS without flats is not clipping', nearR.classification === 'NO CLIPPING', nearR.classification);

  console.log('\n--- 4. High true peak ---');
  const ht = makeMono(fs, 0.8, (i, s) => 0.96 * Math.sin(2 * Math.PI * 997 * i / s));
  const tpR = TP.analyzeTruePeak(ht.left, null, fs);
  check('true peak estimated', tpR.estimated === true && tpR.available === true);
  check('true peak >= sample peak', tpR.value_dbtp + 0.05 >= tpR.sample_peak_dbfs, tpR.value_dbtp + ' vs ' + tpR.sample_peak_dbfs);

  console.log('\n--- 5. Wide dynamic master ---');
  const dyn = makeMono(fs, 4.0, (i, s) => {
    const t = i / s;
    const amp = (t > 1.5 && t < 2.8) ? 0.6 : 0.03;
    return amp * Math.sin(2 * Math.PI * 200 * t);
  });
  const dynA = await Engine.analyze(dyn, {}, () => {});
  check('wide variation measured', dynA.json.dynamics.dynamic_range_estimate_db > 8, String(dynA.json.dynamics.dynamic_range_estimate_db));

  console.log('\n--- 6. Very compressed master ---');
  const comp = makeMono(fs, 1.6, (i, s) => {
    const x = 0.85 * Math.sin(2 * Math.PI * 120 * i / s);
    return Math.max(-0.86, Math.min(0.86, x * 1.4));
  });
  const compA = await Engine.analyze(comp, {}, () => {});
  check('crest factor finite', isFinite(compA.json.dynamics.crest_factor_db));
  check('crest not labelled official DR', /not an official/i.test(compA.json.dynamics.crest_factor_note || ''));

  console.log('\n--- 7. Mono master ---');
  const mono = makeMono(fs, 1.2, (i, s) => 0.25 * Math.sin(2 * Math.PI * 196 * i / s));
  const monoA = await Engine.analyze(mono, {}, () => {});
  check('mono flagged', monoA.json.stereo.applicable === false);
  check('master format mono', /Mono/i.test(monoA.json.master_format.layout));

  console.log('\n--- 8. Wide stereo master ---');
  const wide = makeStereo(fs, 1.2,
    (i, s) => 0.3 * Math.sin(2 * Math.PI * 330 * i / s),
    (i, s) => 0.3 * Math.sin(2 * Math.PI * 440 * i / s));
  const wideA = await Engine.analyze(wide, {}, () => {});
  check('stereo applicable', wideA.json.stereo.applicable === true);
  check('side energy present', wideA.json.stereo.stereo_width_percent > 10, String(wideA.json.stereo.stereo_width_percent));

  console.log('\n--- 9. Phase-problem master ---');
  const ap = makeStereo(fs, 0.9,
    (i, s) => 0.3 * Math.sin(2 * Math.PI * 440 * i / s),
    (i, s) => -0.3 * Math.sin(2 * Math.PI * 440 * i / s));
  const apR = Stereo.analyzeStereo(ap.left, ap.right, fs);
  const phR = Phase.analyzePhase(ap.left, ap.right, fs);
  check('anti-phase correlation ≈ -1', apR.correlation < -0.95, String(apR.correlation));
  check('phase status fail or warning', phR.status === 'FAIL' || phR.status === 'WARNING', phR.status);
  check('mono compatibility poor/critical', ['Poor', 'Critical'].indexOf((await Engine.analyze(ap, {}, () => {})).json.mono_compatibility.rating) >= 0);

  console.log('\n--- 10. Low-frequency-heavy master ---');
  const lf = makeMono(fs, 1.5, (i, s) => 0.45 * Math.sin(2 * Math.PI * 35 * i / s) + 0.05 * Math.sin(2 * Math.PI * 1000 * i / s));
  const lfA = await Engine.analyze(lf, {}, () => {});
  check('LF energy share elevated vs air', lfA.json.spectrum.low_frequency_energy_percent > lfA.json.spectrum.high_frequency_energy_percent,
    lfA.json.spectrum.low_frequency_energy_percent + ' vs ' + lfA.json.spectrum.high_frequency_energy_percent);

  console.log('\n--- 11. High-frequency-heavy master ---');
  const hf = makeMono(fs, 1.5, (i, s) => 0.08 * Math.sin(2 * Math.PI * 120 * i / s) + 0.35 * Math.sin(2 * Math.PI * 9000 * i / s));
  const hfA = await Engine.analyze(hf, {}, () => {});
  check('centroid well above 1 kHz', hfA.json.spectrum.centroid_hz > 1000, String(hfA.json.spectrum.centroid_hz));

  console.log('\n--- 12. Master with silence ---');
  const sil = makeMono(fs, 2.2, (i, s) => {
    const t = i / s;
    if (t < 0.35 || t > 1.9) return 0;
    return 0.2 * Math.sin(2 * Math.PI * 220 * t);
  });
  const silA = await Engine.analyze(sil, {}, () => {});
  check('leading silence > 0.2 s', silA.json.silence.leading_seconds >= 0.2, String(silA.json.silence.leading_seconds));
  check('trailing silence > 0.2 s', silA.json.silence.trailing_seconds >= 0.2, String(silA.json.silence.trailing_seconds));

  console.log('\n--- 13. Master with fade ---');
  const fadeBuf = makeMono(fs, 2.5, (i, s) => {
    const t = i / s;
    let env = 1;
    if (t < 0.6) env = t / 0.6;
    if (t > 1.8) env = Math.max(0, 1 - (t - 1.8) / 0.7);
    return env * 0.3 * Math.sin(2 * Math.PI * 330 * t);
  });
  const fadeR = Fade.analyzeFade(fadeBuf.left, fs, Silence.analyzeSilence(fadeBuf.left, fs));
  check('fade-in present', fadeR.fade_in.present === true, JSON.stringify(fadeR.fade_in));
  check('fade-out present', fadeR.fade_out.present === true, JSON.stringify(fadeR.fade_out));

  console.log('\n--- 14. Reference-comparison case ---');
  const a = makeMono(fs, 1.2, (i, s) => 0.3 * Math.sin(2 * Math.PI * 220 * i / s));
  const b = makeMono(fs, 1.2, (i, s) => 0.15 * Math.sin(2 * Math.PI * 220 * i / s));
  b.fileName = 'ref.wav';
  const cmpA = await Engine.analyze(a, { reference: b }, () => {});
  check('reference comparison enabled', cmpA.json.reference_comparison.enabled === true);
  check('loudness difference reported', cmpA.json.reference_comparison.loudness_difference_lu != null);
  check('loudness-matched label', /LOUDNESS-MATCHED COMPARISON/.test(cmpA.json.reference_comparison.loudness_matched_note || ''));

  console.log('\n--- 15. Custom-target case ---');
  const custom = await Engine.analyze(loud, {
    platformId: 'custom',
    customTarget: { target_lufs: -23, max_true_peak_dbtp: -1, min_sample_rate_hz: 48000, preferred_bit_depth: 24, channels: 'stereo' }
  }, () => {});
  check('custom platform selected', custom.json.platform_analysis.platform_id === 'custom');
  check('custom file check ran', custom.json.custom_target.enabled === true);
  check('stereo requirement flags mono', custom.json.custom_target.status === 'FAIL' || (custom.json.custom_target.findings || []).length > 0);

  console.log('\n--- Platform comparison / scoring / exports ---');
  const clean = makeStereo(fs, 1.4,
    (i, s) => 0.2 * Math.sin(2 * Math.PI * 220 * i / s),
    (i, s) => 0.2 * Math.sin(2 * Math.PI * 220 * i / s));
  const cleanA = await Engine.analyze(clean, { platformId: 'apple_music' }, () => {});
  check('all platforms compared', cleanA.json.platform_comparison.length >= 10, String(cleanA.json.platform_comparison.length));
  check('QC score 0–100', cleanA.json.qc_score.score >= 0 && cleanA.json.qc_score.score <= 100);
  check('score breakdown disclosed', !!cleanA.json.qc_score.breakdown && !!cleanA.json.qc_score.weights);
  check('delivery status set', typeof cleanA.json.delivery_status === 'string' && cleanA.json.delivery_status.length > 0);
  check('true peak labelled estimated', cleanA.json.true_peak.estimated === true);
  check('no EQ advice language', !/boost 10 kHz|set limiter|4:1 compressor/i.test(cleanA.textReport));
  check('text report titled', /MIXLENS FINAL MASTERING ANALYSIS/.test(cleanA.textReport));
  check('html report present', /MIXLENS FINAL MASTERING ANALYSIS/.test(cleanA.htmlReport));
  const rebuilt = Txt.buildTextReport(cleanA.json);
  check('report deterministic from JSON', rebuilt.indexOf(cleanA.json.file.name) >= 0);
  const pdf = Pdf.buildPdf(cleanA.json, {});
  check('PDF bytes produced', pdf && pdf.length > 200, 'len=' + (pdf && pdf.length));
  check('demo flag isolated', cleanA.json.demo === false);

  const demo = Engine.makeDemoBuffer(48000);
  const demoA = await Engine.analyze(demo, { demo: true }, () => {});
  check('demo analysis marked DEMO', demoA.json.demo === true);
  check('demo is real DSP not empty', demoA.json.spectrum.centroid_hz > 0);
  check('demo fade-in likely', demoA.json.fade.fade_in.present === true || demoA.json.silence.leading_seconds > 0.1);

  console.log('\n--- Short / silent error handling ---');
  const silent = makeMono(fs, 0.9, () => 0);
  const silFile = await Engine.analyze(silent, {}, () => {});
  check('silence does not crash', silFile.json.file.duration_seconds > 0);
  let shortErr = null;
  try {
    await Engine.analyze(makeMono(fs, 0.04, (i, s) => 0.2 * Math.sin(2 * Math.PI * 220 * i / s)), {}, () => {});
  } catch (e) { shortErr = e.message; }
  check('very short file rejected clearly', !!shortErr && /short/i.test(shortErr), shortErr || 'no error');

  const dual = Stereo.analyzeStereo(clean.left, clean.right, fs);
  check('identical L/R is dual mono or high correlation', dual.correlation > 0.99, String(dual.correlation));

  const platRow = Plat.analyzeSelected('bandcamp', { integrated_lufs: -9, true_peak_dbtp: -0.2 }, { sample_rate: 44100, channels: 2, channel_layout: 'Stereo' }, { status: 'PASS', detected: false });
  check('Bandcamp has no loudness reference', platRow.loudness_reference_lufs == null);

  console.log('\n========================================');
  console.log(fails === 0 ? 'ALL FINAL MASTERING ANALYSIS TESTS PASSED' : fails + ' TEST(S) FAILED');
  console.log('========================================');
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => {
  console.error('Test execution error:', e);
  process.exit(1);
});
