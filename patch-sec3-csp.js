#!/usr/bin/env node
/**
 * TMC_PATCH_SEC3 - Switch CSP from Report-Only to Enforcement
 *
 * Single change: renames the response header
 *   "Content-Security-Policy-Report-Only"  ->  "Content-Security-Policy"
 *
 * The policy VALUE stays identical, so no legitimate behavior changes.
 * What DOES change: the browser now enforces (blocks) what it was
 * previously only reporting.
 *
 * Blocks (even with unsafe-inline still permitted):
 *   - External scripts from non-allowlisted domains  -> XSS payload defense
 *   - XHR/fetch to non-allowlisted domains           -> exfiltration defense
 *   - Iframing of the site                           -> clickjacking defense
 *   - Form submissions to unauthorized domains
 *   - Base-tag injection
 *
 * Idempotent. Backup created.
 */

const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [
  now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
  pad(now.getHours()), pad(now.getMinutes())
].join('-');
const backupDir = 'backup-sec3-csp-' + stamp;

console.log('\n=== TMC_PATCH_SEC3 - Enforce CSP ===\n');

const target = 'vercel.json';
if (!fs.existsSync(target)) {
  console.error('  X vercel.json not found in current directory');
  process.exit(1);
}

fs.mkdirSync(backupDir, { recursive: true });
fs.copyFileSync(target, path.join(backupDir, target));

const raw = fs.readFileSync(target, 'utf8');
let config;
try {
  config = JSON.parse(raw);
} catch (e) {
  console.error('  X vercel.json is not valid JSON: ' + e.message);
  process.exit(1);
}

if (!Array.isArray(config.headers)) {
  console.error('  X Expected config.headers to be an array');
  process.exit(1);
}

let foundReportOnly = false;
let alreadyEnforced = false;

for (const rule of config.headers) {
  if (!Array.isArray(rule.headers)) continue;
  for (const h of rule.headers) {
    if (h.key === 'Content-Security-Policy-Report-Only') {
      foundReportOnly = true;
      h.key = 'Content-Security-Policy';
      console.log('  + Renamed CSP header: Report-Only -> enforcement');
      console.log('    in rule with source: ' + rule.source);
    } else if (h.key === 'Content-Security-Policy') {
      alreadyEnforced = true;
    }
  }
}

if (alreadyEnforced && !foundReportOnly) {
  console.log('  ~ CSP is already in enforcement mode - nothing to do');
  process.exit(0);
}

if (!foundReportOnly) {
  console.error('  X No Content-Security-Policy-Report-Only header found in vercel.json');
  console.error('    Either CSP is missing entirely, or it has a different name.');
  process.exit(1);
}

fs.writeFileSync(target, JSON.stringify(config, null, 2) + '\n', 'utf8');

console.log('');
console.log('  Backup: ' + backupDir + '/vercel.json');
console.log('');
console.log('Next:');
console.log('  git add vercel.json');
console.log('  git commit -m "TMC_PATCH_SEC3: Enforce CSP (was report-only)"');
console.log('  git push');
console.log('');
console.log('After Vercel deploys (~1 min), thorough test:');
console.log('  1. Open www.tapmycar.io in browser - all pages load?');
console.log('  2. Sign in - works?');
console.log('  3. Dashboard - tags, settings, billing all load?');
console.log('  4. Capacitor app (uses native HTTP, CSP does not apply) - works as before');
console.log('  5. Open DevTools Console on any page - any red CSP errors?');
console.log('     If yes, those are NOW BLOCKED. Tell me the error and we fix or revert.');
console.log('');
console.log('Revert if anything breaks:');
console.log('  Copy-Item "' + backupDir + '\\vercel.json" "." -Force');
console.log('  git add vercel.json');
console.log('  git commit -m "Revert CSP enforcement"');
console.log('  git push');
console.log('');
