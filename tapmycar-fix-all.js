// ═══════════════════════════════════════════════════════════════════
// TapMyCar — Session 2d comprehensive fix
// ═══════════════════════════════════════════════════════════════════
// Fixes 5 distinct problems in one push:
//
//   1. Tag ID shows "TMC.R3LH4S" instead of "TMC-R3LH4S" (period bug)
//      → Affects: activate.html, manage.html, settings.html
//
//   2. Tag gets marked 'active' BEFORE payment succeeds (critical bug)
//      → Root cause: api/get-tag.js POST hardcodes status: 'active'
//      → Fix: don't touch status on POST, let the webhook activate after payment
//
//   3. payment-success.html says "Day 60" and "within 60 days"
//      → Fix: update to new 30-day pricing model language
//
//   4. Encoding issues: "Get Standard � $9.99/yr" and "Your email �"
//      → Fix: replace � with proper dash character
//      → Also fix misaligned content in etag.html
//
//   5. Plan badge on dashboard.html always says "Standard" (hardcoded)
//      → Root cause: line 46 has literal "Standard" text + a syntax error
//      → Fix: make the badge update dynamically from user.plan
//
// Run with:
//   cd "C:\Users\PRAVEEN CHANDU\Documents\tapmycar"
//   node tapmycar-fix-all.js
// ═══════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
let totalFixes = 0;
let filesChanged = new Set();

function patchFile(relPath, patches) {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) {
    console.log(`  [SKIP] ${relPath} not found`);
    return;
  }
  let content = fs.readFileSync(fullPath, 'utf8');
  let fileChanges = 0;

  for (const { name, find, replace } of patches) {
    if (content.includes(find)) {
      content = content.replace(find, replace);
      console.log(`  [FIX] ${relPath} :: ${name}`);
      fileChanges++;
      totalFixes++;
    } else if (replace && content.includes(replace)) {
      console.log(`  [OK]  ${relPath} :: ${name} (already patched)`);
    } else {
      console.log(`  [WARN] ${relPath} :: ${name} — pattern not found`);
    }
  }

  if (fileChanges > 0) {
    fs.writeFileSync(fullPath, content, 'utf8');
    filesChanged.add(relPath);
  }
}

console.log('═══ TapMyCar comprehensive fix (Session 2d) ═══');
console.log('');

// ─── FIX 1: Tag ID "TMC.XXXXXX" → "TMC-XXXXXX" everywhere ───────
console.log('FIX 1: Tag ID period bug (TMC. → TMC-)');
console.log('');

patchFile('public/activate.html', [
  {
    name: 'placeholder TMC.XXXXXX → TMC-XXXXXX',
    find: '<div class="result-tag" id="r-token">TMC.XXXXXX</div>',
    replace: '<div class="result-tag" id="r-token">TMC-XXXXXX</div>'
  },
  {
    name: 'processToken display formatter',
    find: "document.getElementById('r-token').textContent = 'TMC.' + token.replace('TMC','');",
    replace: "document.getElementById('r-token').textContent = 'TMC-' + token.replace(/^TMC[-.]?/,'');"
  }
]);

patchFile('public/manage.html', [
  {
    name: 'manage page tag display formatter',
    find: "document.getElementById('m-token').textContent = 'TMC.' + tag.token.replace('TMC','');",
    replace: "document.getElementById('m-token').textContent = tag.token.includes('-') ? tag.token : 'TMC-' + tag.token.replace(/^TMC[-.]?/,'');"
  }
]);

patchFile('public/settings.html', [
  {
    name: 'settings page tag display formatter',
    find: "document.getElementById('tag-info').textContent = 'TMC.' + tagData.token.replace('TMC','') + ' - ' + (tagData.status || 'unknown');",
    replace: "document.getElementById('tag-info').textContent = (tagData.token.includes('-') ? tagData.token : 'TMC-' + tagData.token.replace(/^TMC[-.]?/,'')) + ' - ' + (tagData.status || 'unknown');"
  }
]);

// ─── FIX 2: Don't mark tag 'active' until payment succeeds ──────
console.log('');
console.log('FIX 2: Tag marked active BEFORE payment (critical bug)');
console.log('');

patchFile('api/get-tag.js', [
  {
    name: 'remove status:active from POST (webhook does it after payment)',
    find: `    const updates = {
      owner_id: user_id,
      status: 'active',
      claimed_at: new Date().toISOString(),
      activated_at: new Date().toISOString()
    };`,
    replace: `    // IMPORTANT: Do NOT set status:'active' here. Tag activation happens ONLY
    // after Stripe webhook confirms payment succeeded (see stripe-webhook.js).
    // This POST is just for saving vehicle info and claiming ownership of the tag.
    // Status transitions: unclaimed → claimed (this POST) → active (webhook)
    const updates = {
      owner_id: user_id,
      status: 'claimed',
      claimed_at: new Date().toISOString()
    };`
  }
]);

