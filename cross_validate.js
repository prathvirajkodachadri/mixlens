/* Cross-validation: MixLens analysis engine vs pyloudnorm (independent EBU R128 implementation) */
const fs = require('fs');
const vm = require('vm');

function stubEl(){ return { addEventListener(){}, classList:{add(){},remove(){}}, style:{}, textContent:'', innerHTML:'', appendChild(){}, click(){}, value:'-14', clientWidth:800, clientHeight:130, getContext(){ return null; } }; }
const els = {};
global.document = { getElementById: id => els[id] || (els[id] = stubEl()), createElement: () => stubEl() };
global.window = { addEventListener(){}, devicePixelRatio: 1 };
global.requestAnimationFrame = () => {}; global.alert = () => {};
global.URL = { createObjectURL: () => '', revokeObjectURL: () => {} }; global.Blob = class {};
vm.runInThisContext(fs.readFileSync('app.js', 'utf8'));

/* --- minimal WAV reader (PCM16 + FLOAT32) --- */
function readWav(path){
  const buf = fs.readFileSync(path);
  const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if(String.fromCharCode(...u8.slice(0, 4)) !== 'RIFF') throw new Error('not RIFF');
  let off = 12, fmt = null, dataOff = 0, dataLen = 0;
  while(off + 8 <= u8.length){
    const id = String.fromCharCode(...u8.slice(off, off + 4));
    const size = dv.getUint32(off + 4, true);
    if(id === 'fmt ') fmt = {
      format: dv.getUint16(off + 8, true),
      channels: dv.getUint16(off + 10, true),
      rate: dv.getUint32(off + 12, true),
      bits: dv.getUint16(off + 22, true),
    };
    if(id === 'data'){ dataOff = off + 8; dataLen = size; }
    off += 8 + size + (size & 1);
  }
  const frames = dataLen / (fmt.bits / 8) / fmt.channels;
  const chans = [];
  for(let c = 0; c < fmt.channels; c++) chans.push(new Float32Array(frames));
  if(fmt.format === 3 && fmt.bits === 32){
    for(let i = 0; i < frames; i++)
      for(let c = 0; c < fmt.channels; c++)
        chans[c][i] = dv.getFloat32(dataOff + (i * fmt.channels + c) * 4, true);
  } else if(fmt.format === 1 && fmt.bits === 16){
    for(let i = 0; i < frames; i++)
      for(let c = 0; c < fmt.channels; c++)
        chans[c][i] = dv.getInt16(dataOff + (i * fmt.channels + c) * 2, true) / 32768;
  } else throw new Error('unsupported format');
  return { sampleRate: fmt.rate, length: frames, numberOfChannels: fmt.channels,
           duration: frames / fmt.rate, getChannelData: c => chans[c] };
}

let fails = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if(!ok) fails++; };

/* parse a marked WAV: verify fmt, cue points, adtl labels */
function parseMarkedWav(u8){
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const out = { fmt: null, cues: [], labels: [] };
  if(String.fromCharCode(...u8.slice(0, 4)) !== 'RIFF' || String.fromCharCode(...u8.slice(8, 12)) !== 'WAVE') return out;
  let off = 12;
  const str = (o, n) => String.fromCharCode(...u8.slice(o, o + n));
  while(off + 8 <= u8.length){
    const id = str(off, 4), size = dv.getUint32(off + 4, true);
    if(id === 'fmt ') out.fmt = { format: dv.getUint16(off + 8, true), channels: dv.getUint16(off + 10, true), rate: dv.getUint32(off + 12, true), bits: dv.getUint16(off + 22, true) };
    if(id === 'cue '){
      const count = dv.getUint32(off + 8, true);
      for(let i = 0; i < count; i++){
        const p = off + 12 + i * 24;
        out.cues.push({ id: dv.getUint32(p, true), pos: dv.getUint32(p + 4, true) });
      }
    }
    if(id === 'LIST' && str(off + 8, 4) === 'adtl'){
      let p = off + 12;
      while(p + 8 <= off + 8 + size){
        const sid = str(p, 4), ssize = dv.getUint32(p + 4, true);
        if(sid === 'labl'){
          const bytes = u8.slice(p + 12, p + 8 + ssize);
          const nul = bytes.indexOf(0);
          out.labels.push(String.fromCharCode(...bytes.slice(0, nul < 0 ? bytes.length : nul)));
        }
        p += 8 + ssize + (ssize & 1);
      }
    }
    off += 8 + size + (size & 1);
  }
  return out;
}

