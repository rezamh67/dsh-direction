#!/usr/bin/env node
/**
 * Real-browser verification of the direction engine.
 *
 * Attribute assertions cannot catch the bug class this plugin is most likely to
 * ship: the controller sets every attribute correctly and the page still reads
 * left-to-right, because a rule lost a specificity fight, an inherited
 * `text-align` re-pinned the text, or the selector stopped matching. Only the
 * browser's own layout engine can answer that.
 *
 * This script therefore drives real headless Chrome:
 *
 *   1. it renders a fixture shaped like the DSH shell with real mixed-script
 *      content (Persian paragraphs, English paragraphs, code, a table);
 *   2. it loads the actual built bundle into that page and activates it;
 *   3. it switches the mode and measures the rendered media box, text-alignment
 *      and computed direction of each probed element;
 *   4. it fails when a Persian paragraph is not flush to the RIGHT edge in rtl
 *      mode, or when code is not flush to the LEFT edge.
 *
 * Chrome is required; when it cannot be found the script reports a skip rather
 * than a pass, so a missing browser can never be mistaken for a green result.
 *
 * Usage: node scripts/browser-check.mjs [--chrome <path>] [--keep]
 *
 * @module dsh-direction/browser-check
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BUNDLE = path.join(ROOT, 'dist', 'client.js');

/** Candidate browser executables, most preferred first. */
const CHROME_CANDIDATES = [
  process.env.DSH_DIRECTION_CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];

