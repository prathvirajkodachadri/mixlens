'use strict';
/**
 * MixLens Final Mastering Analysis 1.0 — Web Worker.
 * Heavy FFT / STFT / loudness / true-peak work runs off the UI thread.
 */
/* eslint-disable no-undef */
importScripts(
  'utilities.js',
  'fft.js',
  'stft.js',
  'clipping.js',
  'loudness.js',
  'true-peak.js',
  'dynamics.js',
  'spectrum.js',
  'stereo.js',
  'phase.js',
  'mono.js',
  'silence.js',
  'fade.js',
  'distortion.js',
  'platform-profiles.js',
  'platform-analysis.js',
  'scoring.js',
  'export-json.js',
  'export-txt.js',
  'report-generator.js',
  'analyzer.js'
);

self.onmessage = function (ev) {
  const msg = ev.data || {};
  if (msg.type !== 'analyze') return;
  const input = msg.input;
  const options = msg.options || {};
  MAAnalyzer.analyze(input, options, function (p) {
    self.postMessage({ type: 'progress', progress: p });
  }).then(function (result) {
    self.postMessage({ type: 'done', result: result });
  }).catch(function (err) {
    self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
  });
};