(async () => {
  const ref = JSON.parse(fs.readFileSync('ref/reference.json', 'utf8'));

  console.log('=== LUFS cross-validation vs pyloudnorm (tolerance ±0.3 LU) ===');
  for(const [name, info] of Object.entries(ref)){
    const wb = readWav(info.path);
    const st = await analyzeAudio(wb, () => {});
    const diff = Math.abs(st.loudness.integrated - info.lufs);
    check(`LUFS ${name}`, diff <= 0.3, `mixlens ${st.loudness.integrated.toFixed(2)} vs reference ${info.lufs.toFixed(2)} (Δ ${diff.toFixed(2)})`);
  }

  console.log('\n=== Extended signal checks ===');
  // dynamic: LRA should be ~6 LU (two levels 6 dB apart, both ungated)
  const dyn = await analyzeAudio(readWav(ref.dynamic.path), () => {});
  check('LRA of 6 dB-level signal', dyn.loudness.lra > 4 && dyn.loudness.lra < 8, `LRA = ${dyn.loudness.lra.toFixed(2)} LU`);

  // stereo: correlated → high correlation, low width
  const st2 = await analyzeAudio(readWav(ref.stereo.path), () => {});
  check('stereo correlation > 0.9', st2.correlation > 0.9, `corr = ${st2.correlation.toFixed(3)}`);
  check('stereo width < 10%', st2.widthPct < 10, `width = ${st2.widthPct.toFixed(2)}%`);

  // anti-phase stereo → correlation ≈ −1
  const wb = readWav(ref.stereo.path);
  const L = wb.getChannelData(0), R = wb.getChannelData(1);
  for(let i = 0; i < R.length; i++) R[i] = -R[i];
  const ap = await analyzeAudio(wb, () => {});
  check('anti-phase correlation < -0.9', ap.correlation < -0.9, `corr = ${ap.correlation.toFixed(3)}`);

  // speech-like: chest (60–150 Hz) should dominate vs pink tilt (devPink > 0)
  const sp = await analyzeAudio(readWav(ref.speech.path), () => {});
  const chest = sp.zones.find(z => z.name === 'Chest');
  check('speech chest zone dominant', chest.devPink > 3, `chest dev = +${chest.devPink.toFixed(1)} dB`);

  // sibilance detection: tone + 7 kHz bursts at 1.0s and 2.2s
  const sr = 48000, n = sr * 3;
  const ch = new Float32Array(n);
  for(let i = 0; i < n; i++){
    ch[i] = 0.15 * Math.sin(2 * Math.PI * 250 * i / sr);
    const t = i / sr;
    if((t > 1.0 && t < 1.12) || (t > 2.2 && t < 2.32))
      ch[i] += 0.5 * (Math.random() * 2 - 1) * Math.sin(2 * Math.PI * 7000 * i / sr);
  }
  const sibBuf = { sampleRate: sr, length: n, numberOfChannels: 1, duration: 3, getChannelData: () => ch };
  const ss = await analyzeAudio(sibBuf, () => {});
  const near1 = ss.sibEvents.some(e => Math.abs(e.t - 1.06) < 0.2);
  const near2 = ss.sibEvents.some(e => Math.abs(e.t - 2.26) < 0.2);
  check('sibilance burst 1 detected @1.06s', near1, `${ss.sibEvents.length} events: ${ss.sibEvents.map(e => e.t.toFixed(2)).join(', ')}`);
  check('sibilance burst 2 detected @2.26s', near2, '');

  // rumble detection: tone + 28 Hz bursts at 1.0–1.5s and 3.0–3.2s
  const n4 = sr * 4;
  const ch4 = new Float32Array(n4);
  for(let i = 0; i < n4; i++){
    const t = i / sr;
    ch4[i] = 0.15 * Math.sin(2 * Math.PI * 200 * i / sr);
    if((t >= 1.0 && t < 1.5) || (t >= 3.0 && t < 3.2))
      ch4[i] += 0.4 * Math.sin(2 * Math.PI * 28 * i / sr);
  }
  const rBuf = { sampleRate: sr, length: n4, numberOfChannels: 1, duration: 4, getChannelData: () => ch4 };
  const rs = await analyzeAudio(rBuf, () => {});
  const r1 = rs.rumbleEvents.find(e => Math.abs(e.t - 1.0) < 0.15);
  const r2 = rs.rumbleEvents.find(e => Math.abs(e.t - 3.0) < 0.15);
  check('rumble event 1 @1.0s', !!r1, `${rs.rumbleEvents.length} events: ${rs.rumbleEvents.map(e => e.t.toFixed(2) + 's/' + e.dur.toFixed(1) + 's/' + Math.round(e.f) + 'Hz').join(', ')}`);
  check('rumble event 2 @3.0s', !!r2, '');
  check('rumble dominant freq ≈ 28 Hz', !!r1 && Math.abs(r1.f - 28) < 6, r1 ? `f = ${r1.f.toFixed(1)} Hz` : 'no event');
  check('rumble duration ≈ 0.5 s', !!r1 && Math.abs(r1.dur - 0.5) < 0.15, r1 ? `dur = ${r1.dur.toFixed(2)} s` : '');
  // clean signal → no false positives
  const clean = new Float32Array(sr * 3);
  for(let i = 0; i < clean.length; i++) clean[i] = 0.2 * Math.sin(2 * Math.PI * 200 * i / sr) + 0.05 * Math.sin(2 * Math.PI * 120 * i / sr);
  const cs = await analyzeAudio({ sampleRate: sr, length: clean.length, numberOfChannels: 1, duration: 3, getChannelData: () => clean }, () => {});
  check('no false rumble on clean low tones', cs.rumbleEvents.length === 0, `${cs.rumbleEvents.length} events`);

  // noise floor: silent gap test
  const ng = new Float32Array(sr * 4);
  for(let i = sr; i < sr * 2; i++) ng[i] = 0.3 * Math.sin(2 * Math.PI * 300 * i / sr);
  const ngBuf = { sampleRate: sr, length: ng.length, numberOfChannels: 1, duration: 4, getChannelData: () => ng };
  const ns = await analyzeAudio(ngBuf, () => {});
  check('noise floor detects silence', ns.noiseFloorDb < -80, `floor = ${ns.noiseFloorDb.toFixed(1)} dBFS`);

  // WAV marker export: build marked WAV, parse it back, verify cues + labels
  const mBuf = { sampleRate: 48000, length: 48000, numberOfChannels: 2, duration: 1,
    getChannelData: c => { const a = new Float32Array(48000); for(let i = 0; i < a.length; i++) a[i] = 0.2 * Math.sin(2 * Math.PI * 440 * i / 48000); return a; } };
  const testMarkers = [{ t: 0.25, label: 'RUMBLE ~30Hz 0.5s' }, { t: 0.5, label: 'SIBILANCE -8dB' }, { t: 0.75, label: 'CLIPPING' }];
  const wavAb = buildMarkedWav(mBuf, testMarkers);
  const parsed = parseMarkedWav(new Uint8Array(wavAb));
  check('marked WAV: fmt valid', parsed.fmt && parsed.fmt.rate === 48000 && parsed.fmt.channels === 2, parsed.fmt ? `${parsed.fmt.rate}Hz ${parsed.fmt.channels}ch` : 'no fmt');
  check('marked WAV: 3 cue points', parsed.cues.length === 3, `${parsed.cues.length} cues`);
  check('marked WAV: cue positions', parsed.cues.length === 3 &&
    Math.abs(parsed.cues[0].pos - 12000) < 2 && Math.abs(parsed.cues[1].pos - 24000) < 2 && Math.abs(parsed.cues[2].pos - 36000) < 2,
    parsed.cues.map(c => c.pos).join(','));
  check('marked WAV: labels present', parsed.labels.some(l => l.includes('RUMBLE')) && parsed.labels.some(l => l.includes('SIBILANCE')) && parsed.labels.some(l => l.includes('CLIPPING')), parsed.labels.join(' | '));
  check('marked WAV: collectMarkers sorts by time', (() => {
    const cm = collectMarkers({ rumbleEvents: [{ t: 0.9, f: 30, dur: 0.5, str: -10 }], sibEvents: [{ t: 0.1, str: -8 }], clipTimes: [0.5] });
    return cm.length === 3 && cm[0].t === 0.1 && cm[1].t === 0.5 && cm[2].t === 0.9;
  })(), 'sorted');

  // performance: 3-minute pink noise
  console.log('\n=== Performance ===');
  const n3 = 48000 * 180;
  const p3 = new Float32Array(n3);
  let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
  for(let i = 0; i < n3; i++){
    const w = Math.random() * 2 - 1;
    b0 = 0.99886*b0 + w*0.0555179; b1 = 0.99332*b1 + w*0.0750759;
    b2 = 0.96900*b2 + w*0.1538520; b3 = 0.86650*b3 + w*0.3104856;
    b4 = 0.55000*b4 + w*0.5329522; b5 = -0.7616*b5 - w*0.0168980;
    p3[i] = (b0+b1+b2+b3+b4+b5+b6 + w*0.5362) * 0.02;
  }
  const bigBuf = { sampleRate: 48000, length: n3, numberOfChannels: 1, duration: 180, getChannelData: () => p3 };
  const t0 = Date.now();
  const bs = await analyzeAudio(bigBuf, () => {});
  const dt = (Date.now() - t0) / 1000;
  check('3-minute file analyzes < 60 s', dt < 60, `${dt.toFixed(1)} s, LUFS = ${bs.loudness.integrated.toFixed(2)}`);

  console.log(fails === 0 ? '\n✅ ALL VALIDATIONS PASSED' : `\n❌ ${fails} VALIDATION(S) FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
