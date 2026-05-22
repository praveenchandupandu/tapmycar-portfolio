// ============================================================================
// TapMyCar - Patch 42 (Notification System, STAGE 2): Compliance foundation
//
// PREREQUISITE
//   Run tapmycar-patch42-notifications-schema.sql in the Supabase SQL editor
//   FIRST. The code below references the new columns/tables.
//
// WHAT THIS PATCH DOES
//   1. api/save-push-subscription.js  - REWRITTEN. The old version always
//      returned {success:true} even when the database write failed (that is
//      what hid the broken push_subscriptions table in Stage 1). New version
//      surfaces real DB errors, and sets users.push_subscribed = true on a
//      successful save.
//   2. api/unsubscribe.js  - NEW. Public endpoint that toggles a user's
//      email_opt_out flag. Token-gated (verifies users.unsubscribe_token),
//      logs the change to notifications_log.
//   3. public/unsubscribe.html  - NEW. Public page marketing emails will link
//      to. Reads ?u=<user_id>&t=<token>, calls /api/unsubscribe, shows a
//      confirmation with a resubscribe option.
//   4. Syncs public/unsubscribe.html -> root.
//
//   No vercel.json change needed: unsubscribe.html is a static file and
//   /api/unsubscribe is covered by the existing /api/:path* rewrite.
//
// Properties: idempotent (safe to re-run), validates JS, backs up changed files.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const API = path.join(ROOT, 'api');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch42-${ts}`);

const log  = (s) => console.log(s);
const ok   = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function writeFile(p, content) {
  fs.writeFileSync(p, content, { encoding: 'utf8' }); // UTF-8, no BOM
}
function backup(absPath, label) {
  if (!fs.existsSync(absPath)) return;
  const dest = path.join(BACKUP_DIR, label);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(absPath, dest);
}
function checkJs(absPath, label) {
  try {
    execSync('node --check "' + absPath + '"', { stdio: 'pipe' });
    ok(label + ' passes node --check');
  } catch (e) {
    errExit(label + ' FAILED node --check:\n' + (e.stderr ? e.stderr.toString() : e.message));
  }
}

log('');
log('TapMyCar Patch 42 (Stage 2) - Compliance foundation');
log('===================================================');

// ----------------------------------------------------------------------------
// STEP 1 - rewrite api/save-push-subscription.js
// ----------------------------------------------------------------------------
log('');
log('Step 1 - api/save-push-subscription.js (surface DB errors)');

const SAVE_PUSH = [
  '// TMC_PATCH42_PUSHSUB - surfaces real DB errors instead of masking them,',
  '// and marks the user as push_subscribed on a successful save.',
  'const { createClient } = require("@supabase/supabase-js");',
  'const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);',
  '',
  'module.exports = async function handler(req, res) {',
  '  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });',
  '',
  '  const { user_id, endpoint, p256dh, auth } = req.body || {};',
  '  if (!user_id || !endpoint || !p256dh || !auth) {',
  '    return res.status(400).json({ error: "Missing fields" });',
  '  }',
  '',
  '  // Write the subscription. onConflict:"endpoint" requires the UNIQUE',
  '  // constraint on push_subscriptions.endpoint (created in Stage 1).',
  '  const { error } = await supabase',
  '    .from("push_subscriptions")',
  '    .upsert({ user_id, endpoint, p256dh, auth }, { onConflict: "endpoint" });',
  '',
  '  if (error) {',
  '    console.error("save-push-subscription error:", error.message);',
  '    return res.status(500).json({ error: error.message });',
  '  }',
  '',
  '  // Best-effort: flag the user as push-subscribed. Non-fatal if it fails.',
  '  try {',
  '    await supabase.from("users").update({ push_subscribed: true }).eq("id", user_id);',
  '  } catch (e) {',
  '    console.error("push_subscribed flag update failed:", e && e.message);',
  '  }',
  '',
  '  return res.json({ success: true });',
  '};',
  ''
].join('\n');

const savePushPath = path.join(API, 'save-push-subscription.js');
if (fs.existsSync(savePushPath) &&
    fs.readFileSync(savePushPath, 'utf8').indexOf('TMC_PATCH42_PUSHSUB') !== -1) {
  skip('api/save-push-subscription.js');
} else {
  backup(savePushPath, 'api/save-push-subscription.js');
  writeFile(savePushPath, SAVE_PUSH);
  checkJs(savePushPath, 'api/save-push-subscription.js');
  ok('Rewritten - DB errors now surfaced, push_subscribed flag set');
}

// ----------------------------------------------------------------------------
// STEP 2 - create api/unsubscribe.js
// ----------------------------------------------------------------------------
log('');
log('Step 2 - api/unsubscribe.js (NEW)');

