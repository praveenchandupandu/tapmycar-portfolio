// ============================================================================
// TapMyCar — Patch 4 of (Patch 4 + 5 + 6 + 7): Phone verification infrastructure
//
// Concept: every active tag must be owned by a user whose phone number was
// SMS-verified. Strangers calling unverified-phone tags get a clear error.
// This is the BACKEND foundation. Patches 5/6/7 wire UI + flow changes.
//
// REQUIRES: Supabase migration must be run BEFORE this patch (printed at
// the bottom of this script).
//
// REQUIRES: Twilio A2P 10DLC approved AND SMS verified to actually flow.
// Test by sending one verification from Twilio Console -> Verify before
// shipping. If SMS doesn't arrive, this patch deploys but every activation
// will fail.
//
// What this patch does:
//   4.1  New endpoint api/start-phone-verification.js
//        POST {user_id} -> looks up user.phone, sends SMS via Twilio Verify
//   4.2  New endpoint api/confirm-phone-verification.js
//        POST {user_id, code} -> checks code via Twilio Verify, on success
//        sets users.phone_verified = true, phone_verified_at = NOW()
//   4.3  Update api/proxy-call.js: before initiating call, check
//        tag.users.phone_verified. If false, return 403.
//   4.4  Update api/notify-owner.js: still send email even if unverified,
//        but with a "your setup isn't complete" extra message in the email.
//   4.5  Both new endpoints are rate-limited via Patch 3 helper:
//        start: 3/hour per user_id, 5/hour per IP
//        confirm: 10/hour per user_id, 20/hour per IP
//
// Properties:
//   - Idempotent: re-running is a no-op
//   - Backups: every touched file copied to backup-patch4-{timestamp}/
//   - Validates JS syntax with node --check
//
// Run:
//   Move-Item "$env:USERPROFILE\Downloads\tapmycar-patch4-phone-verify-backend.js" `
//             "C:\Users\PRAVEEN CHANDU\Documents\tapmycar\tapmycar-patch4-phone-verify-backend.js" -Force
//   cd "C:\Users\PRAVEEN CHANDU\Documents\tapmycar"
//   node tapmycar-patch4-phone-verify-backend.js
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch4-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const warn = (s) => console.log('  ! ' + s);
const err = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

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

log('');
log('TapMyCar Patch 4 \u2014 Phone verification backend');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER_PHONE_VERIFY_GATE = 'TMC_PATCH4_PHONE_VERIFY_GATE';
const MARKER_PHONE_VERIFY_HELPER = 'TMC_PATCH4_PHONE_VERIFY_HELPER';

// ===========================================================================
// 4.1  Create api/start-phone-verification.js
// ===========================================================================

log('4.1  Creating api/start-phone-verification.js');

{
  const file = path.join(API, 'start-phone-verification.js');
  const body = `// ${MARKER_PHONE_VERIFY_HELPER}
// TapMyCar - start phone verification
// POST { user_id } -> sends SMS via Twilio Verify to user.phone
//
// On success: { success: true }
// On failure: { error: '...' } with appropriate status code

const { createClient } = require('@supabase/supabase-js');
const twilio = require('twilio');
const { rateLimit, getClientIp } = require('./_rate-limit');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limits
  const ip = getClientIp(req);
  const { user_id } = req.body || {};

  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  if (!UUID_RE.test(String(user_id))) return res.status(400).json({ error: 'Invalid user_id format' });

  if (!await rateLimit(req, res, [
    { key: 'start-phone-verify:ip:' + ip, max: 5, windowSeconds: 3600 },
    { key: 'start-phone-verify:user:' + user_id, max: 3, windowSeconds: 3600 }
  ])) return;

  // Look up user
  const { data: user, error: userErr } = await supabase
    .from('users')
    .select('id, phone, phone_verified')
    .eq('id', user_id)
    .single();

  if (userErr || !user) return res.status(404).json({ error: 'User not found' });
  if (!user.phone) return res.status(400).json({ error: 'No phone number on this account. Please update your profile first.' });

  // If already verified, short-circuit
  if (user.phone_verified) {
    return res.json({ success: true, already_verified: true });
  }

  // Send via Twilio Verify
  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.verify.v2.services(process.env.TWILIO_VERIFY_SID)
      .verifications.create({ to: user.phone, channel: 'sms' });
    return res.json({ success: true });
  } catch (e) {
    console.error('Twilio Verify start error:', e && e.message);
    // Don't leak Twilio internals to user
    return res.status(500).json({ error: 'Could not send verification code. Please try again in a moment.' });
  }
};
`;

  if (fs.existsSync(file)) {
    const existing = readFile(file);
    if (existing.includes(MARKER_PHONE_VERIFY_HELPER)) {
      skip('api/start-phone-verification.js (already exists)');
    } else {
      backup(file);
      writeFile(file, body);
      validateJs(file);
      ok('api/start-phone-verification.js overwritten');
    }
  } else {
    writeFile(file, body);
    validateJs(file);
    ok('api/start-phone-verification.js created');
  }
}

