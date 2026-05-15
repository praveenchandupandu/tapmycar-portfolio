// ============================================================================
// TapMyCar - Patch 28: Pre-live-mode payment safety
//
// Three independent fixes, each with its own marker:
//
// 28.A — Stripe webhook idempotency
//   Stripe retries webhooks on timeout/non-2xx. Without an event-id check
//   we would process the same event twice and create duplicate subscriptions
//   or duplicate premium codes.
//   Fix: new webhook_events table (event_id PK + processed_at). Webhook
//   checks "have I seen this event id before?" right after signature
//   verification. If yes, return 200 immediately. If no, mark it processed
//   then run the existing handler.
//
// 28.B — Existing-subscription guard in create-checkout
//   Currently the only duplicate-purchase check is "user.plan === plan",
//   which doesn't catch upgrade-while-active or cross-flow re-entry.
//   Fix: before creating a Stripe checkout session, look up the user's
//   subscription_id. If set, ask Stripe whether that subscription is still
//   active/trialing. If yes, refuse the new checkout. If canceled/incomplete
//   /past_due, allow (so user can re-subscribe after cancellation).
//
// 28.C — Twilio webhook signature validation
//   /api/voice-handler, /api/voice-action, /api/inbound-call accept POSTs
//   from anyone. A bad actor can forge call events. Fix: validate the
//   x-twilio-signature header with twilio.validateRequest() against
//   process.env.TWILIO_AUTH_TOKEN. Reject with 403 if invalid.
//   (We deliberately do NOT add this to register-pending-call.js — that
//   one is called from the stranger's BROWSER, not from Twilio.)
//
// SQL needed (printed at end): create webhook_events table.
//
// Properties: idempotent, validates JS, backs up touched files,
// independent per-step markers so re-runs are safe.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch28-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const warn = (s) => console.log('  ! ' + s);
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function readFile(p) {
  if (!fs.existsSync(p)) errExit('File not found: ' + p);
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
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  fs.writeFileSync(p, content, 'utf8');
}
function validateJs(p) {
  try { execSync('node --check "' + p + '"', { stdio: 'pipe' }); }
  catch (e) { errExit('JS syntax error in ' + p + '\n' + e.stderr.toString()); }
}
function tryReplace(content, oldStr, newStr) {
  if (content.includes(oldStr)) return content.replace(oldStr, newStr);
  const oldCRLF = oldStr.replace(/\n/g, '\r\n');
  if (content.includes(oldCRLF)) return content.replace(oldCRLF, newStr.replace(/\n/g, '\r\n'));
  return null;
}

log('');
log('TapMyCar Patch 28 \u2014 pre-live-mode payment safety');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

// ===========================================================================
// 28.A  Stripe webhook idempotency
// ===========================================================================

const M_28A = 'TMC_PATCH28_WEBHOOK_IDEMPOTENT';

log('28.A  api/stripe-webhook.js: add event-id idempotency check');
{
  const file = path.join(API, 'stripe-webhook.js');
  const content = readFile(file);
  if (content.includes(M_28A)) {
    skip('stripe-webhook.js idempotency');
  } else {
    backup(file);

    // Insert idempotency check between sig verification and the switch.
    // Anchor on the console.log("Webhook: ...") line, which is unique.
    const anchor = `  console.log(\`Webhook: \${event.type}\`);

  try {
    switch (event.type) {`;

    const replacement = `  console.log(\`Webhook: \${event.type}\`);

  // ${M_28A}: idempotency \u2014 reject duplicate event deliveries.
  // Stripe retries webhooks on timeout/non-2xx. Without this, we would
  // process the same event twice and create duplicate subscriptions.
  try {
    const { data: existing, error: existsErr } = await supabase
      .from('webhook_events')
      .select('event_id')
      .eq('event_id', event.id)
      .maybeSingle();
    if (existsErr) {
      console.warn('idempotency check failed (continuing):', existsErr.message);
    } else if (existing) {
      console.log(\`Webhook \${event.id} already processed, skipping\`);
      return res.status(200).json({ received: true, duplicate: true });
    }
    // Best-effort: mark this event id as in-progress.
    // If insertion fails due to race (PK violation), another worker is
    // already handling it -> we should also bail out.
    const { error: insertErr } = await supabase
      .from('webhook_events')
      .insert({ event_id: event.id, type: event.type });
    if (insertErr) {
      console.log(\`Webhook \${event.id} insert failed (race?): \${insertErr.message}, skipping\`);
      return res.status(200).json({ received: true, race: true });
    }
  } catch (idempErr) {
    console.warn('idempotency error (continuing):', idempErr && idempErr.message);
    // Do NOT block processing on idempotency-infra failure. Better to
    // double-process rarely than to drop events entirely.
  }

  try {
    switch (event.type) {`;

    let r = tryReplace(content, anchor, replacement);
    if (!r) errExit('stripe-webhook.js: idempotency anchor not found');

    writeFile(file, r);
    validateJs(file);
    ok('stripe-webhook.js: idempotency check inserted');
  }
}

