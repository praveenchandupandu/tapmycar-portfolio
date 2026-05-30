/* ============================================================================
 * TapMyCar  Patch 45a  referrals lifecycle (tracking, display, duplicate-block)
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch45a-referrals-lifecycle.js
 *
 * Builds on Patch 43 (code format) and Patch 44 (short URL + wording).
 * Introduces the referrals table from patch45a-migration.sql for proper
 * lifecycle tracking, duplicate-prevention by email/phone hash, and the
 * four-number dashboard display you asked for.
 *
 * What does NOT happen yet: spending the credits at checkout. That's
 * Patch 45b. Until then, credits accumulate as 'available' but checkout
 * still uses the legacy referral_credits column (which 45a leaves alone
 * on purpose for backward compatibility).
 *
 * IMPORTANT  run patch45a-migration.sql in Supabase FIRST.
 *
 * Four files modified:
 *
 *   1. api/redeem-code.js
 *      Referral branch (TMC-XXXXXX) now ALSO inserts an 'applied' row into
 *      the referrals table after setting users.referred_by. Before inserting,
 *      it computes the redeemer's email/phone hash and blocks the insert if
 *      either hash already exists against the same referrer in any status
 *      (including 'revoked')  fraud prevention by re-registration.
 *
 *   2. api/stripe-webhook.js
 *      checkout.session.completed: flips the user's referral row from
 *      'applied' to 'pending', sets paid_at = now and available_at = now+14d.
 *      Also still updates the legacy users.referral_count/users.referral_credits
 *      columns (for backward compatibility with current settings.html and
 *      until Patch 45b changes how checkout reads them).
 *      Premium-gift-code redemptions are detected by checking parent_user_id
 *      and DO NOT trigger a credit  no money flowed.
 *
 *   3. api/get-referral.js
 *      Returns the FOUR numbers:
 *        signups      - rows in status 'applied'
 *        confirmed    - rows in status 'pending' OR 'available' OR 'consumed'
 *        credit_available  - SUM(credit_amount) where status = 'available'
 *                              OR (status = 'pending' AND available_at <= now)
 *        credit_pending    - SUM(credit_amount) where status = 'pending'
 *                              AND available_at > now
 *      The 'available' flip happens lazily in this query  no cron.
 *
 *   4. public/settings.html
 *      Modern referral card showing all four numbers with clear labels,
 *      pending vs. available split, and the existing share/copy actions.
 *
 * SAFE TO RE-RUN: each file skipped if it already contains TMC_PATCH45A.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'TMC_PATCH45A';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch45a-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

/* ========================================================================
 * EDIT 1  api/redeem-code.js
 *   In the existing referral branch, AFTER the supabase.from('users')
 *   .update({ referred_by: normalized }), add: hash email+phone, check
 *   for existing row by hash, insert the 'applied' row if clean.
 * ======================================================================*/

const REDEEM = path.join('api', 'redeem-code.js');

/* Anchor: the existing successful-referral block from Patch 43. We extend
   the .update({ referred_by: normalized }) success branch to also insert
   into referrals (with duplicate-block by hash). */
const R_FIND = [
  "    /* Set referred_by so stripe-webhook credits the referrer when this",
  "       user buys a paid plan. This is the missing link bug 2 fixes. */",
  "    const { error: updErr } = await supabase",
  "      .from('users')",
  "      .update({ referred_by: normalized })",
  "      .eq('id', user_id);",
  "    if (updErr) {",
  "      console.error('referral set failed:', updErr.message);",
  "      return res.status(500).json({ error: 'Could not apply the referral code right now.' });",
  "    }",
  "    return res.status(200).json({",
  "      success: true,",
  "      type: 'referral',",
  "      referrer_name: referrer.name || 'your friend'",
  "    });",
  "  }"
].join('\n');

