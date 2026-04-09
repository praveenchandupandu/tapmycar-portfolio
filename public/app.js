// TapMyCar — app.js

const API = {
  sendOTP: (phone) => fetch('/api/send-otp', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({phone})
  }).then(r => r.json()),

  verifyOTP: (phone, code, name) => fetch('/api/verify-otp', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({phone, code, name})
  }).then(r => r.json()),
};

function showToast(message) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    t.innerHTML = '<div class="toast-ic"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></div><span id="toast-msg"></span>';
    document.body.appendChild(t);
  }
  document.getElementById('toast-msg').textContent = message;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3200);
}

function initOTP() {
  const boxes = document.querySelectorAll('.otp-box');
  boxes.forEach((box, i) => {
    box.addEventListener('input', (e) => {
      const val = e.target.value;
      if (val.length >= 1) {
        box.value = val[val.length - 1];
        box.classList.add('filled');
        if (i < boxes.length - 1) boxes[i + 1].focus();
      }
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && i > 0) {
        boxes[i - 1].focus();
        boxes[i - 1].classList.remove('filled');
      }
    });
  });
}

function getOTPValue() {
  return Array.from(document.querySelectorAll('.otp-box')).map(b => b.value).join('');
}

function saveSession(token, phone, name) {
  localStorage.setItem('tmc_token', token);
  localStorage.setItem('tmc_phone', phone);
  localStorage.setItem('tmc_name', name);
}

function getSession() {
  return {
    token: localStorage.getItem('tmc_token'),
    phone: localStorage.getItem('tmc_phone'),
    name: localStorage.getItem('tmc_name'),
  };
}

function requireAuth() {
  const { token } = getSession();
  if (!token) window.location.href = '/signin.html';
  return token;
}

function startCountdown(btnId, seconds = 60) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  let s = seconds;
  btn.disabled = true;
  btn.textContent = `Resend (${s}s)`;
  const iv = setInterval(() => {
    s--;
    btn.textContent = `Resend (${s}s)`;
    if (s <= 0) {
      clearInterval(iv);
      btn.textContent = 'Resend code';
      btn.disabled = false;
    }
  }, 1000);
}

document.addEventListener('DOMContentLoaded', () => { initOTP(); });
// ══════════════════════════════════════════════════
// ADD THIS ENTIRE BLOCK TO THE END OF public/app.js
// ══════════════════════════════════════════════════

