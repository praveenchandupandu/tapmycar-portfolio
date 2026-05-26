// ============================================================================
// TapMyCar - Patch 37: Security headers
//
// Adds an HTTP security-headers block to vercel.json. Closes the
// pre-launch checklist's "Security Headers" gap (currently zero headers).
//
// FIVE headers added, applied to every route:
//
//   X-Content-Type-Options: nosniff
//     Stops MIME-type sniffing. Zero behavioural risk.
//
//   X-Frame-Options: SAMEORIGIN
//     Blocks other sites from framing tapmycar.io (anti-clickjacking).
//     Your own pages can still frame each other. Zero risk.
//
//   Strict-Transport-Security: max-age=31536000; includeSubDomains
//     Forces HTTPS. Vercel already serves HTTPS, so this just locks it in.
//
//   Referrer-Policy: strict-origin-when-cross-origin
//     Limits how much URL info leaks to third-party sites on outbound
//     clicks. Zero risk.
//
//   Content-Security-Policy-Report-Only: <policy>
//     XSS protection in REPORT-ONLY mode - the browser checks every page
//     against the policy and logs violations in the console, but BLOCKS
//     NOTHING. Nothing on the site can break. This lets you confirm the
//     policy is correct before ever switching it to enforcing mode.
//     The policy already whitelists every external source the code uses:
//       scripts:  cdnjs.cloudflare.com, unpkg.com
//       styles:   fonts.googleapis.com, unpkg.com
//       fonts:    fonts.gstatic.com
//       images:   self, data:, https: (QR codes, tag photos)
//       connect:  self  (all API calls are same-origin /api/*)
//     'unsafe-inline' is included for scripts + styles because the site
//     has 274 inline onclick handlers and 45 inline <script> blocks - a
//     strict policy would break them. Report-only means this is just a
//     measurement for now; tightening it later is a separate decision.
//
// This patch touches ONLY vercel.json. No code, no UI, no endpoint logic.
// Idempotent, backs up vercel.json, validates JSON.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch37-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function readFile(p) {
  if (!fs.existsSync(p)) errExit('File not found: ' + p + '  (run from inside the tapmycar project folder)');
  return fs.readFileSync(p, 'utf8');
}
function writeFile(p, content) {
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  fs.writeFileSync(p, content, 'utf8');
}

log('');
log('TapMyCar Patch 37 \u2014 security headers');
log('Backup: ' + path.relative(ROOT, BACKUP_DIR));
log('');

const file = path.join(ROOT, 'vercel.json');
const content = readFile(file);

let cfg;
try {
  cfg = JSON.parse(content);
} catch (e) {
  errExit('vercel.json is not valid JSON: ' + e.message);
}

if (Array.isArray(cfg.headers) && JSON.stringify(cfg.headers).includes('X-Content-Type-Options')) {
  skip('vercel.json (security headers already present)');
  process.exit(0);
}

/* backup */
fs.mkdirSync(BACKUP_DIR, { recursive: true });
fs.copyFileSync(file, path.join(BACKUP_DIR, 'vercel.json'));

/* The CSP - report-only. Whitelists every external source the frontend
   actually uses (verified by scanning public/). 'unsafe-inline' kept for
   script/style because of the 274 inline handlers + 45 inline scripts. */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.stripe.com"
].join('; ');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Content-Security-Policy-Report-Only', value: csp }
];

if (!Array.isArray(cfg.headers)) cfg.headers = [];
cfg.headers.push({
  source: '/(.*)',
  headers: securityHeaders
});

writeFile(file, JSON.stringify(cfg, null, 2) + '\n');

/* validate the result is still valid JSON */
try {
  JSON.parse(readFile(file));
} catch (e) {
  errExit('vercel.json invalid after write: ' + e.message);
}
ok('vercel.json: 5 security headers added (CSP in report-only mode)');

log('');
log('==============================================================');
log('Patch 37 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 37: security headers"');
log('  git push');
log('  Wait ~60 sec for Vercel.');
log('');
log('Verify the headers are live:');
log('  Open tapmycar.io in Chrome -> DevTools -> Network tab -> click the');
log('  top document request -> Headers -> Response Headers. You should see');
log('  X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security,');
log('  Referrer-Policy, and Content-Security-Policy-Report-Only.');
log('');
log('IMPORTANT \u2014 the CSP is REPORT-ONLY:');
log('  Nothing on the site can break. Over the next few days, open the');
log('  browser Console on various pages and watch for messages starting');
log('  with "[Report Only]". Those list anything the policy WOULD block.');
log('  Send me that list later and we can decide whether to tighten the');
log('  CSP into enforcing mode. Until then it is purely a measurement.');
log('');
log('What changed for users: nothing visible. The first 4 headers are');
log('invisible metadata; the CSP blocks nothing in report-only mode.');
log('==============================================================');
