// ============================================================================
// TapMyCar — Patch 2 of 3: OTP brute-force protection + input validation +
//                          resource checks + CORS Origin guard
//
// REQUIRES: Supabase migration must already be run (otp_codes.attempts,
//           otp_codes.exhausted_at, otp_lockouts table). User confirmed
//           "Success. No rows returned" before this patch was generated.
//
// What this patch does:
//   2.1  OTP brute-force protection (combined Option A + B):
//        - Per-OTP: 5 wrong guesses invalidates THAT OTP and stamps
//          exhausted_at on it.
//        - Per-email: if 3+ OTPs were exhausted in last 15 min, lock
//          the email out from requesting OR verifying any OTP for 15
//          min (writes a row to otp_lockouts).
//        - Touches: api/send-otp.js (lockout check before issue) and
//          api/verify-otp.js (attempt counter + exhaustion + lockout
//          check before verify).
//
//   2.2  Email format validation in send-otp.js: reject malformed
//        email strings with 400 before any DB or Resend call.
//
//   2.3  Resource ownership / format hardening:
//        - api/update-scan.js: validate scan_id is UUID-shaped,
//          contact_action is in allowlist, lat/lng are sane numbers.
//        - api/redeem-code.js: validate user_id is UUID-shaped.
//        - api/reactivate-etag.js: validate user_id is UUID-shaped.
//
//   2.4  CORS Origin guard on state-changing endpoints. Rejects
//        requests where Origin header is set to a domain OTHER than
//        the allowlist. Browsers always set Origin on cross-origin
//        POSTs; missing Origin is allowed (server-to-server,
//        same-origin).
//        Allowlist: https://tapmycar.io, https://www.tapmycar.io,
//                   plus any *.vercel.app preview deploys.
//        Touches: cancel-subscription.js, delete-account.js,
//                 claim-reward.js, get-dashboard.js (POST branch),
//                 update-order-status.js (admin, defensive).
//
// Properties:
//   - Idempotent: re-running is a no-op
//   - Backups: every touched file copied to backup-patch2-{timestamp}/
//   - Validates JS syntax with node --check
//   - Prints clear "what changed / what was skipped" summary
//
// Run:
//   Move-Item "$env:USERPROFILE\Downloads\tapmycar-patch2-otp-brute-and-validation.js" `
//             "C:\Users\PRAVEEN CHANDU\Documents\tapmycar\tapmycar-patch2-otp-brute-and-validation.js" -Force
//   cd "C:\Users\PRAVEEN CHANDU\Documents\tapmycar"
//   node tapmycar-patch2-otp-brute-and-validation.js
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch2-${ts}`);

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
log('TapMyCar Patch 2 of 3 \u2014 OTP hardening + validation + CORS guard');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Shared marker constants used to detect prior application
// ---------------------------------------------------------------------------
const MARKER_LOCKOUT_HELPER = 'TMC_PATCH2_OTP_LOCKOUT_HELPER';
const MARKER_EMAIL_VALIDATE = 'TMC_PATCH2_EMAIL_VALIDATE';
const MARKER_OTP_LOCKOUT_CHECK = 'TMC_PATCH2_OTP_LOCKOUT_CHECK_BEFORE_ISSUE';
const MARKER_OTP_VERIFY_LOGIC = 'TMC_PATCH2_OTP_VERIFY_HARDENED';
const MARKER_UPDATE_SCAN = 'TMC_PATCH2_UPDATE_SCAN_VALIDATED';
const MARKER_UUID_VALIDATE = 'TMC_PATCH2_UUID_VALIDATE';
const MARKER_ORIGIN_GUARD = 'TMC_PATCH2_ORIGIN_GUARD';

// ===========================================================================
// 2.1 + 2.2  Rewrite send-otp.js with email validation + lockout check
// ===========================================================================

log('2.1 + 2.2  send-otp.js: email validation + per-email lockout check');

{
  const file = path.join(API, 'send-otp.js');
  const content = readFile(file);

  if (content.includes(MARKER_OTP_LOCKOUT_CHECK) && content.includes(MARKER_EMAIL_VALIDATE)) {
    skip('api/send-otp.js (already hardened)');
  } else {
    backup(file);

    // We rewrite the email-OTP branch and add a small lockout helper.
    // The phone-OTP branch (Twilio Verify) is left untouched.
    const newBody = `const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const twilio = require('twilio');

