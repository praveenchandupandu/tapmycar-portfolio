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
// AI CHATBOT — REPLACE the old chatbot code in app.js
// Delete everything from "// ── CHATBOT SYSTEM PROMPT ──" to the end
// Then paste this entire block
// ══════════════════════════════════════════════════

// ── CHATBOT SYSTEM PROMPT ──
const TMC_SYSTEM_PROMPT = `You are TapMyCar Assistant — a friendly, warm, and respectful support agent for TapMyCar, a privacy-first vehicle contact system by Praman Tech LLC, New Britain, Connecticut.

ABOUT TAPMYCAR:
- Car owners place a QR/NFC sticker on their vehicle
- Strangers scan to contact the owner privately — owner's real phone number is NEVER shared
- All calls are masked through a secure proxy — neither party sees real numbers
- Owner gets voice screening: Press 1 to send auto-message, Press 2 to connect directly
- Quick message alerts: strangers can tap preset messages like "Your lights are on" or "Your car is being towed"

PLANS (only mention pricing when specifically asked):
- eTag: Free digital QR code, download instantly, 3 masked calls/month
- Standard: Physical NFC + QR sticker shipped home, 10 masked calls/month, SMS scan alerts
- Premium: 3 vehicles, unlimited masked calls, scan history, emergency contact
- Business: Fleet dashboard, bulk stickers with logo

HOW IT WORKS:
1. Register free at tapmycar.io
2. Get instant digital eTag (QR code PDF)
3. Print and place on windshield
4. Activate to enable masked calling
5. Physical sticker ships after 30 days

COMMON ISSUES:
- QR not scanning → Ensure good lighting, clean QR, camera focused. Try zooming in.
- Can't download PDF → Log in first, then go to Tag page
- Want a refund → Email pramantechllc@gmail.com, refunds within 30 days
- Sticker not arrived → Ships after day 30, check dashboard for status
- Lost my tag → Sign in with email, tag is still active
- Pause tag → Toggle from dashboard
- Change phone → Go to Settings page

RULES:
- Be warm, human-like, concise. Short sentences. 2-3 sentences max.
- NEVER mention prices or dollar amounts unless the user specifically asks about pricing or cost
- If someone says hi/hello, respond warmly and ask how you can help
- If you cannot solve something, say "Let me connect you with our team — email pramantechllc@gmail.com and we will help you within 24 hours."
- Never make up features that don't exist
- Always be soft and respectful`;

// ── INJECT CHATBOT ──
function injectChatbot() {
  if (window.location.pathname.includes('admin')) return;

  const chatHTML = `
    <div id="tmc-chat-bubble" onclick="toggleChat()" style="position:fixed;bottom:24px;right:20px;width:56px;height:56px;border-radius:50%;background:#FF6B00;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 20px rgba(255,107,0,.4);z-index:200;transition:transform .2s">
      <svg id="chat-icon-open" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <svg id="chat-icon-close" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" style="display:none"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </div>
    <div id="tmc-chat-badge" style="position:fixed;bottom:72px;right:20px;background:#111;color:#fff;font-size:11px;font-weight:600;padding:6px 12px;border-radius:10px 10px 0 10px;z-index:200;box-shadow:0 2px 10px rgba(0,0,0,.15);display:none;cursor:pointer" onclick="toggleChat()">Need help? 💬</div>
    <div id="tmc-chat-window" style="display:none;position:fixed;bottom:90px;right:16px;width:340px;max-width:calc(100vw - 32px);height:480px;max-height:calc(100vh - 120px);background:#fff;border-radius:20px;box-shadow:0 8px 40px rgba(0,0,0,.2);z-index:201;flex-direction:column;overflow:hidden">
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
      <div id="tmc-chat-messages" style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px">
        <div class="tmc-msg tmc-msg-bot"><div class="tmc-msg-bubble">Hi there! Welcome to TapMyCar. How can I help you today? 😊</div></div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          <button class="tmc-quick-q" onclick="askQuestion('How do I activate my tag?')">Activate my tag</button>
          <button class="tmc-quick-q" onclick="askQuestion('How does masked calling work?')">Masked calling</button>
          <button class="tmc-quick-q" onclick="askQuestion('My QR code is not scanning')">QR not scanning</button>
          <button class="tmc-quick-q" onclick="askQuestion('I want a refund')">Refund</button>
          <button class="tmc-quick-q" onclick="askQuestion('Where is my physical sticker?')">Sticker status</button>
        </div>
      </div>
      <div style="padding:12px;border-top:1px solid #F3F4F6;display:flex;gap:8px;flex-shrink:0;background:#fff">
        <input type="text" id="tmc-chat-input" placeholder="Type your message..." onkeydown="if(event.key==='Enter')sendChatMessage()" style="flex:1;height:40px;border:1.5px solid #E5E7EB;border-radius:12px;padding:0 14px;font-size:13px;font-family:'Inter',sans-serif;outline:none;background:#F9FAFB" />
        <button onclick="sendChatMessage()" style="width:40px;height:40px;border-radius:12px;background:#FF6B00;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    </div>
  `;

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

  const container = document.createElement('div');
  container.innerHTML = chatHTML;
  document.body.appendChild(container);

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
  chatHistory.push({ role: 'user', content: text });
  addTypingIndicator();

  // Try Anthropic API first
  let replied = false;
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: TMC_SYSTEM_PROMPT,
        messages: chatHistory.slice(-10)
      })
    });

    const data = await response.json();
    removeTypingIndicator();

    if (data.content && data.content[0] && data.content[0].text) {
      const reply = data.content[0].text;
      chatHistory.push({ role: 'assistant', content: reply });
      addChatMessage(reply, false);
      replied = true;
    }
  } catch (e) {
    // API failed — use smart offline
  }

  if (!replied) {
    removeTypingIndicator();
    const reply = getSmartResponse(text);
    chatHistory.push({ role: 'assistant', content: reply });
    addChatMessage(reply, false);
  }
}

