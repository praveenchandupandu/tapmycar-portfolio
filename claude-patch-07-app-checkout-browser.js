#!/usr/bin/env node
/* ============================================================================
 * claude-patch-07-app-checkout-browser.js
 * ----------------------------------------------------------------------------
 * Fix: in the app, the renewal checkout navigates the app's own screen to
 * Stripe and then to the public website, where you're logged out - so backing
 * out dead-ends at sign-in.
 *
 * FIX (renew.html): when running inside the app, open the Stripe checkout URL
 * in the phone's browser (Capacitor Browser plugin) and send the app itself
 * back to the dashboard. The app never leaves its logged-in world; you pay in
 * the browser and come back to the dashboard. On the web, behavior is
 * unchanged (still navigates to Stripe in the same tab).
 *
 * Only the one line `window.location.href = d.url;` is changed. The free-plan
 * redirect and the sign-in redirect are left alone.
 *
 * SAFE / IDEMPOTENT: timestamped backup, UTF-8 no-BOM, skips if already applied
 * (marker TMC_APP_CHECKOUT), validates the injected JS with node --check,
 * mirrors to the root copy, restores on failure.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const FILE = path.join('public', 'renew.html');
const ROOT = 'renew.html';
const MARKER = 'TMC_APP_CHECKOUT';

const REPLACEMENT = [
"/* TMC_APP_CHECKOUT: in the app, open Stripe in the phone browser so the app stays on the dashboard (logged in). */",
"      if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {",
"        var _tmcOpened = false;",
"        try { window.Capacitor.Plugins.Browser.open({ url: d.url }); _tmcOpened = true; } catch (e) {}",
"        if (_tmcOpened) { setTimeout(function(){ window.location.replace('/dashboard.html'); }, 400); }",
"        else { window.location.href = d.url; }",
"      } else {",
"        window.location.href = d.url;",
"      }"
].join('\n');

// match the single handoff line (spacing tolerant); first occurrence only
const TARGET_RE = /window\.location\.href\s*=\s*d\.url\s*;/;

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function validateInjectedJs() {
  const tmp = path.join(os.tmpdir(), 'tmc-checkout-' + Date.now() + '.js');
  const wrapper = 'function __c__(d){ var window = {};\n' + REPLACEMENT + '\n}';
  fs.writeFileSync(tmp, wrapper, 'utf8');
  try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); }
  finally { try { fs.unlinkSync(tmp); } catch (_) {} }
}

console.log('claude-patch-07-app-checkout-browser.js');
console.log('---------------------------------------');

if (!fs.existsSync(FILE)) { console.log('ABORT - ' + FILE + ' not found (nothing changed).'); process.exit(1); }

const original = fs.readFileSync(FILE, 'utf8');

if (original.indexOf(MARKER) !== -1) {
  console.log(FILE + ': already applied (skip).');
  process.exit(0);
}

const m = original.match(TARGET_RE);
if (!m) { console.log('ABORT - could not find `window.location.href = d.url;` (nothing changed).'); process.exit(1); }

try { validateInjectedJs(); console.log('injected JS: node --check OK'); }
catch (e) { console.log('injected JS: node --check FAILED -> aborting, nothing changed.'); console.log('   ' + String(e.message || e)); process.exit(1); }

const backup = FILE + '.bak-' + stamp();
fs.copyFileSync(FILE, backup);
try {
  const updated = original.replace(TARGET_RE, function () { return REPLACEMENT; });
  if (updated.indexOf(MARKER) === -1) throw new Error('marker missing after replace');
  fs.writeFileSync(FILE, Buffer.from(updated, 'utf8')); // UTF-8 no-BOM
  let extra = '';
  if (fs.existsSync(ROOT)) { const rb = ROOT + '.bak-' + stamp(); fs.copyFileSync(ROOT, rb); fs.copyFileSync(FILE, ROOT); extra = ' -> mirrored to ' + ROOT; }
  console.log(FILE + ': patched (checkout opens in phone browser inside the app)' + extra + '  (backup: ' + path.basename(backup) + ')');
  console.log('---------------------------------------');
  console.log('Done. In the app, paying keeps you on the dashboard; on the web nothing changes.');
  process.exit(0);
} catch (err) {
  fs.copyFileSync(backup, FILE);
  console.log(FILE + ': FAILED -> restored  (' + String(err.message || err) + ')');
  process.exit(1);
}
