/* Node test suite for the VoxLens vocal-chain DSP (vox-dsp.js).
   Run:  node test-vox.js
   Synthesizes test signals, runs them through VoxChain blocks,
   and verifies each module's behavior numerically. */
'use strict';

const D = require('./vox-dsp.js');
const { VoxChain, Biquad } = D;

const FS = 48000;
let fails = 0, total = 0;

function check(name, cond, detail) {
  total++;
  if (!cond) fails++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

/* ---------- signal helpers ---------- */
function sine(freq, dur, amp, phase = 0) {
  const n = Math.floor(FS * dur);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin(2 * Math.PI * freq * i / FS + phase);
  return x;
}
function noisy(dur, amp) {
  const n = Math.floor(FS * dur);
  const x = new Float32Array(n);
  let s = 12345;
  for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; x[i] = amp * ((s / 0x7fffffff) * 2 - 1); }
  return x;
}
const amp2db = a => 20 * Math.log10(a + 1e-12);
function rmsDb(x, from = 0, to = x.length) {
  let s = 0, c = 0;
  for (let i = from; i < to; i++) { s += x[i] * x[i]; c++; }
  return amp2db(Math.sqrt(s / Math.max(1, c)));
}
function peakDb(x, from = 0, to = x.length) {
  let p = 0;
  for (let i = from; i < to; i++) { const a = Math.abs(x[i]); if (a > p) p = a; }
  return amp2db(p);
}
/* Goertzel magnitude at freq f, in dBFS, over [from, to) */
function magDb(x, f, from = 0, to = x.length) {
  const w = 2 * Math.PI * f / FS;
  const c = Math.cos(w), s = Math.sin(w);
  let re = 0, im = 0, cnt = 0;
  for (let i = from; i < to; i++) { re += x[i] * Math.cos(w * i); im -= x[i] * Math.sin(w * i); cnt++; }
  const mag = Math.sqrt(re * re + im * im) * 2 / cnt; // sine amplitude
  return amp2db(mag);
}
function allFinite(chans) {
  return chans.every(d => { for (let i = 0; i < d.length; i++) if (!Number.isFinite(d[i])) return false; return true; });
}

/** Run channel arrays through a fresh chain in 128-sample blocks. Input is copied first. */
function run(chans, params) {
  const chain = new VoxChain(FS, chans.length);
  chain.setParams(params);
  const n = chans[0].length;
  const ins = chans.map(d => d.slice());
  const outs = chans.map(() => new Float32Array(n));
  const parts = chans.map(() => new Float32Array(128));
  for (let off = 0; off < n; off += 128) {
    const len = Math.min(128, n - off);
    for (let c = 0; c < chans.length; c++) {
      parts[c].set(ins[c].subarray(off, off + len));
      if (len < 128) parts[c].fill(0, len);
    }
    chain.processBlock(parts, len);
    for (let c = 0; c < chans.length; c++) outs[c].set(parts[c].subarray(0, len), off);
  }
  return outs;
}

/* ==================== 1) passthrough identity ==================== */
{
  const x = [noisy(0.5, 0.3)];
  const y = run(x, { eqOn: 0, limOn: 0 });
  let maxDiff = 0;
  for (let i = 0; i < x[0].length; i++) maxDiff = Math.max(maxDiff, Math.abs(x[0][i] - y[0][i]));
  check('passthrough is bit-transparent (all modules off)', maxDiff === 0, `maxDiff=${maxDiff}`);
}

/* bypass flag identity */
{
  const x = [noisy(0.3, 0.3)];
  const y = run(x, { bypass: 1, cmpOn: 1, cmpThr: -40, cmpRatio: 20, satOn: 1, satDrive: 24, satMix: 1, eqAir: 12 });
  let maxDiff = 0;
  for (let i = 0; i < x[0].length; i++) maxDiff = Math.max(maxDiff, Math.abs(x[0][i] - y[0][i]));
  check('bypass=1 is bit-transparent even with extreme settings', maxDiff === 0, `maxDiff=${maxDiff}`);
}

