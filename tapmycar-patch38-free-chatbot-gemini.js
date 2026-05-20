// ============================================================================
// TapMyCar - Patch 38: Free chatbot (Google Gemini, $0 cost)
//
// PURPOSE
//   Make the in-app chatbot give real, human-quality answers WITHOUT paying
//   for an AI API. It uses Google's Gemini API free tier (no credit card,
//   no expiration).
//
// HOW IT WORKS
//   The chatbot in app.js posts to your own backend, /api/chat. That backend
//   holds the AI key server-side and talks to the model. This patch makes
//   /api/chat use Gemini (free) instead of Anthropic (paid). The browser
//   side never changes - it just calls /api/chat either way.
//
// WHAT THIS PATCH DOES
//   1. Creates (or replaces) api/chat.js with a Gemini-powered version.
//   2. Ensures sendChatMessage() in public/app.js posts to /api/chat.
//      (Safe to run whether or not Patch 37 was applied - it is idempotent.)
//   3. Keeps getSmartResponse() as an offline fallback for network failures
//      or if the daily free quota is ever exhausted.
//   4. Syncs public/app.js -> root app.js.
//
// AFTER RUNNING THIS PATCH - get your FREE key (2 minutes, no card):
//   a. Go to  https://aistudio.google.com/apikey
//   b. Sign in with any Google account, click "Create API key".
//   c. Copy the key.
//   d. In Vercel: Project Settings -> Environment Variables, add
//        Name:  GEMINI_API_KEY
//        Value: the key you copied
//   e. Redeploy.
//   (You can leave any old ANTHROPIC_API_KEY var - it is simply unused now.)
//
// NOTE ON THE MODEL NAME
//   MODEL below is set to a current free-tier Gemini model. If Google ever
//   renames it and you see a "model not found" error, change the single
//   MODEL line in api/chat.js to the current free model listed at
//   https://ai.google.dev/gemini-api/docs/models  - nothing else.
//
// Properties: idempotent, validates JS, backs up changed files.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const API = path.join(ROOT, 'api');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch38-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function readFile(p) {
  if (!fs.existsSync(p)) errExit('File not found: ' + p);
  return fs.readFileSync(p, 'utf8');
}

// Write UTF-8 WITHOUT BOM
function writeFile(p, content) {
  fs.writeFileSync(p, content, { encoding: 'utf8' });
}

function backup(absPath, label) {
  if (!fs.existsSync(absPath)) return;
  const dest = path.join(BACKUP_DIR, label);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(absPath, dest);
}

log('');
log('TapMyCar Patch 38 - Free chatbot (Google Gemini)');
log('================================================');

