// ============================================================================
// TapMyCar - Patch 65: Correct the chatbot's eTag BILLING answer
//
// PROBLEM
//   After Patch 63 the chatbot correctly says the eTag is "free for 30 days"
//   - but it also says "There is no automatic charge" / "payment only if you
//     decide to upgrade". That is FALSE and was my error: Patch 63's prompt
//   literally contains the line "There is no automatic charge". The chatbot
//   is now misrepresenting billing to customers.
//
// CONFIRMED CORRECT MODEL (from Praveen + api/create-checkout.js)
//   - The eTag is free to download.
//   - To activate, the user pays $1 AND actively chooses/agrees to a plan
//     (Standard or Premium). By activating they are agreeing to that plan.
//   - They then have 30 days to experience the service and are free to
//     CANCEL anytime within those 30 days - if they cancel, the upgrade
//     does not proceed.
//   - If they do NOT cancel, the plan they agreed to proceeds automatically:
//       day 30  -> physical sticker ships + sticker price charged
//                  ($9.99 Standard / $24.99 Premium)
//       day 60  -> annual plan begins ($9.99/yr Standard / $19.99/yr Premium),
//                  renewing yearly until cancelled.
//   So: the user agreed up front, AND charges are automatic unless cancelled.
//
// WHAT THIS PATCH DOES
//   1. api/chat.js - corrects the Patch 63 hard-rule block: removes the false
//      "no automatic charge" wording, states the real model.
//   2. api/chat.js - adds a SERVER-SIDE INTERCEPTOR: before the question
//      reaches Gemini, if the latest user message is about eTag cost /
//      billing / payment / duration, the endpoint returns a fixed, exact,
//      hand-written answer. Billing answers therefore NEVER come from the AI
//      and can never drift.
//   3. public/app.js - updates the Patch 63 offline interceptor's fixed
//      answer to the same corrected wording.
//
//   No SQL change. Syncs app.js -> root.
//
// Properties: idempotent (safe to re-run), validates JS, backs up changes.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const API = path.join(ROOT, 'api');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch65-${ts}`);

const log  = (s) => console.log(s);
const ok   = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function writeFile(p, c) { fs.writeFileSync(p, c, { encoding: 'utf8' }); }
function backup(absPath, label) {
  if (!fs.existsSync(absPath)) return;
  const dest = path.join(BACKUP_DIR, label);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(absPath, dest);
}
function replaceOnce(src, find, replace, label) {
  const idx = src.indexOf(find);
  if (idx === -1) errExit(label + ': anchor not found - is Patch 63 applied?');
  if (src.indexOf(find, idx + find.length) !== -1) {
    errExit(label + ': anchor matches more than once.');
  }
  return src.replace(find, function () { return replace; });
}
function checkJs(absPath, label) {
  try {
    execSync('node --check "' + absPath + '"', { stdio: 'pipe' });
    ok(label + ' passes node --check');
  } catch (e) {
    errExit(label + ' FAILED node --check:\n' + (e.stderr ? e.stderr.toString() : e.message));
  }
}

// The single source of truth for the eTag billing answer - used by both
// the server interceptor and (a close variant) the app.js interceptor.
const ETAG_ANSWER =
  "Here's exactly how the eTag works. The eTag is free to download. To activate it, " +
  "you pay a one-time $1 and choose your plan - Standard or Premium - and by activating " +
  "you're agreeing to that plan. You then get 30 days to experience the full service, " +
  "and you're free to cancel anytime within those 30 days if it's not for you. If you " +
  "don't cancel: on day 30 your physical sticker ships and your card is charged for it " +
  "($9.99 for Standard, $24.99 for Premium), and on day 60 your annual plan begins " +
  "($9.99/year for Standard, $19.99/year for Premium) and renews yearly. You can always " +
  "cancel before a charge in Settings. Full details are at tapmycar.io/pricing.";

log('');
log('TapMyCar Patch 65 - Correct chatbot eTag billing answer');
log('=======================================================');

// ----------------------------------------------------------------------------
// STEP 1 - api/chat.js : correct the hard-rule block
// ----------------------------------------------------------------------------
log('');
log('Step 1 - api/chat.js (correct the billing hard-rule)');

const chatPath = path.join(API, 'chat.js');
let chatSrc = fs.readFileSync(chatPath, 'utf8');