// ── SMART OFFLINE RESPONSES ──
function getSmartResponse(question) {
  const q = question.toLowerCase();

  // Greetings
  if (q.match(/^(hi|hey|hello|good morning|good evening|sup|yo|howdy)/)) {
    return 'Hey there! Welcome to TapMyCar support. How can I help you today?';
  }

  // Thanks
  if (q.match(/^(thanks|thank you|thx|ty|appreciate)/)) {
    return 'You\'re welcome! Let me know if there\'s anything else I can help with. 😊';
  }

  // Activation
  if (q.includes('activate') || q.includes('activation')) {
    return 'To activate your tag, go to your dashboard and tap "Activate" or visit tapmycar.io/activate.html. Scan your QR code and follow the steps — it only takes a minute!';
  }

  // QR scanning issues
  if ((q.includes('qr') || q.includes('scan')) && (q.includes('not') || q.includes('won\'t') || q.includes('cant') || q.includes('can\'t') || q.includes('doesn\'t') || q.includes('issue') || q.includes('problem'))) {
    return 'Try these steps: make sure the QR is well-lit and flat (not crinkled). Hold your camera steady and zoom in slightly. If it still doesn\'t work, you can download a fresh PDF from your Tag page.';
  }

  // Masked calling
  if (q.includes('mask') || (q.includes('call') && q.includes('work')) || q.includes('privacy') || q.includes('number safe') || q.includes('hide number')) {
    return 'Your real phone number is never shared with anyone. When someone taps Call on your tag, the call routes through our secure proxy — neither side sees the other\'s real number. Completely private!';
  }

  // Refund
  if (q.includes('refund') || q.includes('money back') || q.includes('charge')) {
    return 'We offer full refunds within 30 days, no questions asked. Just email pramantechllc@gmail.com with your account email and we\'ll process it right away.';
  }

  // Sticker / shipping
  if (q.includes('sticker') || q.includes('ship') || q.includes('deliver') || q.includes('physical')) {
    return 'Physical stickers ship after your 30-day period. You can check the status on your dashboard. If it\'s been longer than expected, email us at pramantechllc@gmail.com and we\'ll look into it.';
  }

  // Pause tag
  if (q.includes('pause') || q.includes('disable') || q.includes('stop') || q.includes('turn off')) {
    return 'You can pause your tag anytime from your dashboard. When paused, strangers won\'t be able to contact you. Just toggle it back on whenever you\'re ready!';
  }

  // Pricing — only when explicitly asked
  if (q.includes('price') || q.includes('pricing') || q.includes('cost') || q.includes('how much') || q.includes('plan') || q.includes('subscription') || q.includes('upgrade')) {
    return 'We have plans for every need — from a free eTag to our Premium and Business options. Check out all the details at tapmycar.io/pricing.html. Happy to answer specific questions about any plan!';
  }

  // Cancel
  if (q.includes('cancel') || q.includes('unsubscribe') || q.includes('delete account')) {
    return 'You can cancel anytime — no long-term commitment. Email us at pramantechllc@gmail.com and we\'ll take care of it for you right away.';
  }

  // Lost tag
  if (q.includes('lost') || q.includes('forgot') || q.includes('can\'t find') || q.includes('cant find')) {
    return 'No worries! Your tag is linked to your account. Just sign in at tapmycar.io/signin.html with your email — everything is still there and active.';
  }

  // Change info
  if (q.includes('change') && (q.includes('phone') || q.includes('email') || q.includes('name') || q.includes('number'))) {
    return 'You can update your personal info in the Settings page. Go to tapmycar.io/settings.html and make your changes there.';
  }

  // How it works
  if (q.includes('how') && (q.includes('work') || q.includes('use'))) {
    return 'It\'s simple! Register free, get your digital QR code, print and place it on your car. When someone needs to reach you, they scan the QR and can call you privately — your real number stays hidden. You control everything from your dashboard.';
  }

  // NFC
  if (q.includes('nfc') || q.includes('tap')) {
    return 'Our physical stickers come with both a QR code and NFC chip. Anyone can either scan the QR with their camera or tap their phone on the NFC chip — both work!';
  }

  // Multiple cars
  if (q.includes('multiple') || q.includes('second car') || q.includes('more than one') || q.includes('another car')) {
    return 'Our Premium plan supports up to 3 vehicles, and Business supports unlimited. Check tapmycar.io/pricing.html for details!';
  }

  // Emergency
  if (q.includes('emergency') || q.includes('911') || q.includes('accident')) {
    return 'In any life-threatening emergency, always call 911 first. TapMyCar is designed for non-emergency situations like parking issues, lights left on, or someone needing to reach you about your vehicle.';
  }

  // Default — friendly catch-all
  return 'Great question! Let me connect you with our team for the best answer. Email us at pramantechllc@gmail.com and we\'ll get back to you within 24 hours. Is there anything else I can help with?';
}

// Auto-inject chatbot on every page
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(injectChatbot, 1000);
});