'use strict';
/**
 * Headless browser & DOM interaction test for index.html UI
 */

const fs = require('fs');
const vm = require('vm');

// Mock browser environment
const listeners = {};
const mockElements = {};
const initiallyHiddenCanvases = new Set([
  'spectrumCanvas',
  'spectrogramCanvas',
  'timelineCanvas',
  'pitchCanvas',
  'eqCurveCanvas'
]);
let imageDataCreateCount = 0;

function createMockElement(tag, id = '') {
  const el = {
    tagName: tag.toUpperCase(),
    id,
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      toggle(c, force) {
        if (force === undefined) {
          if (this._classes.has(c)) this._classes.delete(c); else this._classes.add(c);
        } else if (force) {
          this._classes.add(c);
        } else {
          this._classes.delete(c);
        }
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
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter(x => x !== c); },
    addEventListener(evt, fn) {
      if (!listeners[id + ':' + evt]) listeners[id + ':' + evt] = [];
      listeners[id + ':' + evt].push(fn);
    },
    click() {
      const fns = listeners[id + ':click'];
      if (fns) fns.forEach(fn => fn({ preventDefault() {} }));
    },
    getBoundingClientRect() {
      // Canvas elements inside display:none tab panels have no layout box in
      // a real browser. Keep the mock faithful so zero-size drawing regressions
      // (especially createImageData(0, 0)) are caught by this test.
      if (initiallyHiddenCanvases.has(id)) {
        return { left: 0, top: 0, width: 0, height: 0 };
      }
      return { left: 0, top: 0, width: 800, height: 260 };
    },
    getContext(type) {
      return {
        scale() {},
        fillRect() {},
        strokeRect() {},
        clearRect() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        stroke() {},
        fill() {},
        arc() {},
        fillText() {},
        setLineDash() {},
        createLinearGradient() {
          return { addColorStop() {} };
        },
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
      const tabs = ['tab-overview', 'tab-spectrum', 'tab-spectrogram', 'tab-timeline', 'tab-tonal', 'tab-resonances', 'tab-dynamics', 'tab-sibilance', 'tab-plosives', 'tab-breath', 'tab-pitch', 'tab-health', 'tab-masking', 'tab-reference', 'tab-recommendations', 'tab-eqplan', 'tab-json'];
      return tabs.map(t => {
        const el = createMockElement('button', 'btn_' + t);
        el.setAttribute('data-tab', t);
        return el;
      });
    }
    if (sel === '.v-tab-content') {
      const tabs = ['tab-overview', 'tab-spectrum', 'tab-spectrogram', 'tab-timeline', 'tab-tonal', 'tab-resonances', 'tab-dynamics', 'tab-sibilance', 'tab-plosives', 'tab-breath', 'tab-pitch', 'tab-health', 'tab-masking', 'tab-reference', 'tab-recommendations', 'tab-eqplan', 'tab-json'];
      return tabs.map(t => createMockElement('div', t));
    }
    return [];
  },
  createElement(tag) {
    return createMockElement(tag);
  },
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
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      this.destination = {};
    }
    resume() { return Promise.resolve(); }
    createBuffer(ch, len, sr) {
      const data = [new Float32Array(len)];
      return {
        sampleRate: sr,
        length: len,
        numberOfChannels: ch,
        duration: len / sr,
        getChannelData: (c) => data[c || 0]
      };
    }
    createBufferSource() {
      return {
        connect() {},
        disconnect() {},
        start() {},
        stop() {}
      };
    }
    decodeAudioData(ab) {
      return Promise.resolve(this.createBuffer(1, 48000 * 2, 48000));
    }
  }
};
global.requestAnimationFrame = (fn) => setTimeout(fn, 16);
global.cancelAnimationFrame = (id) => clearTimeout(id);
Object.defineProperty(global.navigator, 'clipboard', { value: { writeText: () => Promise.resolve() }, configurable: true });
global.Blob = class { constructor(parts) { this.parts = parts; } };
global.URL = { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} };
global.alert = (msg) => console.log('Mock Alert:', msg);

// Load all scripts into VM
const scripts = [
  'vocal/dsp.js',
  'vocal/health.js',
  'vocal/spectrum.js',
  'vocal/pitch.js',
  'vocal/formants.js',
  'vocal/tonal.js',
  'vocal/resonances.js',
  'vocal/dynamic-spectral.js',
  'vocal/dynamics.js',
  'vocal/events.js',
  'vocal/character.js',
  'vocal/stereo.js',
  'vocal/masking.js',
  'vocal/reference.js',
  'vocal/decision.js',
  'vocal/proq.js',
  'vocal/engine.js',
  'vocal/ui.js'
];

for (const s of scripts) {
  const code = fs.readFileSync(s, 'utf8');
  vm.runInThisContext(code, { filename: s });
}

(async () => {
  console.log('Testing UI initialization & Load Demo Vocal action...');
  const loadDemoFns = listeners['loadDemoBtn:click'];
  if (!loadDemoFns || !loadDemoFns.length) {
    console.error('FAIL: loadDemoBtn click listener not found');
    process.exit(1);
  }

  // Trigger click on loadDemoBtn
  await loadDemoFns[0]({ preventDefault() {} });

  console.log('Checking rendered summary and tabs...');
  if (imageDataCreateCount !== 0) {
    console.error('FAIL: attempted to render ImageData while the spectrogram tab was hidden');
    process.exit(1);
  }

  // Once the spectrogram tab becomes visible, its click handler should draw it.
  initiallyHiddenCanvases.delete('spectrogramCanvas');
  const spectrogramTabFns = listeners['btn_tab-spectrogram:click'];
  if (!spectrogramTabFns || !spectrogramTabFns.length) {
    console.error('FAIL: spectrogram tab click listener not found');
    process.exit(1);
  }
  spectrogramTabFns[0]({ preventDefault() {} });
  if (imageDataCreateCount !== 1) {
    console.error('FAIL: visible spectrogram was not rendered exactly once');
    process.exit(1);
  }

  const summaryEl = mockElements['overviewSummaryText'];
  console.log('Summary Text:', summaryEl ? summaryEl.textContent : 'none');
  if (!summaryEl || !summaryEl.textContent) {
    console.error('FAIL: overview summary empty');
    process.exit(1);
  }

  const jsonViewer = mockElements['reportJsonViewer'];
  if (!jsonViewer || !jsonViewer.textContent) {
    console.error('FAIL: json viewer empty');
    process.exit(1);
  }
  console.log('JSON Viewer populated with', jsonViewer.textContent.length, 'characters of JSON.');

  console.log('✅ UI Simulation Test Passed Successfully!');
  process.exit(0);
})().catch(e => {
  console.error('UI Simulation Error:', e);
  process.exit(1);
});