const R_REPLACE = [
  "    /* TMC_PATCH45A: duplicate-block by email/phone hash. Looks up the",
  "       redeemer's email + phone and SHA-256 hashes them, then checks the",
  "       referrals table for any existing row from the same referrer with",
  "       matching hash in ANY status (including 'revoked'). If found, the",
  "       same person already used a referral from this referrer  reject.",
  "       This is the fix for: friend signs up, deletes account, re-registers",
  "       with same email/phone to claim again. */",
  "    const crypto = require('crypto');",
  "    const { data: redeemer } = await supabase",
  "      .from('users')",
  "      .select('email, phone')",
  "      .eq('id', user_id)",
  "      .single();",
  "    function sha256(s) { return crypto.createHash('sha256').update(String(s).toLowerCase().trim()).digest('hex'); }",
  "    const emailHash = redeemer && redeemer.email ? sha256(redeemer.email) : null;",
  "    const phoneHash = redeemer && redeemer.phone ? sha256(redeemer.phone) : null;",
  "    if (emailHash || phoneHash) {",
  "      const orFilters = [];",
  "      if (emailHash) orFilters.push('referred_email_hash.eq.' + emailHash);",
  "      if (phoneHash) orFilters.push('referred_phone_hash.eq.' + phoneHash);",
  "      const { data: dup } = await supabase",
  "        .from('referrals')",
  "        .select('id')",
  "        .eq('referrer_user_id', referrer.id)",
  "        .or(orFilters.join(','))",
  "        .limit(1);",
  "      if (dup && dup.length) {",
  "        return res.status(400).json({ error: \"This referral has already been used.\" });",
  "      }",
  "    }",
  "    /* Set referred_by so stripe-webhook credits the referrer when this",
  "       user buys a paid plan. This is the missing link bug 2 fixes. */",
  "    const { error: updErr } = await supabase",
  "      .from('users')",
  "      .update({ referred_by: normalized })",
  "      .eq('id', user_id);",
  "    if (updErr) {",
  "      console.error('referral set failed:', updErr.message);",
  "      return res.status(500).json({ error: 'Could not apply the referral code right now.' });",
  "    }",
  "    /* TMC_PATCH45A: insert the 'applied' row. Non-fatal  if this fails,",
  "       the referral still works via the legacy users.referred_by path and",
  "       stripe-webhook will fall back to the legacy count/credit columns. */",
  "    try {",
  "      await supabase.from('referrals').insert({",
  "        referrer_user_id:    referrer.id,",
  "        referred_user_id:    user_id,",
  "        referral_code:       normalized,",
  "        referred_email_hash: emailHash,",
  "        referred_phone_hash: phoneHash,",
  "        status:              'applied'",
  "      });",
  "    } catch (e) {",
  "      console.warn('referrals insert failed (non-fatal):', e && e.message);",
  "    }",
  "    return res.status(200).json({",
  "      success: true,",
  "      type: 'referral',",
  "      referrer_name: referrer.name || 'your friend'",
  "    });",
  "  }"
].join('\n');

/* ========================================================================
 * EDIT 2  api/stripe-webhook.js
 *   In the existing referral-rewards block in checkout.session.completed,
 *   ALSO transition the referrals row from 'applied' to 'pending'. Skip
 *   if buyer is a Premium-gift-code joiner (parent_user_id is set), per Q3.
 *   Keep the legacy users.referral_count/users.referral_credits update so
 *   nothing else breaks until Patch 45b.
 * ======================================================================*/

const WEBHOOK = path.join('api', 'stripe-webhook.js');

const W_FIND = [
  "        // ─── REFERRAL REWARDS ───────────────────────────────────",
  "        const { data: buyer } = await supabase.from(\"users\").select(\"referred_by\").eq(\"id\", user_id).single();",
  "        if (buyer && buyer.referred_by) {",
  "          const { data: referrer } = await supabase.from(\"users\")",
  "            .select(\"id, referral_count, referral_credits, referral_reward_pending\")",
  "            .eq(\"referral_code\", buyer.referred_by).single();",
  "          if (referrer) {",
  "            const newCount = (referrer.referral_count || 0) + 1;",
  "            const updates = { referral_count: newCount };",
  "            if (newCount === 1) updates.referral_credits = (referrer.referral_credits || 0) + 3.00;",
  "            else updates.referral_reward_pending = \"choice\";",
  "            await supabase.from(\"users\").update(updates).eq(\"id\", referrer.id);",
  "          }",
  "        }"
].join('\n');