/* ==================== 2) biquad sanity ==================== */
{
  const b = new Biquad();
  b.set('highshelf', FS, 10000, 0.707, 6);
  const x = sine(15000, 0.4, 0.5);
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = b.proc(x[i]);
  const got = magDb(y, 15000) - magDb(x, 15000);
  check('highshelf +6 dB @10k lifts 15 kHz by ~6 dB', Math.abs(got - 6) < 0.7, `got ${got.toFixed(2)} dB`);

  const l = new Biquad();
  l.set('lowshelf', FS, 180, 0.707, -6);
  const x2 = sine(60, 0.5, 0.5);
  const y2 = new Float32Array(x2.length);
  for (let i = 0; i < x2.length; i++) y2[i] = l.proc(x2[i]);
  const got2 = magDb(y2, 60) - magDb(x2, 60);
  check('lowshelf −6 dB @180 cuts 60 Hz by ~6 dB', Math.abs(got2 + 6) < 0.6, `got ${got2.toFixed(2)} dB`);

  const h = new Biquad();
  h.set('highpass', FS, 150, 0.707, 0);
  const x3 = sine(40, 0.6, 0.5);
  const y3 = new Float32Array(x3.length);
  for (let i = 0; i < x3.length; i++) y3[i] = h.proc(x3[i]);
  const att = magDb(x3, 40) - magDb(y3, 40);
  check('HPF @150 attenuates 40 Hz by >15 dB', att > 15, `got ${att.toFixed(1)} dB`);
}

/* ==================== 3) gate ==================== */
{
  const loud = sine(200, 0.5, 0.3);             // −10.5 dB peak
  const quiet = noisy(1.4, Math.pow(10, -65 / 20));
  const full = new Float32Array(loud.length + quiet.length);
  full.set(loud); full.set(quiet, loud.length);
  const y = run([full], { gateOn: 1, gateThr: -45, gateRange: -60, gateRel: 60, eqOn: 0, limOn: 0 })[0];

  // measure the last 0.5 s of the quiet section: the detector's hang/release
  // keeps the gate open ~0.3 s after the loud part (anti-chatter), then it closes
  const t0 = loud.length + Math.floor(0.8 * FS);
  const inQuiet = rmsDb(full, t0);
  const outQuiet = rmsDb(y, t0);
  check('gate closes on quiet material', outQuiet <= inQuiet - 40, `in ${inQuiet.toFixed(1)} dB → out ${outQuiet.toFixed(1)} dB`);

  const inLoud = rmsDb(full, 9600, loud.length);
  const outLoud = rmsDb(y, 9600, loud.length); // skip first 0.2 s while gate opens
  check('gate passes loud material unchanged', Math.abs(outLoud - inLoud) < 0.5, `Δ ${(outLoud - inLoud).toFixed(2)} dB`);
}

/* ==================== 4) de-esser ==================== */
{
  const base = sine(250, 0.8, 0.063);            // −24 dB body
  const sib = sine(6500, 0.8, 0.25);             // −12 dB "ess"
  const mix = new Float32Array(base.length);
  for (let i = 0; i < mix.length; i++) mix[i] = base[i] + sib[i];

  const y = run([mix], { dssOn: 1, dssFreq: 6500, dssThr: -45, dssAmt: 1, eqOn: 0, limOn: 0 })[0];
  const warm = Math.floor(0.3 * FS), end = Math.floor(0.8 * FS);

  const sibDrop = magDb(mix, 6500, warm, end) - magDb(y, 6500, warm, end);
  check('de-esser attenuates hot sibilance by ≥12 dB', sibDrop >= 12, `got ${sibDrop.toFixed(1)} dB`);

  const bodyDrop = magDb(mix, 250, warm, end) - magDb(y, 250, warm, end);
  check('de-esser leaves 250 Hz body intact (≤1.5 dB)', Math.abs(bodyDrop) <= 1.5, `got ${bodyDrop.toFixed(2)} dB`);

  const yOff = run([mix], { dssOn: 0, eqOn: 0, limOn: 0 })[0];
  const ident = peakDb(new Float32Array(yOff.map((v, i) => v - mix[i])));
  check('de-esser off = transparent', ident < -200 || ident === -240 || ident === -Infinity || !isFinite(ident) || ident < -150, `${ident.toFixed(1)} dB`);
}

