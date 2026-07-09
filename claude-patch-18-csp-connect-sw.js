#!/usr/bin/env node
/* ============================================================================
 * claude-patch-18-csp-connect-sw.js
 * ----------------------------------------------------------------------------
 * Your service worker re-fetches resources via fetch(), which CSP governs with
 * connect-src. connect-src only allowed 'self' + Supabase, so the SW's fetches
 * for Google Fonts and the cdnjs QR script were BLOCKED — causing "QRCode is
 * not defined", a dashboard load crash, and (downstream) black video thumbnails.
 *
 * FIX: add the font + CDN origins already trusted in script-src/style-src/
 * font-src to connect-src too, so the service worker can fetch them:
 *   + https://fonts.googleapis.com  https://fonts.gstatic.com
 *   + https://cdnjs.cloudflare.com  https://unpkg.com
 *
 * SCOPE: vercel.json only -> git push redeploys (site-wide header).
 * SAFE: validates JSON, idempotent, anchor must match once or aborts.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');

const FILE = 'vercel.json';
const FROM = "connect-src 'self' https://*.supabase.co;";
const TO   = "connect-src 'self' https://*.supabase.co https://fonts.googleapis.com https://fonts.gstatic.com https://cdnjs.cloudflare.com https://unpkg.com;";

function stamp() {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

console.log('claude-patch-18-csp-connect-sw.js');
console.log('---------------------------------');
if (!fs.existsSync(FILE)) { console.log('ABORT - ' + FILE + ' not found.'); process.exit(1); }
let text = fs.readFileSync(FILE, 'utf8');
try { JSON.parse(text); } catch (e) { console.log('ABORT - not valid JSON to begin with.'); process.exit(1); }

if (text.indexOf('https://fonts.googleapis.com https://fonts.gstatic.com https://cdnjs.cloudflare.com https://unpkg.com;') !== -1 && text.indexOf(TO) !== -1) {
  console.log(FILE + ': connect-src already broadened (skip).'); process.exit(0);
}
const n = text.split(FROM).length - 1;
if (n !== 1) { console.log('ABORT - expected connect-src value matched ' + n + ' (expected 1). Paste me your current CSP so I can adjust. No change.'); process.exit(1); }

const b = FILE + '.bak-' + stamp();
fs.copyFileSync(FILE, b);
try {
  text = text.replace(FROM, TO);
  JSON.parse(text);
  fs.writeFileSync(FILE, Buffer.from(text, 'utf8'));
  console.log(FILE + ': connect-src broadened (fonts + CDNs added). JSON valid.  (backup: ' + path.basename(b) + ')');
} catch (e) {
  fs.copyFileSync(b, FILE);
  console.log(FILE + ': FAILED -> restored (' + String(e.message || e) + ').');
  process.exit(1);
}
console.log('---------------------------------');
console.log('Deploy: git add -A && commit && push (~60s). Then UNREGISTER the old service worker + hard-refresh.');
process.exit(0);