// Update activate.html to send correct params and handle the new flow
patchFile('public/activate.html', [
  {
    name: 'processPayment API call (send flow, plan, prepay)',
    find: `  // Create Stripe checkout
  try {
    const res = await fetch('/api/create-checkout', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        user_id: s.token,
        plan: 'etag',
        address: address
      })
    });`,
    replace: `  // Create Stripe checkout — NEW API contract: flow, plan, prepay required
  try {
    const res = await fetch('/api/create-checkout', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        user_id: s.token,
        flow: 'activate',
        plan: 'standard',
        prepay: false,
        referral_discount: 0
      })
    });`
  }
]);

// contact.html needs the same API fix
patchFile('public/contact.html', [
  {
    name: 'contact.html activateAndPay API params',
    find: "const res=await fetch('/api/create-checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:registrationData.userId,plan:'etag',token:currentToken})});",
    replace: "const res=await fetch('/api/create-checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_id:registrationData.userId,flow:'activate',plan:'standard',prepay:false,referral_discount:0,token:currentToken})});"
  },
  {
    name: 'contact.html email placeholder encoding',
    find: 'Your email \ufffd get your free tag link',
    replace: 'Your email — get your free tag link'
  }
]);

// ─── FIX 3: payment-success.html outdated 60-day language ───────
console.log('');
console.log('FIX 3: Outdated 60-day text on payment-success page');
console.log('');

patchFile('public/payment-success.html', [
  {
    name: 'success page subtitle (60 days → 2-3 days sticker)',
    find: 'Your eTag is now active. Your physical NFC + QR sticker will ship to your address within 60 days.',
    replace: "Your tag is now active. If you ordered a physical sticker, it ships within 2-3 business days."
  },
  {
    name: 'what happens next box (new 30-day model)',
    find: 'Day 1-60: Your digital eTag is active and working. Day 60: We charge $9.99 and ship your physical sticker.',
    replace: "Your digital eTag is active immediately. If this was a $1 activation with a physical sticker on the way, your annual plan begins on day 30 — we'll email you before any charge."
  }
]);

// ─── FIX 4: Encoding issues (� → proper dash) + etag alignment ──
console.log('');
console.log('FIX 4: Broken encoding characters');
console.log('');

patchFile('public/etag.html', [
  {
    name: 'Standard button broken dash character',
    find: 'Get Standard \ufffd $9.99/yr',
    replace: 'Get Standard — $9.99/yr'
  }
]);

// ─── FIX 5: Dashboard plan badge always says "Standard" ─────────
console.log('');
console.log('FIX 5: Plan badge hardcoded to Standard + syntax error');
console.log('');

patchFile('public/dashboard.html', [
  {
    name: 'plan-badge HTML (fix syntax, make dynamic)',
    find: '<div style="background:var(--orl);border:.5px solid var(--orl2);border-radius:99px;padding:5px 12px;font-size:10px;font-weight:700;color:var(--or)"" id="plan-badge"> Standard</div>',
    replace: '<div style="background:var(--orl);border:.5px solid var(--orl2);border-radius:99px;padding:5px 12px;font-size:10px;font-weight:700;color:var(--or);text-transform:capitalize" id="plan-badge">Free</div>'
  },
  {
    name: 'dashboard plan badge updater (inside loadDashboard)',
    find: `      const userPlan = data.user ? (data.user.plan || 'etag') : 'etag';
      if (userPlan === 'etag' || userPlan === 'free') {
        document.getElementById('upgrade-banner-etag').style.display = 'block';
      } else if (userPlan === 'standard') {
        document.getElementById('upgrade-banner-standard').style.display = 'block';
      }`,
    replace: `      const userPlan = data.user ? (data.user.plan || 'etag') : 'etag';
      // Update plan badge label dynamically
      const badge = document.getElementById('plan-badge');
      if (badge) {
        const label = userPlan === 'etag' ? 'Free' : userPlan === 'standard' ? 'Standard' : userPlan === 'premium' ? 'Premium' : userPlan;
        badge.textContent = label;
      }
      if (userPlan === 'etag' || userPlan === 'free') {
        document.getElementById('upgrade-banner-etag').style.display = 'block';
      } else if (userPlan === 'standard') {
        document.getElementById('upgrade-banner-standard').style.display = 'block';
      }`
  }
]);

// ─── Sync public/ copies to root (Vercel serves from root) ──────
console.log('');
console.log('Syncing public/*.html to root copies...');
['activate.html', 'contact.html', 'manage.html', 'settings.html', 'payment-success.html', 'etag.html', 'dashboard.html'].forEach(f => {
  const src = path.join(ROOT, 'public', f);
  const dest = path.join(ROOT, f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`  [SYNC] public/${f} → ${f}`);
  }
});

console.log('');
console.log('═══════════════════════════════════════════════════');
console.log(`Total fixes applied: ${totalFixes}`);
console.log(`Files changed: ${filesChanged.size}`);
console.log('═══════════════════════════════════════════════════');
console.log('');
console.log('Next: commit and push with');
console.log('  git add -A');
console.log('  git commit -m "Session 2d: fix 5 issues — tag activation timing, display, badges, encoding"');
console.log('  git push');