/* ==================== 5) tone EQ through the chain ==================== */
{
  const x = sine(16000, 0.5, 0.2);
  const y = run([x], { eqOn: 1, eqAir: 6, limOn: 0 })[0];
  const boost = magDb(y, 16000, 4800) - magDb(x, 16000, 4800);
  check('Air +6 dB boosts 16 kHz by ~6 dB', Math.abs(boost - 6) < 1.0, `got ${boost.toFixed(2)} dB`);

  const x2 = sine(45, 0.6, 0.2);
  const y2 = run([x2], { eqOn: 1, eqHpf: 150, limOn: 0 })[0];
  const att = magDb(x2, 45, 9600) - magDb(y2, 45, 9600);
  check('HPF @150 in chain kills 45 Hz rumble (>15 dB)', att > 15, `got ${att.toFixed(1)} dB`);

  const lo = sine(100, 0.5, 0.2), hi = sine(10000, 0.5, 0.2);
  const mix = new Float32Array(lo.length);
  for (let i = 0; i < mix.length; i++) mix[i] = lo[i] + hi[i];
  const yt = run([mix], { eqOn: 1, eqTone: 6, eqHpf: 20, limOn: 0 })[0];
  const dLow = magDb(yt, 100, 9600) - magDb(mix, 100, 9600);
  const dHi = magDb(yt, 10000, 9600) - magDb(mix, 10000, 9600);
  check('Tone +6 tilts dark→bright (100 Hz down, 10 kHz up)', dLow < -1.5 && dHi > 1.5, `low ${dLow.toFixed(2)} dB, hi ${dHi.toFixed(2)} dB`);
}

/* ==================== 6) compressor ==================== */
{
  const inDb = -8;
  const x = sine(400, 0.7, Math.pow(10, inDb / 20));
  const y = run([x], { cmpOn: 1, cmpThr: -24, cmpRatio: 4, cmpAtk: 5, cmpRel: 100, cmpMake: 0, eqOn: 0, limOn: 0 })[0];
  const expected = -24 + (inDb - -24) / 4; // −20 dB
  const got = peakDb(y, Math.floor(0.35 * FS));
  check('comp 4:1 @ thr −24 shapes −8 dBFS sine to ≈ −20 dBFS', Math.abs(got - expected) < 1.6, `got ${got.toFixed(2)} dB`);

  const y2 = run([x], { cmpOn: 1, cmpThr: -24, cmpRatio: 4, cmpAtk: 5, cmpRel: 100, cmpMake: 6, eqOn: 0, limOn: 0 })[0];
  const got2 = peakDb(y2, Math.floor(0.35 * FS));
  check('makeup +6 dB lands at ≈ −14 dBFS', Math.abs(got2 - (expected + 6)) < 1.6, `got ${got2.toFixed(2)} dB`);

  const y3 = run([x], { cmpOn: 1, cmpThr: -24, cmpRatio: 1, eqOn: 0, limOn: 0 })[0];
  const got3 = peakDb(y3, 14400);
  check('ratio 1:1 = transparent', Math.abs(got3 - inDb) < 0.5, `got ${got3.toFixed(2)} dB`);
}

/* ==================== 7) heat / saturator ==================== */
{
  const x = sine(1000, 0.6, 0.5);
  const ident = run([x], { satOn: 1, satDrive: 12, satMix: 0, eqOn: 0, limOn: 0 })[0];
  let maxDiff = 0;
  for (let i = 0; i < x.length; i++) maxDiff = Math.max(maxDiff, Math.abs(x[i] - ident[i]));
  check('heat at mix 0% = bit-transparent dry', maxDiff === 0, `maxDiff=${maxDiff}`);

  const sat = run([x], { satOn: 1, satDrive: 14, satMix: 1, eqOn: 0, limOn: 0 })[0];
  const warm = 4800;
  const h1 = magDb(sat, 1000, warm);
  const h3 = magDb(sat, 3000, warm) - h1;
  check('saturation generates 3rd harmonic (≥ −30 dB rel.)', h3 >= -30 && h3 < -3, `H3 ${h3.toFixed(1)} dB`);

  const pk = peakDb(sat, warm);
  check('tanh stage tames peaks (soft-clip)', pk < -6.5, `peak ${pk.toFixed(2)} dB`);
}

