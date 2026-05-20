// ============================================================================
// TapMyCar - Patch 35a: Gift Activate — schema migration + backend endpoint
//
// This patch adds the foundation for the Gift Activate feature:
//
//   1. New columns on `tags` table (manual SQL migration the admin runs):
//        is_gift                 BOOLEAN  default FALSE
//        gift_plan               TEXT     ('standard' | 'premium')
//        gift_months             INT      (1..12)
//        gift_assigned_to_user_id UUID    (for pre-linked gifts; NULL for open)
//        gift_note               TEXT     (admin's internal note)
//
//   2. New column on `users` table:
//        gift_plan_expires_at    TIMESTAMPTZ NULL
//        gift_plan_starts_at     TIMESTAMPTZ NULL  (informational)
//
//   3. New backend endpoint: POST /api/admin-gift-activate
//      Admin-only. Marks a tag as gift-ready with chosen plan + months.
//      Does NOT activate the tag yet — that happens when the recipient
//      scans + claims it (Patch 35c).
//
// What this patch does NOT do (deferred to later patches):
//   - Admin UI to call this endpoint (Patch 35b)
//   - Welcome page banner for gifted tags (Patch 35c)
//   - Recipient claim flow that applies the gift (Patch 35c)
//   - Expiry cron job (Patch 35c)
//   - Reminder emails 5d/1d/day-of (Patch 35c)
//   - Dashboard banner from day 25 onwards (Patch 35c)
//
// Properties: idempotent, safeReplace, backs up files. Writes a NEW api file
// (no anchor needed — created from scratch).
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch35a-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function writeFile(p, content) {
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  fs.writeFileSync(p, content, 'utf8');
}

log('');
log('TapMyCar Patch 35a \u2014 Gift Activate schema + backend');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH35A_GIFT_ACTIVATE';

// =============================================================================
// 35a.1  Create api/admin-gift-activate.js
// =============================================================================

log('35a.1  api/admin-gift-activate.js: new admin endpoint');
{
  const file = path.join(API, 'admin-gift-activate.js');
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, 'utf8');
    if (existing.includes(MARKER)) {
      skip('admin-gift-activate.js');
    } else {
      errExit('admin-gift-activate.js exists but missing marker \u2014 manual review needed');
    }
  } else {
    const body = `// ${MARKER}
// POST /api/admin-gift-activate
//
// Admin-only. Marks an unclaimed verified physical tag as gift-ready.
// Does NOT activate the tag (recipient does that by scanning + claiming).
//
// Request headers:
//   x-admin-key: <ADMIN_SECRET_KEY>
//
// Request body:
//   {
//     token: 'TMC-XXXXXX',
//     plan: 'standard' | 'premium',
//     months: 1..12,  (gift trial duration)
//     assigned_user_email?: 'user@example.com',  (optional, for pre-linked gifts)
//     note?: 'Auto show 2026'  (optional admin note)
//   }
//
// If assigned_user_email is provided, the gift is pre-linked: only that
// specific user can claim it. If omitted, the gift is OPEN \u2014 whoever
// scans + claims first becomes the recipient.
//
// Response (200):
//   {
//     success: true,
//     gift: {
//       token, plan, months, assigned_user_id (or null), note
//     }
//   }

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Optional audit hook (best-effort)
let _audit = null;
try { _audit = require('./_audit').audit; } catch (e) {}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_RE = /^TMC-[A-Z0-9]{6,12}$/;
const EMAIL_RE = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Admin auth
  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = req.body || {};
  const token = String(body.token || '').trim().toUpperCase();
  const plan = String(body.plan || '').toLowerCase().trim();
  const months = parseInt(body.months, 10);
  const assignedEmail = body.assigned_user_email
    ? String(body.assigned_user_email).trim().toLowerCase()
    : null;
  const note = body.note ? String(body.note).trim().slice(0, 500) : null;

  // Validate
  if (!token || !TOKEN_RE.test(token)) {
    return res.status(400).json({ error: 'Invalid token format. Expected TMC-XXXXXX.' });
  }
  if (!['standard', 'premium'].includes(plan)) {
    return res.status(400).json({ error: 'plan must be "standard" or "premium"' });
  }
  if (!Number.isInteger(months) || months < 1 || months > 12) {
    return res.status(400).json({ error: 'months must be an integer 1..12' });
  }
  if (assignedEmail && !EMAIL_RE.test(assignedEmail)) {
    return res.status(400).json({ error: 'assigned_user_email is not a valid email' });
  }

  // Look up the tag
  const { data: tag, error: tagErr } = await supabase
    .from('tags')
    .select('id, token, status, verified, is_gift, owner_id')
    .eq('token', token)
    .maybeSingle();

  if (tagErr) {
    console.error('tag lookup error:', tagErr.message);
    return res.status(500).json({ error: 'Tag lookup failed' });
  }
  if (!tag) {
    return res.status(404).json({ error: 'Tag not found' });
  }
  if (!tag.verified) {
    return res.status(400).json({
      error: 'Tag is not verified yet. Verify it in admin before gifting.'
    });
  }
  if (tag.status !== 'unclaimed' || tag.owner_id) {
    return res.status(400).json({
      error: 'Tag is already claimed. Only unclaimed tags can be gift-activated.'
    });
  }
  if (tag.is_gift) {
    return res.status(400).json({
      error: 'Tag is already marked as a gift. Revoke first before re-gifting.'
    });
  }

  // If pre-link requested, find the user
  let assignedUserId = null;
  let assignedUserName = null;
  if (assignedEmail) {
    const { data: assignedUser, error: userErr } = await supabase
      .from('users')
      .select('id, name')
      .eq('email', assignedEmail)
      .maybeSingle();

    if (userErr) {
      console.error('assigned user lookup error:', userErr.message);
      return res.status(500).json({ error: 'User lookup failed' });
    }
    if (!assignedUser) {
      return res.status(404).json({
        error: 'No user found with email ' + assignedEmail + '. They need an account first, or use an open gift.'
      });
    }
    assignedUserId = assignedUser.id;
    assignedUserName = assignedUser.name || null;
  }

  // Mark the tag as gift-ready
  const { error: updateErr } = await supabase
    .from('tags')
    .update({
      is_gift: true,
      gift_plan: plan,
      gift_months: months,
      gift_assigned_to_user_id: assignedUserId,
      gift_note: note
    })
    .eq('id', tag.id);

  if (updateErr) {
    console.error('gift mark error:', updateErr.message);
    return res.status(500).json({ error: 'Failed to mark tag as gift' });
  }

  // Audit
  if (_audit) {
    try {
      await _audit({
        actor: 'admin',
        action: 'gift_activate',
        target_type: 'tag',
        target_id: token,
        meta: {
          plan,
          months,
          assigned_user_id: assignedUserId,
          assigned_user_email: assignedEmail,
          note
        }
      });
    } catch (e) {}
  }

  return res.json({
    success: true,
    gift: {
      token,
      plan,
      months,
      assigned_user_id: assignedUserId,
      assigned_user_name: assignedUserName,
      assigned_user_email: assignedEmail,
      note
    }
  });
};
`;
    writeFile(file, body);

    // Validate JS
    try {
      execSync('node --check "' + file + '"', { stdio: 'pipe' });
      ok('admin-gift-activate.js: created and JS valid');
    } catch (e) {
      errExit('JS syntax error: ' + e.stderr.toString());
    }
  }
}