// ── QUICK MESSAGE TEMPLATES (auto-injects into contact page) ──
function injectQuickMessages() {
  const textBtn = document.getElementById('text-btn');
  if (!textBtn) return;

  const quickHTML = `
    <div id="quick-msgs" style="background:#fff;border-radius:14px;border:1.5px solid #E5E7EB;overflow:hidden">
      <div style="padding:14px 16px;border-bottom:1px solid #F3F4F6">
        <div style="font-size:14px;font-weight:700;color:#111">Quick alert</div>
        <div style="font-size:10px;color:#6B7280">Tap to notify the owner instantly</div>
      </div>
      <div class="qm-row" onclick="sendQuickMessage('Your lights are on')">
        <div class="qm-icon" style="background:#FEF3C7">💡</div>
        <div class="qm-label">Your lights are on</div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
      <div class="qm-row" onclick="sendQuickMessage('Your car is being towed')">
        <div class="qm-icon" style="background:#FEE2E2">🚨</div>
        <div class="qm-label">Your car is being towed</div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
      <div class="qm-row" onclick="sendQuickMessage('You are parked illegally')">
        <div class="qm-icon" style="background:#FFF3EC">🚫</div>
        <div class="qm-label">You're parked illegally</div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
      <div class="qm-row" onclick="sendQuickMessage('Your alarm is going off')">
        <div class="qm-icon" style="background:#DBEAFE">🔔</div>
        <div class="qm-label">Your alarm is going off</div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
      <div class="qm-row" onclick="sendQuickMessage('Someone hit your car')" style="border-bottom:none">
        <div class="qm-icon" style="background:#FCE7F3">💥</div>
        <div class="qm-label">Someone hit your car</div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
      <div id="custom-msg-row" class="qm-row" onclick="showCustomMessage()" style="border-bottom:none">
        <div class="qm-icon" style="background:#F3F4F6">✏️</div>
        <div class="qm-label" style="color:#6B7280">Write a custom message...</div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
      <div id="custom-msg-input" style="display:none;padding:12px 16px;border-top:1px solid #F3F4F6">
        <textarea id="custom-msg-text" placeholder="Type your message to the vehicle owner..." style="width:100%;height:70px;border:1.5px solid #E5E7EB;border-radius:10px;padding:10px 12px;font-size:13px;font-family:'Inter',sans-serif;resize:none;outline:none;background:#F9FAFB" maxlength="200"></textarea>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
          <div id="custom-msg-count" style="font-size:10px;color:#9CA3AF">0/200</div>
          <button onclick="sendCustomMessage()" style="background:#FF6B00;color:#fff;font-size:12px;font-weight:700;padding:8px 18px;border-radius:10px;border:none;cursor:pointer;font-family:'Inter',sans-serif">Send</button>
        </div>
      </div>
    </div>
    <div id="msg-sent" style="display:none;background:#DCFCE7;border-radius:14px;padding:16px;text-align:center;border:1.5px solid #BBF7D0">
      <div style="font-size:18px;margin-bottom:6px">✓</div>
      <div style="font-size:14px;font-weight:700;color:#166534;margin-bottom:2px">Message sent!</div>
      <div style="font-size:11px;color:#15803D">The vehicle owner has been notified.</div>
    </div>
  `;

  // Add CSS for quick message rows
  const style = document.createElement('style');
  style.textContent = `
    .qm-row{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:.5px solid #F3F4F6;cursor:pointer;transition:background .15s}
    .qm-row:active{background:#F9FAFB}
    .qm-icon{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:18px}
    .qm-label{flex:1;font-size:13px;font-weight:600;color:#111}
  `;
  document.head.appendChild(style);

  // Replace text button with quick messages
  textBtn.outerHTML = quickHTML;
}

async function sendQuickMessage(message) {
  const msgSent = document.getElementById('msg-sent');
  const quickMsgs = document.getElementById('quick-msgs');
  if (quickMsgs) quickMsgs.style.display = 'none';
  if (msgSent) msgSent.style.display = 'block';

  // Update scan action
  if (typeof updateScanAction === 'function') updateScanAction('quick_message');

  // Notify owner
  const token = typeof currentToken !== 'undefined' ? currentToken : '';
  if (token) {
    try {
      const tagRes = await fetch('/api/get-tag?token=' + token);
      const tagData = await tagRes.json();
      if (tagData.tag) {
        await fetch('/api/notify-owner', {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({
            tag_id: tagData.tag.id,
            action: 'quick_message',
            message: message,
            scan_id: typeof currentScanId !== 'undefined' ? currentScanId : ''
          })
        });
      }
    } catch(e) { console.error('Notify error:', e); }
  }

  showToast('Owner notified: "' + message + '"');

  setTimeout(() => {
    if (msgSent) msgSent.style.display = 'none';
    if (quickMsgs) quickMsgs.style.display = 'block';
  }, 5000);
}

function showCustomMessage() {
  document.getElementById('custom-msg-row').style.display = 'none';
  document.getElementById('custom-msg-input').style.display = 'block';
  const textarea = document.getElementById('custom-msg-text');
  textarea.focus();
  textarea.addEventListener('input', () => {
    document.getElementById('custom-msg-count').textContent = textarea.value.length + '/200';
  });
}

function sendCustomMessage() {
  const text = document.getElementById('custom-msg-text').value.trim();
  if (!text) { showToast('Type a message first'); return; }
  if (text.length > 200) { showToast('Message too long — max 200 characters'); return; }
  sendQuickMessage(text);
}

// Auto-inject on contact pages
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(injectQuickMessages, 1500);
});


