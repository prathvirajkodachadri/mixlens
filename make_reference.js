#!/usr/bin/env node
/* Generate the same reference fixtures as make_reference.py without Python deps.
   LUFS uses official ITU BS.1770-4 biquad coefficients (independent of app.js). */
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'ref');
fs.mkdirSync(OUT, { recursive: true });

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function writeWavFloat(filePath, channels, rate) {
  const nCh = channels.length;
  const frames = channels[0].length;
  const dataBytes = frames * nCh * 4;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(3, 20); // IEEE float
  buf.writeUInt16LE(nCh, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * nCh * 4, 28);
  buf.writeUInt16LE(nCh * 4, 32);
  buf.writeUInt16LE(32, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nCh; c++) {
      buf.writeFloatLE(channels[c][i], o);
      o += 4;
    }
  }
  fs.writeFileSync(filePath, buf);
}

function biquad(b0, b1, b2, a1, a2) {
  let z1 = 0, z2 = 0;
  return x => {
    const y = b0 * x + z1;
    z1 = b1 * x - a1 * y + z2;
    z2 = b2 * x - a2 * y;
    return y;
  };
}

/* Official ITU BS.1770-4 @48 kHz; bilinear-scale for other rates. */
function kFilters(fs) {
  if (Math.abs(fs - 48000) < 1) {
    return {
      shelf: biquad(1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585),
      hp: biquad(1, -2, 1, -1.99004745483398, 0.99007225036621),
    };
  }
  // RBJ high-shelf + high-pass matching ITU analog prototypes
  const k = Math.tan(Math.PI * 1681.974450955533 / fs);
  const Vh = Math.pow(10, 3.999843853973347 / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0s = 1 + k / 0.7071752369554196 + k * k;
  const shelf = biquad(
    (Vh + Vb * k / 0.7071752369554196 + k * k) / a0s,
    2 * (k * k - Vh) / a0s,
    (Vh - Vb * k / 0.7071752369554196 + k * k) / a0s,
    2 * (k * k - 1) / a0s,
    (1 - k / 0.7071752369554196 + k * k) / a0s
  );
  const kh = Math.tan(Math.PI * 38.13547087602444 / fs);
  const a0h = 1 + kh / 0.5003270373238773 + kh * kh;
  const hp = biquad(1 / a0h, -2 / a0h, 1 / a0h, 2 * (kh * kh - 1) / a0h, (1 - kh / 0.5003270373238773 + kh * kh) / a0h);
  return { shelf, hp };
}

function integratedLufs(channels, fs) {
  const n = channels[0].length;
  const nCh = channels.length;
  const filters = channels.map(() => kFilters(fs));
  const hop = Math.round(fs * 0.1);
  const win = Math.round(fs * 0.4);
  const energies = [];
  let acc = 0, count = 0;
  for (let i = 0; i < n; i++) {
    let msq = 0;
    for (let c = 0; c < nCh; c++) {
      const y = filters[c].hp(filters[c].shelf(channels[c][i]));
      msq += y * y;
    }
    acc += msq;
    count++;
    if (count === hop) {
      // ITU: sum of per-channel mean-squares (L/R weights = 1), not the average
      energies.push(acc / hop);
      acc = 0; count = 0;
    }
  }
  const overlap = win / hop;
  const blocks = [];
  for (let i = 0; i + overlap <= energies.length; i++) {
    let s = 0;
    for (let j = 0; j < overlap; j++) s += energies[i + j];
    blocks.push(s / overlap);
  }
  const absThresh = Math.pow(10, (-70 + 0.691) / 10);
  const ungated = blocks.filter(e => e > absThresh);
  if (!ungated.length) return -Infinity;
  const mean1 = ungated.reduce((a, b) => a + b, 0) / ungated.length;
  const relThresh = mean1 * Math.pow(10, -10 / 10);
  const gated = ungated.filter(e => e > relThresh);
  if (!gated.length) return -Infinity;
  const mean2 = gated.reduce((a, b) => a + b, 0) / gated.length;
  return -0.691 + 10 * Math.log10(mean2);
}

function save(name, channels, rate) {
  const file = path.join(OUT, name + '.wav');
  writeWavFloat(file, channels, rate);
  const lufs = integratedLufs(channels, rate);
  return {
    path: path.join('ref', name + '.wav'),
    rate,
    lufs,
    channels: channels.length,
    samples: channels[0].length,
  };
}

const rng = mulberry32(42);
const rate = 48000;
const n = rate * 6;
const results = {};

{
  const amp = 10 ** (-23 / 20);
  const sine = new Float32Array(n);
  for (let i = 0; i < n; i++) sine[i] = amp * Math.sin(2 * Math.PI * 1000 * i / rate);
  results.sine_1k = save('sine_1k', [sine], rate);
}

{
  const pink = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = rng() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.0168980;
    pink[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11 * 0.15;
  }
  results.pink = save('pink', [pink], rate);
}

{
  const sig = new Float32Array(n);
  const phases = [];
  for (let k = 1; k < 15; k++) phases[k] = rng() * 6.28;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    let v = 0;
    for (let k = 1; k < 15; k++) v += (1 / Math.pow(k, 1.3)) * Math.sin(2 * Math.PI * 110 * k * t + phases[k]);
    sig[i] = v * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3.2 * t)) * 0.10;
  }
  results.speech = save('speech', [sig], rate);
}

{
  const seglen = 5;
  const nn = rate * seglen * 6;
  const dyn = new Float32Array(nn);
  const seg = rate * seglen;
  for (let s = 0; s < 6; s++) {
    const lvl = s % 2 === 0 ? 0.4 : 0.2;
    for (let i = 0; i < seg; i++) {
      const idx = s * seg + i;
      dyn[idx] = lvl * Math.sin(2 * Math.PI * 440 * idx / rate);
    }
  }
  results.dynamic = save('dynamic', [dyn], rate);
}

{
  const L = new Float32Array(n), R = new Float32Array(n);
  for (const f of [80, 160, 320, 640, 1250, 2500]) {
    const a = 1 / Math.sqrt(f);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      L[i] += Math.sin(2 * Math.PI * f * t) * a;
      R[i] += Math.sin(2 * Math.PI * f * t + 0.3) * a;
    }
  }
  for (let i = 0; i < n; i++) { L[i] *= 0.12; R[i] *= 0.12; }
  results.stereo = save('stereo', [L, R], rate);
}

{
  const r44 = 44100;
  const n44 = r44 * 5;
  const s44 = new Float32Array(n44);
  const amp = 10 ** (-20 / 20);
  for (let i = 0; i < n44; i++) s44[i] = amp * Math.sin(2 * Math.PI * 997 * i / r44);
  results.sine441 = save('sine_441', [s44], r44);
}

fs.writeFileSync(path.join(OUT, 'reference.json'), JSON.stringify(results, null, 2));
for (const [k, v] of Object.entries(results)) {
  console.log(`${k.padEnd(9)} rate=${v.rate} ch=${v.channels} LUFS=${v.lufs.toFixed(2)}`);
}