const UNSUB_API = [
  '// TMC_PATCH42_UNSUBSCRIBE - public email unsubscribe / resubscribe endpoint.',
  '// POST { user_id, token, action }. Token must equal users.unsubscribe_token.',
  '// action "resubscribe" clears the opt-out; anything else sets it.',
  'const { createClient } = require("@supabase/supabase-js");',
  'const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);',
  '',
  'module.exports = async function handler(req, res) {',
  '  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });',
  '',
  '  const { user_id, token, action } = req.body || {};',
  '  if (!user_id || !token) return res.status(400).json({ error: "Missing user_id or token" });',
  '',
  '  const { data: user, error } = await supabase',
  '    .from("users")',
  '    .select("id, email, unsubscribe_token, email_opt_out")',
  '    .eq("id", user_id)',
  '    .single();',
  '',
  '  if (error || !user) return res.status(404).json({ error: "Not found" });',
  '  if (!user.unsubscribe_token || user.unsubscribe_token !== token) {',
  '    return res.status(403).json({ error: "Invalid unsubscribe link" });',
  '  }',
  '',
  '  // Default action = unsubscribe (opt OUT). "resubscribe" opts back in.',
  '  const optOut = action !== "resubscribe";',
  '',
  '  const { error: upErr } = await supabase',
  '    .from("users")',
  '    .update({ email_opt_out: optOut })',
  '    .eq("id", user_id);',
  '  if (upErr) {',
  '    console.error("unsubscribe update error:", upErr.message);',
  '    return res.status(500).json({ error: upErr.message });',
  '  }',
  '',
  '  // Audit the preference change. Non-fatal if logging fails.',
  '  try {',
  '    await supabase.from("notifications_log").insert({',
  '      channel: "email",',
  '      event_type: "system",',
  '      recipient_user_id: user_id,',
  '      recipient_contact: user.email || null,',
  '      subject: optOut ? "Email unsubscribe" : "Email resubscribe",',
  '      body_preview: optOut',
  '        ? "User opted out of marketing emails"',
  '        : "User opted back in to marketing emails",',
  '      sent_by: "system",',
  '      status: "sent"',
  '    });',
  '  } catch (e) {',
  '    console.error("notifications_log insert failed:", e && e.message);',
  '  }',
  '',
  '  return res.json({ success: true, email_opt_out: optOut });',
  '};',
  ''
].join('\n');

const unsubApiPath = path.join(API, 'unsubscribe.js');
if (fs.existsSync(unsubApiPath) &&
    fs.readFileSync(unsubApiPath, 'utf8').indexOf('TMC_PATCH42_UNSUBSCRIBE') !== -1) {
  skip('api/unsubscribe.js');
} else {
  backup(unsubApiPath, 'api/unsubscribe.js');
  writeFile(unsubApiPath, UNSUB_API);
  checkJs(unsubApiPath, 'api/unsubscribe.js');
  ok('Created api/unsubscribe.js');
}

// ----------------------------------------------------------------------------
// STEP 3 - create public/unsubscribe.html
// ----------------------------------------------------------------------------
log('');
log('Step 3 - public/unsubscribe.html (NEW)');

