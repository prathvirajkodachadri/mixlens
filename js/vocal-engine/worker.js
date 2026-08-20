'use strict';
/**
 * MixLens Vocal Engine 3.0 — Web Worker.
 * Heavy FFT / STFT / YIN / event detection run off the UI thread.
 */
/* eslint-disable no-undef */
importScripts(
  'utilities.js',
  'fft.js',
  'stft.js',
  'preprocessing.js',
  'clipping.js',
  'loudness.js',
  'dynamics.js',
  'spectrum.js',
  'tonal-balance.js',
  'resonance.js',
  'sibilance.js',
  'plosive.js',
  'breath.js',
  'noise.js',
  'hum.js',
  'pitch.js',
  'vibrato.js',
  'stereo.js',
  'masking.js',
  'scoring.js',
  'interpretation.js',
  'timeline.js',
  'json-export.js',
  'report-generator.js',
  'analyzer.js'
);

self.onmessage = function (ev) {
  const msg = ev.data || {};
  if (msg.type !== 'analyze') return;
  const input = msg.input;
  const options = msg.options || {};
  VEAnalyzer.analyze(input, options, function (p) {
    self.postMessage({ type: 'progress', progress: p });
  }).then(function (result) {
    self.postMessage({ type: 'done', result: result });
  }).catch(function (err) {
    self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
  });
};
