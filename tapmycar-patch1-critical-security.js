// ============================================================================
// TapMyCar — Patch 1 of 3: Critical security fixes
//
// What this patch does:
//   1.1  Adds admin-key check to get-leads.js, get-orders.js,
//        update-order-status.js (closes the customer-data leak)
//   1.2  Replaces Math.random() with crypto.randomInt() in five files:
//        send-otp.js, verify-otp.js, stripe-webhook.js, generate-tokens.js,
//        generate-referral-code.js (closes prediction attacks on OTPs,
//        gift codes, sticker tokens, eTag tokens, referral codes)
//   1.3  Hardcodes Stripe success_url / cancel_url to https://tapmycar.io
//        in create-checkout.js (closes the open-redirect attack)
//   1.4  Wraps user-typed email in v6Esc() in contact.html line ~1005
//        (closes self-XSS in lead capture overlay)
//   1.5  Updates admin.html so loadLeads / loadOrders / updateOrder send
//        the x-admin-key header (so the new server checks pass)
//
// Properties:
//   - Idempotent: re-running is a no-op if changes already applied
//   - Backups: every touched file copied to backup-patch1-{timestamp}/
//   - Validates JS syntax with node --check after writing
//   - Prints clear "what changed / what was skipped" summary
//
// Run:
//   Move-Item "$env:USERPROFILE\Downloads\tapmycar-patch1-critical-security.js" `
//             "C:\Users\PRAVEEN CHANDU\Documents\tapmycar\tapmycar-patch1-critical-security.js" -Force
//   cd "C:\Users\PRAVEEN CHANDU\Documents\tapmycar"
//   node tapmycar-patch1-critical-security.js
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const API = path.join(ROOT, 'api');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch1-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const warn = (s) => console.log('  ! ' + s);
const err = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFile(p) {
  if (!fs.existsSync(p)) err('File not found: ' + p);
  return fs.readFileSync(p, 'utf8');
}