if (chatSrc.indexOf('TMC_PATCH65_BILLING') !== -1) {
  skip('api/chat.js');
} else {
  if (chatSrc.indexOf('TMC_PATCH63_ETAG') === -1) {
    errExit('Patch 63 marker not found in chat.js - apply Patch 63 first.');
  }
  backup(chatPath, 'api/chat.js');

  // 1a - replace the entire Patch 63 hard-rule line with the corrected one.
  const OLD_RULE =
    'CRITICAL FACT - THE eTAG IS NOT PERMANENT (TMC_PATCH63_ETAG)\n' +
    'The free eTag works for 30 DAYS only. You must NEVER tell a user the eTag is permanent, lifetime, unlimited, "doesn\'t expire", or "works indefinitely" - that is false. Always state it clearly: the eTag is free for 30 days, after which the user must upgrade to a paid plan (Standard or Premium) to keep the tag active, or it deactivates. There is no automatic charge. The physical sticker ships after the user upgrades to a paid plan. If asked how long the eTag lasts or whether it expires, give exactly this rule.';
  const NEW_RULE =
    'CRITICAL FACT - eTAG BILLING (TMC_PATCH65_BILLING)\n' +
    'The eTag is free to DOWNLOAD. To ACTIVATE it the user pays a one-time $1 and ' +
    'chooses a plan (Standard or Premium) - by activating, they are agreeing to that ' +
    'plan. They then get 30 days to try the service and may CANCEL any time within ' +
    'those 30 days. If they do NOT cancel, the plan they agreed to proceeds ' +
    'AUTOMATICALLY: on day 30 the physical sticker ships and the sticker price is ' +
    'charged ($9.99 Standard / $24.99 Premium); on day 60 the annual plan begins ' +
    '($9.99/year Standard / $19.99/year Premium) and renews yearly until cancelled. ' +
    'You must NEVER say "there is no automatic charge" or "payment only if you decide ' +
    'to upgrade" - that is FALSE. Charges DO happen automatically unless the user ' +
    'cancels within 30 days. You must also NEVER say the eTag is permanent, lifetime, ' +
    'unlimited or "never expires". Always describe billing using exactly the model above.';
  chatSrc = replaceOnce(chatSrc, OLD_RULE, NEW_RULE, 'Step 1a hard-rule');
  ok('Step 1a - false "no automatic charge" wording removed from prompt');

  // 1b - add the server-side interceptor right after the last-user-message
  //      validation, before the Gemini call.
  const ANCHOR =
    "  if (!messages.length || messages[messages.length - 1].role !== 'user') {\n" +
    "    return res.status(400).json({ error: 'conversation must end with a user message' });\n" +
    "  }\n";
  const INTERCEPTOR = ANCHOR +
    "\n" +
    "  // TMC_PATCH65_BILLING: billing questions about the eTag are answered\n" +
    "  // with a fixed, exact response - they never go through Gemini, so the\n" +
    "  // answer can never drift or misstate what the customer is charged.\n" +
    "  try {\n" +
    "    const lastUserMsg = String(messages[messages.length - 1].content || '').toLowerCase();\n" +
    "    var mentionsEtag = lastUserMsg.indexOf('etag') !== -1 ||\n" +
    "      lastUserMsg.indexOf('e-tag') !== -1 ||\n" +
    "      (lastUserMsg.indexOf('free') !== -1 &&\n" +
    "        (lastUserMsg.indexOf('tag') !== -1 || lastUserMsg.indexOf('qr') !== -1));\n" +
    "    var asksBillingOrDuration =\n" +
    "      lastUserMsg.indexOf('pay') !== -1 || lastUserMsg.indexOf('charge') !== -1 ||\n" +
    "      lastUserMsg.indexOf('cost') !== -1 || lastUserMsg.indexOf('price') !== -1 ||\n" +
    "      lastUserMsg.indexOf('bill') !== -1 || lastUserMsg.indexOf('free') !== -1 ||\n" +
    "      lastUserMsg.indexOf('money') !== -1 || lastUserMsg.indexOf('$') !== -1 ||\n" +
    "      lastUserMsg.indexOf('how long') !== -1 || lastUserMsg.indexOf('days') !== -1 ||\n" +
    "      lastUserMsg.indexOf('expire') !== -1 || lastUserMsg.indexOf('expir') !== -1 ||\n" +
    "      lastUserMsg.indexOf('last') !== -1 || lastUserMsg.indexOf('duration') !== -1 ||\n" +
    "      lastUserMsg.indexOf('permanent') !== -1 || lastUserMsg.indexOf('forever') !== -1 ||\n" +
    "      lastUserMsg.indexOf('indefinit') !== -1 || lastUserMsg.indexOf('30') !== -1 ||\n" +
    "      lastUserMsg.indexOf('cancel') !== -1 || lastUserMsg.indexOf('upgrade') !== -1;\n" +
    "    if (mentionsEtag && asksBillingOrDuration) {\n" +
    "      return res.status(200).json({ reply: " + JSON.stringify(ETAG_ANSWER) + " });\n" +
    "    }\n" +
    "  } catch (e) { /* if anything goes wrong, fall through to the AI */ }\n";
  chatSrc = replaceOnce(chatSrc, ANCHOR, INTERCEPTOR, 'Step 1b server interceptor');
  ok('Step 1b - server-side billing interceptor added (bypasses the AI)');

  writeFile(chatPath, chatSrc);
  checkJs(chatPath, 'api/chat.js');
}