const W_REPLACE = [
  "        // ─── REFERRAL REWARDS ───────────────────────────────────",
  "        /* TMC_PATCH45A: gate on parent_user_id  Premium-gift-code",
  "           joiners do NOT trigger a credit (they paid nothing). Then",
  "           transition the referrals row applied -> pending with",
  "           available_at = paid_at + 14 days. */",
  "        const { data: buyer } = await supabase.from(\"users\").select(\"referred_by, parent_user_id\").eq(\"id\", user_id).single();",
  "        const isGiftJoiner = !!(buyer && buyer.parent_user_id);",
  "        if (buyer && buyer.referred_by && !isGiftJoiner) {",
  "          const { data: referrer } = await supabase.from(\"users\")",
  "            .select(\"id, referral_count, referral_credits, referral_reward_pending\")",
  "            .eq(\"referral_code\", buyer.referred_by).single();",
  "          if (referrer) {",
  "            /* Q2: only credit once per friend. The unique index on",
  "               referrals.referred_user_id enforces this at the DB level;",
  "               here we also guard the legacy users.referral_count bump",
  "               by checking the referrals row's current status. */",
  "            const { data: refRow } = await supabase",
  "              .from('referrals')",
  "              .select('id, status, paid_at, available_at')",
  "              .eq('referred_user_id', user_id)",
  "              .maybeSingle();",
  "            const now = new Date();",
  "            const availableAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);",
  "            if (refRow && refRow.status === 'applied') {",
  "              await supabase.from('referrals').update({",
  "                status: 'pending',",
  "                paid_at: now.toISOString(),",
  "                available_at: availableAt.toISOString()",
  "              }).eq('id', refRow.id);",
  "              const newCount = (referrer.referral_count || 0) + 1;",
  "              const updates = { referral_count: newCount };",
  "              if (newCount === 1) updates.referral_credits = (referrer.referral_credits || 0) + 3.00;",
  "              else updates.referral_reward_pending = \"choice\";",
  "              await supabase.from(\"users\").update(updates).eq(\"id\", referrer.id);",
  "            } else if (!refRow) {",
  "              /* Edge case: legacy users.referred_by set but no referrals row",
  "                 (e.g. data predating Patch 45a). Create a 'pending' row so",
  "                 the dashboard reflects this purchase. */",
  "              await supabase.from('referrals').insert({",
  "                referrer_user_id: referrer.id,",
  "                referred_user_id: user_id,",
  "                referral_code:    buyer.referred_by,",
  "                status:           'pending',",
  "                paid_at:          now.toISOString(),",
  "                available_at:     availableAt.toISOString()",
  "              });",
  "              const newCount = (referrer.referral_count || 0) + 1;",
  "              const updates = { referral_count: newCount };",
  "              if (newCount === 1) updates.referral_credits = (referrer.referral_credits || 0) + 3.00;",
  "              else updates.referral_reward_pending = \"choice\";",
  "              await supabase.from(\"users\").update(updates).eq(\"id\", referrer.id);",
  "            }",
  "            /* If refRow.status is already 'pending'/'available'/'consumed'",
  "               we do nothing  this is a renewal or a duplicate event. */",
  "          }",
  "        }"
].join('\n');

/* ========================================================================
 * EDIT 3  api/get-referral.js  — return the four numbers
 * ======================================================================*/

const GET_REF = path.join('api', 'get-referral.js');

const G_FIND = [
  "  const { data: user } = await supabase.from(\"users\").select(\"referral_code, referral_count, referral_credits, referral_reward_pending\").eq(\"id\", user_id).single();",
  "  if (!user) return res.status(404).json({ error: \"User not found\" });",
  "",
  "  return res.json({ success: true, ...user });",
  "};"
].join('\n');

const G_REPLACE = [
  "  const { data: user } = await supabase.from(\"users\").select(\"referral_code, referral_count, referral_credits, referral_reward_pending\").eq(\"id\", user_id).single();",
  "  if (!user) return res.status(404).json({ error: \"User not found\" });",
  "",
  "  /* TMC_PATCH45A: derive the four numbers from the referrals table. The",
  "     'available' flip happens lazily here  any row in status 'pending'",
  "     whose available_at has passed counts as available. We don't write",
  "     back the status change (a cron could, but it's not needed for",
  "     display correctness; Patch 45b will flip on consumption). */",
  "  const nowIso = new Date().toISOString();",
  "  const { data: rows } = await supabase",
  "    .from('referrals')",
  "    .select('status, credit_amount, available_at')",
  "    .eq('referrer_user_id', user_id);",
  "  let signups = 0, confirmed = 0, credit_available = 0, credit_pending = 0;",
  "  (rows || []).forEach(function (r) {",
  "    var amt = parseFloat(r.credit_amount) || 0;",
  "    if (r.status === 'applied') {",
  "      signups += 1;",
  "    } else if (r.status === 'pending') {",
  "      confirmed += 1;",
  "      if (r.available_at && r.available_at <= nowIso) credit_available += amt;",
  "      else                                            credit_pending += amt;",
  "    } else if (r.status === 'available') {",
  "      confirmed += 1;",
  "      credit_available += amt;",
  "    } else if (r.status === 'consumed') {",
  "      confirmed += 1;",
  "      /* consumed contributes to confirmed count but not to balances */",
  "    }",
  "    /* 'revoked' rows contribute to neither signups nor confirmed nor any balance */",
  "  });",
  "",
  "  return res.json({",
  "    success: true,",
  "    referral_code: user.referral_code,",
  "    referral_count: user.referral_count,                /* legacy */",
  "    referral_credits: user.referral_credits,            /* legacy */",
  "    referral_reward_pending: user.referral_reward_pending, /* legacy */",
  "    /* TMC_PATCH45A: new derived numbers */",
  "    signups,",
  "    confirmed,",
  "    credit_available: parseFloat(credit_available.toFixed(2)),",
  "    credit_pending:   parseFloat(credit_pending.toFixed(2))",
  "  });",
  "};"
].join('\n');