// ── TAG PAUSE/RESUME (for dashboard) ──
async function toggleTagPause(token, currentStatus) {
  const newStatus = currentStatus === 'active' ? 'paused' : 'active';
  const action = newStatus === 'paused' ? 'pause' : 'resume';

  if (!confirm(`${action === 'pause' ? 'Pause' : 'Resume'} your tag? ${action === 'pause' ? 'Strangers will not be able to contact you while paused.' : 'Your tag will be active again.'}`)) return;

  try {
    const res = await fetch('/api/get-tag', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ token, user_id: 'owner-toggle', status_override: newStatus })
    });
    const data = await res.json();
    if (data.success) {
      showToast(action === 'pause' ? 'Tag paused — strangers cannot contact you' : 'Tag resumed — you are reachable again');
      // Reload page to reflect change
      setTimeout(() => window.location.reload(), 800);
    } else {
      showToast(data.error || 'Failed to ' + action);
    }
  } catch(e) { showToast('Network error'); }
}


// ── SCAN NOTIFICATION (call notify-owner when tag is scanned) ──
async function notifyScan(tagId, scanId) {
  try {
    await fetch('/api/notify-owner', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ tag_id: tagId, action: 'scan', scan_id: scanId })
    });
  } catch(e) { /* silent fail */ }
}


// ── PAUSED STATE HANDLER (for contact pages) ──
function showPausedState() {
  // Check if we're on a contact page and tag is paused
  // This is called from contact.html/check.html when tag.status === 'paused'
  const body = document.body;
  const pausedHTML = `
    <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 24px;text-align:center;background:#FEF3C7">
      <div style="width:80px;height:80px;border-radius:50%;background:#fff;border:3px solid #D97706;display:flex;align-items:center;justify-content:center;margin-bottom:16px">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#D97706" stroke-width="2.5" stroke-linecap="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
      </div>
      <div style="font-size:24px;font-weight:800;color:#92400E;margin-bottom:8px">Tag Paused</div>
      <div style="font-size:14px;color:#A16207;line-height:1.6;max-width:280px;margin-bottom:24px">The vehicle owner has temporarily paused this tag. They are not accepting contacts right now.</div>
      <div style="background:#FEF9C3;border-radius:12px;padding:14px;border:1px solid #FDE68A;max-width:300px;width:100%">
        <div style="font-size:12px;color:#92400E;line-height:1.5">If this is an emergency, call <strong>911</strong> immediately.</div>
      </div>
      <a href="https://tapmycar.io" style="margin-top:20px;font-size:13px;color:#D97706;font-weight:600;text-decoration:none">Visit tapmycar.io</a>
    </div>
  `;
  return pausedHTML;
}


// ── HANDLE CALL WITH NOTIFICATION ──
// Override handleCall on contact pages to also send notification
const _origHandleCall = typeof handleCall === 'function' ? handleCall : null;
if (typeof window !== 'undefined') {
  window._tmcNotifyOnCall = async function(tagId, scanId) {
    try {
      await fetch('/api/notify-owner', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ tag_id: tagId, action: 'call', scan_id: scanId })
      });
    } catch(e) {}
  };
}

// ══════════════════════════════════════════════════
// AI CHATBOT — Add this to the END of public/app.js
// ══════════════════════════════════════════════════