const resend = new Resend(process.env.RESEND_API_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ${MARKER_LOCKOUT_HELPER}
// Checks otp_lockouts table. Returns null if not locked, or a
// human-readable error string if locked. Defensive: if the table
// doesn't exist or query fails, fail-open (returns null) to avoid
// breaking signup if migration hasn't run.
async function checkLockout(email) {
  try {
    const { data: row, error } = await supabase
      .from('otp_lockouts')
      .select('locked_until')
      .eq('email', email)
      .maybeSingle();
    if (error || !row) return null;
    const until = new Date(row.locked_until).getTime();
    if (Date.now() >= until) return null;
    const minsLeft = Math.max(1, Math.ceil((until - Date.now()) / 60000));
    return 'Too many failed attempts. Please try again in ' + minsLeft + ' minute' + (minsLeft === 1 ? '' : 's') + '.';
  } catch (e) {
    return null;
  }
}

// ${MARKER_EMAIL_VALIDATE}
// RFC-lite email format check. Rejects obviously malformed strings
// before we hand them to Resend or write them to the DB.
function isValidEmail(s) {
  if (typeof s !== 'string') return false;
  if (s.length < 5 || s.length > 254) return false;
  return /^[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}$/.test(s);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // mode: 'signin' = check that email exists before sending OTP
  // mode: 'register' = allow any email (default)
  const { email, phone, type, mode } = req.body;

  // EMAIL OTP
  if (type === 'email' || (!type && email)) {
    if (!email) return res.status(400).json({ error: 'Email required' });

    // ${MARKER_EMAIL_VALIDATE} — reject malformed emails
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    // ${MARKER_OTP_LOCKOUT_CHECK} — block locked-out emails before issuing
    const lockMsg = await checkLockout(email);
    if (lockMsg) {
      return res.status(429).json({ error: lockMsg, locked: true });
    }

    // SIGNIN MODE: verify user exists first
    if (mode === 'signin') {
      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('email', email)
        .maybeSingle();

      if (!existingUser) {
        return res.status(404).json({
          error: 'No account found for this email. Please register first.',
          no_account: true
        });
      }
    }

    const code = crypto.randomInt(100000, 1000000).toString();

    // Delete old OTPs for this email (and start fresh attempts counter)
    const { error: delError } = await supabase
      .from('otp_codes')
      .delete()
      .eq('phone', email);
    if (delError) console.error('Delete old OTPs error:', delError);

    // Insert new OTP
    const { error: insError } = await supabase
      .from('otp_codes')
      .insert({
        phone: email,
        code,
        used: false,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      });
    if (insError) {
      console.error('Insert OTP error:', insError);
      return res.status(500).json({ error: 'Failed to save OTP' });
    }

    // Send via Resend
    try {
      await resend.emails.send({
        from: 'TapMyCar <noreply@tapmycar.io>',
        to: email,
        subject: 'Your TapMyCar verification code: ' + code,
        html: '<div style="font-family:Inter,sans-serif;max-width:400px;margin:0 auto;padding:40px 20px"><div style="font-size:24px;font-weight:800;color:#111;margin-bottom:8px">TapMyCar<span style="color:#FF6B00">.</span></div><div style="font-size:14px;color:#6B7280;margin-bottom:32px">Privacy for you. Safety for your car.</div><div style="background:#FFF3EC;border:1.5px solid #FFE4CC;border-radius:14px;padding:24px;text-align:center;margin-bottom:24px"><div style="font-size:13px;color:#9A3800;font-weight:600;margin-bottom:8px">Your verification code</div><div style="font-size:42px;font-weight:800;color:#FF6B00;letter-spacing:8px;font-family:Menlo,monospace">' + code + '</div></div><div style="font-size:12px;color:#9CA3AF;text-align:center">Code expires in 10 minutes. If you did not request this, you can ignore this email.</div></div>'
      });
    } catch (e) {
      console.error('Resend error:', e);
      return res.status(500).json({ error: 'Failed to send email' });
    }

    return res.json({ success: true });
  }

  // PHONE OTP — Twilio Verify (used for tag activation, untouched by Patch 2)
  if (type === 'phone') {
    if (!phone) return res.status(400).json({ error: 'Phone required' });
    try {
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await client.verify.v2.services(process.env.TWILIO_VERIFY_SID)
        .verifications.create({ to: phone, channel: 'sms' });
      return res.json({ success: true });
    } catch (e) {
      console.error('Twilio Verify error:', e);
      return res.status(500).json({ error: 'Failed to send SMS' });
    }
  }

  return res.status(400).json({ error: 'type or email required' });
};
`;
    writeFile(file, newBody);
    validateJs(file);
    ok('api/send-otp.js rewritten with email validation + lockout check');
  }
}

// ===========================================================================
// 2.1  verify-otp.js — attempt counter, exhaustion, lockout check
// ===========================================================================

log('');
log('2.1  verify-otp.js: attempt counter + exhaustion + lockout');

{
  const file = path.join(API, 'verify-otp.js');
  const content = readFile(file);

  if (content.includes(MARKER_OTP_VERIFY_LOGIC)) {
    skip('api/verify-otp.js (already hardened)');
  } else {
    backup(file);

    // Replace ONLY the email-OTP branch. We keep the phone-OTP branch
    // and the assignFreeTag helper exactly as they are.

    // Find the email-OTP branch start
    const emailBranchMarker = "// EMAIL OTP";
    const emailBranchStart = content.indexOf(emailBranchMarker);
    if (emailBranchStart === -1) {
      err('verify-otp.js: could not find "// EMAIL OTP" marker');
    }

    // Find the end (the final "type or email required" line)
    const emailBranchEndMarker = "return res.status(400).json({ error: 'type or email required' });";
    const emailBranchEndIdx = content.indexOf(emailBranchEndMarker);
    if (emailBranchEndIdx === -1) {
      err('verify-otp.js: could not find email-branch end marker');
    }
    // Slice up to the line BEFORE the closing return
    const emailBranchEnd = content.lastIndexOf('}', emailBranchEndIdx) + 1;

    const before = content.slice(0, emailBranchStart);
    const after = content.slice(emailBranchEnd);

    // ${MARKER_OTP_VERIFY_LOGIC}
    const newEmailBranch = `// EMAIL OTP — signin or register
  // ${MARKER_OTP_VERIFY_LOGIC}
  if (type === 'email' || email) {
    if (!email || !code) return res.status(400).json({ error: 'Email and code required' });

    // ─── Per-email lockout check (before any DB work) ────────────
    try {
      const { data: lockRow } = await supabase
        .from('otp_lockouts')
        .select('locked_until')
        .eq('email', email)
        .maybeSingle();
      if (lockRow) {
        const until = new Date(lockRow.locked_until).getTime();
        if (Date.now() < until) {
          const minsLeft = Math.max(1, Math.ceil((until - Date.now()) / 60000));
          return res.status(429).json({
            error: 'Too many failed attempts. Please try again in ' + minsLeft + ' minute' + (minsLeft === 1 ? '' : 's') + '.',
            locked: true
          });
        }
      }
    } catch (e) {
      // fail-open: don't block legitimate users if lockouts table query fails
    }

    // Find the most recent unused OTP for this email (any code value)
    // We DON'T filter by code here so we can count this as an attempt
    // even if the user typed the wrong code.
    const { data: otps } = await supabase.from('otp_codes').select('*')
      .eq('phone', email)
      .eq('used', false)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!otps || otps.length === 0) {
      return res.status(400).json({ error: 'No active code found. Please request a new one.' });
    }

    const otp = otps[0];
    const expiresAt = new Date(otp.expires_at).getTime();
    if (Date.now() > expiresAt) {
      await supabase.from('otp_codes').update({ used: true }).eq('id', otp.id);
      return res.status(400).json({ error: 'Code expired. Please request a new one.' });
    }

    // ─── Compare submitted code to stored code ───────────────────
    if (String(code).trim() !== String(otp.code)) {
      // Wrong code — increment attempts
      const newAttempts = (otp.attempts || 0) + 1;
      const MAX_ATTEMPTS = 5;

      if (newAttempts >= MAX_ATTEMPTS) {
        // Exhaust this OTP
        await supabase.from('otp_codes')
          .update({ used: true, attempts: newAttempts, exhausted_at: new Date().toISOString() })
          .eq('id', otp.id);

        // ─── Per-email cooldown trigger ────────────────────────
        // Count exhausted OTPs for this email in last 15 min.
        const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
        const { data: recentExhausted } = await supabase.from('otp_codes')
          .select('id')
          .eq('phone', email)
          .gte('exhausted_at', fifteenMinAgo);

        const exhaustedCount = (recentExhausted || []).length;
        if (exhaustedCount >= 3) {
          // Lock the email out for 15 minutes
          const lockUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
          await supabase.from('otp_lockouts').upsert({
            email,
            locked_until: lockUntil,
            reason: 'repeated_otp_failures',
            updated_at: new Date().toISOString()
          }, { onConflict: 'email' });
          return res.status(429).json({
            error: 'Too many failed attempts. Please try again in 15 minutes.',
            locked: true
          });
        }

        return res.status(400).json({
          error: 'Too many wrong attempts. Please request a new code.',
          attempts_exhausted: true
        });
      } else {
        await supabase.from('otp_codes')
          .update({ attempts: newAttempts })
          .eq('id', otp.id);
        const remaining = MAX_ATTEMPTS - newAttempts;
        return res.status(400).json({
          error: 'Wrong code. ' + remaining + ' attempt' + (remaining === 1 ? '' : 's') + ' left.',
          attempts_remaining: remaining
        });
      }
    }

    // ─── Correct code path ───────────────────────────────────────
    await supabase.from('otp_codes').update({ used: true }).eq('id', otp.id);
    await supabase.from('otp_codes').delete().eq('phone', email).eq('used', false);
    // Clear any stale lockout row for this email
    await supabase.from('otp_lockouts').delete().eq('email', email);

    // Check if user exists
    let { data: user } = await supabase.from('users').select('*').eq('email', email).single();
    let isNewUser = false;

    // SIGNIN MODE: reject if user doesn't exist
    if (mode === 'signin' && !user) {
      return res.status(404).json({
        error: 'No account found for this email. Please register first.',
        no_account: true
      });
    }

    // REGISTER MODE (or legacy): create user if not exists
    if (!user) {
      const cleaned = (phone || '').replace(/\\D/g, '');
      const formatted = cleaned ? (cleaned.startsWith('1') ? '+' + cleaned : '+1' + cleaned) : null;
      const { data: newUser, error: insertError } = await supabase.from('users')
        .insert({ email, phone: formatted, name: name || 'User' })
        .select().single();

      if (insertError) {
        console.error('User insert error:', insertError);
        const { data: existingUser } = await supabase.from('users').select('*').eq('email', email).single();
        if (existingUser) {
          user = existingUser;
        } else {
          return res.status(500).json({ error: 'Failed to create account. Please try again.' });
        }
      } else {
        user = newUser;
        isNewUser = true;
      }
    }

    if (!user) return res.status(500).json({ error: 'Account error. Please try again.' });

    // Auto-assign tag and generate referral code for new users
    if (isNewUser && user) {
      await assignFreeTag(user.id);
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      let refCode = "TMC-";
      for (let i = 0; i < 6; i++) refCode += chars[crypto.randomInt(chars.length)];
      const updates = { referral_code: refCode };
      if (token) updates.referred_by = token;
      await supabase.from('users').update(updates).eq('id', user.id);
    }

    return res.json({
      token: user.id,
      name: user.name,
      email: user.email,
      isNewUser
    });
  }

  `;

    const newContent = before + newEmailBranch + after;
    writeFile(file, newContent);
    validateJs(file);
    ok('api/verify-otp.js email branch replaced with hardened logic');
  }
}

// ===========================================================================
// 2.3  update-scan.js — input validation
// ===========================================================================

log('');
log('2.3  update-scan.js: scan_id UUID + action allowlist + lat/lng validation');

{
  const file = path.join(API, 'update-scan.js');
  const content = readFile(file);
  if (content.includes(MARKER_UPDATE_SCAN)) {
    skip('api/update-scan.js (already validated)');
  } else {
    backup(file);
    const newBody = `const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ${MARKER_UPDATE_SCAN}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTION_ALLOWLIST = new Set([
  'view', 'call', 'photo', 'voice', 'quick_message', 'emergency'
]);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { scan_id, latitude, longitude, contact_action } = req.body;
  if (!scan_id) return res.status(400).json({ error: 'scan_id required' });

  // Validate scan_id format
  if (!UUID_RE.test(String(scan_id))) {
    return res.status(400).json({ error: 'Invalid scan_id format' });
  }

  const updates = {};

  if (latitude !== undefined) {
    const lat = Number(latitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return res.status(400).json({ error: 'Invalid latitude' });
    }
    updates.latitude = lat;
  }

  if (longitude !== undefined) {
    const lng = Number(longitude);
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'Invalid longitude' });
    }
    updates.longitude = lng;
  }

  if (contact_action !== undefined) {
    if (!ACTION_ALLOWLIST.has(String(contact_action))) {
      return res.status(400).json({ error: 'Invalid contact_action' });
    }
    updates.contact_action = contact_action;
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const { error } = await supabase
    .from('scan_logs')
    .update(updates)
    .eq('id', scan_id);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ success: true });
};
`;
    writeFile(file, newBody);
    validateJs(file);
    ok('api/update-scan.js now validates scan_id, action, and coordinates');
  }
}

// ===========================================================================
// 2.3  redeem-code.js — UUID validation
// ===========================================================================

log('');
log('2.3  redeem-code.js: UUID validation on user_id');

{
  const file = path.join(API, 'redeem-code.js');
  const content = readFile(file);
  if (content.includes(MARKER_UUID_VALIDATE)) {
    skip('api/redeem-code.js (already validated)');
  } else {
    backup(file);
    const oldBlock = "  if (!user_id) return res.status(400).json({ error: 'user_id required' });\n  if (!code) return res.status(400).json({ error: 'code required' });";
    const newBlock = `  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  if (!code) return res.status(400).json({ error: 'code required' });

  // ${MARKER_UUID_VALIDATE}
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(String(user_id))) {
    return res.status(400).json({ error: 'Invalid user_id format' });
  }`;
    if (!content.includes(oldBlock)) {
      warn('api/redeem-code.js \u2014 expected pattern not found, skipped');
    } else {
      writeFile(file, content.replace(oldBlock, newBlock));
      validateJs(file);
      ok('api/redeem-code.js now validates user_id format');
    }
  }
}

// ===========================================================================
// 2.3  reactivate-etag.js — UUID validation
// ===========================================================================

log('');
log('2.3  reactivate-etag.js: UUID validation on user_id');

{
  const file = path.join(API, 'reactivate-etag.js');
  const content = readFile(file);
  if (content.includes(MARKER_UUID_VALIDATE)) {
    skip('api/reactivate-etag.js (already validated)');
  } else {
    backup(file);
    const oldBlock = "  const { user_id } = req.body;\n  if (!user_id) return res.status(400).json({ error: 'user_id required' });";
    const newBlock = `  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  // ${MARKER_UUID_VALIDATE}
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(String(user_id))) {
    return res.status(400).json({ error: 'Invalid user_id format' });
  }`;
    if (!content.includes(oldBlock)) {
      warn('api/reactivate-etag.js \u2014 expected pattern not found, skipped');
    } else {
      writeFile(file, content.replace(oldBlock, newBlock));
      validateJs(file);
      ok('api/reactivate-etag.js now validates user_id format');
    }
  }
}

// ===========================================================================
// 2.4  CORS Origin guard on state-changing endpoints
// ===========================================================================

log('');
log('2.4  Adding CORS Origin guard to state-changing endpoints');

const ORIGIN_HELPER = `
// ${MARKER_ORIGIN_GUARD}
function checkOrigin(req) {
  const origin = req.headers.origin;
  // Missing origin = same-origin or server-to-server, allowed
  if (!origin) return true;
  // Allowlist: tapmycar.io domains and any *.vercel.app preview
  if (origin === 'https://tapmycar.io') return true;
  if (origin === 'https://www.tapmycar.io') return true;
  if (/^https:\\/\\/[a-z0-9-]+\\.vercel\\.app$/.test(origin)) return true;
  return false;
}
`;

function addOriginGuardToFile(file, insertionPattern, label) {
  const content = readFile(file);
  if (content.includes(MARKER_ORIGIN_GUARD)) {
    skip(label + ' (already guarded)');
    return;
  }
  if (!content.includes(insertionPattern)) {
    warn(label + ' \u2014 insertion pattern not found, skipped');
    return;
  }
  backup(file);

  // Insert helper at the very top (after first `const ... require` line)
  const firstReqMatch = content.match(/^(const [^\n]+require\([^)]+\);?\r?\n)/m);
  let updated;
  if (firstReqMatch) {
    // Find where the require block ends — insert helper after the LAST consecutive require line at the top
    const lines = content.split(/\r?\n/);
    let lastReqLine = -1;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (l === '' || l.startsWith('//') || l.startsWith('/*') || l.startsWith('*') || l.startsWith('﻿')) continue;
      if (l.includes('require(') || l.startsWith('const ') && l.endsWith(';')) {
        lastReqLine = i;
        continue;
      }
      break;
    }
    if (lastReqLine === -1) lastReqLine = 0;
    lines.splice(lastReqLine + 1, 0, ORIGIN_HELPER);
    updated = lines.join('\n');
  } else {
    updated = ORIGIN_HELPER + '\n' + content;
  }

  // Insert the guard call right after the method check
  const guardCall = `  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden origin' });