/* ========================================================================
 * EDIT 4  public/settings.html  — four-number modern UI
 *   Replace the referral card body + loadReferrals() display logic.
 * ======================================================================*/

const SETTINGS = path.join('public', 'settings.html');

/* 4a — replace the inner card (the stats area), keeping the input + Share Link */
const S_CARD_FIND = [
  "    <div style=\"display:flex;justify-content:space-between;align-items:center;margin-top:12px\">",
  "      <div style=\"text-align:center\"><div style=\"font-size:22px;font-weight:800;color:var(--or)\" id=\"ref-count\">0</div><div style=\"font-size:10px;color:#6B7280\">Friends referred</div></div>",
  "      <div id=\"ref-credits\" style=\"display:none;background:#DCFCE7;border-radius:10px;padding:6px 12px;font-size:12px;font-weight:700;color:#16A34A\"></div>",
  "    </div>",
  "    <div style=\"background:#FFF3EC;border-radius:10px;padding:10px 12px;margin-top:12px;font-size:11px;color:#FF6B00;font-weight:600\" id=\"ref-next\">Loading...</div>"
].join('\n');

const S_CARD_REPLACE = [
  "    <!-- TMC_PATCH45A: four-number stats grid -->",
  "    <div style=\"display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:14px\">",
  "      <div style=\"background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;padding:10px 12px\">",
  "        <div style=\"font-size:20px;font-weight:800;color:#111\" id=\"ref-signups\">0</div>",
  "        <div style=\"font-size:10px;color:#6B7280;margin-top:2px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em\">Friends signed up</div>",
  "      </div>",
  "      <div style=\"background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;padding:10px 12px\">",
  "        <div style=\"font-size:20px;font-weight:800;color:#111\" id=\"ref-confirmed\">0</div>",
  "        <div style=\"font-size:10px;color:#6B7280;margin-top:2px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em\">Bought a plan</div>",
  "      </div>",
  "      <div style=\"background:#DCFCE7;border:1px solid #BBF7D0;border-radius:10px;padding:10px 12px\">",
  "        <div style=\"font-size:20px;font-weight:800;color:#16A34A\" id=\"ref-available\">$0</div>",
  "        <div style=\"font-size:10px;color:#15803D;margin-top:2px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em\">Available</div>",
  "      </div>",
  "      <div style=\"background:#FFF3EC;border:1px solid #FED7AA;border-radius:10px;padding:10px 12px\">",
  "        <div style=\"font-size:20px;font-weight:800;color:#FF6B00\" id=\"ref-pending\">$0</div>",
  "        <div style=\"font-size:10px;color:#C2410C;margin-top:2px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em\">Pending (14d hold)</div>",
  "      </div>",
  "    </div>",
  "    <div style=\"background:#FFF3EC;border-radius:10px;padding:10px 12px;margin-top:12px;font-size:11px;color:#FF6B00;font-weight:600\" id=\"ref-next\">Loading...</div>"
].join('\n');

/* 4b — replace the loadReferrals display block to populate the four cards */
const S_DISP_FIND = [
  "    document.getElementById('ref-code').textContent = data.referral_code;",
  "    document.getElementById('ref-link').value = link;",
  "    document.getElementById('ref-count').textContent = (data.referral_count || 0);",
  "    if (data.referral_credits > 0) {",
  "      document.getElementById('ref-credits').textContent = '$' + parseFloat(data.referral_credits).toFixed(2) + ' discount earned';",
  "      document.getElementById('ref-credits').style.display = 'block';",
  "    }"
].join('\n');