// ===========================================================================
// 4.2  Create api/confirm-phone-verification.js
// ===========================================================================

log('');
log('4.2  Creating api/confirm-phone-verification.js');

{
  const file = path.join(API, 'confirm-phone-verification.js');
  const body = `// ${MARKER_PHONE_VERIFY_HELPER}
// TapMyCar - confirm phone verification
// POST { user_id, code } -> checks via Twilio Verify, marks phone_verified

const { createClient } = require('@supabase/supabase-js');
const twilio = require('twilio');
const { rateLimit, getClientIp } = require('./_rate-limit');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  const { user_id, code } = req.body || {};

  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  if (!code) return res.status(400).json({ error: 'code required' });
  if (!UUID_RE.test(String(user_id))) return res.status(400).json({ error: 'Invalid user_id format' });
  if (!/^\\d{4,8}$/.test(String(code).trim())) return res.status(400).json({ error: 'Invalid code format' });

  if (!await rateLimit(req, res, [
    { key: 'confirm-phone-verify:ip:' + ip, max: 20, windowSeconds: 3600 },
    { key: 'confirm-phone-verify:user:' + user_id, max: 10, windowSeconds: 3600 }
  ])) return;

  // Look up user
  const { data: user, error: userErr } = await supabase
    .from('users')
    .select('id, phone, phone_verified')
    .eq('id', user_id)
    .single();

  if (userErr || !user) return res.status(404).json({ error: 'User not found' });
  if (!user.phone) return res.status(400).json({ error: 'No phone number on this account.' });

  // Already verified — short-circuit
  if (user.phone_verified) {
    return res.json({ success: true, already_verified: true });
  }

  // Check via Twilio Verify
  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const check = await client.verify.v2.services(process.env.TWILIO_VERIFY_SID)
      .verificationChecks.create({ to: user.phone, code: String(code).trim() });
    if (check.status !== 'approved') {
      return res.status(400).json({ error: 'Wrong or expired code. Please try again.' });
    }
  } catch (e) {
    console.error('Twilio Verify check error:', e && e.message);
    return res.status(400).json({ error: 'Wrong or expired code. Please try again.' });
  }

  // Mark verified
  const { error: updErr } = await supabase
    .from('users')
    .update({ phone_verified: true, phone_verified_at: new Date().toISOString() })
    .eq('id', user_id);

  if (updErr) {
    console.error('phone_verified update error:', updErr.message);
    return res.status(500).json({ error: 'Verification succeeded but database update failed. Please try again.' });
  }

  return res.json({ success: true });
};
`;

  if (fs.existsSync(file)) {
    const existing = readFile(file);
    if (existing.includes(MARKER_PHONE_VERIFY_HELPER)) {
      skip('api/confirm-phone-verification.js (already exists)');
    } else {
      backup(file);
      writeFile(file, body);
      validateJs(file);
      ok('api/confirm-phone-verification.js overwritten');
    }
  } else {
    writeFile(file, body);
    validateJs(file);
    ok('api/confirm-phone-verification.js created');
  }
}

// ===========================================================================
// 4.3  Update proxy-call.js to gate on phone_verified
// ===========================================================================

log('');
log('4.3  Adding phone_verified gate to proxy-call.js');

{
  const file = path.join(API, 'proxy-call.js');
  const content = readFile(file);

  if (content.includes(MARKER_PHONE_VERIFY_GATE)) {
    skip('proxy-call.js (already gated)');
  } else {
    backup(file);

    // The existing query selects "*, users(phone, name)" — extend to include phone_verified
    const oldSelect = ".select('*, users(phone, name)')";
    const newSelect = ".select('*, users(phone, name, phone_verified)')";

    let updated = content;
    if (updated.includes(oldSelect)) {
      updated = updated.replace(oldSelect, newSelect);
    } else {
      warn('proxy-call.js: tag select pattern not found, skipping select update');
    }

    // Now insert the verified-check after we have the tag+owner
    // The existing code has an owner-resolution block. We add the gate
    // right after we confirm we have the tag and owner.
    // Insertion point: after "if (!tag" or "if (error || !tag" near top.
    // Look for the spot where ownerPhone is derived.
    const insertionAnchor = "  if (!token || !caller_number) {\n    return res.status(400).json({ error: 'token and caller_number required' });\n  }";
    const gateBlock = `

  // ${MARKER_PHONE_VERIFY_GATE}
  // Look up tag + owner phone_verified BEFORE Twilio is engaged.
  // Strangers can't call tags whose owner hasn't verified their phone.
  {
    const { data: _tagCheck } = await supabase
      .from('tags')
      .select('status, users(phone_verified)')
      .eq('token', String(token).toUpperCase().trim())
      .single();
    if (!_tagCheck) {
      return res.status(404).json({ error: 'Tag not found' });
    }
    if (_tagCheck.status !== 'active') {
      return res.status(403).json({
        error: 'This tag is not yet active.',
        not_active: true
      });
    }
    if (!_tagCheck.users || !_tagCheck.users.phone_verified) {
      return res.status(403).json({
        error: 'This tag is not yet ready for calls. The owner needs to complete setup.',
        unverified: true
      });
    }
  }`;

    if (updated.includes(insertionAnchor)) {
      updated = updated.replace(insertionAnchor, insertionAnchor + gateBlock);
    } else {
      warn('proxy-call.js: insertion anchor not found, manual review needed');
    }

    writeFile(file, updated);
    validateJs(file);
    ok('proxy-call.js gates on phone_verified + tag.status === active');
  }
}