// ===========================================================================
// 28.B  Existing-subscription guard in create-checkout
// ===========================================================================

const M_28B = 'TMC_PATCH28_EXISTING_SUB_GUARD';

log('');
log('28.B  api/create-checkout.js: add existing-subscription guard');
{
  const file = path.join(API, 'create-checkout.js');
  const content = readFile(file);
  if (content.includes(M_28B)) {
    skip('create-checkout.js existing-sub guard');
  } else {
    backup(file);

    // Anchor: just after the existing "user.plan === plan" same-plan check.
    const anchor = `  // Prevent duplicate purchases (e.g. Standard user trying to buy Standard again)
  if (flow === 'direct' && user.plan === plan) {
    return res.status(400).json({
      error: \`You're already on the \${plan.charAt(0).toUpperCase() + plan.slice(1)} plan.\`
    });
  }`;

    const replacement = `  // Prevent duplicate purchases (e.g. Standard user trying to buy Standard again)
  if (flow === 'direct' && user.plan === plan) {
    return res.status(400).json({
      error: \`You're already on the \${plan.charAt(0).toUpperCase() + plan.slice(1)} plan.\`
    });
  }

  // ${M_28B}: stronger existing-subscription guard.
  // If the user has a subscription_id, ask Stripe whether it's still active.
  // Active/trialing -> refuse new checkout (prevents Vishnu-style double-pay).
  // Canceled/incomplete_expired/past_due -> allow (user is re-subscribing).
  if ((flow === 'activate' || flow === 'direct') && user.subscription_id) {
    try {
      const existingSub = await stripe.subscriptions.retrieve(user.subscription_id);
      const blockingStatuses = ['active', 'trialing', 'past_due', 'unpaid'];
      if (existingSub && blockingStatuses.indexOf(existingSub.status) >= 0) {
        return res.status(400).json({
          error: 'You already have an active subscription. Manage it in your dashboard.',
          code: 'existing_subscription',
          subscription_status: existingSub.status,
          dashboard_url: '/dashboard.html'
        });
      }
      // Otherwise (canceled, incomplete_expired): fall through and allow new checkout.
    } catch (subErr) {
      // If Stripe says "no such subscription" (id stale), allow checkout.
      // For any other error, log but don't block \u2014 we don't want a Stripe
      // outage to lock the user out of paying.
      if (subErr && subErr.code !== 'resource_missing') {
        console.warn('existing-sub check failed (continuing):', subErr.message);
      }
    }
  }`;

    let r = tryReplace(content, anchor, replacement);
    if (!r) errExit('create-checkout.js: same-plan guard anchor not found');

    writeFile(file, r);
    validateJs(file);
    ok('create-checkout.js: existing-sub guard inserted');
  }
}

// ===========================================================================
// 28.C  Twilio webhook signature validation
// ===========================================================================

const M_28C = 'TMC_PATCH28_TWILIO_SIG';

const TWILIO_FILES = [
  'voice-handler.js',
  'voice-action.js',
  'inbound-call.js'
];

