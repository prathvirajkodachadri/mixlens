/* Node test harness for the MixLens analysis engine */
const fs = require('fs');
const vm = require('vm');
const code = fs.readFileSync('app.js', 'utf8');

// --- minimal DOM stubs so app.js loads in Node ---
function stubEl(){
  return {
    addEventListener(){}, classList:{ add(){}, remove(){} }, style:{},
    textContent:'', innerHTML:'', appendChild(){}, click(){}, value:'-14',
    clientWidth:800, clientHeight:130, getContext(){ return null; },
  };
}
const els = {};
global.document = { getElementById: id => els[id] || (els[id] = stubEl()), createElement: () => stubEl() };
global.window = { addEventListener(){}, devicePixelRatio: 1 };
global.requestAnimationFrame = () => {};
global.alert = m => console.log('ALERT:', m);
global.URL = { createObjectURL: () => '', revokeObjectURL: () => {} };
global.Blob = class { constructor(){} };

vm.runInThisContext(code, { filename: 'app.js' });

// --- fake AudioBuffer ---
function makeBuffer(fs, dur, gen){
  const n = Math.floor(fs * dur);
  const ch = new Float32Array(n);
  for(let i = 0; i < n; i++) ch[i] = gen(i, fs);
  return {
    sampleRate: fs, length: n, numberOfChannels: 1,
    duration: dur, getChannelData: () => ch,
  };
}

(async () => {
  let fails = 0;
  const check = (name, got, exp, tol) => {
    const ok = Math.abs(got - exp) <= tol;
    if(!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${got.toFixed(2)}, expected ~${exp} ±${tol}`);
  };

  /* Test 1: 1 kHz sine, amplitude 0.5 → RMS −9.03 dBFS, crest 3.01 dB, true peak −6 dBFS, LUFS ≈ −9.02 (−0.691 const cancels K-gain at ~1kHz by design) */
  const fs = 48000;
  const buf1 = makeBuffer(fs, 4, (i, s) => 0.5 * Math.sin(2 * Math.PI * 1000 * i / s));
  const st1 = await analyzeAudio(buf1, () => {});
  check('sine RMS dBFS', st1.rmsDb, -9.03, 0.2);
  check('sine crest', st1.crestDb, 3.01, 0.3);
  check('sine true peak dBFS', db20(st1.truePeak), -6.02, 0.4);
  check('sine integrated LUFS', st1.loudness.integrated, -9.02, 0.3);
  check('zones count', st1.zones.length, 8, 0);
  const bodyZone = st1.zones.find(z => z.name === 'Body');
  if(bodyZone.devPink > 0) console.log('PASS  sine energy concentrates above pink tilt in Body/Presence (dev +' + bodyZone.devPink.toFixed(1) + ' dB)');
  else { fails++; console.log('FAIL  sine band deviation unexpected'); }

  /* Test 2: silence-ish → gating handles it, no NaN */
  const buf2 = makeBuffer(fs, 2, () => 1e-6 * (Math.random() - 0.5));
  const st2 = await analyzeAudio(buf2, () => {});
  const sane = isFinite(st2.loudness.integrated) || st2.loudness.integrated === -Infinity;
  console.log(`${sane ? 'PASS' : 'FAIL'}  near-silent handled: integrated = ${st2.loudness.integrated}`);
  if(!sane) fails++;

  /* Test 3: pink-ish noise (1/f) → LUFS in expected range, band devs small */
  let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
  const pink = (i) => {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886*b0 + w*0.0555179; b1 = 0.99332*b1 + w*0.0750759;
    b2 = 0.96900*b2 + w*0.1538520; b3 = 0.86650*b3 + w*0.3104856;
    b4 = 0.55000*b4 + w*0.5329522; b5 = -0.7616*b5 - w*0.0168980;
    return (b0+b1+b2+b3+b4+b5+b6 + w*0.5362) * 0.11 * 0.35;
  };
  const buf3 = makeBuffer(fs, 6, pink);
  const st3 = await analyzeAudio(buf3, () => {});
  const maxDev = Math.max(...st3.zones.filter(z=>z.name!=='Sub'&&z.name!=='Air').map(z => Math.abs(z.devPink)));
  check('pink noise max band deviation', maxDev, 0, 4.5);
  console.log('INFO  pink noise LUFS =', st3.loudness.integrated.toFixed(1), ', LRA =', st3.loudness.lra.toFixed(1));

  /* Test 4: clipped sine → clipped counter > 0 */
  const buf4 = makeBuffer(fs, 1, (i, s) => Math.max(-0.999, Math.min(0.999, 1.8 * Math.sin(2 * Math.PI * 200 * i / s))));
  const st4 = await analyzeAudio(buf4, () => {});
  console.log(`${st4.clipped > 0 ? 'PASS' : 'FAIL'}  clipping detected: ${st4.clipped} samples`);
  if(st4.clipped === 0) fails++;

  /* Test 5: suggestions engine runs without errors for all presets */
  for(const pk of ['narration','vocal','mix']){
    const sugg = computeSuggestions(st1, pk, -14);
    if(sugg.length > 0) console.log(`PASS  suggestions[${pk}]: ${sugg.length} items`);
    else { fails++; console.log(`FAIL  suggestions[${pk}] empty`); }
  }

  console.log(fails === 0 ? '\nALL TESTS PASSED' : `\n${fails} TEST(S) FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
