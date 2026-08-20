'use strict';
/**
 * Headless DOM interaction test for Vocal Engine 3.0 (index.html UI)
 */

const fs = require('fs');
const vm = require('vm');

const listeners = {};
const mockElements = {};
const initiallyHiddenCanvases = new Set([
  'spectrumCanvas', 'spectrogramCanvas', 'timelineCanvas', 'pitchCanvas',
  'tonalCanvas', 'resonanceCanvas', 'loudnessCanvas', 'radarCanvas'
]);
let imageDataCreateCount = 0;

function createMockElement(tag, id) {
  const el = {
    tagName: String(tag).toUpperCase(),
    id: id || '',
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      toggle(c, force) {
        if (force === undefined) {
          if (this._classes.has(c)) this._classes.delete(c); else this._classes.add(c);
        } else if (force) this._classes.add(c); else this._classes.delete(c);
      },
      contains(c) { return this._classes.has(c); }
    },
    style: {},
    attributes: {},
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k]; },
    textContent: '',
    innerHTML: '',
    children: [],
    value: '',
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(evt, fn) {
      const key = (id || '') + ':' + evt;
      if (!listeners[key]) listeners[key] = [];
      listeners[key].push(fn);
    },
    getBoundingClientRect() {
      if (initiallyHiddenCanvases.has(id)) return { left: 0, top: 0, width: 0, height: 0 };
      return { left: 0, top: 0, width: 800, height: 260 };
    },
    getContext() {
      return {
        scale() {}, fillRect() {}, strokeRect() {}, clearRect() {},
        beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
        arc() {}, fillText() {}, setLineDash() {}, setTransform() {},
        save() {}, restore() {}, translate() {}, rotate() {}, closePath() {},
        drawImage() {},
        createLinearGradient() { return { addColorStop() {} }; },
        createImageData(w, h) {
          if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
            throw new TypeError("Failed to execute 'createImageData': The source width is zero or not a number.");
          }
          imageDataCreateCount++;
          return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
        },
        putImageData() {}
      };
    }
  };
  return el;
}

const mockDoc = {
  readyState: 'complete',
  getElementById(id) {
    if (!mockElements[id]) mockElements[id] = createMockElement('div', id);
    return mockElements[id];
  },
  querySelectorAll(sel) {
    if (sel === '.v-tab-btn') {
      const tabs = ['tab-report', 'tab-spectrum', 'tab-spectrogram', 'tab-timeline', 'tab-tonal', 'tab-resonances', 'tab-loudness', 'tab-events', 'tab-pitch', 'tab-health', 'tab-character', 'tab-compare', 'tab-json'];
      return tabs.map((t) => {
        const el = createMockElement('button', 'btn_' + t);
        el.setAttribute('data-tab', t);
        return el;
      });
    }
    if (sel === '.v-tab-content') {
      return ['tab-report', 'tab-spectrum', 'tab-spectrogram', 'tab-json'].map((t) => createMockElement('div', t));
    }
    return [];
  },
  querySelector(sel) {
    if (sel === '.v-tab-btn.active') {
      const el = createMockElement('button', 'btn_tab-report');
      el.setAttribute('data-tab', 'tab-report');
      return el;
    }
    return null;
  },
  createElement(tag) { return createMockElement(tag); },
  body: createMockElement('body'),
  addEventListener(evt, fn) {
    if (!listeners['doc:' + evt]) listeners['doc:' + evt] = [];
    listeners['doc:' + evt].push(fn);
  }
};

global.document = mockDoc;
global.window = {
  addEventListener() {},
  devicePixelRatio: 1,
  AudioContext: class {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    resume() { return Promise.resolve(); }
    createGain() { return { gain: { value: 1 }, connect() {} }; }
    createBuffer(ch, len, sr) {
      const data = [];
      for (let i = 0; i < ch; i++) data.push(new Float32Array(len));
      return {
        sampleRate: sr, length: len, numberOfChannels: ch, duration: len / sr,
        getChannelData: (c) => data[c || 0]
      };
    }
    createBufferSource() { return { connect() {}, disconnect() {}, start() {}, stop() {}, playbackRate: { value: 1 } }; }
    decodeAudioData() { return Promise.resolve(this.createBuffer(1, 48000 * 2, 48000)); }
  }
};
global.self = global.window;
global.requestAnimationFrame = (fn) => setTimeout(fn, 16);
global.cancelAnimationFrame = (id) => clearTimeout(id);
Object.defineProperty(global.navigator, 'clipboard', { value: { writeText: () => Promise.resolve() }, configurable: true });
global.Blob = class { constructor(parts) { this.parts = parts; } };
global.URL = { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} };
global.Worker = function () { throw new Error('no worker in sim'); };
global.alert = () => {};