const S_DISP_REPLACE = [
  "    /* TMC_PATCH45A: populate the four-number grid from the new fields,",
  "       falling back to legacy fields if get-referral hasn't been redeployed. */",
  "    document.getElementById('ref-code').textContent = data.referral_code;",
  "    document.getElementById('ref-link').value = link;",
  "    var signups   = (typeof data.signups   === 'number') ? data.signups   : 0;",
  "    var confirmed = (typeof data.confirmed === 'number') ? data.confirmed : (data.referral_count || 0);",
  "    var avail     = (typeof data.credit_available === 'number') ? data.credit_available : (data.referral_credits || 0);",
  "    var pending   = (typeof data.credit_pending   === 'number') ? data.credit_pending   : 0;",
  "    document.getElementById('ref-signups').textContent   = signups;",
  "    document.getElementById('ref-confirmed').textContent = confirmed;",
  "    document.getElementById('ref-available').textContent = '$' + parseFloat(avail).toFixed(2);",
  "    document.getElementById('ref-pending').textContent   = '$' + parseFloat(pending).toFixed(2);"
].join('\n');

/* ========================================================================
 * DRIVER
 * ======================================================================*/

log('\nTapMyCar  Patch 45a  referrals lifecycle');
log('Backup -> ' + BACKUP_DIR + '\n');

function backupAndWrite(file, original, updated) {
  const dest = path.join(BACKUP_DIR, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
  fs.writeFileSync(file, updated, 'utf8');
}

function patchFile(file, edits) {
  if (!fs.existsSync(file)) fail('expected file not found: ' + file);
  const original = fs.readFileSync(file, 'utf8');
  if (original.indexOf(MARKER) !== -1) {
    log(file + ': skip (already patched)');
    return false;
  }
  const wasCRLF = original.indexOf('\r\n') !== -1;
  let updated = original.replace(/\r\n/g, '\n');
  for (const e of edits) {
    const i = updated.indexOf(e.find);
    if (i === -1) fail('pattern NOT FOUND in ' + file + '  [' + e.label + ']');
    if (updated.indexOf(e.find, i + 1) !== -1) fail('pattern NOT UNIQUE in ' + file + '  [' + e.label + ']');
    updated = updated.replace(e.find, () => e.replace);
  }
  if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');
  backupAndWrite(file, original, updated);
  log(file + ': patched');
  return true;
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });
let changed = 0;

try {
  if (patchFile(REDEEM, [
    { label: 'redeem-code: insert applied row + duplicate-block', find: R_FIND, replace: R_REPLACE }
  ])) {
    execSync('node --check "' + REDEEM + '"', { stdio: 'pipe' });
    log('   - node --check OK');
    changed++;
  }
  if (patchFile(WEBHOOK, [
    { label: 'stripe-webhook: applied -> pending', find: W_FIND, replace: W_REPLACE }
  ])) {
    execSync('node --check "' + WEBHOOK + '"', { stdio: 'pipe' });
    log('   - node --check OK');
    changed++;
  }
  if (patchFile(GET_REF, [
    { label: 'get-referral: derive four numbers', find: G_FIND, replace: G_REPLACE }
  ])) {
    execSync('node --check "' + GET_REF + '"', { stdio: 'pipe' });
    log('   - node --check OK');
    changed++;
  }
  if (patchFile(SETTINGS, [
    { label: 'settings.html: four-number card',  find: S_CARD_FIND, replace: S_CARD_REPLACE },
    { label: 'settings.html: populate fields',   find: S_DISP_FIND, replace: S_DISP_REPLACE }
  ])) {
    /* sanity: the script block around loadReferrals should parse */
    const s = fs.readFileSync(SETTINGS, 'utf8');
    const i = s.indexOf('loadReferrals');
    if (i !== -1) {
      const a = s.lastIndexOf('<script>', i) + 8;
      const b = s.indexOf('</script>', i);
      fs.writeFileSync('/tmp/p45a-chk.js', s.slice(a, b));
      execSync('node --check /tmp/p45a-chk.js', { stdio: 'pipe' });
      log('   - settings.html script: node --check OK');
    }
    changed++;
  }
} catch (e) {
  fail(e && e.message);
}

log('');
if (changed === 0) {
  log('All files already patched. Nothing to do.\n');
} else {
  log('Done. Files changed: ' + changed + '\n');
  log('IMPORTANT  did you run patch45a-migration.sql in Supabase?');
  log('If not, the patched code will throw on insert into the referrals table.\n');
  log('NEXT STEPS:');
  log('  1. git add -A');
  log('  2. git commit -m "Patch 45a: referrals lifecycle (tracking + display)"');
  log('  3. git push  (wait ~60s for Vercel)');
  log('  4. Test (see verification notes).\n');
}