const UNSUB_HTML = [
  '<!DOCTYPE html>',
  '<!-- TMC_PATCH42_UNSUBSCRIBE -->',
  '<html lang="en">',
  '<head>',
  '  <meta charset="UTF-8">',
  '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
  '  <meta name="theme-color" content="#FF6B00">',
  '  <title>Email Preferences \u2014 TapMyCar</title>',
  '  <link rel="icon" type="image/x-icon" href="/favicon.ico">',
  '  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">',
  '  <link rel="apple-touch-icon" href="/apple-touch-icon.png">',
  '  <meta name="robots" content="noindex">',
  '  <style>',
  '    *{box-sizing:border-box;margin:0;padding:0}',
  '    body{font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif;',
  '      background:#F9FAFB;color:#111;min-height:100vh;display:flex;',
  '      align-items:center;justify-content:center;padding:24px}',
  '    .card{background:#fff;max-width:440px;width:100%;border-radius:18px;',
  '      border:1px solid #E5E7EB;padding:40px 32px;text-align:center;',
  '      box-shadow:0 4px 24px rgba(0,0,0,.05)}',
  '    .brand{font-size:22px;font-weight:800;margin-bottom:28px}',
  '    .brand span{color:#FF6B00}',
  '    .icon{width:54px;height:54px;border-radius:50%;margin:0 auto 18px;',
  '      display:flex;align-items:center;justify-content:center;',
  '      font-size:26px;font-weight:800}',
  '    .icon.ok{background:#DCFCE7;color:#16A34A}',
  '    .icon.err{background:#FEE2E2;color:#DC2626}',
  '    h1{font-size:20px;font-weight:800;margin-bottom:10px}',
  '    p{font-size:14px;color:#4B5563;line-height:1.65;margin-bottom:8px}',
  '    a{color:#FF6B00}',
  '    .msg{font-size:15px;color:#6B7280;padding:20px 0}',
  '    .btn-ghost{margin-top:20px;background:none;border:1px solid #E5E7EB;',
  '      color:#374151;font-size:13px;font-weight:600;padding:10px 18px;',
  '      border-radius:10px;cursor:pointer;font-family:inherit}',
  '    .btn-ghost:hover{background:#F9FAFB}',
  '    .foot{margin-top:26px;font-size:11px;color:#9CA3AF}',
  '  </style>',
  '</head>',
  '<body>',
  '  <div class="card">',
  '    <div class="brand">TapMyCar<span>.</span></div>',
  '    <div id="card"><div class="msg">Updating your email preferences\u2026</div></div>',
  '    <div class="foot">Praman Tech LLC \u00b7 Connecticut, USA</div>',
  '  </div>',
  '  <script>',
  '  (function(){',
  '    var p = new URLSearchParams(location.search);',
  '    var uid = p.get("u"); var tok = p.get("t");',
  '    var card = document.getElementById("card");',
  '    function render(state, optOut){',
  '      if(state === "loading"){',
  '        card.innerHTML = \'<div class="msg">Updating your email preferences\\u2026</div>\';',
  '        return;',
  '      }',
  '      if(state === "error"){',
  '        card.innerHTML =',
  '          \'<div class="icon err">!</div>\' +',
  '          \'<h1>Link not valid</h1>\' +',
  '          \'<p>This unsubscribe link is invalid or has expired. If you keep \' +',
  '          \'receiving unwanted emails, contact \' +',
  '          \'<a href="mailto:support@tapmycar.io">support@tapmycar.io</a>.</p>\';',
  '        return;',
  '      }',
  '      if(optOut){',
  '        card.innerHTML =',
  '          \'<div class="icon ok">&#10003;</div>\' +',
  '          \'<h1>You have been unsubscribed</h1>\' +',
  '          \'<p>You will no longer receive marketing or announcement emails \' +',
  '          \'from TapMyCar.</p>\' +',
  '          \'<p>Important account, billing and security emails are still sent \' +',
  '          \'\\u2014 these are required to operate your account.</p>\' +',
  '          \'<button id="toggle" class="btn-ghost">Changed your mind? Resubscribe</button>\';',
  '      } else {',
  '        card.innerHTML =',
  '          \'<div class="icon ok">&#10003;</div>\' +',
  '          \'<h1>You are resubscribed</h1>\' +',
  '          \'<p>You will receive TapMyCar product updates and announcements again.</p>\' +',
  '          \'<button id="toggle" class="btn-ghost">Unsubscribe</button>\';',
  '      }',
  '      var b = document.getElementById("toggle");',
  '      if(b) b.onclick = function(){ submit(optOut ? "resubscribe" : "unsubscribe"); };',
  '    }',
  '    function submit(action){',
  '      render("loading");',
  '      fetch("/api/unsubscribe", {',
  '        method: "POST",',
  '        headers: { "Content-Type": "application/json" },',
  '        body: JSON.stringify({ user_id: uid, token: tok, action: action })',
  '      }).then(function(r){ return r.json(); }).then(function(d){',
  '        if(d && d.success){ render("done", !!d.email_opt_out); }',
  '        else { render("error"); }',
  '      }).catch(function(){ render("error"); });',
  '    }',
  '    if(!uid || !tok){ render("error"); }',
  '    else { submit("unsubscribe"); }',
  '  })();',
  '  </script>',
  '</body>',
  '</html>',
  ''
].join('\n');

const unsubHtmlPub = path.join(PUBLIC, 'unsubscribe.html');
if (fs.existsSync(unsubHtmlPub) &&
    fs.readFileSync(unsubHtmlPub, 'utf8').indexOf('TMC_PATCH42_UNSUBSCRIBE') !== -1) {
  skip('public/unsubscribe.html');
} else {
  backup(unsubHtmlPub, 'public/unsubscribe.html');
  writeFile(unsubHtmlPub, UNSUB_HTML);
  ok('Created public/unsubscribe.html');
}

// ----------------------------------------------------------------------------
// STEP 4 - sync public/unsubscribe.html -> root
// ----------------------------------------------------------------------------
log('');
log('Step 4 - sync to root');
const unsubHtmlRoot = path.join(ROOT, 'unsubscribe.html');
backup(unsubHtmlRoot, 'root-unsubscribe.html');
fs.copyFileSync(unsubHtmlPub, unsubHtmlRoot);
ok('Synced unsubscribe.html -> root');

// ----------------------------------------------------------------------------
// DONE
// ----------------------------------------------------------------------------
log('');
log('===================================================');
log('Patch 42 (Stage 2) applied.');
if (fs.existsSync(BACKUP_DIR)) log('Backups: ' + path.basename(BACKUP_DIR));
log('');
log('  BEFORE PUSHING: confirm you have run');
log('  tapmycar-patch42-notifications-schema.sql in the Supabase SQL editor.');
log('  The new endpoints need those columns/tables to exist.');
log('');
log('  Then commit + push. After deploy, test the unsubscribe page like this:');
log('   1. In Supabase, grab a test user:');
log('        select id, unsubscribe_token from users limit 1;');
log('   2. Visit:  https://www.tapmycar.io/unsubscribe.html?u=<id>&t=<token>');
log('      -> should show "You have been unsubscribed".');
log('   3. In Supabase, confirm:  select email_opt_out from users where id=<id>;');
log('      -> should now be true. Click Resubscribe on the page to flip it back.');
log('   4. Try a bad token: ?u=<id>&t=wrong -> should show "Link not valid".');
log('');