/* ==================== 8) limiter ==================== */
{
  const x = sine(300, 0.6, 1.0); // 0 dBFS sine — forcing real limiting
  const ceilDb = -1;
  const y = run([x], { limOn: 1, limCeil: ceilDb, eqOn: 0 })[0];
  const pk = peakDb(y, Math.floor(0.05 * FS)); // skip 2 ms lookahead warm-up
  check(`limiter pins 0 dBFS sine to ${ceilDb} dB ceiling`, pk <= ceilDb + 0.15, `peak ${pk.toFixed(2)} dB`);
  check('limiter rides the ceiling (not over-crushing)', pk >= ceilDb - 0.9, `peak ${pk.toFixed(2)} dB`);

  const quiet = sine(300, 0.6, Math.pow(10, -12 / 20));
  const y2 = run([quiet], { limOn: 1, limCeil: ceilDb, eqOn: 0 })[0];
  const d = peakDb(y2, Math.floor(0.05 * FS)) - (-12);
  check('signal below ceiling passes un-grained (±0.3 dB)', Math.abs(d) < 0.3, `Δ ${d.toFixed(2)} dB`);
}

/* ==================== 9) stereo link + stability ==================== */
{
  const L = sine(400, 0.5, 0.5);
  const R = new Float32Array(L.length); // silence
  const [yL, yR] = run([L, R], { cmpOn: 1, cmpThr: -20, cmpRatio: 4, eqOn: 0, limOn: 0 });
  check('linked comp: silent side stays silent', peakDb(yR, 4800) < -200, `R peak ${peakDb(yR, 4800).toFixed(1)} dB`);
  check('linked comp: L compressed (>4 dB GR)', peakDb(L, 4800) - peakDb(yL, 4800) > 4, `GR ${(peakDb(L, 4800) - peakDb(yL, 4800)).toFixed(1)} dB`);
}

{
  // everything on, abuse settings, white noise — must stay finite and under the ceiling
  const x = [noisy(1.0, 0.9), noisy(1.0, 0.9)];
  const y = run(x, {
    gateOn: 1, gateThr: -40, gateRange: -50, gateRel: 40,
    dssOn: 1, dssFreq: 8000, dssThr: -50, dssAmt: 1,
    eqOn: 1, eqHpf: 120, eqLow: 3, eqTone: 4, eqAir: 6,
    cmpOn: 1, cmpThr: -30, cmpRatio: 8, cmpAtk: 2, cmpRel: 80, cmpMake: 9,
    satOn: 1, satDrive: 18, satMix: 0.8,
    outGain: 18, limOn: 1, limCeil: -1,
  });
  check('full chain on hot noise: output finite', allFinite(y));
  const pkL = peakDb(y[0], 4800), pkR = peakDb(y[1], 4800);
  check('full chain limiter actually engages at ceiling', pkL <= -0.85 && pkL >= -2.5 && pkR <= -0.85 && pkR >= -2.5,
    `peaks ${pkL.toFixed(2)} / ${pkR.toFixed(2)} dB (~−1 expected)`);
}

/* ---------- 44.1 kHz spot-check (different sample rate) ---------- */
{
  const fs2 = 44100;
  const chain = new VoxChain(fs2, 1);
  chain.setParams({ cmpOn: 1, cmpThr: -24, cmpRatio: 4, cmpAtk: 5, cmpRel: 100, eqOn: 0, limOn: 0 });
  const n = Math.floor(fs2 * 0.6);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.pow(10, -8 / 20) * Math.sin(2 * Math.PI * 400 * i / fs2);
  const out = new Float32Array(n);
  const part = new Float32Array(128);
  for (let off = 0; off < n; off += 128) {
    const len = Math.min(128, n - off);
    part.set(x.subarray(off, off + len)); if (len < 128) part.fill(0, len);
    chain.processBlock([part], len);
    out.set(part.subarray(0, len), off);
  }
  const got = peakDb(out, Math.floor(fs2 * 0.3));
  check('44.1 kHz render matches 48 kHz comp curve', Math.abs(got - -20) < 1.6, `got ${got.toFixed(2)} dB`);
}

/* ==================== summary ==================== */
console.log(`\n${total - fails}/${total} checks passed${fails ? ` — ${fails} FAILED` : ''}`);
process.exit(fails ? 1 : 0);