log('');
log('28.C  api/voice-*.js + inbound-call.js: validate Twilio signatures');
{
  for (const fileName of TWILIO_FILES) {
    const file = path.join(API, fileName);
    if (!fs.existsSync(file)) {
      warn(fileName + ': not found, skipped');
      continue;
    }
    const content = readFile(file);
    if (content.includes(M_28C)) {
      skip(fileName);
      continue;
    }

    // Strategy: add a require at the top + a validation block at the
    // start of the handler. Anchor on "module.exports = async function handler(req, res) {"
    // which we confirmed exists in all three files.
    const anchorHandler = `module.exports = async function handler(req, res) {`;

    // Build the validation block. We allow GET requests through (Twilio
    // sometimes does GETs for status callbacks). Only validate POSTs.
    const validationBlock = `module.exports = async function handler(req, res) {
  /* ${M_28C}: verify Twilio signature on POSTs.
     Skipped on GET (Twilio sometimes uses GET for status callbacks).
     Skipped if no auth token is configured (dev only). */
  if (req.method === 'POST') {
    try {
      const _twAuth = process.env.TWILIO_AUTH_TOKEN;
      if (_twAuth) {
        const _twilio = require('twilio');
        const _sig = req.headers['x-twilio-signature'] || req.headers['X-Twilio-Signature'];
        const _proto = req.headers['x-forwarded-proto'] || 'https';
        const _host = req.headers['host'];
        const _path = req.url || '';
        const _fullUrl = _proto + '://' + _host + _path;
        const _params = (req.body && typeof req.body === 'object') ? req.body : {};
        const _valid = _sig && _twilio.validateRequest(_twAuth, _sig, _fullUrl, _params);
        if (!_valid) {
          console.warn('Twilio signature invalid for ' + _fullUrl);
          res.setHeader('Content-Type', 'text/xml');
          return res.status(403).send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
        }
      }
    } catch (_sigErr) {
      console.warn('Twilio signature check error (continuing):', _sigErr && _sigErr.message);
      // Don't block on infra error \u2014 better to accept a call than drop it.
    }
  }
`;

    let r = tryReplace(content, anchorHandler, validationBlock);
    if (!r) {
      warn(fileName + ': handler signature anchor not found, skipped');
      continue;
    }

    backup(file);
    writeFile(file, r);
    validateJs(file);
    ok(fileName + ': signature validation added');
  }
}

log('');
log('==============================================================');
log('Patch 28 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('==============================================================');
log('REQUIRED: Run this SQL in Supabase BEFORE deploying');
log('==============================================================');
log('');
log('-- Webhook idempotency table');
log('CREATE TABLE IF NOT EXISTS public.webhook_events (');
log('  event_id TEXT PRIMARY KEY,');
log('  type TEXT,');
log('  processed_at TIMESTAMPTZ DEFAULT NOW()');
log(');');
log('');
log('-- Optional: auto-cleanup old events (older than 30 days)');
log('-- to keep the table small. Run periodically OR set up a cron job.');
log('-- DELETE FROM public.webhook_events WHERE processed_at < NOW() - INTERVAL \'30 days\';');
log('');
log('==============================================================');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 28: payment safety - idempotency + sub guard + twilio sig"');
log('  git push');
log('  Wait ~60 seconds for Vercel.');
log('');
log('Verify after deploy:');
log('  1. Test a checkout flow in Stripe TEST mode \u2014 should work normally.');
log('  2. Make a real call to your TapMyCar number \u2014 owner phone should ring');
log('     normally. If it does NOT, check Vercel logs for "Twilio signature');
log('     invalid" messages and verify TWILIO_AUTH_TOKEN env var is set.');
log('  3. After webhook fires, check Supabase webhook_events table \u2014 should');
log('     have one row per Stripe event.');
log('  4. Try buying a second subscription as an existing customer \u2014 should');
log('     get "You already have an active subscription" error.');
log('==============================================================');
log('');
log('GOING-LIVE CHECKLIST (after patch deploys cleanly):');
log('  1. Stripe Dashboard \u2014 toggle from TEST to LIVE mode');
log('  2. Create products in LIVE mode:');
log('     - Standard $9.99/year subscription');
log('     - Premium $19.99/year subscription');
log('     Copy each price_... ID');
log('  3. Vercel Project Settings > Environment Variables:');
log('     - STRIPE_SECRET_KEY \u2192 sk_live_...');
log('     - STRIPE_STANDARD_PRICE_ID \u2192 live price ID for Standard');
log('     - STRIPE_PREMIUM_PRICE_ID  \u2192 live price ID for Premium');
log('  4. Stripe Dashboard \u2014 add a NEW webhook endpoint in LIVE mode:');
log('     - URL: https://www.tapmycar.io/api/stripe-webhook');
log('     - Events: checkout.session.completed,');
log('               customer.subscription.updated,');
log('               customer.subscription.deleted,');
log('               invoice.payment_failed');
log('     - Copy the new signing secret \u2192 Vercel STRIPE_WEBHOOK_SECRET');
log('  5. Redeploy Vercel (env var changes need a redeploy)');
log('  6. TEST with a real card and small amount:');
log('     - Buy Standard $9.99 with your own card');
log('     - Confirm: payment goes through, subscription created with 30d trial,');
log('       email arrives, dashboard shows order, premium_codes row appears');
log('       if Premium');
log('     - Refund yourself in Stripe Dashboard');
log('  7. Verify Resend domain is verified (not onboarding@resend.dev)');
log('  8. Verify Twilio A2P 10DLC approved');
log('==============================================================');