`;
  updated = updated.replace(insertionPattern, insertionPattern + '\n' + guardCall);
  writeFile(file, updated);
  validateJs(file);
  ok(label);
}

// cancel-subscription.js
addOriginGuardToFile(
  path.join(API, 'cancel-subscription.js'),
  'if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });',
  'api/cancel-subscription.js Origin guard'
);

// delete-account.js
addOriginGuardToFile(
  path.join(API, 'delete-account.js'),
  'if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });',
  'api/delete-account.js Origin guard'
);

// claim-reward.js
addOriginGuardToFile(
  path.join(API, 'claim-reward.js'),
  'if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });',
  'api/claim-reward.js Origin guard'
);

// update-order-status.js (admin-only, defensive)
addOriginGuardToFile(
  path.join(API, 'update-order-status.js'),
  'if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });',
  'api/update-order-status.js Origin guard'
);

// get-dashboard.js — POST branch only. Insert guard inside the POST block
{
  const file = path.join(API, 'get-dashboard.js');
  const content = readFile(file);
  if (content.includes(MARKER_ORIGIN_GUARD)) {
    skip('api/get-dashboard.js Origin guard (already applied)');
  } else {
    const insertionPattern = "if (req.method === 'POST') {";
    if (!content.includes(insertionPattern)) {
      warn('api/get-dashboard.js \u2014 POST-branch start not found');
    } else {
      backup(file);

      // Insert helper at top (after first require)
      const lines = content.split(/\r?\n/);
      let lastReqLine = -1;
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i].trim();
        if (l === '' || l.startsWith('//') || l.startsWith('/*') || l.startsWith('*') || l.startsWith('﻿')) continue;
        if (l.includes('require(')) { lastReqLine = i; continue; }
        if (l.startsWith('const ') && l.endsWith(';')) { lastReqLine = i; continue; }
        break;
      }
      if (lastReqLine === -1) lastReqLine = 0;
      lines.splice(lastReqLine + 1, 0, ORIGIN_HELPER);
      let updated = lines.join('\n');

      // Insert guard inside POST branch
      const guardCall = `\n    if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden origin' });`;
      updated = updated.replace(insertionPattern, insertionPattern + guardCall);
      writeFile(file, updated);
      validateJs(file);
      ok('api/get-dashboard.js Origin guard (POST branch only)');
    }
  }
}

// ===========================================================================
// Done
// ===========================================================================

log('');
log('==============================================================');
log('Patch 2 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Next steps:');
log('  1. Review changes:   git diff');
log('  2. Stage all:        git add -A');
log('  3. Commit:           git commit -m "Patch 2: OTP brute-force + validation + CORS guard"');
log('  4. Push:             git push');
log('  5. Wait ~60 seconds for Vercel deploy.');
log('  6. Test in fresh incognito with hard refresh:');
log('     - Sign up with a fresh email, OTP arrives, types correctly, lands on dashboard');
log('     - Sign up with bad email "abc" -> should reject with "Please enter a valid email"');
log('     - Type wrong OTP code 5 times -> should say "Too many wrong attempts"');
log('     - Click Resend, get new OTP, this time enter correctly -> should work');
log('     - Settings page: edit profile, save -> should still work');
log('     - Settings page: cancel subscription test -> should still work (Origin from tapmycar.io passes)');
log('     - Admin panel: Leads + Orders + Mark Shipped -> all still work');
log('==============================================================');
