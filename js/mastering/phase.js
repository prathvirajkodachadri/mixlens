'use strict';
/**
 * MixLens Final Mastering Analysis 1.0 — Phase correlation, including frequency-dependent bands.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./utilities'), require('./fft'));
  } else {
    root.MAPhase = factory(root.MAUtilities, root.MAFft);
  }
}(typeof self !== 'undefined' ? self : this, function (U, FftMod) {

  const BANDS = [
    { id: 'lf', name: '20–120 Hz', lo: 20, hi: 120 },
    { id: 'lowmid', name: '120–400 Hz', lo: 120, hi: 400 },
    { id: 'mid', name: '400 Hz–2 kHz', lo: 400, hi: 2000 },
    { id: 'highmid', name: '2–5 kHz', lo: 2000, hi: 5000 },
    { id: 'presence', name: '5–10 kHz', lo: 5000, hi: 10000 },
    { id: 'air', name: '10–20 kHz', lo: 10000, hi: 20000 }
  ];

  function broadband(left, right) {
    const N = Math.min(left.length, right.length);
    let dot = 0, sL = 0, sR = 0;
    for (let i = 0; i < N; i++) {
      const l = left[i], r = right[i];
      dot += l * r;
      sL += l * l;
      sR += r * r;
    }
    return Math.sqrt(sL * sR) > 1e-12 ? U.clamp(dot / Math.sqrt(sL * sR), -1, 1) : 1;
  }

  function bandCorrelation(left, right, sampleRate) {
    const FFT = FftMod.FFT;
    const fftSize = 2048;
    const hop = 2048;
    const N = Math.min(left.length, right.length);
    const numBins = fftSize >> 1;
    const binW = sampleRate / fftSize;
    const totalPossible = Math.max(1, Math.floor((N - fftSize) / hop) + 1);
    const maxFrames = 400;
    const frameStep = totalPossible > maxFrames ? Math.ceil(totalPossible / maxFrames) : 1;
    const fft = new FFT(fftSize);
    const window = U.hannWindow(fftSize);
    const reL = new Float32Array(fftSize);
    const imL = new Float32Array(fftSize);
    const reR = new Float32Array(fftSize);
    const imR = new Float32Array(fftSize);

    const acc = BANDS.map(function () { return { dot: 0, eL: 0, eR: 0 }; });

    for (let f = 0; f < totalPossible; f += frameStep) {
      const offset = f * hop;
      if (offset + fftSize > N) break;
      for (let i = 0; i < fftSize; i++) {
        reL[i] = left[offset + i];
        imL[i] = 0;
        reR[i] = right[offset + i];
        imR[i] = 0;
      }
      U.applyWindow(reL, window, reL);
      U.applyWindow(reR, window, reR);
      fft.transform(reL, imL);
      fft.transform(reR, imR);
      for (let b = 0; b < BANDS.length; b++) {
        const loBin = Math.max(1, Math.floor(BANDS[b].lo / binW));
        const hiBin = Math.min(numBins - 1, Math.ceil(BANDS[b].hi / binW));
        for (let k = loBin; k < hiBin; k++) {
          /* Real-valued correlation of spectral coefficients (in-phase energy). */
          const dot = reL[k] * reR[k] + imL[k] * imR[k];
          const eL = reL[k] * reL[k] + imL[k] * imL[k];
          const eR = reR[k] * reR[k] + imR[k] * imR[k];
          acc[b].dot += dot;
          acc[b].eL += eL;
          acc[b].eR += eR;
        }
      }
    }

    return BANDS.map(function (band, i) {
      const a = acc[i];
      const den = Math.sqrt(a.eL * a.eR);
      const c = den > 1e-18 ? U.clamp(a.dot / den, -1, 1) : 1;
      let status = 'PASS';
      if (c < -0.15) status = 'FAIL';
      else if (c < 0.15) status = 'WARNING';
      return {
        id: band.id,
        name: band.name,
        frequency_range_hz: [band.lo, band.hi],
        correlation: U.round(c, 3),
        status: status
      };
    });
  }

  function interpret(corr) {
    if (corr >= 0.92) return 'Strong mono compatibility.';
    if (corr >= 0.70) return 'Good overall phase coherence.';
    if (corr >= 0.30) return 'Moderate correlation — some mono thinning is possible.';
    if (corr >= 0) return 'Low correlation — mono playback may lose image energy.';
    return 'Negative correlation — cancellation risk in mono.';
  }

  function analyzePhase(left, right, sampleRate) {
    if (!right) {
      return {
        applicable: false,
        correlation: 1,
        interpretation: 'Mono master — phase correlation is +1 by definition.',
        status: 'PASS',
        bands: []
      };
    }
    const corr = broadband(left, right);
    const bands = bandCorrelation(left, right, sampleRate);
    let status = 'PASS';
    if (corr < -0.15) status = 'FAIL';
    else if (corr < 0.35) status = 'WARNING';
    const negBands = bands.filter(function (b) { return b.correlation < 0; });
    if (negBands.length && status === 'PASS') status = 'WARNING';

    return {
      applicable: true,
      correlation: U.round(corr, 3),
      meter_min: -1,
      meter_max: 1,
      interpretation: interpret(corr),
      status: status,
      bands: bands,
      negative_bands: negBands.map(function (b) { return b.name; }),
      note: negBands.length
        ? 'Negative correlation in: ' + negBands.map(function (b) { return b.name + ' (' + b.correlation + ')'; }).join(', ') + '.'
        : 'No frequency band measured a negative mean correlation.'
    };
  }

  return { analyzePhase: analyzePhase };
}));