// ── CHATBOT SYSTEM PROMPT ──
const TMC_SYSTEM_PROMPT = `You are TapMyCar Assistant — a friendly, warm, and professional support agent for TapMyCar, a privacy-first vehicle contact system by Praman Tech LLC based in New Britain, Connecticut.

ABOUT TAPMYCAR:
- TapMyCar lets car owners place a QR/NFC sticker on their vehicle
- Strangers can scan the tag to contact the owner privately — the owner's real phone number is NEVER shared
- All calls are masked through Twilio proxy — neither party sees real numbers
- The owner gets voice screening: Press 1 to send auto-message, Press 2 to connect directly

PLANS:
- eTag (Free): Digital QR code, download instantly, 3 masked calls/month. Activation costs $1.
- Standard ($9.99 + $4.99/yr): Physical NFC + QR sticker shipped to home, 10 masked calls/month, SMS scan alerts, voice screening
- Premium ($24.99 + $9.99/yr): 3 vehicles, unlimited masked calls, scan history, emergency contact
- Business ($49/month): Fleet dashboard, bulk stickers with logo

HOW IT WORKS:
1. Register free at tapmycar.io — get instant digital eTag (QR code PDF)
2. Print and place QR on windshield
3. Activate for $1 — enables masked calling
4. After 30 days, auto-upgrade to Standard ($9.99) — physical sticker ships to your address
5. Cancel anytime before day 30 — no charge

COMMON ISSUES & SOLUTIONS:
- "QR not scanning" → Make sure QR is well-lit, not crinkled, camera focused. Try zooming in slightly.
- "Can't download PDF" → Make sure you're logged in. Go to tapmycar.io/etag.html
- "How to activate" → Go to tapmycar.io/activate.html, scan your QR, pay $1
- "Want a refund" → Email pramantechllc@gmail.com. Refunds within 30 days, no questions asked.
- "Sticker not arrived" → Physical stickers ship after day 30. Check dashboard for status.
- "Lost my tag" → Sign in at tapmycar.io/signin.html with your email. Your tag is still active.
- "How to pause tag" → Go to dashboard, toggle pause on your tag
- "Change phone number" → Go to settings, update your phone number
- "How masked calling works" → When someone scans your tag and taps Call, the call goes through our Twilio number. Neither you nor the caller see each other's real numbers.
- "Is my number safe?" → Yes. Your real number is NEVER shown to anyone. All communication routes through TapMyCar's secure proxy.

TONE: Be warm, human, concise. Use short sentences. Never be robotic. If you can't solve something, say "I'll create a support ticket for you — our team will reach out within 24 hours." Never make up features that don't exist.

IMPORTANT: Keep responses SHORT — 2-3 sentences max. This is a mobile chat, not an essay.`;

