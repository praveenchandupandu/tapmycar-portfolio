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