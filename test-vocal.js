'use strict';
/**
 * MixLens Vocal Engine 3.0 — synthetic-signal test harness.
 * Every assertion is against real DSP output. No fixture numbers.
 */

const U = require('./js/vocal-engine/utilities');
const Fft = require('./js/vocal-engine/fft');
const Clip = require('./js/vocal-engine/clipping');
const Hum = require('./js/vocal-engine/hum');
const Pitch = require('./js/vocal-engine/pitch');
const Spec = require('./js/vocal-engine/spectrum');
const Tonal = require('./js/vocal-engine/tonal-balance');
const Stereo = require('./js/vocal-engine/stereo');
const Engine = require('./js/vocal-engine/analyzer');
const Report = require('./js/vocal-engine/report-generator');
const Json = require('./js/vocal-engine/json-export');
const Pdf = require('./js/vocal-engine/pdf-export');

function makeMono(fs, dur, gen) {
  const n = Math.floor(fs * dur);
  const ch0 = new Float32Array(n);
  for (let i = 0; i < n; i++) ch0[i] = gen(i, fs);
  return {
    left: ch0, right: null, sampleRate: fs, fileName: 't.wav', fileSize: n * 2,
    format: 'WAV', codec: 'PCM', bitDepth: 16,
    getChannelData: () => ch0,
    length: n, duration: dur, numberOfChannels: 1
  };
}

function makeStereo(fs, dur, genL, genR) {
  const n = Math.floor(fs * dur);
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = genL(i, fs); R[i] = genR(i, fs); }
  return { left: L, right: R, sampleRate: fs, fileName: 'st.wav', fileSize: n * 4, format: 'WAV', codec: 'PCM', bitDepth: 16 };
}

let fails = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' — ' + detail : ''));
  if (!ok) fails++;
}