// ── INJECT CHATBOT ──
function injectChatbot() {
  // Don't inject on admin page
  if (window.location.pathname.includes('admin')) return;

  const chatHTML = `
    <div id="tmc-chat-bubble" onclick="toggleChat()" style="position:fixed;bottom:24px;right:20px;width:56px;height:56px;border-radius:50%;background:#FF6B00;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 20px rgba(255,107,0,.4);z-index:200;transition:transform .2s">
      <svg id="chat-icon-open" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <svg id="chat-icon-close" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" style="display:none"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </div>
    <div id="tmc-chat-badge" style="position:fixed;bottom:72px;right:20px;background:#111;color:#fff;font-size:11px;font-weight:600;padding:6px 12px;border-radius:10px 10px 0 10px;z-index:200;box-shadow:0 2px 10px rgba(0,0,0,.15);display:none;cursor:pointer" onclick="toggleChat()">Need help? 💬</div>

    <div id="tmc-chat-window" style="display:none;position:fixed;bottom:90px;right:16px;width:340px;max-width:calc(100vw - 32px);height:480px;max-height:calc(100vh - 120px);background:#fff;border-radius:20px;box-shadow:0 8px 40px rgba(0,0,0,.2);z-index:201;display:none;flex-direction:column;overflow:hidden">
      <!-- Header -->
      <div style="background:#FF6B00;padding:16px;display:flex;align-items:center;gap:10px;flex-shrink:0">
        <div style="width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        </div>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:700;color:#fff">TapMyCar Support</div>
          <div style="font-size:10px;color:rgba(255,255,255,.8);display:flex;align-items:center;gap:4px"><div style="width:6px;height:6px;border-radius:50%;background:#4ADE80"></div>Online now</div>
        </div>
        <button onclick="toggleChat()" style="background:rgba(255,255,255,.2);border:none;border-radius:8px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;cursor:pointer"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>

      <!-- Messages -->
      <div id="tmc-chat-messages" style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px">
        <div class="tmc-msg tmc-msg-bot">
          <div class="tmc-msg-bubble">Hi! I'm your TapMyCar assistant. How can I help you today? 😊</div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          <button class="tmc-quick-q" onclick="askQuestion('How do I activate my tag?')">Activate my tag</button>
          <button class="tmc-quick-q" onclick="askQuestion('How does masked calling work?')">Masked calling</button>
          <button class="tmc-quick-q" onclick="askQuestion('My QR code is not scanning')">QR not scanning</button>
          <button class="tmc-quick-q" onclick="askQuestion('I want a refund')">Refund</button>
          <button class="tmc-quick-q" onclick="askQuestion('Where is my physical sticker?')">Sticker status</button>
        </div>
      </div>

      <!-- Input -->
      <div style="padding:12px;border-top:1px solid #F3F4F6;display:flex;gap:8px;flex-shrink:0;background:#fff">
        <input type="text" id="tmc-chat-input" placeholder="Type your message..." onkeydown="if(event.key==='Enter')sendChatMessage()" style="flex:1;height:40px;border:1.5px solid #E5E7EB;border-radius:12px;padding:0 14px;font-size:13px;font-family:'Inter',sans-serif;outline:none;background:#F9FAFB" />
        <button onclick="sendChatMessage()" style="width:40px;height:40px;border-radius:12px;background:#FF6B00;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    </div>
  `;

  // Add CSS
  const chatStyle = document.createElement('style');
  chatStyle.textContent = `
    .tmc-msg{display:flex;gap:8px;max-width:85%}
    .tmc-msg-bot{align-self:flex-start}
    .tmc-msg-user{align-self:flex-end;flex-direction:row-reverse}
    .tmc-msg-bubble{padding:10px 14px;border-radius:16px;font-size:13px;line-height:1.5;font-family:'Inter',sans-serif}
    .tmc-msg-bot .tmc-msg-bubble{background:#F3F4F6;color:#111;border-bottom-left-radius:4px}
    .tmc-msg-user .tmc-msg-bubble{background:#FF6B00;color:#fff;border-bottom-right-radius:4px}
    .tmc-msg-typing .tmc-msg-bubble{background:#F3F4F6;color:#9CA3AF;font-style:italic}
    .tmc-quick-q{background:#fff;border:1px solid #FFE4CC;color:#FF6B00;font-size:11px;font-weight:600;padding:6px 12px;border-radius:99px;cursor:pointer;font-family:'Inter',sans-serif;transition:background .15s}
    .tmc-quick-q:active{background:#FFF3EC}
    #tmc-chat-bubble:active{transform:scale(.92)}
    @media(max-width:400px){#tmc-chat-window{right:8px;width:calc(100vw - 16px);bottom:84px;height:calc(100vh - 100px)}}
  `;
  document.head.appendChild(chatStyle);

  // Inject HTML
  const container = document.createElement('div');
  container.innerHTML = chatHTML;
  document.body.appendChild(container);

  // Show help badge after 5 seconds on first visit
  if (!sessionStorage.getItem('tmc_chat_shown')) {
    setTimeout(() => {
      const badge = document.getElementById('tmc-chat-badge');
      if (badge) badge.style.display = 'block';
      setTimeout(() => { if (badge) badge.style.display = 'none'; }, 5000);
    }, 5000);
    sessionStorage.setItem('tmc_chat_shown', '1');
  }
}

let chatOpen = false;
let chatHistory = [];

function toggleChat() {
  chatOpen = !chatOpen;
  const win = document.getElementById('tmc-chat-window');
  const iconOpen = document.getElementById('chat-icon-open');
  const iconClose = document.getElementById('chat-icon-close');
  const badge = document.getElementById('tmc-chat-badge');

  if (chatOpen) {
    win.style.display = 'flex';
    iconOpen.style.display = 'none';
    iconClose.style.display = 'block';
    if (badge) badge.style.display = 'none';
    document.getElementById('tmc-chat-input').focus();
  } else {
    win.style.display = 'none';
    iconOpen.style.display = 'block';
    iconClose.style.display = 'none';
  }
}