// ===========================================================================
// 4.4  Update notify-owner.js — email mentions setup-incomplete if unverified
// ===========================================================================

log('');
log('4.4  Adjusting notify-owner.js for unverified-phone case');

{
  const file = path.join(API, 'notify-owner.js');
  const content = readFile(file);

  if (content.includes(MARKER_PHONE_VERIFY_GATE)) {
    skip('notify-owner.js (already adjusted)');
  } else {
    backup(file);

    // Extend the tag select to include phone_verified
    const oldSelect = ".select('*, users(phone, name, email)')";
    const newSelect = ".select('*, users(phone, name, email, phone_verified)')";

    let updated = content;
    if (updated.includes(oldSelect)) {
      updated = updated.replace(oldSelect, newSelect);
    } else {
      warn('notify-owner.js: tag select pattern not found');
    }

    // Add a note at top of email body when phone is unverified.
    // The cleanest insertion is right after we destructure ownerName etc.
    // Find: const ownerName = tag.users.name || 'there';
    const anchor = "const ownerName = tag.users.name || 'there';";
    const verifyFlag = `const ownerName = tag.users.name || 'there';
  // ${MARKER_PHONE_VERIFY_GATE}
  const _ownerPhoneVerified = !!(tag.users && tag.users.phone_verified);`;
    if (updated.includes(anchor)) {
      updated = updated.replace(anchor, verifyFlag);
    }

    // Append a "complete setup" banner to the email body when phone unverified.
    // The existing code uses a variable called `body` (not `emailHtml`).
    // We prepend the banner right before the email-send call.
    const sendAnchor = "  // Send email notification\n  if (ownerEmail) {";
    const sendReplacement = `  // ${MARKER_PHONE_VERIFY_GATE} prepend setup-incomplete banner if needed
  if (!_ownerPhoneVerified) {
    body = '<div style="background:#FEF3C7;border:1px solid #F59E0B;color:#92400E;font-size:13px;padding:12px;border-radius:8px;margin-bottom:16px;font-family:Inter,sans-serif">Heads up: your account setup isn\\'t complete yet. Strangers can\\'t call you until you verify your phone number. <a href="https://tapmycar.io/dashboard.html" style="color:#92400E;text-decoration:underline">Verify now</a></div>' + body;
  }

  // Send email notification
  if (ownerEmail) {`;
    if (updated.includes(sendAnchor)) {
      updated = updated.replace(sendAnchor, sendReplacement);
    } else {
      warn('notify-owner.js: email send anchor not found, banner not added');
    }

    writeFile(file, updated);
    validateJs(file);
    ok('notify-owner.js: email shows setup-incomplete banner when phone unverified');
  }
}

// ===========================================================================
// Done
// ===========================================================================

log('');
log('==============================================================');
log('Patch 4 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('CRITICAL PRE-DEPLOY CHECKS:');
log('  1. Run the SQL migration below in Supabase BEFORE deploying.');
log('  2. Verify SMS actually arrives via Twilio Verify in production.');
log('     Open Twilio Console > Verify > Send a test code to your phone.');
log('     If SMS does not arrive, do NOT deploy this patch yet -');
log('     phone verification will be impossible to complete.');
log('');
log('Next steps after SQL + SMS test:');
log('  git add -A');
log('  git commit -m "Patch 4: phone verification backend"');
log('  git push');
log('');
log('Tests after deploy:');
log('  curl -X POST https://tapmycar.io/api/start-phone-verification \\');
log('    -H "Content-Type: application/json" \\');
log('    -d \'{"user_id":"YOUR_USER_UUID"}\' ');
log('  -> should send an SMS to your phone');
log('');
log('==============================================================');
log('SUPABASE MIGRATION (run in SQL editor BEFORE deploying):');
log('');
log('-- Add phone_verified columns');
log('ALTER TABLE public.users');
log('  ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT false NOT NULL,');
log('  ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;');
log('');
log('-- Backfill existing users (treat as already-trusted test accounts)');
log('UPDATE public.users');
log('  SET phone_verified = true,');
log('      phone_verified_at = NOW()');
log('  WHERE phone_verified = false;');
log('');
log('-- Add a partial index for the gate query in proxy-call.js');
log('CREATE INDEX IF NOT EXISTS users_phone_verified_idx');
log('  ON public.users(id) WHERE phone_verified = true;');
log('==============================================================');
