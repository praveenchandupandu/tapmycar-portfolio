// TMC_PATCH38_CHAT_GEMINI
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

const SYSTEM_PROMPT = `You are the TapMyCar Assistant - a warm, friendly, genuinely helpful support agent for TapMyCar, a privacy-first vehicle contact system by Praman Tech LLC, based in Connecticut, USA.

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
- eTag: a free digital QR code, downloadable instantly as a PDF. It is FREE FOR 30 DAYS. Before the 30 days end, the user upgrades to Standard or Premium to keep the tag active; if they do not upgrade, the eTag deactivates. There is NO automatic charge - the user is never billed without choosing to upgrade.
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
- Refunds (current policy): A subscription plan can be refunded within 14 days of purchase, and a $1 service fee is retained from the refund. After 14 days the plan is non-refundable, but the user can still cancel anytime to stop future renewals. Annual subscription fees are refundable within 14 days of each annual charge (again, $1 service fee retained). Activation fees, physical sticker fees, and prepaid bundle extras are non-refundable. Physical stickers cannot be refunded once shipped, because each one is uniquely coded to the account. Refunds are SELF-SERVE: when a refund is available, a "Refund $X available" option shows up on the Settings page (tapmycar.io/settings) - the user just cancels there and the refund goes back to their card automatically. They do NOT need to email anyone. Only suggest emailing support@tapmycar.io if the user says the self-serve refund is not appearing or seems wrong.
- Physical sticker hasn't arrived: stickers ship after the 30-day period; status shows on the dashboard. If it's overdue, have them email support@tapmycar.io.
- Promo or gift code: there's a "Have a promo code?" option on the checkout/registration flow, and redeemed codes show under "My family codes" on the dashboard.
- REFERRAL CREDITS (TMC_PATCH118): each account has a referral code (visible in Settings). ONLY the person who SHARED the code gets a credit when their friend signs up and activates - the friend who signs up does NOT get a credit themselves. Never say both people get a credit.

CRITICAL FACT - eTAG BILLING (TMC_PATCH65_BILLING)
The eTag is free to DOWNLOAD. To ACTIVATE it the user pays a one-time $1 and chooses a plan (Standard or Premium) - by activating, they are agreeing to that plan. They then get 30 days to try the service and may CANCEL any time within those 30 days. If they do NOT cancel, the plan they agreed to proceeds AUTOMATICALLY: on day 30 the physical sticker ships and the sticker price is charged ($9.99 Standard / $24.99 Premium); on day 60 the annual plan begins ($9.99/year Standard / $19.99/year Premium) and renews yearly until cancelled. You must NEVER say "there is no automatic charge" or "payment only if you decide to upgrade" - that is FALSE. Charges DO happen automatically unless the user cancels within 30 days. You must also NEVER say the eTag is permanent, lifetime, unlimited or "never expires". Always describe billing using exactly the model above.

STYLE
- Be warm, natural, and human. Sound like a real person, not a script.
- Keep replies fairly short - usually 2 to 4 sentences. Use a clear numbered list only when giving step-by-step instructions.
- If someone just says hi, greet them warmly and ask what they need help with.
- Never invent features that don't exist. If you're genuinely unsure of a specific detail, say so honestly and point them to tapmycar.io or support@tapmycar.io - but try to actually help first.
- For a real emergency (an accident, a life-threatening situation), tell the user to call 911 first. TapMyCar is for non-emergency vehicle contact.
- Don't end every message by pushing email support. Only mention it when the task truly needs account access.`;

// TMC_PATCH39 - refund policy updated
/* TMC_PATCH70_CHAT_RL_REQUIRE */
const { rateLimit, getClientIp } = require('./_rate-limit');
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  /* TMC_PATCH70_CHAT_RL_GATE: throttle the AI endpoint per IP. */
  const _chatIp = getClientIp(req);
  if (!await rateLimit(req, res, [
    { key: 'chat:ip:' + _chatIp, max: 20, windowSeconds: 60 },
    { key: 'chat:ip-hr:' + _chatIp, max: 200, windowSeconds: 3600 }
  ])) return;

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

  // TMC_PATCH65_BILLING: billing questions about the eTag are answered
  // with a fixed, exact response - they never go through Gemini, so the
  // answer can never drift or misstate what the customer is charged.
  try {
    const lastUserMsg = String(messages[messages.length - 1].content || '').toLowerCase();
    var mentionsEtag = lastUserMsg.indexOf('etag') !== -1 ||
      lastUserMsg.indexOf('e-tag') !== -1 ||
      (lastUserMsg.indexOf('free') !== -1 &&
        (lastUserMsg.indexOf('tag') !== -1 || lastUserMsg.indexOf('qr') !== -1));
    var asksBillingOrDuration =
      lastUserMsg.indexOf('pay') !== -1 || lastUserMsg.indexOf('charge') !== -1 ||
      lastUserMsg.indexOf('cost') !== -1 || lastUserMsg.indexOf('price') !== -1 ||
      lastUserMsg.indexOf('bill') !== -1 || lastUserMsg.indexOf('free') !== -1 ||
      lastUserMsg.indexOf('money') !== -1 || lastUserMsg.indexOf('$') !== -1 ||
      lastUserMsg.indexOf('how long') !== -1 || lastUserMsg.indexOf('days') !== -1 ||
      lastUserMsg.indexOf('expire') !== -1 || lastUserMsg.indexOf('expir') !== -1 ||
      lastUserMsg.indexOf('last') !== -1 || lastUserMsg.indexOf('duration') !== -1 ||
      lastUserMsg.indexOf('permanent') !== -1 || lastUserMsg.indexOf('forever') !== -1 ||
      lastUserMsg.indexOf('indefinit') !== -1 || lastUserMsg.indexOf('30') !== -1 ||
      lastUserMsg.indexOf('cancel') !== -1 || lastUserMsg.indexOf('upgrade') !== -1;
    if (mentionsEtag && asksBillingOrDuration) {
      return res.status(200).json({ reply: "Here's exactly how the eTag works. The eTag is free to download. To activate it, you pay a one-time $1 and choose your plan - Standard or Premium - and by activating you're agreeing to that plan. You then get 30 days to experience the full service, and you're free to cancel anytime within those 30 days if it's not for you. If you don't cancel: on day 30 your physical sticker ships and your card is charged for it ($9.99 for Standard, $24.99 for Premium), and on day 60 your annual plan begins ($9.99/year for Standard, $19.99/year for Premium) and renews yearly. You can always cancel before a charge in Settings. Full details are at tapmycar.io/pricing." });
    }
  } catch (e) { /* if anything goes wrong, fall through to the AI */ }

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