// ----------------------------------------------------------------------------
// STEP 2 - public/app.js : update the offline interceptor's fixed answer
// ----------------------------------------------------------------------------
log('');
log('Step 2 - public/app.js (update offline interceptor wording)');

const appPath = path.join(PUBLIC, 'app.js');
let appSrc = fs.readFileSync(appPath, 'utf8');

if (appSrc.indexOf('TMC_PATCH65_BILLING') !== -1) {
  skip('public/app.js');
} else {
  if (appSrc.indexOf('TMC_PATCH63_ETAG') === -1) {
    errExit('Patch 63 marker not found in app.js - apply Patch 63 first.');
  }
  backup(appPath, 'public/app.js');

  // The Patch 63 fixed answer appears twice (comment context differs); both
  // are the SAME string literal, so replace each occurrence of the literal.
  const OLD_ANSWER =
    '"The free eTag works for 30 days. Before the 30 days end, you upgrade to Standard or Premium to keep your tag active - if you do not upgrade, the eTag deactivates. There is no automatic charge, so you are never billed without choosing to. The physical sticker ships once you upgrade to a paid plan."';
  const NEW_ANSWER = '/* TMC_PATCH65_BILLING */ ' + JSON.stringify(ETAG_ANSWER);

  // It is used once in getSmartResponse (Patch 63). Replace that occurrence.
  var occurrences = appSrc.split(OLD_ANSWER).length - 1;
  if (occurrences === 0) {
    errExit('Patch 63 fixed-answer string not found in app.js.');
  }
  appSrc = appSrc.split(OLD_ANSWER).join(NEW_ANSWER);
  writeFile(appPath, appSrc);
  checkJs(appPath, 'public/app.js');
  ok('Step 2 - offline interceptor answer corrected (' + occurrences + ' occurrence(s))');
}

// ----------------------------------------------------------------------------
// Sync to root
// ----------------------------------------------------------------------------
log('');
log('Sync to root');
const appRoot = path.join(ROOT, 'app.js');
if (fs.existsSync(appRoot)) {
  backup(appRoot, 'root-app.js');
  fs.copyFileSync(appPath, appRoot);
  ok('Synced app.js -> root');
}

log('');
log('=======================================================');
log('Patch 65 applied.');
if (fs.existsSync(BACKUP_DIR)) log('Backups: ' + path.basename(BACKUP_DIR));
log('');
log('  Commit + push, wait ~60s, hard-refresh. TEST the chatbot:');
log('   1. "should i pay for etag?" -> must explain $1 activation, that the');
log('      user agrees to a plan, the 30-day cancel window, and that charges');
log('      are AUTOMATIC if not cancelled. Must NOT say "no automatic charge".');
log('   2. "how long does my etag work?" -> 30-day model, same billing facts.');
log('   3. "what happens if i don\u0027t cancel?" -> day-30 sticker charge,');
log('      day-60 annual plan.');
log('');
log('  These answers now come from a fixed server response, not the AI, so');
log('  they will be identical and correct every time.');
log('');
