'use strict';
/**
 * Regression test for the UI boot guard added after the bug:
 *   "Cannot read properties of undefined (reading 'generateProQ4Preset')"
 *
 * Verifies that when the VocalEngine module fails to load (stale/mixed
 * browser cache), vocal/ui.js:
 *   1. attempts exactly ONE cache-busted reload, and
 *   2. shows an actionable recovery banner instead of crashing later
 *      with an undefined-module error mid-analysis.
 */

const fs = require('fs');
const vm = require('vm');

function makeHarness() {
  const elements = {};
  const state = {
    reloads: 0,
    reloadHrefs: [],
    storage: new Map(),
    bannerCreated: false
  };

  const mockDoc = {
    readyState: 'complete',
    getElementById(id) {
      return elements[id] || null;
    },
    querySelectorAll() {
      return [];
    },
    createElement(tag) {
      const el = {
        tagName: tag.toUpperCase(),
        id: '',
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        style: {},
        setAttribute(k, v) { this.id = (k === 'id') ? v : this.id; },
        innerHTML: '',
        appendChild() {}
      };
      return el;
    },
    body: {
      appendChild(el) {
        if (el && el.id === 'mixlensBootError') state.bannerCreated = true;
      }
    },
    documentElement: { appendChild() {} },
    addEventListener() {}
  };

  const mockWindow = {
    location: {
      href: 'https://example.com/mixlens/index.html',
      pathname: '/mixlens/index.html',
      replace(url) {
        state.reloads++;
        state.reloadHrefs.push(url);
      }
    },
    sessionStorage: {
      getItem(k) { return state.storage.has(k) ? state.storage.get(k) : null; },
      setItem(k, v) { state.storage.set(k, String(v)); }
    },
    addEventListener() {}
  };

  const sandbox = {
    document: mockDoc,
    window: mockWindow,
    self: undefined,
    setTimeout,
    clearTimeout,
    isFinite,
    console
  };
  sandbox.self = sandbox;
  return { sandbox, state, elements };
}

function loadUI(sandbox) {
  const code = fs.readFileSync('vocal/ui.js', 'utf8');
  vm.runInNewContext(code, sandbox, { filename: 'vocal/ui.js' });
}

let fails = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails++;
}

/* --- Case 1: engine missing -> one cache-busted reload, no banner yet --- */
{
  const { sandbox, state } = makeHarness();
  sandbox.VocalDSP = { fmtDb: (x) => x, fmtFreq: (x) => String(x), freqToNote: () => ({}) };
  sandbox.VocalReport = {};
  // VocalEngine intentionally NOT defined
  loadUI(sandbox);

  check('missing engine triggers a cache-busted reload', state.reloads === 1, `reloads=${state.reloads}`);
  check('reload URL carries a fresh cache-busting token',
    state.reloadHrefs.length === 1 && /_fresh=\d+/.test(state.reloadHrefs[0]),
    state.reloadHrefs[0] || 'none');
  check('no error banner on first (auto-reload) attempt', state.bannerCreated === false);
}

/* --- Case 2: engine still missing after reload -> error banner, no loop --- */
{
  const { sandbox, state } = makeHarness();
  sandbox.VocalDSP = { fmtDb: (x) => x, fmtFreq: (x) => String(x), freqToNote: () => ({}) };
  sandbox.VocalReport = {};
  state.storage.set('mixlens_fresh_reload', '1'); // previous attempt already happened
  loadUI(sandbox);

  check('second failure does not reload again (no loop)', state.reloads === 0, `reloads=${state.reloads}`);
  check('actionable recovery banner is shown', state.bannerCreated === true);
}

/* --- Case 3: engine present -> boot proceeds without reload or banner --- */
{
  const { sandbox, state } = makeHarness();
  sandbox.VocalDSP = { fmtDb: (x) => x, fmtFreq: (x) => String(x), freqToNote: () => ({}) };
  sandbox.VocalReport = {};
  sandbox.VocalEngine = { analyzeVocal: async () => ({}) };
  loadUI(sandbox);

  check('healthy engine boot: no reload', state.reloads === 0, `reloads=${state.reloads}`);
  check('healthy engine boot: no banner', state.bannerCreated === false);
}

console.log(fails === 0 ? '\n✅ BOOT GUARD TESTS PASSED' : `\n❌ ${fails} BOOT GUARD TEST(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
