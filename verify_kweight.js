/* Verify my RBJ-generated K-weighting filters vs official ITU BS.1770-4 coefficients @48kHz */
const vm = require('vm'), fs = require('fs');
function stubEl(){ return { addEventListener(){}, classList:{add(){},remove(){}}, style:{}, textContent:'', innerHTML:'', appendChild(){}, click(){}, value:'-14', clientWidth:800, clientHeight:130, getContext(){ return null; } }; }
const els = {};
global.document = { getElementById: id => els[id] || (els[id] = stubEl()), createElement: () => stubEl() };
global.window = { addEventListener(){}, devicePixelRatio: 1 };
global.requestAnimationFrame = () => {}; global.alert = () => {};
global.URL = { createObjectURL: () => '', revokeObjectURL: () => {} }; global.Blob = class {};
vm.runInThisContext(fs.readFileSync('app.js', 'utf8'));

function cMul(a, b){ return [a[0]*b[0] - a[1]*b[1], a[0]*b[1] + a[1]*b[0]]; }
function cAdd(a, b){ return [a[0]+b[0], a[1]+b[1]]; }
function cAbs(a){ return Math.hypot(a[0], a[1]); }
// H(e^jw) for biquad b0..b2 / 1,a1,a2
function magDb(b0, b1, b2, a1, a2, f, fs){
  const w = 2*Math.PI*f/fs;
  const z1 = [Math.cos(w), -Math.sin(w)];       // z^-1
  const z2 = [Math.cos(2*w), -Math.sin(2*w)];   // z^-2
  const N = cAdd(cAdd([b0,0], cMul([b1,0], z1)), cMul([b2,0], z2));
  const D = cAdd(cAdd([1,0], cMul([a1,0], z1)), cMul([a2,0], z2));
  return 20*Math.log10(cAbs(N)/cAbs(D));
}
const { shelf, hp } = kWeightingFilters(48000);
const myMag = (f) => magDb(shelf[0], shelf[1], shelf[2], shelf[3], shelf[4], f, 48000)
                   + magDb(hp[0], hp[1], hp[2], hp[3], hp[4], f, 48000);
// official ITU BS.1770-4 @48kHz
const off1 = { b:[1.53512485958697,-2.69169618940638,1.19839281085285], a:[-1.69065929318241,0.73248077421585] };
const off2 = { b:[1,-2,1], a:[-1.99004745483398,0.99007225036621] };
const offMag = (f) => magDb(off1.b[0],off1.b[1],off1.b[2],off1.a[0],off1.a[1],f,48000)
                    + magDb(off2.b[0],off2.b[1],off2.b[2],off2.a[0],off2.a[1],f,48000);
let maxDiff = 0;
for(const f of [40,100,200,500,1000,1500,2000,4000,8000,16000]){
  const m = myMag(f), o = offMag(f), d = Math.abs(m-o);
  if(d > maxDiff) maxDiff = d;
  console.log(`${String(f).padStart(6)} Hz  mine=${m.toFixed(3)} dB  official=${o.toFixed(3)} dB  diff=${d.toFixed(3)} dB`);
}
console.log(maxDiff < 0.15 ? '\nK-WEIGHTING VERIFIED (max deviation ' + maxDiff.toFixed(3) + ' dB)' : '\nMISMATCH — needs fixing: ' + maxDiff.toFixed(3) + ' dB');
