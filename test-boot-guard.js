'use strict';
/**
 * Boot guard: if VEAnalyzer failed to load, ui.js must surface a recovery banner
 * and must not throw.
 */

const fs = require('fs');
const vm = require('vm');

function makeHarness() {
  const state = { bannerCreated: false };
  const mockDoc = {
    readyState: 'complete',
    getElementById() { return null; },
    querySelectorAll() { return []; },
    createElement(tag) {
      return { tagName: tag.toUpperCase(), id: '', className: '', textContent: '', classList: { add() {}, toggle() {} } };
    },
    body: {
      appendChild(el) {
        if (el && el.id === 'mixlensBootError') state.bannerCreated = true;
      }
    },
    addEventListener() {}
  };
  const sandbox = {
    document: mockDoc,
    window: { addEventListener() {}, location: { href: 'https://example.com/mixlens/index.html' } },
    self: undefined,
    console,
    setTimeout,
    clearTimeout
  };
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  return { sandbox, state };
}

function loadUI(sandbox) {
  const code = fs.readFileSync('js/vocal-engine/ui.js', 'utf8');
  vm.runInNewContext(code, sandbox, { filename: 'js/vocal-engine/ui.js' });
}

let fails = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' — ' + detail : ''));
  if (!ok) fails++;
}

{
  const { sandbox, state } = makeHarness();
  loadUI(sandbox);
  check('missing engine shows recovery banner', state.bannerCreated === true);
}

{
  const { sandbox, state } = makeHarness();
  sandbox.VEUtilities = { fmtDb: (x) => x, fmtFreq: String, fmtTime: String };
  sandbox.VEAnalyzer = { analyze: async () => ({}), STAGES: [], makeDemoBuffer() { return {}; } };
  sandbox.VEAudioLoader = {};
  sandbox.VEPdf = {};
  sandbox.document.getElementById = function () {
    return {
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      addEventListener() {},
      style: {},
      setAttribute() {},
      textContent: '',
      innerHTML: ''
    };
  };
  sandbox.document.querySelectorAll = function () { return []; };
  loadUI(sandbox);
  check('healthy engine boot: no banner', state.bannerCreated === false);
}

console.log(fails === 0 ? '\nBOOT GUARD TESTS PASSED' : '\n' + fails + ' BOOT GUARD TEST(S) FAILED');
process.exit(fails === 0 ? 0 : 1);
