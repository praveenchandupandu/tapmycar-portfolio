#!/usr/bin/env node
/**
 * TMC_PATCH_SEC2 — Lock down CORS in vercel.json
 *
 * Replaces wildcard Access-Control-Allow-Origin: * with origin-specific
 * rules using Vercel's `has` matcher.
 *
 * Allowed origins:
 *   - https://www.tapmycar.io   (canonical website)
 *   - https://tapmycar.io       (non-www, in case)
 *   - https://localhost         (Capacitor Android WebView)
 *   - capacitor://localhost     (Capacitor iOS WebView scheme — future)
 *
 * Idempotent.
 */

const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [
  now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
  pad(now.getHours()), pad(now.getMinutes())
].join('-');
const backupDir = 'backup-sec2-cors-' + stamp;

console.log('\n=== TMC_PATCH_SEC2 - Lock down CORS ===\n');

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

const apiSrcPattern = '/api/(.*)';
const existingApiBlocks = config.headers.filter(h => h.source === apiSrcPattern);

const alreadyMigrated = existingApiBlocks.some(b => Array.isArray(b.has) && b.has.length > 0);
if (alreadyMigrated) {
  console.log('  ~ vercel.json already has origin-specific CORS rules - skipping');
  process.exit(0);
}

const hadWildcard = existingApiBlocks.some(b =>
  Array.isArray(b.headers) &&
  b.headers.some(h => h.key === 'Access-Control-Allow-Origin' && h.value === '*')
);
if (!hadWildcard) {
  console.log('  ! No wildcard CORS found - vercel.json may already be hardened or in unexpected state');
  console.log('    Aborting to avoid clobbering custom config.');
  process.exit(1);
}

config.headers = config.headers.filter(h => h.source !== apiSrcPattern);

const allowedOrigins = [
  'https://www.tapmycar.io',
  'https://tapmycar.io',
  'https://localhost',
  'capacitor://localhost'
];

const corsHeadersFor = origin => ([
  { key: 'Access-Control-Allow-Origin',      value: origin },
  { key: 'Access-Control-Allow-Credentials', value: 'true' },
  { key: 'Access-Control-Allow-Methods',     value: 'GET, POST, PUT, DELETE, OPTIONS, PATCH' },
  { key: 'Access-Control-Allow-Headers',     value: 'Content-Type, Authorization, X-Requested-With' },
  { key: 'Access-Control-Max-Age',           value: '86400' },
  { key: 'Vary',                             value: 'Origin' }
]);

for (const origin of allowedOrigins) {
  config.headers.push({
    source: apiSrcPattern,
    has: [{ type: 'header', key: 'origin', value: origin }],
    headers: corsHeadersFor(origin)
  });
}

fs.writeFileSync(target, JSON.stringify(config, null, 2) + '\n', 'utf8');

console.log('  + Removed wildcard CORS');
console.log('  + Added origin-specific CORS for ' + allowedOrigins.length + ' origins:');
allowedOrigins.forEach(o => console.log('      - ' + o));
console.log('');
console.log('  Backup: ' + backupDir + '/vercel.json');
console.log('');
console.log('Next:');
console.log('  git add vercel.json');
console.log('  git commit -m "TMC_PATCH_SEC2: Lock CORS to specific origins"');
console.log('  git push');
console.log('');