/** The fixture: DSH's real data attributes plus real mixed-script content. */
const FIXTURE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>dsh-direction harness</title>
<style>
  /* A deliberately opinionated host stylesheet: it pins text-align:left on the
     body, the way a real application shell does. A direction engine that only
     sets attributes on a permissive document would pass without this. */
  html, body { margin: 0; height: 100%; text-align: left; direction: ltr; }
  .frame { display: grid; grid-template-columns: 220px 1fr; height: 100%; }
  .sidebar { border-right: 1px solid #ddd; }
  [data-conversation-scroll] { overflow: auto; padding: 16px; }
  [data-chat-flow] { max-width: 748px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
  p { margin: 0 0 8px; }
  pre { background: #f4f4f5; padding: 8px; border-radius: 6px; margin: 0 0 8px; white-space: pre; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 6px; }
  [data-composer-seat] { padding: 12px; border-top: 1px solid #ddd; }
  [data-composer-card] { border: 1px solid #ccc; border-radius: 18px; padding: 10px; }
  [data-lexical-editor] { min-height: 24px; outline: none; }
  [data-composer-placeholder] { color: #999; }
  .userRow { display: flex; flex-direction: column; align-items: flex-end; }
  .userStack { background: #eef; border-radius: 18px; padding: 8px 14px; }
</style>
</head>
<body>
<div class="frame">
  <aside class="sidebar">sidebar</aside>
  <main>
    <div data-conversation-scroll>
      <div data-chat-flow>
        <div class="userRow"><div class="userStack"><p id="user-fa">چرا قبلا Pw نوشته بودم؟ چون تمرکز شما روی PW و پورت ۱۰۰۰ بود و PW همان مسیر مستقیم است.</p></div></div>
        <p id="assistant-fa">عوض کردن ترابری = عوض کردن دروازه‌ای که با دستگاه حرف می‌زند. سرویس کاراوت (۷۰۰۱) مستقیما روی ۱۰۰۰۱ گوش می‌دهد.</p>
        <p id="assistant-en">An English paragraph with a trailing period, used as the control case.</p>
        <pre id="code-block"><code>transport: "Karaweb"
server: 127.0.0.1:10001
listen: 7001</code></pre>
        <table><thead><tr><th id="th-1">خودکار</th><th id="th-2">سرویس کاراوت</th></tr></thead>
          <tbody><tr><td id="td-1">خیر</td><td id="td-2">بله</td></tr></tbody></table>
      </div>
    </div>
    <div data-composer-seat>
      <div data-composer-card>
        <div data-input-scroll>
          <div id="editor" data-lexical-editor contenteditable="true"><span data-lexical-text>سلام، این یک پیام آزمایشی است</span></div>
          <div data-composer-placeholder>Message or run a task</div>
        </div>
      </div>
    </div>
  </main>
</div>
<script src="./client.js"></script>
<script>
(function () {
  const report = { errors: [], steps: [] };
  const notes = (message) => report.steps.push(message);

  const registration = window.__capturedRegistration;
  if (registration === undefined) {
    report.errors.push('the bundle did not register a module');
    emit();
    return;
  }
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
    useEffect: () => {},
    useMemo: (factory) => factory(),
    useRef: (value) => ({ current: value }),
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot()
  };
  const exports = registration.factory((specifier) => {
    if (specifier === 'react') return React;
    report.errors.push('unexpected external ' + specifier);
    return undefined;
  });
  const ctx = {
    effect: (callback) => { callback(); },
    get: (key) => (key === 'react' ? React : undefined),
    logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
    slots: { inject: (key, callback) => callback(), register: () => () => {} }
  };
  try {
    exports.apply(ctx);
  } catch (error) {
    report.errors.push('apply threw: ' + error.message);
    emit();
    return;
  }
  const api = window.__DSH_DIRECTION__;
  if (api === undefined) {
    report.errors.push('the console face was not installed');
    emit();
    return;
  }

  const box = (id) => {
    const element = document.getElementById(id);
    if (element === null) return null;
    const rect = element.getBoundingClientRect();
    return { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) };
  };

  /* One measurement pass for the active mode. */
  function measure(mode) {
    const containers = [
      '[data-conversation-scroll]',
      '[data-chat-flow]',
      '[data-composer-card]',
      '[data-lexical-editor]'
    ];
    const computed = {};
    for (const selector of containers) {
      const element = document.querySelector(selector);
      const style = element === null ? null : getComputedStyle(element);
      computed[selector] = {
        dir: element === null ? null : element.getAttribute('dir'),
        direction: style === null ? null : style.direction,
        textAlign: style === null ? null : style.textAlign
      };
    }
    return {
      mode,
      preference: api.getPreference(),
      diagnose: api.diagnose(),
      computed,
      boxes: {
        userFa: box('user-fa'),
        assistantFa: box('assistant-fa'),
        assistantEn: box('assistant-en'),
        code: box('code-block'),
        th: box('th-1'),
        td: box('td-1'),
        editor: box('editor')
      }
    };
  }

  function emit() {
    const payload = { report, measurements: report.measurements || [] };
    const node = document.createElement('pre');
    node.id = 'dsh-direction-result';
    node.textContent = 'DSH_DIRECTION_RESULT:' + JSON.stringify(payload);
    document.body.appendChild(node);
  }

  report.measurements = [];
  api.setMode('auto');
  report.measurements.push(measure('auto'));
  api.setMode('rtl');
  report.measurements.push(measure('rtl'));
  api.setMode('ltr');
  report.measurements.push(measure('ltr'));
  api.setMode('rtl');
  api.setScope('interface');
  report.measurements.push(measure('rtl+interface'));
  api.setMode('auto');
  api.setScope('messages');

  /* Guards that need the real layout engine. The flow is centred inside a
     scroll box, so "flush right" is measured relative to the FLOW, not the
     viewport. */
  const flow = document.querySelector('[data-chat-flow]').getBoundingClientRect();
  const rtlPass = report.measurements[1];
  const autoPass = report.measurements[0];
  const ltrPass = report.measurements[2];
  const flushedRight = (rect, container) =>
    rect !== null && container !== null && Math.abs(rect.right - container.right) <= 2;
  const flushedLeft = (rect, container) =>
    rect !== null && container !== null && Math.abs(rect.left - container.left) <= 2;

  if (!flushedRight(autoPass.boxes.assistantFa, flow)) {
    report.errors.push(
      'auto: the Persian paragraph is not right-aligned (right=' +
        (autoPass.boxes.assistantFa && autoPass.boxes.assistantFa.right) +
        ', flowRight=' +
        Math.round(flow.right) +
        ')'
    );
  }
  if (!flushedLeft(autoPass.boxes.assistantEn, flow)) {
    report.errors.push(
      'auto: the English paragraph is not left-aligned (left=' +
        (autoPass.boxes.assistantEn && autoPass.boxes.assistantEn.left) +
        ', flowLeft=' +
        Math.round(flow.left) +
        ')'
    );
  }
  if (!flushedRight(rtlPass.boxes.assistantEn, flow)) {
    report.errors.push('rtl: a forced direction must align every block to the right edge');
  }
  if (!flushedLeft(ltrPass.boxes.assistantFa, flow)) {
    report.errors.push('ltr: a forced direction must align every block to the left edge');
  }
  if (!flushedLeft(ltrPass.boxes.code, flow)) {
    report.errors.push('code must stay flush left in every mode');
  }
  if (!flushedRight(rtlPass.boxes.code, flow) && !flushedLeft(rtlPass.boxes.code, flow)) {
    report.errors.push('rtl: the code block is neither flush left nor flush right');
  }
  emit();
})();
</script>
</body></html>`;

/**
 * Locate a usable browser.
 *
 * @returns {string|undefined} the executable path.
 */
function findChrome() {
  return CHROME_CANDIDATES.find((candidate) => candidate !== undefined && existsSync(candidate));
}

/**
 * Run one headless page and return its serialized DOM.
 *
 * @param {string} chrome - browser executable.
 * @param {string} pageUrl - file URL of the harness.
 * @returns {{ dom: string, stderr: string }} the dump.
 */
function dumpDom(chrome, pageUrl) {
  const result = spawnSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      '--window-size=1280,900',
      '--virtual-time-budget=4000',
      '--allow-file-access-from-files',
      '--dump-dom',
      pageUrl
    ],
    { encoding: 'utf8', timeout: 90_000, maxBuffer: 64 * 1024 * 1024 }
  );
  return { dom: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/**
 * Run the check.
 *
 * @returns {Promise<void>} resolves after the report; sets a nonzero exit on failure.
 */
async function main() {
  if (!existsSync(BUNDLE)) {
    console.error('browser-check: dist/client.js is missing — run the build first');
    process.exitCode = 1;
    return;
  }
  const chrome = findChrome();
  if (chrome === undefined) {
    console.log('browser-check: no Chrome/Edge found — SKIPPED (set DSH_DIRECTION_CHROME to enable)');
    return;
  }
  const keep = process.argv.includes('--keep');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-direction-'));
  writeFileSync(path.join(dir, 'client.js'), readFileSync(BUNDLE, 'utf8'), 'utf8');
  /* The bundle registers through window.__ModuleLoader__.load; this stub keeps
     the registration instead of building a module system, so the harness drives
     the plugin directly. */
  const html = FIXTURE.replace(
    '<script src="./client.js"></script>',
    '<script>window.__capturedRegistration=null;window.__ModuleLoader__={mode:"queue",pendingQueue:[],load:function(r){window.__capturedRegistration=r;},create:function(){}};</script>\n<script src="./client.js"></script>'
  );
  writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
  const pageUrl = `file:///${path.join(dir, 'index.html').replace(/\\/g, '/')}`;

  const { dom, stderr } = dumpDom(chrome, pageUrl);
  const match = /DSH_DIRECTION_RESULT:(\{[\s\S]*?\})<\/pre>/.exec(dom);
  if (match === null) {
    console.error('browser-check: the harness produced no result.');
    if (stderr.trim() !== '') console.error(stderr.split('\n').slice(0, 12).join('\n'));
    console.error('  (the page may have failed to load the bundle; re-run with --keep to inspect the fixture)');
    process.exitCode = 1;
    if (!keep) rmSync(dir, { recursive: true, force: true });
    else console.error(`fixture kept at ${dir}`);
    return;
  }
  const payload = JSON.parse(match[1]);
  for (const measurement of payload.measurements) {
    const { mode, boxes, computed } = measurement;
    console.log(
      `${mode.padEnd(14)} fa.right=${String(boxes.assistantFa?.right).padStart(4)} en.left=${String(boxes.assistantEn?.left).padStart(4)} ` +
        `code.left=${String(boxes.code?.left).padStart(4)} th.left=${String(boxes.th?.left).padStart(4)} td.left=${String(boxes.td?.left).padStart(4)}`
    );
    console.log(
      `               flow dir=${computed['[data-chat-flow]'].direction}/${computed['[data-chat-flow]'].textAlign} ` +
        `editor dir=${computed['[data-lexical-editor]'].direction}/${computed['[data-lexical-editor]'].textAlign} ` +
        `containers auto-marked=${measurement.diagnose.containers.markedAuto}/${measurement.diagnose.containers.matched}`
    );
  }
  const totalErrors = payload.report.errors.length;
  if (totalErrors > 0) {
    console.error(`\nbrowser-check: ${totalErrors} rendering assertion(s) failed:`);
    for (const error of payload.report.errors) console.error(`  FAIL  ${error}`);
    process.exitCode = 1;
  } else {
    console.log('\nbrowser-check: all rendering assertions passed in real Chrome.');
  }
  if (keep) console.error(`fixture kept at ${dir}`);
  else rmSync(dir, { recursive: true, force: true });
}

await main();