// =============================================================================
// 35a.2  Write the SQL migration to a file the admin can run in Supabase
// =============================================================================

log('');
log('35a.2  patch35a-migration.sql: schema migration file');
{
  const file = path.join(ROOT, 'patch35a-migration.sql');
  const sql = `-- ${MARKER}: gift activate columns
--
-- Run this in Supabase SQL Editor BEFORE deploying Patch 35a's backend.
-- Idempotent: uses IF NOT EXISTS so re-running is safe.

ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS is_gift BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS gift_plan TEXT NULL
    CHECK (gift_plan IS NULL OR gift_plan IN ('standard', 'premium'));

ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS gift_months INT NULL
    CHECK (gift_months IS NULL OR (gift_months >= 1 AND gift_months <= 12));

ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS gift_assigned_to_user_id UUID NULL
    REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS gift_note TEXT NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS gift_plan_expires_at TIMESTAMPTZ NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS gift_plan_starts_at TIMESTAMPTZ NULL;

-- Useful index for the daily expiry cron (Patch 35c)
CREATE INDEX IF NOT EXISTS idx_users_gift_expiry
  ON users (gift_plan_expires_at)
  WHERE gift_plan_expires_at IS NOT NULL;

-- Useful index for looking up gift-ready tags
CREATE INDEX IF NOT EXISTS idx_tags_is_gift
  ON tags (is_gift)
  WHERE is_gift = TRUE;

-- Verify migration:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'tags' AND column_name LIKE 'gift%' OR column_name = 'is_gift';
--
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'users' AND column_name LIKE 'gift%';
`;

  if (fs.existsSync(file)) {
    skip('patch35a-migration.sql (already exists)');
  } else {
    writeFile(file, sql);
    ok('patch35a-migration.sql: created');
  }
}

log('');
log('==============================================================');
log('Patch 35a complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('==== DEPLOY STEPS \u2014 IN ORDER ====');
log('');
log('STEP 1: Run the SQL migration in Supabase');
log('  Open Supabase \u2192 SQL Editor \u2192 paste contents of:');
log('    patch35a-migration.sql');
log('  Click Run. Verify it succeeded with the SELECT queries at the bottom.');
log('');
log('STEP 2: Deploy the backend endpoint');
log('  git add -A');
log('  git commit -m "Patch 35a: gift activate schema + backend"');
log('  git push');
log('  Wait ~60 sec for Vercel.');
log('');
log('STEP 3: Smoke test the endpoint');
log('  Use a tool like Postman or curl to test:');
log('    POST https://tapmycar.io/api/admin-gift-activate');
log('    Headers: x-admin-key: <your ADMIN_SECRET_KEY value>');
log('             Content-Type: application/json');
log('    Body: { "token": "TMC-XXXXX", "plan": "standard", "months": 1 }');
log('  Expected: 200 with { success: true, gift: {...} }');
log('  Then check Supabase tags table \u2014 the row should now have');
log('  is_gift=true, gift_plan=standard, gift_months=1');
log('');
log('NEXT: Patch 35b builds the Admin Dashboard UI for this endpoint.');
log('==============================================================');
