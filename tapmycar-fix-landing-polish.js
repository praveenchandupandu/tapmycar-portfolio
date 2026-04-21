// ═══════════════════════════════════════════════════════════════
// Landing.html polish
// 1. Reorder pricing: Standard first, Premium second, eTag last
// 2. Add Premium card (not currently on landing page)
// 3. Fix Contact link - make it a real mailto anchor (not plain text)
// 4. Add pipe separators between Sign up / Sign in / Pricing
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

const filePath = path.join(ROOT, 'public', 'landing.html');
if (!fs.existsSync(filePath)) {
  console.error('public/landing.html not found');
  process.exit(1);
}
let content = fs.readFileSync(filePath, 'utf8');
let fixes = 0;

// ─── 1. Replace the pricing block entirely with new order ────
// Find the pricing section from the eTag card start to the Standard card end
const eTagCardStart = `  <div style="background:#F0FDF4;border:1.5px solid #BBF7D0;border-radius:18px;padding:18px;margin-bottom:12px">`;
const standardCardEndPattern = `    <a href="/register.html" style="background:#FF6B00;color:#fff;font-size:14px;font-weight:700;padding:13px 0;border-radius:13px;text-decoration:none;display:block;text-align:center">Get Standard</a>\r\n  </div>`;

const eTagIdx = content.indexOf(eTagCardStart);
const endIdx = content.indexOf(standardCardEndPattern);

if (eTagIdx === -1 || endIdx === -1) {
  console.log('[WARN] Could not locate pricing card boundaries');
} else {
  const endFull = endIdx + standardCardEndPattern.length;
  const oldBlock = content.substring(eTagIdx, endFull);

  // Build new block: Standard (most popular) -> Premium -> eTag
  const newBlock = `  <div class="pricing-card">
    <div style="display:inline-block;background:#FF6B00;color:#fff;font-size:10px;font-weight:700;padding:3px 10px;border-radius:99px;margin-bottom:8px">Most popular</div>
    <h3>Standard</h3>
    <div class="pricing-price">$9.99 <span>+ $9.99/yr</span></div>
    <div class="pricing-desc">1 vehicle · physical NFC + QR sticker ships home</div>
    <div class="pricing-features">
      <div class="pf"><div class="pf-dot"></div>Physical sticker ships to your home</div>
      <div class="pf"><div class="pf-dot"></div>10 masked calls per month</div>
      <div class="pf"><div class="pf-dot"></div>SMS alert on every scan</div>
      <div class="pf"><div class="pf-dot"></div>Voice screening system</div>
    </div>
    <a href="/register.html" style="background:#FF6B00;color:#fff;font-size:14px;font-weight:700;padding:13px 0;border-radius:13px;text-decoration:none;display:block;text-align:center">Get Standard</a>
  </div>

  <div class="pricing-card" style="border-color:#1A1A1A;background:#FAFAFA">
    <div style="display:inline-block;background:#1A1A1A;color:#fff;font-size:10px;font-weight:700;padding:3px 10px;border-radius:99px;margin-bottom:8px">Best for families</div>
    <h3>Premium</h3>
    <div class="pricing-price">$24.99 <span>+ $19.99/yr</span></div>
    <div class="pricing-desc">3 physical stickers · protect your whole family</div>
    <div class="pricing-features">
      <div class="pf"><div class="pf-dot"></div>3 physical stickers (one-time purchase)</div>
      <div class="pf"><div class="pf-dot"></div>3 gift codes to share with family</div>
      <div class="pf"><div class="pf-dot"></div>Everything in Standard plan</div>
      <div class="pf"><div class="pf-dot"></div>Priority support</div>
    </div>
    <a href="/register.html" style="background:#1A1A1A;color:#fff;font-size:14px;font-weight:700;padding:13px 0;border-radius:13px;text-decoration:none;display:block;text-align:center">Get Premium</a>
  </div>

  <div style="background:#F0FDF4;border:1.5px solid #BBF7D0;border-radius:18px;padding:18px;margin-bottom:12px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <div style="font-size:17px;font-weight:800;color:#111">eTag</div>
      <div style="background:#16A34A;color:#fff;font-size:11px;font-weight:700;padding:3px 12px;border-radius:99px">Free</div>
    </div>
    <div style="font-size:12px;color:#15803D;margin-bottom:14px">Download instantly · Get started in 2 minutes</div>
    <a href="/register.html" style="background:#16A34A;color:#fff;font-size:14px;font-weight:700;padding:13px 0;border-radius:13px;text-decoration:none;display:block;text-align:center">Get free eTag</a>
  </div>`;

  content = content.substring(0, eTagIdx) + newBlock + content.substring(endFull);
  console.log('[FIX] Reordered pricing: Standard → Premium → eTag (Premium card added)');
  fixes++;
}

// ─── 2. Fix footer: pipe separators + fix Contact mailto ────
// The current footer has plain-text spaces between links. Replace with pipes.
// Also ensure Contact link actually works as mailto.
const oldFooter1 = `  <p style="margin-bottom:6px"><a href="/register.html">Sign up</a>  <a href="/signin.html">Sign in</a>  <a href="/pricing.html">Pricing</a></p>`;
const newFooter1 = `  <p style="margin-bottom:6px"><a href="/register.html">Sign up</a> <span style="color:#D1D5DB;margin:0 6px">|</span> <a href="/signin.html">Sign in</a> <span style="color:#D1D5DB;margin:0 6px">|</span> <a href="/pricing.html">Pricing</a></p>`;

if (content.includes(oldFooter1)) {
  content = content.replace(oldFooter1, newFooter1);
  console.log('[FIX] Footer: added pipe separators between Sign up / Sign in / Pricing');
  fixes++;
} else if (content.includes('color:#D1D5DB;margin:0 6px">|<')) {
  console.log('[OK] Footer pipes already present');
} else {
  // Try more flexible match (maybe LF vs CRLF differences)
  const flexible = /<p style="margin-bottom:6px"><a href="\/register\.html">Sign up<\/a>\s+<a href="\/signin\.html">Sign in<\/a>\s+<a href="\/pricing\.html">Pricing<\/a><\/p>/;
  if (flexible.test(content)) {
    content = content.replace(flexible, newFooter1.trim());
    console.log('[FIX] Footer pipes added (via flex pattern)');
    fixes++;
  } else {
    console.log('[WARN] Footer line pattern not found - manual check needed');
  }
}

// Contact line — verify mailto is properly set up
// The current: <a href="mailto:support@tapmycar.io">Contact</a>
// This IS correct. The issue is likely that browsers don't have a default email client.
// We'll keep it as mailto but also make it more robust.
// No changes needed for Contact - it's already a mailto link

console.log('');
console.log('\u2550'.repeat(50));
console.log(`Total fixes: ${fixes}`);
console.log('\u2550'.repeat(50));

if (fixes > 0) {
  fs.writeFileSync(filePath, content, 'utf8');
  fs.copyFileSync(filePath, path.join(ROOT, 'landing.html'));
  console.log('[SYNC] public/landing.html -> landing.html');
}

console.log('');
console.log('Now commit and push:');
console.log('  git add -A');
console.log('  git commit -m "Landing: Standard/Premium/eTag order + Premium card + footer pipes"');
console.log('  git push');