(async () => {
  console.log('=== MixLens Vocal Engine 3.0 Test Suite ===\n');
  const fs = 48000;

  console.log('--- DSP core ---');
  check('linearToDb(1) = 0', Math.abs(U.linearToDb(1) - 0) < 1e-6, String(U.linearToDb(1)));
  check('linearToDb(0.5) ≈ -6.02', Math.abs(U.linearToDb(0.5) + 6.0206) < 0.02, String(U.linearToDb(0.5)));
  check('freqToNote(440) = A4', U.freqToNote(440).note === 'A4', U.freqToNote(440).note);
  const fft = new Fft.FFT(1024);
  const re = new Float32Array(1024), im = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) re[i] = Math.sin(2 * Math.PI * 4 * i / 1024);
  fft.transform(re, im);
  const pwr = fft.powerSpectrum(re, im);
  check('FFT peak at bin 4', pwr[4] > pwr[3] && pwr[4] > pwr[5], 'p4=' + pwr[4].toFixed(4));

  console.log('\n--- 1. Clean mono vocal (harmonic stack) ---');
  const clean = makeMono(fs, 2.2, (i, s) => {
    const t = i / s;
    return 0.28 * Math.sin(2 * Math.PI * 220 * t) + 0.16 * Math.sin(2 * Math.PI * 440 * t) + 0.08 * Math.sin(2 * Math.PI * 660 * t);
  });
  const cleanA = await Engine.analyze(clean, {}, () => {});
  check('schema 3.0', cleanA.json.schema_version === '3.0');
  check('engine 3.0.0', cleanA.json.engine_version === '3.0.0');
  check('analysis_version 2026.08', cleanA.json.analysis_version === '2026.08');
  check('no clipping on clean sine stack', cleanA.json.clipping.classification === 'NO CLIPPING', cleanA.json.clipping.classification);
  check('16 tonal zones', cleanA.json.tonal_zones.length === 16, String(cleanA.json.tonal_zones.length));
  check('F0 near 220 Hz', cleanA.json.pitch.available && Math.abs(cleanA.json.pitch.median_f0_hz - 220) < 6, String(cleanA.json.pitch.median_f0_hz));
  check('health is a 0–100 integer', cleanA.json.recording_health.score >= 0 && cleanA.json.recording_health.score <= 100);
  check('text report titled', /MIXLENS VOCAL ANALYSIS REPORT/.test(cleanA.textReport));
  check('html report present', /MIXLENS VOCAL ANALYSIS REPORT/.test(cleanA.htmlReport));
  check('JSON has no fake bit depth invention when provided', cleanA.json.file.bit_depth === 16);

  console.log('\n--- 2. Clean stereo vocal ---');
  const st = makeStereo(fs, 1.2,
    (i, s) => 0.25 * Math.sin(2 * Math.PI * 196 * i / s),
    (i, s) => 0.25 * Math.sin(2 * Math.PI * 196 * i / s));
  const stA = await Engine.analyze(st, {}, () => {});
  check('stereo flagged applicable', stA.json.stereo.applicable === true);
  check('correlation ≈ 1', stA.json.stereo.correlation > 0.99, String(stA.json.stereo.correlation));

  console.log('\n--- 3. Clipped vocal ---');
  const clipped = makeMono(fs, 1.0, (i, s) => Math.max(-0.9996, Math.min(0.9996, 1.7 * Math.sin(2 * Math.PI * 220 * i / s))));
  const clipR = Clip.analyzeClipping(clipped.left, fs);
  check('clipping detected', clipR.clipped_samples > 40, String(clipR.clipped_samples));
  check('not classified as none', clipR.classification !== 'NO CLIPPING', clipR.classification);

  const nearFs = makeMono(fs, 0.4, (i, s) => 0.97 * Math.sin(2 * Math.PI * 220 * i / s));
  const nearR = Clip.analyzeClipping(nearFs.left, fs);
  check('near 0 dBFS without flats is not clipping', nearR.classification === 'NO CLIPPING', nearR.classification);

  console.log('\n--- 4. Noisy vocal ---');
  const noisy = makeMono(fs, 2.0, (i, s) => 0.18 * Math.sin(2 * Math.PI * 180 * i / s) + 0.08 * (Math.random() * 2 - 1));
  const noisyA = await Engine.analyze(noisy, {}, () => {});
  check('noise module ran', noisyA.json.noise.available === true || noisyA.json.noise.classification === 'Insufficient Signal');
  if (noisyA.json.noise.available) {
    check('noisy file has finite floor', isFinite(noisyA.json.noise.noise_floor_dbfs));
  }

  console.log('\n--- 5. Hum-contaminated vocal ---');
  const humBuf = makeMono(fs, 2.2, (i, s) => 0.008 * (Math.random() - 0.5) + 0.16 * Math.sin(2 * Math.PI * 50 * i / s) + 0.09 * Math.sin(2 * Math.PI * 100 * i / s));
  const humR = Hum.analyzeHum(humBuf.left, fs);
  check('50 Hz family detected', humR.detected && humR.fundamental_hz === 50, JSON.stringify({ d: humR.detected, f: humR.fundamental_hz, c: humR.confidence }));

  console.log('\n--- 6. Strong sibilance ---');
  const sib = makeMono(fs, 2.5, (i, s) => {
    const t = i / s;
    let v = 0.18 * Math.sin(2 * Math.PI * 200 * t);
    if (t >= 1.1 && t < 1.24) v += 0.55 * (Math.random() * 2 - 1) * Math.sin(2 * Math.PI * 7500 * t);
    return v;
  });
  const sibA = await Engine.analyze(sib, {}, () => {});
  check('sibilance events ≥ 1', sibA.json.sibilance.event_count >= 1, String(sibA.json.sibilance.event_count));

  console.log('\n--- 7. Strong plosives ---');
  const plo = makeMono(fs, 2.0, (i, s) => {
    const t = i / s;
    let v = 0.16 * Math.sin(2 * Math.PI * 210 * t);
    if (t >= 0.8 && t < 0.87) v += 0.75 * Math.sin(2 * Math.PI * 55 * (t - 0.8));
    return v;
  });
  const ploA = await Engine.analyze(plo, {}, () => {});
  check('plosive events ≥ 1', ploA.json.plosives.event_count >= 1, String(ploA.json.plosives.event_count));

  console.log('\n--- 8. Quiet vocal ---');
  const quiet = makeMono(fs, 1.2, (i, s) => 0.004 * Math.sin(2 * Math.PI * 190 * i / s));
  const quietA = await Engine.analyze(quiet, {}, () => {});
  check('quiet file does not crash', quietA.json.technical.sample_peak_dbfs < -40, String(quietA.json.technical.sample_peak_dbfs));

  console.log('\n--- 9. Highly dynamic vocal ---');
  const dyn = makeMono(fs, 3.0, (i, s) => {
    const t = i / s;
    const amp = (t > 1.2 && t < 2.2) ? 0.55 : 0.04;
    return amp * Math.sin(2 * Math.PI * 200 * t);
  });
  const dynA = await Engine.analyze(dyn, {}, () => {});
  check('wide or moderate variation measured', dynA.json.dynamics.variation_db > 6, String(dynA.json.dynamics.variation_db));

  console.log('\n--- 10. Silence ---');
  const sil = makeMono(fs, 0.8, () => 0);
  const silA = await Engine.analyze(sil, {}, () => {});
  check('silence analyzed', silA.json.file.duration_seconds > 0);
  check('silence ratio high', silA.json.technical.silence_ratio > 0.8, String(silA.json.technical.silence_ratio));

  console.log('\n--- 11. Music-only (unpitched noise-like) ---');
  const music = makeMono(fs, 1.5, (i, s) => 0.12 * Math.sin(2 * Math.PI * 110 * i / s) + 0.08 * Math.sin(2 * Math.PI * 330 * i / s) + 0.05 * Math.sin(2 * Math.PI * 880 * i / s));
  const musicA = await Engine.analyze(music, {}, () => {});
  check('music-only does not crash', !!musicA.json.spectrum.centroid_hz);

  console.log('\n--- 12. Very short file ---');
  let shortErr = null;
  try {
    await Engine.analyze(makeMono(fs, 0.04, (i, s) => 0.2 * Math.sin(2 * Math.PI * 220 * i / s)), {}, () => {});
  } catch (e) { shortErr = e.message; }
  check('very short file rejected clearly', !!shortErr && /short/i.test(shortErr), shortErr || 'no error');

  console.log('\n--- Stereo anti-phase ---');
  const ap = makeStereo(fs, 0.8,
    (i, s) => 0.3 * Math.sin(2 * Math.PI * 440 * i / s),
    (i, s) => -0.3 * Math.sin(2 * Math.PI * 440 * i / s));
  const apR = Stereo.analyzeStereo(ap.left, ap.right);
  check('anti-phase correlation ≈ -1', apR.correlation < -0.95, String(apR.correlation));
  check('critical phase', apR.phase_status === 'CRITICAL', apR.phase_status);

  console.log('\n--- YIN on A3 ---');
  const yin = Pitch.analyzePitch(clean.left, fs);
  check('YIN median near 220', yin.available && Math.abs(yin.median_f0_hz - 220) < 5, String(yin.median_f0_hz));

  console.log('\n--- Report / export ---');
  check('no EQ plan / VST fields', !cleanA.json.eqPlan && !cleanA.json.proQ4Preset);
  const rebuilt = Report.buildTextReport(cleanA.json);
  check('report deterministic from JSON', rebuilt.indexOf(cleanA.json.file.name) >= 0);
  const pdf = Pdf.buildPdf(cleanA.json, {});
  check('PDF bytes produced', pdf && pdf.length > 200, 'len=' + (pdf && pdf.length));
  check('demo flag isolated', cleanA.json.demo === false);

  const demo = Engine.makeDemoBuffer(48000);
  const demoA = await Engine.analyze(demo, { demo: true }, () => {});
  check('demo analysis marked DEMO', demoA.json.demo === true);
  check('demo is real DSP not empty', demoA.json.spectrum.centroid_hz > 0);

  console.log('\n========================================');
  console.log(fails === 0 ? 'ALL VOCAL ENGINE 3.0 TESTS PASSED' : fails + ' TEST(S) FAILED');
  console.log('========================================');
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => {
  console.error('Test execution error:', e);
  process.exit(1);
});
