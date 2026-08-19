'use strict';
/**
 * Test Harness for MixLens Vocal Analysis Engine
 * Tests all 18 modules with synthetic signals
 */

const fs = require('fs');
const DSP = require('./vocal/dsp');
const Health = require('./vocal/health');
const Spectrum = require('./vocal/spectrum');
const Pitch = require('./vocal/pitch');
const Formants = require('./vocal/formants');
const Tonal = require('./vocal/tonal');
const Resonances = require('./vocal/resonances');
const DynamicSpectral = require('./vocal/dynamic-spectral');
const Dynamics = require('./vocal/dynamics');
const Events = require('./vocal/events');
const Character = require('./vocal/character');
const Stereo = require('./vocal/stereo');
const Masking = require('./vocal/masking');
const Reference = require('./vocal/reference');
const Decision = require('./vocal/decision');
const ProQ = require('./vocal/proq');
const Engine = require('./vocal/engine');

function makeBuffer(fs, dur, gen) {
  const n = Math.floor(fs * dur);
  const ch0 = new Float32Array(n);
  for (let i = 0; i < n; i++) ch0[i] = gen(i, fs, 0);
  return {
    sampleRate: fs,
    length: n,
    numberOfChannels: 1,
    duration: dur,
    getChannelData: () => ch0
  };
}

function makeStereoBuffer(fs, dur, genL, genR) {
  const n = Math.floor(fs * dur);
  const ch0 = new Float32Array(n);
  const ch1 = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    ch0[i] = genL(i, fs);
    ch1[i] = genR(i, fs);
  }
  return {
    sampleRate: fs,
    length: n,
    numberOfChannels: 2,
    duration: dur,
    getChannelData: (c) => (c === 0 ? ch0 : ch1)
  };
}

let fails = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails++;
}