const scripts = [
  'js/vocal-engine/utilities.js',
  'js/vocal-engine/fft.js',
  'js/vocal-engine/stft.js',
  'js/vocal-engine/preprocessing.js',
  'js/vocal-engine/clipping.js',
  'js/vocal-engine/loudness.js',
  'js/vocal-engine/dynamics.js',
  'js/vocal-engine/spectrum.js',
  'js/vocal-engine/tonal-balance.js',
  'js/vocal-engine/resonance.js',
  'js/vocal-engine/sibilance.js',
  'js/vocal-engine/plosive.js',
  'js/vocal-engine/breath.js',
  'js/vocal-engine/noise.js',
  'js/vocal-engine/hum.js',
  'js/vocal-engine/pitch.js',
  'js/vocal-engine/vibrato.js',
  'js/vocal-engine/stereo.js',
  'js/vocal-engine/masking.js',
  'js/vocal-engine/scoring.js',
  'js/vocal-engine/interpretation.js',
  'js/vocal-engine/timeline.js',
  'js/vocal-engine/json-export.js',
  'js/vocal-engine/report-generator.js',
  'js/vocal-engine/pdf-export.js',
  'js/vocal-engine/analyzer.js',
  'js/vocal-engine/audio-loader.js',
  'js/vocal-engine/ui.js'
];

for (const s of scripts) {
  vm.runInThisContext(fs.readFileSync(s, 'utf8'), { filename: s });
}

(async () => {
  console.log('Testing Vocal Engine 3.0 UI + Load Demo…');
  const loadDemoFns = listeners['loadDemoBtn:click'];
  if (!loadDemoFns || !loadDemoFns.length) {
    console.error('FAIL: loadDemoBtn click listener not found');
    process.exit(1);
  }
  await loadDemoFns[0]({ preventDefault() {}, stopPropagation() {} });

  if (imageDataCreateCount !== 0) {
    console.error('FAIL: spectrogram ImageData created while hidden');
    process.exit(1);
  }

  initiallyHiddenCanvases.delete('spectrogramCanvas');
  const specTab = listeners['btn_tab-spectrogram:click'];
  if (!specTab || !specTab.length) {
    console.error('FAIL: spectrogram tab click listener not found');
    process.exit(1);
  }
  specTab[0]({ preventDefault() {} });
  if (imageDataCreateCount !== 1) {
    console.error('FAIL: visible spectrogram was not rendered exactly once, got', imageDataCreateCount);
    process.exit(1);
  }

  const summaryEl = mockElements.overviewSummaryText;
  if (!summaryEl || !summaryEl.textContent) {
    console.error('FAIL: overview summary empty');
    process.exit(1);
  }
  const jsonViewer = mockElements.reportJsonViewer;
  if (!jsonViewer || !jsonViewer.textContent) {
    console.error('FAIL: json viewer empty');
    process.exit(1);
  }
  const fullReport = mockElements.fullReportViewer;
  if (!fullReport || !fullReport.innerHTML || !/MIXLENS VOCAL ANALYSIS REPORT/.test(fullReport.innerHTML)) {
    console.error('FAIL: full vocal report was not rendered');
    process.exit(1);
  }
  if (!/DEMO DATA/.test(mockElements.demoBanner.classList.contains('hidden') ? '' : 'DEMO DATA') &&
      mockElements.demoBanner.classList.contains('hidden')) {
    // banner should be visible for demo
    if (mockElements.demoBanner.classList.contains('hidden')) {
      console.error('FAIL: demo banner hidden on demo analysis');
      process.exit(1);
    }
  }
  console.log('Summary:', summaryEl.textContent.slice(0, 120));
  console.log('JSON chars:', jsonViewer.textContent.length);
  console.log('UI Simulation Test Passed Successfully!');
  process.exit(0);
})().catch((e) => {
  console.error('UI Simulation Error:', e);
  process.exit(1);
});
