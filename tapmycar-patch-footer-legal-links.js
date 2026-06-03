/* ============================================================================
 * TapMyCar  Patch  add Privacy + Terms links to landing.html and why.html
 * Run from project root:  node tapmycar-patch-footer-legal-links.js
 *
 * The privacy and terms pages already exist (/privacy.html and /terms.html).
 * They are linked from settings, signin, register, pricing, contact, dashboard,
 * payment-success, activate, activity, manage, etag, knowmore, and reviews.
 * But landing.html and why.html were missing the links in their footers, so
 * the policies were effectively invisible to visitors. This patch adds them.
 *
 * SAFE TO RE-RUN: detected by /privacy.html already in the footer block.
 * ==========================================================================*/
'use strict';
const fs = require('fs');
const path = require('path');

const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-footer-legal-' + STAMP;
fs.mkdirSync(BACKUP_DIR, { recursive: true });

function patch(p, oldStr, newStr) {
  if (!fs.existsSync(p)) { console.log(p + ': not found, skipping'); return; }
  const original = fs.readFileSync(p, 'utf8');
  if (original.indexOf(newStr.split('\n')[0].slice(0, 50)) !== -1 && original.indexOf('/privacy.html') !== -1 && original.indexOf('/terms.html') !== -1) {
    // Check that the LANDING/WHY footer specifically has the legal links (not just any other reference)
    const footerRegion = original.indexOf('class="footer"');
    if (footerRegion >= 0) {
      const after = original.slice(footerRegion, footerRegion + 800);
      if (after.indexOf('/privacy.html') !== -1 && after.indexOf('/terms.html') !== -1) {
        console.log(p + ': skip (legal links already in footer)');
        return;
      }
    }
  }
  if (original.indexOf(oldStr) === -1) {
    console.log(p + ': anchor not found, skipping');
    return;
  }
  if (original.split(oldStr).length - 1 !== 1) {
    console.log(p + ': anchor not unique, skipping');
    return;
  }
  fs.mkdirSync(path.join(BACKUP_DIR, path.dirname(p)), { recursive: true });
  fs.copyFileSync(p, path.join(BACKUP_DIR, p));
  const updated = original.replace(oldStr, newStr);
  fs.writeFileSync(p, updated, 'utf8');
  console.log(p + ': patched');
}

// --- landing.html ---
patch(
  'public/landing.html',
  '<p style="margin-bottom:6px"><a href="/register.html">Sign up</a> <span style="color:#D1D5DB;margin:0 6px">|</span> <a href="/signin.html">Sign in</a> <span style="color:#D1D5DB;margin:0 6px">|</span> <a href="/pricing.html">Pricing</a></p>',
  '<p style="margin-bottom:6px"><a href="/register.html">Sign up</a> <span style="color:#D1D5DB;margin:0 6px">|</span> <a href="/signin.html">Sign in</a> <span style="color:#D1D5DB;margin:0 6px">|</span> <a href="/pricing.html">Pricing</a></p>\r\n  <p style="margin-bottom:6px"><a href="/privacy.html">Privacy Policy</a> <span style="color:#D1D5DB;margin:0 6px">|</span> <a href="/terms.html">Terms of Service</a></p>'
);

// --- why.html ---
patch(
  'public/why.html',
  '<a href="/register.html" style="color:#FF6B00;text-decoration:none;font-weight:600">Sign up</a> · <a href="/signin.html" style="color:#FF6B00;text-decoration:none;font-weight:600">Sign in</a> · <a href="/pricing.html" style="color:#FF6B00;text-decoration:none;font-weight:600">Pricing</a> · <a href="/landing.html" style="color:#FF6B00;text-decoration:none;font-weight:600">Home</a></p>',
  '<a href="/register.html" style="color:#FF6B00;text-decoration:none;font-weight:600">Sign up</a> · <a href="/signin.html" style="color:#FF6B00;text-decoration:none;font-weight:600">Sign in</a> · <a href="/pricing.html" style="color:#FF6B00;text-decoration:none;font-weight:600">Pricing</a> · <a href="/landing.html" style="color:#FF6B00;text-decoration:none;font-weight:600">Home</a></p>\r\n  <p style="font-size:11px;color:#9CA3AF;margin-bottom:6px"><a href="/privacy.html" style="color:#FF6B00;text-decoration:none;font-weight:600">Privacy Policy</a> · <a href="/terms.html" style="color:#FF6B00;text-decoration:none;font-weight:600">Terms of Service</a></p>'
);

console.log('\nDone.');
console.log('\nNEXT STEPS:');
console.log('  git add -A');
console.log('  git commit -m "Add Privacy + Terms links to landing and why footers"');
console.log('  git push');