function backup(file) {
  const rel = path.relative(ROOT, file);
  const dest = path.join(BACKUP_DIR, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
}

function writeFile(p, content) {
  // Strip BOM if accidentally introduced
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  fs.writeFileSync(p, content, 'utf8');
}

function validateJs(p) {
  try {
    execSync('node --check "' + p + '"', { stdio: 'pipe' });
  } catch (e) {
    err('JS syntax error in ' + p + '\n' + e.stderr.toString());
  }
}

function applyEdit(file, oldStr, newStr, label) {
  const orig = readFile(file);
  if (orig.includes(newStr)) {
    skip(label);
    return false;
  }
  if (!orig.includes(oldStr)) {
    warn(label + ' \u2014 expected pattern not found, manual check needed for ' + path.relative(ROOT, file));
    return false;
  }
  backup(file);
  const updated = orig.replace(oldStr, newStr);
  writeFile(file, updated);
  if (file.endsWith('.js')) validateJs(file);
  ok(label);
  return true;
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

log('');
log('TapMyCar Patch 1 of 3 \u2014 Critical security fixes');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');

fs.mkdirSync(BACKUP_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// 1.1  Admin-key check on three exposed endpoints
// ---------------------------------------------------------------------------

log('1.1  Adding admin-key checks to data-leak endpoints');

// --- api/get-leads.js ---
{
  const file = path.join(API, 'get-leads.js');
  const content = readFile(file);
  const marker = 'TMC_PATCH1_ADMIN_CHECK';
  if (content.includes(marker)) {
    skip('api/get-leads.js admin-key check');
  } else {
    backup(file);
    const newBody = `const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // ${marker}
  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { data: leads } = await supabase
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  return res.json({ success: true, leads: leads || [] });
};
`;
    writeFile(file, newBody);
    validateJs(file);
    ok('api/get-leads.js admin-key check');
  }
}

// --- api/get-orders.js ---
{
  const file = path.join(API, 'get-orders.js');
  const content = readFile(file);
  const marker = 'TMC_PATCH1_ADMIN_CHECK';
  if (content.includes(marker)) {
    skip('api/get-orders.js admin-key check');
  } else {
    backup(file);
    const newBody = `const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // ${marker}
  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { status } = req.query;

  let query = supabase.from("orders")
    .select("*, users(name, email, phone)")
    .eq("status", "paid")
    .order("created_at", { ascending: false })
    .limit(100);

  if (status && status !== "all") query = query.eq("order_status", status);

  const { data: orders } = await query;
  return res.json({ success: true, orders: orders || [] });
};
`;
    writeFile(file, newBody);
    validateJs(file);
    ok('api/get-orders.js admin-key check');
  }
}

// --- api/update-order-status.js ---
{
  const file = path.join(API, 'update-order-status.js');
  const content = readFile(file);
  const marker = 'TMC_PATCH1_ADMIN_CHECK';
  if (content.includes(marker)) {
    skip('api/update-order-status.js admin-key check');
  } else {
    // Insert auth block right after the method check
    const oldBlock = 'if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });\n  const { order_id, status, tracking_number } = req.body;';
    const newBlock = `if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // ${marker}
  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { order_id, status, tracking_number } = req.body;`;
    if (!content.includes(oldBlock)) {
      warn('api/update-order-status.js \u2014 expected pattern not found, manual check needed');
    } else {
      backup(file);
      writeFile(file, content.replace(oldBlock, newBlock));
      validateJs(file);
      ok('api/update-order-status.js admin-key check');
    }
  }
}

// ---------------------------------------------------------------------------
// 1.2  Math.random() -> crypto.randomInt()
// ---------------------------------------------------------------------------

log('');
log('1.2  Replacing Math.random() with crypto.randomInt()');

const cryptoRequire = "const crypto = require('crypto');";

function ensureCryptoRequire(content) {
  if (content.includes("require('crypto')") || content.includes('require("crypto")')) {
    return content;
  }
  // Insert after first require line
  const firstReq = content.match(/^(.*require\([^)]+\);?)\r?\n/m);
  if (firstReq) {
    return content.replace(firstReq[0], firstReq[0] + cryptoRequire + '\n');
  }
  return cryptoRequire + '\n' + content;
}

// --- send-otp.js: 6-digit OTP code ---
{
  const file = path.join(API, 'send-otp.js');
  let content = readFile(file);
  const oldLine = 'const code = Math.floor(100000 + Math.random() * 900000).toString();';
  const newLine = 'const code = crypto.randomInt(100000, 1000000).toString();';
  if (content.includes(newLine)) {
    skip('api/send-otp.js OTP code generation');
  } else if (!content.includes(oldLine)) {
    warn('api/send-otp.js \u2014 expected pattern not found');
  } else {
    backup(file);
    content = ensureCryptoRequire(content);
    content = content.replace(oldLine, newLine);
    writeFile(file, content);
    validateJs(file);
    ok('api/send-otp.js OTP code now uses crypto.randomInt');
  }
}

// --- verify-otp.js: eTag token + referral code (TWO sites) ---
{
  const file = path.join(API, 'verify-otp.js');
  let content = readFile(file);
  let changed = false;

  // Site 1: eTag token (line 37)
  const oldA = 'random += chars[Math.floor(Math.random() * chars.length)];';
  const newA = 'random += chars[crypto.randomInt(chars.length)];';

  // Site 2: referral code (line 183)
  const oldB = 'for (let i = 0; i < 6; i++) refCode += chars[Math.floor(Math.random() * chars.length)];';
  const newB = 'for (let i = 0; i < 6; i++) refCode += chars[crypto.randomInt(chars.length)];';

  const aDone = content.includes(newA);
  const bDone = content.includes(newB);

  if (aDone && bDone) {
    skip('api/verify-otp.js (both sites already use crypto.randomInt)');
  } else {
    backup(file);
    content = ensureCryptoRequire(content);
    if (!aDone && content.includes(oldA)) {
      content = content.replace(oldA, newA);
      changed = true;
    }
    if (!bDone && content.includes(oldB)) {
      content = content.replace(oldB, newB);
      changed = true;
    }
    if (changed) {
      writeFile(file, content);
      validateJs(file);
      ok('api/verify-otp.js eTag token + referral code now use crypto.randomInt');
    } else {
      warn('api/verify-otp.js \u2014 expected patterns not found');
    }
  }
}

// --- stripe-webhook.js: gift code generation ---
{
  const file = path.join(API, 'stripe-webhook.js');
  let content = readFile(file);
  const oldLine = 'for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];';
  const newLine = 'for (let i = 0; i < 6; i++) out += chars[crypto.randomInt(chars.length)];';
  if (content.includes(newLine)) {
    skip('api/stripe-webhook.js gift code generation');
  } else if (!content.includes(oldLine)) {
    warn('api/stripe-webhook.js \u2014 expected pattern not found');
  } else {
    backup(file);
    content = ensureCryptoRequire(content);
    content = content.replace(oldLine, newLine);
    writeFile(file, content);
    validateJs(file);
    ok('api/stripe-webhook.js gift code now uses crypto.randomInt');
  }
}

// --- generate-tokens.js: physical sticker token generation ---
{
  const file = path.join(API, 'generate-tokens.js');
  let content = readFile(file);
  const oldLine = 'random += chars[Math.floor(Math.random() * chars.length)];';
  const newLine = 'random += chars[crypto.randomInt(chars.length)];';
  if (content.includes(newLine)) {
    skip('api/generate-tokens.js sticker token generation');
  } else if (!content.includes(oldLine)) {
    warn('api/generate-tokens.js \u2014 expected pattern not found');
  } else {
    backup(file);
    content = ensureCryptoRequire(content);
    content = content.replace(oldLine, newLine);
    writeFile(file, content);
    validateJs(file);
    ok('api/generate-tokens.js sticker token now uses crypto.randomInt');
  }
}

// --- generate-referral-code.js ---
{
  const file = path.join(API, 'generate-referral-code.js');
  let content = readFile(file);
  const oldLine = 'for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];';
  const newLine = 'for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(chars.length)];';
  if (content.includes(newLine)) {
    skip('api/generate-referral-code.js code generation');
  } else if (!content.includes(oldLine)) {
    warn('api/generate-referral-code.js \u2014 expected pattern not found');
  } else {
    backup(file);
    content = ensureCryptoRequire(content);
    content = content.replace(oldLine, newLine);
    writeFile(file, content);
    validateJs(file);
    ok('api/generate-referral-code.js referral code now uses crypto.randomInt');
  }
}

// ---------------------------------------------------------------------------
// 1.3  Hardcode Stripe success_url / cancel_url
// ---------------------------------------------------------------------------

log('');
log('1.3  Hardcoding Stripe redirect URLs');

{
  const file = path.join(API, 'create-checkout.js');
  let content = readFile(file);
  const oldSuccess = '`${req.headers.origin}/payment-success.html?session_id={CHECKOUT_SESSION_ID}&plan=${plan}&flow=${flow}${prepay ? \'&prepay=1\' : \'\'}`';
  const newSuccess = '`https://tapmycar.io/payment-success.html?session_id={CHECKOUT_SESSION_ID}&plan=${plan}&flow=${flow}${prepay ? \'&prepay=1\' : \'\'}`';
  const oldCancel = '`${req.headers.origin}/pricing.html`';
  const newCancel = '`https://tapmycar.io/pricing.html`';

  const sDone = content.includes(newSuccess);
  const cDone = content.includes(newCancel);

  if (sDone && cDone) {
    skip('api/create-checkout.js Stripe redirect URLs');
  } else {
    let changed = false;
    backup(file);
    if (!sDone && content.includes(oldSuccess)) {
      content = content.replace(oldSuccess, newSuccess);
      changed = true;
    }
    if (!cDone && content.includes(oldCancel)) {
      content = content.replace(oldCancel, newCancel);
      changed = true;
    }
    if (changed) {
      writeFile(file, content);
      validateJs(file);
      ok('api/create-checkout.js redirect URLs hardcoded to tapmycar.io');
    } else {
      warn('api/create-checkout.js \u2014 expected patterns not found');
    }
  }
}

// ---------------------------------------------------------------------------
// 1.4  Self-XSS fix in contact.html
// ---------------------------------------------------------------------------

log('');
log('1.4  Fixing self-XSS in contact.html lead overlay');

{
  const file = path.join(PUBLIC, 'contact.html');
  let content = readFile(file);
  const oldFragment = "We sent your free TapMyCar tag link to ' + email + '";
  const newFragment = "We sent your free TapMyCar tag link to ' + v6Esc(email) + '";

  if (content.includes(newFragment)) {
    skip('public/contact.html lead-overlay XSS escape');
  } else if (!content.includes(oldFragment)) {
    warn('public/contact.html \u2014 expected pattern not found');
  } else {
    backup(file);
    writeFile(file, content.replace(oldFragment, newFragment));
    ok('public/contact.html lead-overlay now escapes user email');
  }
}

// ---------------------------------------------------------------------------
// 1.5  admin.html must send x-admin-key header
// ---------------------------------------------------------------------------

log('');
log('1.5  Updating admin.html to send x-admin-key header');

{
  const file = path.join(PUBLIC, 'admin.html');
  let content = readFile(file);
  let touchedAny = false;

  // loadLeads
  const oldLeads = "const res = await fetch('/api/get-leads');";
  const newLeads = "const res = await fetch('/api/get-leads', { headers: { 'x-admin-key': getAdminKey() } });";
  if (content.includes(newLeads)) {
    skip('admin.html loadLeads sends header');
  } else if (content.includes(oldLeads)) {
    if (!touchedAny) backup(file);
    content = content.replace(oldLeads, newLeads);
    touchedAny = true;
    ok('admin.html loadLeads now sends x-admin-key');
  } else {
    warn('admin.html loadLeads \u2014 expected pattern not found');
  }

  // loadOrders
  const oldOrders = "const res = await fetch('/api/get-orders');";
  const newOrders = "const res = await fetch('/api/get-orders', { headers: { 'x-admin-key': getAdminKey() } });";
  if (content.includes(newOrders)) {
    skip('admin.html loadOrders sends header');
  } else if (content.includes(oldOrders)) {
    if (!touchedAny) backup(file);
    content = content.replace(oldOrders, newOrders);
    touchedAny = true;
    ok('admin.html loadOrders now sends x-admin-key');
  } else {
    warn('admin.html loadOrders \u2014 expected pattern not found');
  }

  // updateOrder
  const oldUpdate = "const res = await fetch('/api/update-order-status', {\n      method: 'POST',\n      headers: {'Content-Type':'application/json'},\n      body: JSON.stringify({ order_id: orderId, status, tracking_number: tracking || null })\n    });";
  const newUpdate = "const res = await fetch('/api/update-order-status', {\n      method: 'POST',\n      headers: {'Content-Type':'application/json', 'x-admin-key': getAdminKey()},\n      body: JSON.stringify({ order_id: orderId, status, tracking_number: tracking || null })\n    });";
  if (content.includes(newUpdate)) {
    skip('admin.html updateOrder sends header');
  } else if (content.includes(oldUpdate)) {
    if (!touchedAny) backup(file);
    content = content.replace(oldUpdate, newUpdate);
    touchedAny = true;
    ok('admin.html updateOrder now sends x-admin-key');
  } else {
    warn('admin.html updateOrder \u2014 expected pattern not found (line endings might differ)');
  }

  if (touchedAny) {
    writeFile(file, content);
  }
}

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------

log('');
log('==============================================================');
log('Patch 1 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Next steps:');
log('  1. Review changes:   git diff');
log('  2. Stage all:        git add -A');
log('  3. Commit:           git commit -m "Patch 1: critical security fixes"');
log('  4. Push:             git push');
log('  5. Wait ~60 seconds for Vercel deploy.');
log('  6. Test in fresh incognito with hard refresh:');
log('     - Admin panel: log in, verify Leads + Orders tabs still load');
log('     - Mark a test order shipped, verify it works');
log('     - Try a registration, verify OTP arrives and works');
log('     - Try a Stripe checkout flow, verify redirect goes to');
log('       tapmycar.io/payment-success.html (not localhost or other)');
log('');
log('Verification: open these URLs in incognito (no admin key set).');
log('Each should return 401 Unauthorized:');
log('  https://tapmycar.io/api/get-leads');
log('  https://tapmycar.io/api/get-orders');
log('==============================================================');
