// ============================================================================
// TapMyCar - Patch 35c-2: Gift trial lifecycle automation
//
// Completes the Gift Activate feature with the background lifecycle:
//
//  PART 1 - SQL migration (patch35c2-migration.sql):
//     adds users.gift_reminders_sent (text) to track which reminder emails
//     have gone out ('5d', '1d', '0d') so we never send the same one twice.
//
//  PART 2 - api/gift-expiry-cron.js (new cron endpoint):
//     runs daily. For every user with a gift_plan_expires_at:
//       - if expired: downgrade plan -> etag, set their gift tag(s)
//         status -> inactive, stamp gift_expired_at
//       - if 5 / 1 / 0 days out and that reminder not yet sent: email them
//     Auth: Bearer CRON_SECRET (same pattern as daily-report.js).
//
//  PART 3 - vercel.json:
//     adds a crons block - runs gift-expiry-cron daily at 09:00 UTC.
//
//  PART 4 - public/dashboard.html:
//     shows a "trial ending" banner when the user is within 10 days of
//     gift_plan_expires_at, with a Subscribe button.
//
//  PART 5 - public/contact.html:
//     the existing 'disabled' state, when the tag was a gift, shows a
//     gift-specific "trial ended - reactivate" message to the owner.
//
// Properties: idempotent, safeReplace, per-file backup, JS validation.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch35c2-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function readFile(p) {
  if (!fs.existsSync(p)) errExit('File not found: ' + p + '  (run from inside the tapmycar project folder)');
  return fs.readFileSync(p, 'utf8');
}
function backup(file) {
  if (!fs.existsSync(file)) return;
  const rel = path.relative(ROOT, file);
  const dest = path.join(BACKUP_DIR, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
}
function writeFile(p, content) {
  if (typeof content === 'string' && content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  fs.writeFileSync(p, content, 'utf8');
}
function safeReplace(content, oldStr, newStr) {
  const oldCRLF = oldStr.replace(/\n/g, '\r\n');
  if (content.includes(oldStr)) return content.replace(oldStr, () => newStr);
  if (content.includes(oldCRLF)) {
    const newCRLF = newStr.replace(/\n/g, '\r\n');
    return content.replace(oldCRLF, () => newCRLF);
  }
  return null;
}

log('');
log('TapMyCar Patch 35c-2 \u2014 gift trial lifecycle automation');
log('Backup: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH35C2_GIFT_LIFECYCLE';

// =============================================================================
// PART 1 - SQL migration
// =============================================================================

log('Part 1  patch35c2-migration.sql');
{
  const file = path.join(ROOT, 'patch35c2-migration.sql');
  if (fs.existsSync(file)) {
    skip('patch35c2-migration.sql (already exists)');
  } else {
    const sql = `-- ${MARKER}: gift trial lifecycle columns
-- Run in Supabase SQL Editor BEFORE deploying Patch 35c-2.
-- Idempotent: IF NOT EXISTS, so re-running is safe.

-- Tracks which reminder emails were sent for the CURRENT trial.
-- Comma-separated list of milestones: '5d', '1d', '0d'.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS gift_reminders_sent TEXT NULL DEFAULT '';

-- When the gift trial actually expired (set by the cron at downgrade).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS gift_expired_at TIMESTAMPTZ NULL;

-- Lets contact.html show a "trial ended" message: marks a tag whose
-- owner's gift trial lapsed (vs an admin-disabled tag).
ALTER TABLE tags
  ADD COLUMN IF NOT EXISTS gift_expired BOOLEAN NOT NULL DEFAULT FALSE;

-- Verify:
-- SELECT column_name FROM information_schema.columns
--   WHERE (table_name='users' AND column_name IN ('gift_reminders_sent','gift_expired_at'))
--      OR (table_name='tags'  AND column_name='gift_expired');
`;
    writeFile(file, sql);
    ok('patch35c2-migration.sql created');
  }
}

// =============================================================================
// PART 2 - api/gift-expiry-cron.js
// =============================================================================

log('');
log('Part 2  api/gift-expiry-cron.js');
{
  const file = path.join(API, 'gift-expiry-cron.js');
  if (fs.existsSync(file)) {
    const existing = readFile(file);
    if (existing.includes(MARKER)) {
      skip('gift-expiry-cron.js');
    } else {
      errExit('gift-expiry-cron.js exists without marker \u2014 manual review needed');
    }
  } else {
    const body = `// ${MARKER}
// Daily cron: expire lapsed gift trials + send reminder emails.
// Scheduled by vercel.json crons -> 09:00 UTC daily.
// Auth: Bearer CRON_SECRET (same as daily-report.js).

const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = 'TapMyCar <noreply@tapmycar.io>';
const SITE = 'https://tapmycar.io';

/* whole-day difference between two dates (b - a), rounded down */
function daysBetween(a, b) {
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / 86400000);
}

function reminderEmail(name, daysLeft, planName) {
  const greeting = name ? ('Hi ' + name + ',') : 'Hi,';
  let subject, lead;
  if (daysLeft <= 0) {
    subject = 'Your TapMyCar trial ends today';
    lead = 'Your free ' + planName + ' trial ends today. Subscribe now to keep your tag active and your car protected.';
  } else if (daysLeft === 1) {
    subject = 'Your TapMyCar trial ends tomorrow';
    lead = 'Your free ' + planName + ' trial ends tomorrow. Subscribe now so your tag keeps working without interruption.';
  } else {
    subject = 'Your TapMyCar trial ends in ' + daysLeft + ' days';
    lead = 'Your free ' + planName + ' trial ends in ' + daysLeft + ' days. Subscribe any time to keep your tag active.';
  }
  const html =
    '<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#111">' +
    '<h2 style="color:#FF6B00">' + greeting + '</h2>' +
    '<p style="font-size:15px;line-height:1.6">' + lead + '</p>' +
    '<p style="margin:24px 0"><a href="' + SITE + '/dashboard.html" ' +
    'style="background:#FF6B00;color:#fff;padding:12px 22px;border-radius:10px;' +
    'text-decoration:none;font-weight:700;font-size:14px">Subscribe now</a></p>' +
    '<p style="font-size:12px;color:#888">If your trial lapses, your tag pauses until you subscribe. ' +
    'You can reactivate any time \\u2014 your vehicle details are saved.</p>' +
    '</div>';
  return { subject, html };
}

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== ('Bearer ' + process.env.CRON_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = new Date();
  const summary = { expired: 0, remindersSent: 0, errors: [] };

  try {
    /* All users currently on a gift trial (expiry set, not yet expired-out). */
    const { data: giftUsers, error: guErr } = await supabase
      .from('users')
      .select('id, name, email, plan, gift_plan_expires_at, gift_reminders_sent')
      .not('gift_plan_expires_at', 'is', null);

    if (guErr) {
      console.error('${MARKER}: user query failed:', guErr.message);
      return res.status(500).json({ error: 'User query failed' });
    }

    for (const u of (giftUsers || [])) {
      try {
        const expiresAt = new Date(u.gift_plan_expires_at);
        const daysLeft = daysBetween(now, expiresAt);
        const planName = (u.plan || 'standard');
        const planLabel = planName.charAt(0).toUpperCase() + planName.slice(1);

        /* ---- EXPIRED: downgrade ---- */
        if (daysLeft < 0) {
          /* downgrade the user */
          await supabase
            .from('users')
            .update({
              plan: 'etag',
              gift_expired_at: now.toISOString(),
              gift_plan_expires_at: null,
              gift_reminders_sent: ''
            })
            .eq('id', u.id);

          /* set their gift tag(s) inactive + mark gift_expired */
          await supabase
            .from('tags')
            .update({ status: 'inactive', gift_expired: true })
            .eq('owner_id', u.id)
            .eq('is_gift', true)
            .eq('status', 'active');

          summary.expired++;
          continue;
        }

        /* ---- REMINDERS: 5d / 1d / 0d ---- */
        const sent = (u.gift_reminders_sent || '').split(',').filter(Boolean);
        let milestone = null;
        if (daysLeft <= 0 && sent.indexOf('0d') === -1) milestone = '0d';
        else if (daysLeft === 1 && sent.indexOf('1d') === -1) milestone = '1d';
        else if (daysLeft <= 5 && daysLeft > 1 && sent.indexOf('5d') === -1) milestone = '5d';

        if (milestone && u.email) {
          const mail = reminderEmail(u.name, daysLeft, planLabel);
          try {
            await resend.emails.send({
              from: FROM,
              to: u.email,
              subject: mail.subject,
              html: mail.html
            });
            sent.push(milestone);
            await supabase
              .from('users')
              .update({ gift_reminders_sent: sent.join(',') })
              .eq('id', u.id);
            summary.remindersSent++;
          } catch (mailErr) {
            console.error('${MARKER}: email failed for', u.id, mailErr && mailErr.message);
            summary.errors.push('email:' + u.id);
          }
        }
      } catch (perUserErr) {
        console.error('${MARKER}: per-user error', u.id, perUserErr && perUserErr.message);
        summary.errors.push('user:' + u.id);
      }
    }

    return res.json({ success: true, ran_at: now.toISOString(), ...summary });
  } catch (e) {
    console.error('${MARKER}: fatal', e && e.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
`;
    writeFile(file, body);
    try {
      execSync('node --check "' + file + '"', { stdio: 'pipe' });
      ok('gift-expiry-cron.js created, JS valid');
    } catch (e) {
      errExit('gift-expiry-cron.js JS error: ' + e.stderr.toString());
    }
  }
}

// =============================================================================
// PART 3 - vercel.json crons block
// =============================================================================

log('');
log('Part 3  vercel.json: crons block');
{
  const file = path.join(ROOT, 'vercel.json');
  const content = readFile(file);
  if (content.includes('gift-expiry-cron')) {
    skip('vercel.json (cron already registered)');
  } else {
    backup(file);
    let cfg;
    try {
      cfg = JSON.parse(content);
    } catch (e) {
      errExit('vercel.json is not valid JSON: ' + e.message);
    }
    if (!Array.isArray(cfg.crons)) cfg.crons = [];
    cfg.crons.push({ path: '/api/gift-expiry-cron', schedule: '0 9 * * *' });
    writeFile(file, JSON.stringify(cfg, null, 2) + '\n');
    ok('vercel.json: gift-expiry-cron scheduled daily at 09:00 UTC');
  }
}

// =============================================================================
// PART 4 - dashboard.html: trial-ending banner
// =============================================================================

log('');
log('Part 4  public/dashboard.html: trial-ending banner');
{
  const file = path.join(PUBLIC, 'dashboard.html');
  const content = readFile(file);
  if (content.includes(MARKER)) {
    skip('dashboard.html');
  } else {
    backup(file);
    let updated = content;

    /* 4a: add the banner element right after the standard upgrade banner.
       Anchor on the standard banner opening div. */
    const oldBanner = `    <div id="upgrade-banner-standard" style="display:none;background:linear-gradient(135deg,#1A1A1A,#2d1a00);border-radius:18px;padding:18px 16px;margin-bottom:14px;position:relative;overflow:hidden">`;
    const newBanner = `    <!-- ${MARKER}: gift trial-ending banner -->
    <div id="gift-expiry-banner" style="display:none;background:linear-gradient(135deg,#FF6B00,#C2410C);border-radius:18px;padding:18px 16px;margin-bottom:14px;position:relative;overflow:hidden">
      <div style="font-size:15px;font-weight:800;color:#fff;margin-bottom:4px" id="gift-expiry-title">Your free trial is ending soon</div>
      <div style="font-size:13px;color:rgba(255,255,255,.9);line-height:1.5;margin-bottom:12px" id="gift-expiry-text">Subscribe to keep your tag active.</div>
      <a href="/pricing.html" style="display:inline-block;background:#fff;color:#C2410C;font-weight:700;font-size:13px;padding:9px 18px;border-radius:10px;text-decoration:none">Subscribe now</a>
    </div>
    <div id="upgrade-banner-standard" style="display:none;background:linear-gradient(135deg,#1A1A1A,#2d1a00);border-radius:18px;padding:18px 16px;margin-bottom:14px;position:relative;overflow:hidden">`;

    let r = safeReplace(updated, oldBanner, newBanner);
    if (!r) errExit('dashboard.html: standard banner anchor not found');
    updated = r;
    ok('gift-expiry banner element added');

    /* 4b: banner decision logic — append after the existing banner block.
       Anchor on the comment line right after the banner if/else. */
    const oldLogic = `    /* premium / business / anything else: no banner shown */

    // TMC_FAMILY_CODES_LOADER
    renderFamilyCodes(_userPlan, data.premiumCodes || []);`;

    const newLogic = `    /* premium / business / anything else: no banner shown */

    /* ${MARKER}: gift trial-ending banner — shows within 10 days of expiry.
       Overrides the upgrade banners (a gift user does not need an upgrade
       nag, they need a renewal nag). */
    try {
      var _giftExp = data && data.user && data.user.gift_plan_expires_at;
      var _giftBanner = document.getElementById('gift-expiry-banner');
      if (_giftExp && _giftBanner) {
        var _expDate = new Date(_giftExp);
        var _msLeft = _expDate.getTime() - Date.now();
        var _daysLeft = Math.ceil(_msLeft / 86400000);
        if (_daysLeft <= 10) {
          /* hide the upgrade banners; the renewal banner takes priority */
          if (_bEtag) _bEtag.style.display = 'none';
          if (_bStd) _bStd.style.display = 'none';
          var _t = document.getElementById('gift-expiry-title');
          var _x = document.getElementById('gift-expiry-text');
          if (_daysLeft <= 0) {
            if (_t) _t.textContent = 'Your free trial ends today';
            if (_x) _x.textContent = 'Subscribe now to keep your tag active and your car protected.';
          } else if (_daysLeft === 1) {
            if (_t) _t.textContent = 'Your free trial ends tomorrow';
            if (_x) _x.textContent = 'Subscribe now so your tag keeps working without interruption.';
          } else {
            if (_t) _t.textContent = 'Your free trial ends in ' + _daysLeft + ' days';
            if (_x) _x.textContent = 'Subscribe any time to keep your tag active after the trial.';
          }
          _giftBanner.style.display = 'block';
        }
      }
    } catch (e) { console.warn('${MARKER}: banner error', e); }

    // TMC_FAMILY_CODES_LOADER
    renderFamilyCodes(_userPlan, data.premiumCodes || []);`;

    r = safeReplace(updated, oldLogic, newLogic);
    if (!r) errExit('dashboard.html: banner logic anchor not found');
    updated = r;
    ok('gift-expiry banner decision logic added');

    writeFile(file, updated);
  }
}

// =============================================================================
// PART 5 - contact.html: gift "trial ended" message in the disabled state
// =============================================================================

log('');
log('Part 5  public/contact.html: gift reactivate message');
{
  const file = path.join(PUBLIC, 'contact.html');
  const content = readFile(file);
  if (content.includes(MARKER)) {
    skip('contact.html');
  } else {
    backup(file);

    /* The disabled branch. We extend it: if the tag was a gift that
       expired, show a gift-specific message instead of the generic one. */
    const oldDisabled = `    if(tag.status==='disabled'||tag.status==='inactive'){showState('disabled');}`;
    const newDisabled = `    if(tag.status==='disabled'||tag.status==='inactive'){/*${MARKER}: gift-expired tags get a reactivate message*/if(tag.gift_expired===true){try{var _dt=document.querySelector('#state-disabled .result-message, #state-disabled p');if(_dt){_dt.textContent='This tag\\u2019s free trial has ended. The owner can reactivate it by subscribing at tapmycar.io.';}}catch(e){}}showState('disabled');}`;

    const r = safeReplace(content, oldDisabled, newDisabled);
    if (!r) errExit('contact.html: disabled-state anchor not found');
    writeFile(file, r);
    ok('contact.html: gift-expired tags show a reactivate message');
  }
}

log('');
log('==============================================================');
log('Patch 35c-2 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('==== DEPLOY \u2014 IN ORDER ====');
log('');
log('STEP 1: Run the SQL migration in Supabase');
log('  Open patch35c2-migration.sql, paste into Supabase SQL Editor, Run.');
log('  Adds users.gift_reminders_sent, users.gift_expired_at,');
log('  tags.gift_expired.');
log('');
log('STEP 2: Confirm CRON_SECRET exists');
log('  The cron auth uses process.env.CRON_SECRET. daily-report.js already');
log('  uses it, so it should already be set in Vercel. If not, add it in');
log('  Vercel -> Settings -> Environment Variables (any long random string).');
log('');
log('STEP 3: Deploy code');
log('  git add -A');
log('  git commit -m "Patch 35c-2: gift trial lifecycle automation"');
log('  git push');
log('  Wait ~60 sec. Vercel picks up the new cron from vercel.json.');
log('');
log('STEP 4: Verify the cron is registered');
log('  Vercel dashboard -> your project -> Settings -> Cron Jobs.');
log('  You should see /api/gift-expiry-cron scheduled "0 9 * * *".');
log('');
log('STEP 5: Test the cron manually (optional but recommended)');
log('  The cron needs the CRON_SECRET bearer token, so test from a');
log('  terminal (replace YOUR_SECRET):');
log('    curl -H "Authorization: Bearer YOUR_SECRET" \\\\');
log('         https://tapmycar.io/api/gift-expiry-cron');
log('  Expected JSON: {"success":true,"expired":N,"remindersSent":N,...}');
log('');
log('STEP 6: Test the dashboard banner');
log('  Temporarily set a gift user to expire soon, in Supabase:');
log('    UPDATE users SET gift_plan_expires_at = NOW() + INTERVAL (3 days)');
log('    WHERE id = (a gift user id);');
log('    [replace () with single quotes]');
log('  Open that user dashboard -> orange "trial ends in 3 days" banner.');
log('==============================================================');