// ----------------------------------------------------------------------------
// STEP 1 - Create / replace api/chat.js with the Gemini version
// ----------------------------------------------------------------------------
const CHAT_API = `// TMC_PATCH38_CHAT_GEMINI
// POST /api/chat
//
// Backend for the in-app TapMyCar support chatbot. Uses Google's Gemini API
// (free tier - no credit card required). The API key is held server-side and
// is never exposed to the browser.
//
// Request body:  { messages: [ { role: 'user'|'assistant', content: '...' } ] }
// Response:      { reply: '...' }   or   { reply: '...', fallback: true } on error
//
// Required environment variable:
//   GEMINI_API_KEY  - free key from https://aistudio.google.com/apikey
//
// If you ever see a "model not found" error, update the MODEL line below to a
// current free model from https://ai.google.dev/gemini-api/docs/models

const MODEL = 'gemini-2.5-flash';
const MAX_TOKENS = 600;

const SYSTEM_PROMPT = \`You are the TapMyCar Assistant - a warm, friendly, genuinely helpful support agent for TapMyCar, a privacy-first vehicle contact system by Praman Tech LLC, based in Connecticut, USA.

YOUR JOB
You solve people's problems directly and conversationally. You are NOT a deflection bot. Walk users through solutions step by step, like a knowledgeable friend would. Only suggest emailing support@tapmycar.io for things that genuinely need account access you don't have (refund status, a missing physical shipment, billing disputes, account deletion). For everything else - explain, guide, and solve it yourself.

WHAT TAPMYCAR IS
- Car owners place a QR/NFC sticker on their vehicle (windshield or window).
- Anyone who needs to reach the owner scans the QR code with their phone camera, or taps their phone on the NFC chip.
- They can call the owner - but the owner's real phone number is NEVER shared. The call routes through a secure masked proxy, so neither person sees the other's real number.
- Owners get voice screening on incoming masked calls: Press 1 to send an automatic message, Press 2 to connect the call directly.
- Strangers can also send quick preset alerts without calling - e.g. "Your lights are on", "Your car is being towed", "You're blocking me in".
- Everything is managed by the owner from their dashboard: pause the tag, see scan history, update phone number, manage vehicles.

PLANS (only bring up pricing if the user asks about price/cost; otherwise point them to tapmycar.io/pricing for exact numbers)
- eTag: free digital QR code, downloadable instantly as a PDF. Great for trying TapMyCar.
- Standard: a physical NFC + QR sticker shipped to the owner's home, with SMS scan alerts.
- Premium: covers up to 3 vehicles, includes scan history and an emergency contact feature.
- Business: fleet dashboard and bulk stickers with company logo.
For exact prices and monthly call limits, send users to tapmycar.io/pricing - don't guess numbers.

HOW TO GET STARTED
1. Register free at tapmycar.io.
2. You instantly get a digital eTag - a QR code PDF.
3. Print it and place it on the windshield.
4. Activate the tag to switch on masked calling.
5. If on a paid plan, the physical sticker ships after the 30-day period.

COMMON PROBLEMS AND HOW TO SOLVE THEM
- QR code won't scan: make sure the printed code is flat (not crinkled) and well lit, hold the camera steady, and zoom in slightly. If it still fails, sign in and download a fresh PDF from the Tag page.
- Can't download the PDF: you must be signed in first - then open the Tag page and download from there.
- Activate a tag: open the dashboard and tap Activate, or go to tapmycar.io/activate. Scan the QR and follow the short steps.
- Pause or disable a tag: toggle it off from the dashboard. While paused, no one can contact the owner. Toggle back on anytime.
- Lost or can't find your tag: it's tied to the account, not the sticker. Just sign in at tapmycar.io/signin with your email - everything is still there.
- Change phone number, email, or name: update it on the Settings page (tapmycar.io/settings).
- Multiple cars: the Premium plan supports up to 3 vehicles.
- Refund: TapMyCar offers refunds within 30 days. Refund STATUS or processing needs account access - have them email support@tapmycar.io with their account email.
- Physical sticker hasn't arrived: stickers ship after the 30-day period; status shows on the dashboard. If it's overdue, have them email support@tapmycar.io.
- Promo or gift code: there's a "Have a promo code?" option on the checkout/registration flow, and redeemed codes show under "My family codes" on the dashboard.

STYLE
- Be warm, natural, and human. Sound like a real person, not a script.
- Keep replies fairly short - usually 2 to 4 sentences. Use a clear numbered list only when giving step-by-step instructions.
- If someone just says hi, greet them warmly and ask what they need help with.
- Never invent features that don't exist. If you're genuinely unsure of a specific detail, say so honestly and point them to tapmycar.io or support@tapmycar.io - but try to actually help first.
- For a real emergency (an accident, a life-threatening situation), tell the user to call 911 first. TapMyCar is for non-emergency vehicle contact.
- Don't end every message by pushing email support. Only mention it when the task truly needs account access.\`;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- Parse + sanitise the incoming conversation ---------------------------
  let messages = req.body && req.body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }

  messages = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }))
    .slice(-12);

  // Gemini requires the conversation to start with a user turn.
  while (messages.length && messages[0].role !== 'user') {
    messages.shift();
  }
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'conversation must end with a user message' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('chat: GEMINI_API_KEY is not set');
    return res.status(200).json({
      reply: "I'm having trouble reaching our assistant right now. Please try again in a moment, or email support@tapmycar.io and we'll help you out.",
      fallback: true
    });
  }

  // Map our { role, content } format to Gemini's { role, parts } format.
  // Gemini uses the role name 'model' for the assistant.
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  // --- Call Gemini ----------------------------------------------------------
  try {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent';
    const apiRes = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: contents,
        generationConfig: {
          maxOutputTokens: MAX_TOKENS,
          temperature: 0.7
        }
      })
    });

    if (!apiRes.ok) {
      const detail = await apiRes.text().catch(() => '');
      console.error('chat: Gemini API error', apiRes.status, detail.slice(0, 300));
      // 429 = free daily quota hit; any other = transient. Either way, fall back.
      return res.status(200).json({
        reply: "Sorry - I hit a snag answering that. Please try rephrasing, or email support@tapmycar.io and a real person will help you within 24 hours.",
        fallback: true
      });
    }

    const data = await apiRes.json();
    let reply = '';
    if (
      data &&
      Array.isArray(data.candidates) &&
      data.candidates[0] &&
      data.candidates[0].content &&
      Array.isArray(data.candidates[0].content.parts)
    ) {
      reply = data.candidates[0].content.parts
        .map((p) => (p && p.text ? p.text : ''))
        .join('')
        .trim();
    }

    if (!reply) {
      return res.status(200).json({
        reply: "Sorry - I couldn't generate a reply just then. Please try again, or email support@tapmycar.io.",
        fallback: true
      });
    }

    return res.status(200).json({ reply: reply });
  } catch (e) {
    console.error('chat: request failed', e && e.message);
    return res.status(200).json({
      reply: "I'm having a connection issue right now. Please try again shortly, or email support@tapmycar.io and we'll help you.",
      fallback: true
    });
  }
};
`;