function askQuestion(q) {
  document.getElementById('tmc-chat-input').value = q;
  sendChatMessage();
}

function addChatMessage(text, isUser) {
  const msgs = document.getElementById('tmc-chat-messages');
  const div = document.createElement('div');
  div.className = 'tmc-msg ' + (isUser ? 'tmc-msg-user' : 'tmc-msg-bot');
  div.innerHTML = `<div class="tmc-msg-bubble">${text}</div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function addTypingIndicator() {
  const msgs = document.getElementById('tmc-chat-messages');
  const div = document.createElement('div');
  div.className = 'tmc-msg tmc-msg-bot tmc-msg-typing';
  div.id = 'typing-indicator';
  div.innerHTML = '<div class="tmc-msg-bubble">Typing...</div>';
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function removeTypingIndicator() {
  const el = document.getElementById('typing-indicator');
  if (el) el.remove();
}

async function sendChatMessage() {
  const input = document.getElementById('tmc-chat-input');
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  addChatMessage(text, true);

  // Add to history
  chatHistory.push({ role: 'user', content: text });

  // Show typing
  addTypingIndicator();

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: TMC_SYSTEM_PROMPT,
        messages: chatHistory.slice(-10) // Keep last 10 messages for context
      })
    });

    const data = await response.json();
    removeTypingIndicator();

    if (data.content && data.content[0] && data.content[0].text) {
      const reply = data.content[0].text;
      chatHistory.push({ role: 'assistant', content: reply });
      addChatMessage(reply, false);
    } else if (data.error) {
      addChatMessage('Sorry, I encountered an issue. Please try again or email us at pramantechllc@gmail.com for help.', false);
    }
  } catch (e) {
    removeTypingIndicator();
    // Fallback — offline responses
    const reply = getOfflineResponse(text);
    addChatMessage(reply, false);
  }
}

// Offline fallback responses when API fails
function getOfflineResponse(question) {
  const q = question.toLowerCase();
  if (q.includes('activate')) return 'To activate your tag, go to tapmycar.io/activate.html, scan your QR code, and pay $1. Your tag will be live instantly!';
  if (q.includes('refund')) return 'For refunds, email us at pramantechllc@gmail.com. We offer full refunds within 30 days, no questions asked.';
  if (q.includes('scan') && q.includes('not')) return 'Make sure your QR code is well-lit and not crinkled. Try zooming in slightly with your camera. If the issue persists, you can download a fresh PDF from tapmycar.io/etag.html';
  if (q.includes('mask') || q.includes('call') && q.includes('work')) return 'When someone scans your tag and taps Call, the call routes through our secure Twilio proxy. Neither you nor the caller ever see each other\'s real phone numbers.';
  if (q.includes('sticker') || q.includes('ship')) return 'Physical stickers ship after your auto-upgrade on day 30. Check your dashboard for the latest status.';
  if (q.includes('number') && q.includes('safe')) return 'Yes! Your real phone number is NEVER shared with anyone. All calls and messages route through TapMyCar\'s secure proxy system.';
  if (q.includes('pause')) return 'You can pause your tag from your dashboard. When paused, strangers cannot contact you until you resume it.';
  if (q.includes('price') || q.includes('cost') || q.includes('plan')) return 'We have 4 plans: eTag (Free + $1 activation), Standard ($9.99), Premium ($24.99), and Business ($49/mo). See all details at tapmycar.io/pricing.html';
  if (q.includes('cancel')) return 'You can cancel anytime before day 30 with no charge. After day 30, your Standard plan renews at $4.99/year. Email pramantechllc@gmail.com to cancel.';
  return 'I\'m having trouble connecting right now. For immediate help, email us at pramantechllc@gmail.com — our team responds within 24 hours!';
}

// Auto-inject chatbot on every page
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(injectChatbot, 1000);
});