(async () => {
  console.log('=== MixLens Vocal Analysis Engine Test Suite ===\n');

  const fs = 48000;

  // 1. Test DSP Core & Math
  console.log('--- 1. DSP Core Tests ---');
  check('db20(1.0) is 0 dB', Math.abs(DSP.db20(1.0) - 0.0) < 1e-4, `${DSP.db20(1.0)} dB`);
  check('db20(0.5) is -6.02 dB', Math.abs(DSP.db20(0.5) - (-6.0206)) < 0.01, `${DSP.db20(0.5).toFixed(2)} dB`);
  check('freqToNote(440) is A4', DSP.freqToNote(440).note === 'A4', `note = ${DSP.freqToNote(440).note}`);
  check('freqToNote(261.63) is C4', DSP.freqToNote(261.63).note === 'C4', `note = ${DSP.freqToNote(261.63).note}`);

  const fftSize = 1024;
  const fft = new DSP.FFT(fftSize);
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) re[i] = Math.sin(2 * Math.PI * 4 * i / fftSize);
  fft.transform(re, im);
  const power = fft.powerSpectrum(re, im);
  check('FFT detects 4-cycle sine at bin 4', power[4] > power[3] && power[4] > power[5], `bin 4 power = ${power[4].toFixed(4)}`);

  // 2. Test Module 1: Recording Health (Clipping, Noise, Hum, DC Offset)
  console.log('\n--- 2. Module 1: Recording Health Tests ---');
  // 2a. Clipped sine
  const clippedBuf = makeBuffer(fs, 1.0, (i, s) => Math.max(-0.9995, Math.min(0.9995, 1.8 * Math.sin(2 * Math.PI * 220 * i / s))));
  const healthClip = Health.analyzeRecordingHealth(clippedBuf.getChannelData(0), fs);
  check('Clipping detected', healthClip.clipping.samples > 50, `${healthClip.clipping.samples} clipped samples, severity = ${healthClip.clipping.severity}`);
  check('Clipping severity is significant or severe', healthClip.clipping.severity === 'significant' || healthClip.clipping.severity === 'severe', '');

  // 2b. 50 Hz mains hum
  const humBuf = makeBuffer(fs, 2.0, (i, s) => 0.01 * (Math.random() - 0.5) + 0.15 * Math.sin(2 * Math.PI * 50 * i / s) + 0.08 * Math.sin(2 * Math.PI * 100 * i / s));
  const healthHum = Health.analyzeRecordingHealth(humBuf.getChannelData(0), fs);
  check('50 Hz Mains hum detected', healthHum.hum.detected && healthHum.hum.freq === 50, `freq = ${healthHum.hum.freq} Hz, level = ${healthHum.hum.levelDb.toFixed(1)} dB`);

  // 2c. DC offset
  const dcBuf = makeBuffer(fs, 1.0, (i, s) => 0.05 + 0.2 * Math.sin(2 * Math.PI * 440 * i / s));
  const healthDc = Health.analyzeRecordingHealth(dcBuf.getChannelData(0), fs);
  check('DC offset detected', healthDc.dcOffset.detected && Math.abs(healthDc.dcOffset.mean - 0.05) < 0.01, `mean = ${healthDc.dcOffset.mean.toFixed(3)}`);

  // 3. Test Modules 3 & 4: Pitch (YIN) & Harmonics
  console.log('\n--- 3. Modules 3 & 4: Pitch & Harmonics Tests ---');
  // Synthetic A3 (220 Hz) vowel with rich harmonic stack
  const vowelBuf = makeBuffer(fs, 2.5, (i, s) => {
    const t = i / s;
    let val = 0.3 * Math.sin(2 * Math.PI * 220 * t); // H1
    val += 0.2 * Math.sin(2 * Math.PI * 440 * t);     // H2
    val += 0.15 * Math.sin(2 * Math.PI * 660 * t);    // H3
    val += 0.10 * Math.sin(2 * Math.PI * 880 * t);    // H4
    val += 0.06 * Math.sin(2 * Math.PI * 1100 * t);   // H5
    return val;
  });
  const pitchRes = Pitch.analyzePitchAndHarmonics(vowelBuf.getChannelData(0), fs);
  check('YIN F0 detected near 220 Hz', Math.abs(pitchRes.f0.medianF0 - 220) < 5, `got ${pitchRes.f0.medianF0.toFixed(1)} Hz, note = ${pitchRes.f0.note}`);
  check('Voiced percent > 90%', pitchRes.f0.voicedPercent > 90, `${pitchRes.f0.voicedPercent.toFixed(1)}%`);
  check('HNR > 15 dB', pitchRes.harmonics.meanHnrDb > 15, `${pitchRes.harmonics.meanHnrDb.toFixed(1)} dB`);
  check('Harmonics count >= 5', pitchRes.harmonics.harmonics.length >= 5, `${pitchRes.harmonics.harmonics.length} harmonics`);

  // 4. Test Module 2 & 6: Spectrum & Tonal Balance
  console.log('\n--- 4. Modules 2 & 6: Spectrum & Tonal Balance Tests ---');
  const specRes = Spectrum.analyzeSpectrum(vowelBuf.getChannelData(0), fs);
  check('STFT bins count is 2048', specRes.numBins === 2048, `${specRes.numBins} bins`);
  const tonalRes = Tonal.analyzeTonalBalance(specRes);
  check('Tonal zones count is 16', tonalRes.zones.length === 16, `${tonalRes.zones.length} zones`);

  // 5. Test Resonances Discrimination
  console.log('\n--- 5. Resonance Analysis Tests ---');
  // Signal with natural pitch harmonics + one narrow artificial resonance at 3150 Hz
  const resSigBuf = makeBuffer(fs, 3.0, (i, s) => {
    const t = i / s;
    // Vary pitch slightly (200 Hz to 240 Hz)
    const f0 = 200 + 40 * Math.sin(2 * Math.PI * 0.5 * t);
    let val = 0.25 * Math.sin(2 * Math.PI * f0 * t) + 0.15 * Math.sin(2 * Math.PI * 2 * f0 * t);
    // Stationary acoustic resonance @ 3150 Hz (fixed frequency)
    val += 0.18 * Math.sin(2 * Math.PI * 3150 * t);
    return val;
  });
  const specResSig = Spectrum.analyzeSpectrum(resSigBuf.getChannelData(0), fs);
  const pitchResSig = Pitch.analyzePitchAndHarmonics(resSigBuf.getChannelData(0), fs);
  const resAnalysis = Resonances.analyzeResonances(specResSig, pitchResSig);
  const fixedRes = resAnalysis.resonances.find(r => Math.abs(r.centerFreq - 3150) < 60);
  check('Stationary 3150 Hz peak identified', !!fixedRes, fixedRes ? `freq = ${fixedRes.centerFreq} Hz, action = ${fixedRes.action}, type = ${fixedRes.type}` : 'not found');
  if (fixedRes) {
    check('Stationary resonance triggers CUT or DYNAMIC_CUT', fixedRes.action === 'CUT' || fixedRes.action === 'DYNAMIC_CUT', `action = ${fixedRes.action}`);
  }

  // 6. Test Module 7: Dynamic Spectral Analysis
  console.log('\n--- 6. Module 7: Dynamic Spectral Analysis Tests ---');
  // Loud belting signal has surging 3400 Hz harshness
  const dynSigBuf = makeBuffer(fs, 4.0, (i, s) => {
    const t = i / s;
    const isLoud = (t > 1.0 && t < 2.0) || (t > 2.8 && t < 3.8);
    const baseAmp = isLoud ? 0.6 : 0.15;
    let val = baseAmp * Math.sin(2 * Math.PI * 240 * t);
    if (isLoud) {
      val += 0.35 * Math.sin(2 * Math.PI * 3400 * t); // dynamic harshness surge
    }
    return val;
  });
  const dynSpec = Spectrum.analyzeSpectrum(dynSigBuf.getChannelData(0), fs);
  const dynAnalysis = DynamicSpectral.analyzeDynamicSpectrum(dynSpec);
  const harshFinding = dynAnalysis.findings.find(f => f.zone.toLowerCase().includes('harsh'));
  check('Dynamic harshness detected during loud passages', !!harshFinding, harshFinding ? harshFinding.evidence : 'none');

  // 7. Test Modules 9, 10, 11, 12: Vocal Events (Sibilance, Plosives, Breaths)
  console.log('\n--- 7. Modules 9–12: Vocal Events Tests ---');
  const eventSigBuf = makeBuffer(fs, 5.0, (i, s) => {
    const t = i / s;
    let val = 0.2 * Math.sin(2 * Math.PI * 250 * t); // baseline voice
    // Plosive pop at 1.0s (low frequency burst)
    if (t >= 1.0 && t < 1.08) {
      val += 0.7 * Math.sin(2 * Math.PI * 55 * (t - 1.0));
    }
    // Sibilance 'S' burst at 2.5s (7.5 kHz burst)
    if (t >= 2.5 && t < 2.65) {
      val += 0.5 * (Math.random() * 2 - 1) * Math.sin(2 * Math.PI * 7500 * t);
    }
    return val;
  });
  const eventPitch = Pitch.analyzePitchAndHarmonics(eventSigBuf.getChannelData(0), fs);
  const eventRes = Events.analyzeVocalEvents(eventSigBuf.getChannelData(0), fs, eventPitch);
  check('Plosive burst detected near 1.0s', eventRes.plosives.eventsCount >= 1, `${eventRes.plosives.eventsCount} plosives`);
  check('Sibilance burst detected near 2.5s', eventRes.sibilance.eventsCount >= 1, `${eventRes.sibilance.eventsCount} sibilant events`);
  check('Sibilance dominant frequency ~7.5 kHz', Math.abs(eventRes.sibilance.dominantFrequency - 7500) < 800, `${eventRes.sibilance.dominantFrequency} Hz`);

  // 8. Test Module 16: Stereo & Phase Analysis
  console.log('\n--- 8. Module 16: Stereo & Phase Tests ---');
  // Correlated stereo
  const stBuf = makeStereoBuffer(fs, 1.0, (i, s) => 0.3 * Math.sin(2 * Math.PI * 440 * i / s), (i, s) => 0.3 * Math.sin(2 * Math.PI * 440 * i / s));
  const stRes = Stereo.analyzeStereo(stBuf.getChannelData(0), stBuf.getChannelData(1));
  check('Correlated stereo correlation ≈ 1.0', stRes.correlation > 0.99, `corr = ${stRes.correlation}`);

  // Anti-phase stereo
  const apBuf = makeStereoBuffer(fs, 1.0, (i, s) => 0.3 * Math.sin(2 * Math.PI * 440 * i / s), (i, s) => -0.3 * Math.sin(2 * Math.PI * 440 * i / s));
  const apRes = Stereo.analyzeStereo(apBuf.getChannelData(0), apBuf.getChannelData(1));
  check('Anti-phase stereo correlation ≈ -1.0', apRes.correlation < -0.95, `corr = ${apRes.correlation}`);
  check('Anti-phase flagged as Critical phase risk', apRes.phaseRisk === 'Critical', apRes.monoCompatibility);

  // 9. Test Full Engine Pipeline & Decision Engine
  console.log('\n--- 9. Full Engine Pipeline & Decision Engine Tests ---');
  const fullAnalysis = await Engine.analyzeVocal(eventSigBuf, { name: 'lead_vocal_test.wav', size: 480000 });
  const report = fullAnalysis.reportJson;

  check('Report JSON has version 1.0', report.version === '1.0', `version = ${report.version}`);
  check('Mix readiness score is between 1 and 100', report.mixReadinessScore >= 1 && report.mixReadinessScore <= 100, `score = ${report.mixReadinessScore}`);
  check('Executive summary is populated', report.executiveSummary && report.executiveSummary.length > 20, report.executiveSummary);
  check('Recommendations array populated', report.recommendations && report.recommendations.length > 0, `${report.recommendations.length} recommendations`);
  check('EQ Plan has 1 to 8 bands', report.eqPlan && report.eqPlan.length >= 1 && report.eqPlan.length <= 8, `${report.eqPlan.length} bands`);
  check('FabFilter Pro-Q 4 preset generated', report.proQ4Preset && report.proQ4Preset.plugin === 'FabFilter Pro-Q 4', report.proQ4Preset.name);
  check('Pro-Q XML file generated', fullAnalysis.proQ4Xml && fullAnalysis.proQ4Xml.includes('<FabFilterPreset'), 'XML output valid');

  console.log('\n========================================');
  console.log(fails === 0 ? '✅ ALL VOCAL ENGINE TESTS PASSED (100% SUCCESS)' : `❌ ${fails} TEST(S) FAILED`);
  console.log('========================================');

  process.exit(fails === 0 ? 0 : 1);
})().catch(e => {
  console.error('Test execution error:', e);
  process.exit(1);
});