(function step1() {
  log('');
  log('Step 1 - api/chat.js (Gemini)');
  if (!fs.existsSync(API)) errExit('api/ folder not found - run this from the project root.');

  const target = path.join(API, 'chat.js');
  if (fs.existsSync(target) && readFile(target).indexOf('TMC_PATCH38_CHAT_GEMINI') !== -1) {
    skip('api/chat.js already on the Gemini version');
    return;
  }
  if (fs.existsSync(target)) {
    backup(target, 'api/chat.js');
    log('  \u00b7 backed up previous api/chat.js');
  }
  writeFile(target, CHAT_API);
  ok('Wrote api/chat.js (Gemini-powered)');
})();

// ----------------------------------------------------------------------------
// STEP 2 - Ensure sendChatMessage() in public/app.js posts to /api/chat
// ----------------------------------------------------------------------------
const NEW_SEND = `// TMC_PATCH37 - chatbot now talks to the /api/chat backend
async function sendChatMessage() {
  const input = document.getElementById('tmc-chat-input');
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  addChatMessage(text, true);
  chatHistory.push({ role: 'user', content: text });
  addTypingIndicator();

  let replied = false;
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: chatHistory.slice(-12) })
    });

    if (response.ok) {
      const data = await response.json();
      if (data && data.reply) {
        removeTypingIndicator();
        chatHistory.push({ role: 'assistant', content: data.reply });
        addChatMessage(data.reply, false);
        replied = true;
      }
    }
  } catch (e) {
    // network failed - fall through to the offline keyword helper
  }

  if (!replied) {
    removeTypingIndicator();
    const reply = getSmartResponse(text);
    chatHistory.push({ role: 'assistant', content: reply });
    addChatMessage(reply, false);
  }
}

`;

function patchAppJs(absPath, label) {
  let src = readFile(absPath);

  // TMC_PATCH37 marker means sendChatMessage already posts to /api/chat.
  if (src.indexOf('TMC_PATCH37') !== -1) {
    skip(label + ' already posts to /api/chat');
    return src;
  }

  const startMarker = 'async function sendChatMessage() {';
  const endMarker = '//  SMART OFFLINE RESPONSES';

  const startIdx = src.indexOf(startMarker);
  const endIdx = src.indexOf(endMarker);
  if (startIdx === -1) errExit(label + ': could not find sendChatMessage() - file may differ from expected.');
  if (endIdx === -1 || endIdx < startIdx) errExit(label + ': could not find the SMART OFFLINE RESPONSES marker.');

  backup(absPath, label);

  const before = src.slice(0, startIdx);
  const after = src.slice(endIdx); // keep the offline keyword helper intact
  const patched = before + NEW_SEND + after;

  if (patched.indexOf('function getSmartResponse') === -1) {
    errExit(label + ': getSmartResponse() went missing after patch - aborting.');
  }
  if (patched.indexOf('async function sendChatMessage()') === -1) {
    errExit(label + ': sendChatMessage() went missing after patch - aborting.');
  }

  writeFile(absPath, patched);
  ok('Patched ' + label);
  return patched;
}

log('');
log('Step 2 - public/app.js');
const publicAppPath = path.join(PUBLIC, 'app.js');
const patchedPublic = patchAppJs(publicAppPath, 'public/app.js');

// ----------------------------------------------------------------------------
// STEP 3 - Sync public/app.js -> root app.js
// ----------------------------------------------------------------------------
log('');
log('Step 3 - sync to root app.js');
const rootAppPath = path.join(ROOT, 'app.js');
if (fs.existsSync(rootAppPath)) {
  const rootSrc = readFile(rootAppPath);
  if (rootSrc === patchedPublic) {
    skip('root app.js already in sync');
  } else {
    backup(rootAppPath, 'app.js');
    writeFile(rootAppPath, patchedPublic);
    ok('Synced root app.js to match public/app.js');
  }
} else {
  log('  \u00b7 no root app.js found - nothing to sync');
}

// ----------------------------------------------------------------------------
// Done
// ----------------------------------------------------------------------------
log('');
log('================================================');
log('Patch 38 complete.');
if (fs.existsSync(BACKUP_DIR)) log('Backups saved to: ' + path.basename(BACKUP_DIR));
log('');
log('NEXT STEPS - get your FREE Gemini key (2 min, no credit card):');
log('  1. Open  https://aistudio.google.com/apikey');
log('  2. Sign in with a Google account, click "Create API key", copy it.');
log('  3. In Vercel: Project Settings -> Environment Variables, add');
log('       GEMINI_API_KEY = the key you copied');
log('  4. git add -A && git commit -m "Patch 38: free Gemini chatbot" && git push');
log('  5. Wait ~60s for Vercel, then test in a fresh incognito window.');
log('');
log('To confirm it works: open DevTools -> Network, send a chat message,');
log('and check the /api/chat response. A real answer = working. If you see');
log('"fallback":true, the GEMINI_API_KEY is missing or wrong.');
log('');
