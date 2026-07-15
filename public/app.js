// TapMyCar  app.js

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
  if (!boxes.length) return;

  // Detect which submit to trigger (signin vs register)
  function submitOTP() {
    if (typeof window.signIn === 'function') window.signIn();
    else if (typeof window.verifyOTP === 'function') window.verifyOTP();
  }

  // Spread a 6-digit string across the 6 boxes
  function fillBoxes(digits) {
    const clean = String(digits || '').replace(/\D/g, '').slice(0, boxes.length);
    if (!clean) return;
    for (let i = 0; i < boxes.length; i++) {
      boxes[i].value = clean[i] || '';
      if (clean[i]) boxes[i].classList.add('filled');
      else boxes[i].classList.remove('filled');
    }
    const lastFilled = Math.min(clean.length, boxes.length) - 1;
    if (lastFilled >= 0) boxes[lastFilled].focus();
    // Auto-submit when all 6 are filled (great UX for iOS autofill)
    if (clean.length === boxes.length) setTimeout(submitOTP, 200);
  }

  boxes.forEach((box, i) => {
    box.addEventListener('input', (e) => {
      const val = e.target.value;
      // If iOS autofill or paste dumped multiple digits into this box, spread them
      if (val.length > 1) {
        fillBoxes(val);
        return;
      }
      if (val.length >= 1) {
        box.value = val[val.length - 1];
        box.classList.add('filled');
        if (i < boxes.length - 1) boxes[i + 1].focus();
      } else {
        box.classList.remove('filled');
      }
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && i > 0) {
        boxes[i - 1].focus();
        boxes[i - 1].classList.remove('filled');
      }
      // Enter on any OTP box = submit (as long as all 6 are filled)
      if (e.key === 'Enter') {
        e.preventDefault();
        const full = Array.from(boxes).map(b => b.value).join('');
        if (full.length === boxes.length) submitOTP();
      }
    });
    // Handle paste into any box
    box.addEventListener('paste', (e) => {
      const pasted = (e.clipboardData || window.clipboardData).getData('text');
      if (pasted && /\d/.test(pasted)) {
        e.preventDefault();
        fillBoxes(pasted);
      }
    });
  });
}

function getOTPValue() {
  return Array.from(document.querySelectorAll('.otp-box')).map(b => b.value).join('');
}

/* TMC_PATCH38S3_SESSION  Patch 38 Stage 3  signed-session storage + send.
   Backward-compatible by design:
     - tmc_token (legacy raw UUID) is still stored exactly as before.
     - tmc_session_token (the new HMAC-signed token from verify-otp) is
       stored alongside it.
   Either one alone lets the backend identify the user, so a user who was
   logged in before this deploy (legacy token only) is never locked out.
   saveSession() now takes an optional 4th arg: sessionToken. */
function saveSession(token, phone, name, sessionToken) {
  localStorage.setItem('tmc_token', token);
  localStorage.setItem('tmc_phone', phone);
  localStorage.setItem('tmc_name', name);
  if (sessionToken) {
    /* fresh login on a server that issued a signed token */
    localStorage.setItem('tmc_session_token', sessionToken);
  } else if (sessionToken === null || sessionToken === '') {
    /* server explicitly returned no signed token  clear any stale one */
    localStorage.removeItem('tmc_session_token');
  }
  /* sessionToken === undefined (legacy 3-arg caller): leave token as-is */
}

function getSession() {
  return {
    token: localStorage.getItem('tmc_token'),
    phone: localStorage.getItem('tmc_phone'),
    name: localStorage.getItem('tmc_name'),
    sessionToken: localStorage.getItem('tmc_session_token'),
  };
}

/* TMC_PATCH38S3_FETCH_AUTH  attach the signed session token to same-origin
   /api/ requests as an 'Authorization: Bearer <token>' header.
   STRICTLY ADDITIVE: it only ADDS a header. It never removes user_id or
   token from any request body or query string. Endpoints that do not yet
   read the header simply ignore it; once Stage 4 endpoints adopt
   resolveUser() they read this header first and fall back to the legacy
   user_id UUID  so no user is ever locked out. If no signed token is
   stored (legacy session) nothing is attached and requests are unchanged. */
(function () {
  if (window.__tmcFetchAuthInstalled) return;   /* idempotent at runtime */
  var origFetch = window.fetch ? window.fetch.bind(window) : null;
  if (!origFetch) return;
  window.__tmcFetchAuthInstalled = true;
  window.fetch = function (input, init) {
    try {
      var url = (typeof input === 'string') ? input
              : (input && input.url) ? input.url : '';
      if (url) {
        var u = new URL(url, window.location.origin);
        var isSameOriginApi = (u.origin === window.location.origin) &&
                              (u.pathname.indexOf('/api/') === 0);
        if (isSameOriginApi) {
          var tok = null;
          try { tok = localStorage.getItem('tmc_session_token'); } catch (e) {}
          if (tok) {
            var h = new Headers((init && init.headers) || {});
            if (!h.has('Authorization')) {
              h.set('Authorization', 'Bearer ' + tok);
            }
            var newInit = Object.assign({}, init || {});
            newInit.headers = h;
            return origFetch(input, newInit);
          }
        }
      }
    } catch (e) {
      /* never let auth-wrapping break a request  fall through */
    }
    return origFetch(input, init);
  };
})();

function requireAuth() {
  // TMC_PATCH110_PRESERVE_QUERY_ON_AUTH_REDIRECT
  const { token } = getSession();
  if (!token) {
    var qs = window.location.search;
    window.location.href = '/signin.html' + qs;
  }
  return token;
}

// TMC_PATCH17_IDLE_LOGOUT: Idle auto-logout helper.
//
// Call installIdleLogout({minutes, warningSeconds, onLogout}) on any page
// that requires auth. The helper:
//   - Tracks the timestamp of the last user activity in localStorage
//     (key 'tmc_last_activity'). This makes it multi-tab-safe: activity
//     in any tab resets the timer in all open tabs.
//   - Checks every 5 seconds: if (now - lastActivity) > (minutes * 60s),
//     calls onLogout.
//   - At (minutes - warningSeconds/60) minutes, shows a warning modal.
//   - Listens for mousemove, keydown, scroll, touchstart, click, and
//     resets the timestamp on any of these.
//   - On visibilitychange: when tab becomes visible again, immediately
//     re-checks; if elapsed time is past the limit, logs out at once.
//   - On storage event for 'tmc_last_activity' from another tab,
//     refreshes its in-memory copy.
/* TMC_PATCH27_IDLE_FIX: rewrite installIdleLogout to fix Stay-button race */
window.installIdleLogout = function(opts) {
  // IDLE_LOGOUT_DISABLED_IN_APP: in the Capacitor mobile app, do not
  // auto-log out on inactivity. The 90-day JWT governs session length
  // there. Web users keep the original idle-logout behavior.
  if (typeof window !== 'undefined' && window.tmcIsInApp === true) {
    return;
  }
  opts = opts || {};
  var minutes = opts.minutes || 10;
  var warningSeconds = opts.warningSeconds || 60;
  var onLogout = opts.onLogout || function() { window.location.href = '/signin.html'; };

  var IDLE_INTERVAL_MS = 5000;
  var WARN_INTERVAL_MS = 250;
  var LIMIT_MS = minutes * 60 * 1000;
  var WARN_MS = LIMIT_MS - warningSeconds * 1000;

  var warningEl = null;
  var loggedOut = false;
  var pollHandle = null;
  var currentInterval = IDLE_INTERVAL_MS;
  var justClickedUntil = 0;

  // Global handle for the Stay button (called via onclick attribute).
  // Re-assigning each install is safe; only one idle helper ever runs.
  window.__tmcStaySignedIn = function() {
    var now = Date.now();
    try { localStorage.setItem('tmc_last_activity', String(now)); } catch (e) {}
    justClickedUntil = now + 1500; // suppress logout for 1.5s after click
    hideWarning();
    rescheduleTick(IDLE_INTERVAL_MS);
  };

  function recordActivity() {
    if (loggedOut) return;
    try { localStorage.setItem('tmc_last_activity', String(Date.now())); } catch (e) {}
    hideWarning();
  }

  function showWarning() {
    if (warningEl) { warningEl.style.display = 'flex'; return; }
    var div = document.createElement('div');
    div.id = 'tmc-idle-warning';
    div.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;font-family:inherit';
    div.innerHTML = '<div style="background:#fff;border-radius:18px;padding:24px 22px;max-width:340px;width:100%;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,.3)">' +
      '<div style="width:48px;height:48px;border-radius:50%;background:#FFF3EC;display:flex;align-items:center;justify-content:center;margin:0 auto 14px"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FF6B00" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>' +
      '<div style="font-size:16px;font-weight:800;color:#111;margin-bottom:6px">Still there?</div>' +
      '<div style="font-size:13px;color:#6B7280;margin-bottom:18px;line-height:1.5">You&#39;ll be signed out in <span id="tmc-idle-count">60</span> <span id="tmc-idle-unit">seconds</span> for inactivity.</div>' +
      '<button id="tmc-idle-stay" type="button" onclick="window.__tmcStaySignedIn()" style="width:100%;height:44px;border:none;border-radius:12px;background:#FF6B00;color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">Stay signed in</button>' +
    '</div>';
    document.body.appendChild(div);
    warningEl = div;
  }

  function hideWarning() {
    if (warningEl) warningEl.style.display = 'none';
  }

  function getLastActivity() {
    try {
      var v = parseInt(localStorage.getItem('tmc_last_activity') || '0', 10);
      return v > 0 ? v : Date.now();
    } catch (e) { return Date.now(); }
  }

  function doLogout() {
    if (loggedOut) return;
    loggedOut = true;
    if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
    try { localStorage.removeItem('tmc_last_activity'); } catch (e) {}
    try { onLogout(); } catch (e) { console.error('logout callback error:', e); }
  }

  function rescheduleTick(intervalMs) {
    if (currentInterval === intervalMs && pollHandle) return;
    if (pollHandle) clearInterval(pollHandle);
    currentInterval = intervalMs;
    pollHandle = setInterval(tick, intervalMs);
  }

  function tick() {
    if (loggedOut) return;
    var now = Date.now();
    // Suppress logout briefly after a "Stay signed in" click, to ride out
    // any race conditions.
    if (now < justClickedUntil) {
      rescheduleTick(IDLE_INTERVAL_MS);
      return;
    }
    var elapsed = now - getLastActivity();
    if (elapsed >= LIMIT_MS) {
      doLogout();
      return;
    }
    if (elapsed >= WARN_MS) {
      showWarning();
      rescheduleTick(WARN_INTERVAL_MS); // smooth countdown when warning shown
      var remaining = Math.max(0, Math.ceil((LIMIT_MS - elapsed) / 1000));
      var c = document.getElementById('tmc-idle-count');
      if (c) c.textContent = remaining;
      var u = document.getElementById('tmc-idle-unit');
      if (u) u.textContent = (remaining === 1 ? 'second' : 'seconds');
    } else {
      hideWarning();
      rescheduleTick(IDLE_INTERVAL_MS);
    }
  }

  // Initialize last-activity to "now" on install.
  recordActivity();

  // Activity listeners (throttled writes).
  var events = ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'];
  var lastWrite = 0;
  events.forEach(function(ev) {
    window.addEventListener(ev, function() {
      var now = Date.now();
      if (now - lastWrite < 5000) return;
      lastWrite = now;
      recordActivity();
    }, { passive: true });
  });

  // Tab visibility — re-check when tab becomes visible
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) tick();
  });

  // Multi-tab: respond to last-activity updates from other tabs
  window.addEventListener('storage', function(e) {
    if (e.key === 'tmc_last_activity') {
      hideWarning();
      rescheduleTick(IDLE_INTERVAL_MS);
    }
  });

  // Start polling
  rescheduleTick(IDLE_INTERVAL_MS);
};


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
// 
// ADD THIS ENTIRE BLOCK TO THE END OF public/app.js
// 

//  QUICK MESSAGE TEMPLATES (auto-injects into contact page) 
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
        <div class="qm-icon" style="background:#FEF3C7"></div>
        <div class="qm-label">Your lights are on</div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
      <div class="qm-row" onclick="sendQuickMessage('Your car is being towed')">
        <div class="qm-icon" style="background:#FEE2E2"></div>
        <div class="qm-label">Your car is being towed</div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
      <div class="qm-row" onclick="sendQuickMessage('You are parked illegally')">
        <div class="qm-icon" style="background:#FFF3EC"></div>
        <div class="qm-label">You're parked illegally</div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
      <div class="qm-row" onclick="sendQuickMessage('Your alarm is going off')">
        <div class="qm-icon" style="background:#DBEAFE"></div>
        <div class="qm-label">Your alarm is going off</div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
      <div class="qm-row" onclick="sendQuickMessage('Someone hit your car')" style="border-bottom:none">
        <div class="qm-icon" style="background:#FCE7F3"></div>
        <div class="qm-label">Someone hit your car</div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
      <div id="custom-msg-row" class="qm-row" onclick="showCustomMessage()" style="border-bottom:none">
        <div class="qm-icon" style="background:#F3F4F6"></div>
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
      <div style="font-size:18px;margin-bottom:6px"></div>
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
  if (text.length > 200) { showToast('Message too long  max 200 characters'); return; }
  sendQuickMessage(text);
}

// Auto-inject on contact pages
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(injectQuickMessages, 1500);
});


//  TAG PAUSE/RESUME (for dashboard) 
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
      showToast(action === 'pause' ? 'Tag paused  strangers cannot contact you' : 'Tag resumed  you are reachable again');
      // Reload page to reflect change
      setTimeout(() => window.location.reload(), 800);
    } else {
      showToast(data.error || 'Failed to ' + action);
    }
  } catch(e) { showToast('Network error'); }
}


//  SCAN NOTIFICATION (call notify-owner when tag is scanned) 
async function notifyScan(tagId, scanId) {
  try {
    await fetch('/api/notify-owner', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ tag_id: tagId, action: 'scan', scan_id: scanId })
    });
  } catch(e) { /* silent fail */ }
}


//  PAUSED STATE HANDLER (for contact pages) 
function showPausedState() {
  // Check if we're on a contact page and tag is paused
  // This is called from contact.html when tag.status === 'paused'
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


//  HANDLE CALL WITH NOTIFICATION 
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

// 
// AI CHATBOT  REPLACE the old chatbot code in app.js
// Delete everything from "//  CHATBOT SYSTEM PROMPT " to the end
// Then paste this entire block
// 

//  CHATBOT SYSTEM PROMPT 
const TMC_SYSTEM_PROMPT = `You are TapMyCar Assistant  a friendly, warm, and respectful support agent for TapMyCar, a privacy-first vehicle contact system by Praman Tech LLC, New Britain, Connecticut.

ABOUT TAPMYCAR:
- Car owners place a QR/NFC sticker on their vehicle
- Strangers scan to contact the owner privately  owner's real phone number is NEVER shared
- All calls are masked through a secure proxy  neither party sees real numbers
- Owner gets voice screening: Press 1 to send auto-message, Press 2 to connect directly
- Quick message alerts: strangers can tap preset messages like "Your lights are on" or "Your car is being towed"

PLANS (only mention pricing when specifically asked):
- eTag: Free digital QR code for 30 days, download instantly, 3 masked calls/month. TMC_PATCH62_ETAG30 After 30 days the user chooses to upgrade to Standard or Premium to keep the tag active - if they do not upgrade, the eTag deactivates. There is NO automatic charge; the user is never billed without choosing to.
- Standard: Physical NFC + QR sticker shipped home, 10 masked calls/month, SMS scan alerts
- Premium: 3 vehicles, unlimited masked calls, scan history, emergency contact
- Business: Fleet dashboard, bulk stickers with logo

HOW IT WORKS:
1. Register free at tapmycar.io
2. Get instant digital eTag (QR code PDF)
3. Print and place on windshield
4. Activate to enable masked calling
5. On a paid plan, the physical NFC + QR sticker ships to your home

COMMON ISSUES:
- QR not scanning  Ensure good lighting, clean QR, camera focused. Try zooming in.
- Can't download PDF  Log in first, then go to Tag page
- Want a refund  Self-serve on the Settings page within 14 days ($1 fee retained)
- Sticker not arrived  Ships after day 30, check dashboard for status
- Lost my tag  Sign in with email, tag is still active
- Pause tag  Toggle from dashboard
- Change phone  Go to Settings page

RULES:
- Be warm, human-like, concise. Short sentences. 2-3 sentences max.
- NEVER mention prices or dollar amounts unless the user specifically asks about pricing or cost
- If someone says hi/hello, respond warmly and ask how you can help
- If you cannot solve something, say "Let me connect you with our team  email support@tapmycar.io and we will help you within 24 hours."
- Never make up features that don't exist
- Always be soft and respectful`;

//  INJECT CHATBOT 
function injectChatbot() {
  /* TMC_PATCH39B: the admin page sets window.__tmcNoChat. We check that
     flag instead of the URL so the admin page can have a secret name
     without that name ever appearing in this public file. */
  if (window.__tmcNoChat) return;

  const chatHTML = `
    <div id="tmc-chat-bubble" onclick="toggleChat()" style="position:fixed;bottom:24px;right:20px;width:56px;height:56px;border-radius:50%;background:#FF6B00;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 20px rgba(255,107,0,.4);z-index:200;transition:transform .2s">
      <svg id="chat-icon-open" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <svg id="chat-icon-close" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" style="display:none"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </div>
    <div id="tmc-chat-badge" style="position:fixed;bottom:72px;right:20px;background:#111;color:#fff;font-size:11px;font-weight:600;padding:6px 12px;border-radius:10px 10px 0 10px;z-index:200;box-shadow:0 2px 10px rgba(0,0,0,.15);display:none;cursor:pointer" onclick="toggleChat()">Need help? </div>
    <div id="tmc-chat-window" style="display:none;position:fixed;bottom:90px;right:16px;width:340px;max-width:calc(100vw - 32px);height:480px;max-height:calc(100vh - 120px);background:#fff;border-radius:20px;box-shadow:0 8px 40px rgba(0,0,0,.2);z-index:201;flex-direction:column;overflow:hidden">
      <div style="background:#FF6B00;padding:16px;display:flex;align-items:center;gap:10px;flex-shrink:0">
        <div style="width:36px;height:36px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0"><!-- TMC_PATCH40 -->
          <img src="/logo.png" alt="TapMyCar" width="30" height="30" style="display:block;object-fit:contain" />
        </div>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:700;color:#fff">TapMyCar Support</div>
          <div style="font-size:10px;color:rgba(255,255,255,.8);display:flex;align-items:center;gap:4px"><div style="width:6px;height:6px;border-radius:50%;background:#4ADE80"></div>Online now</div>
        </div>
        <button onclick="toggleChat()" style="background:rgba(255,255,255,.2);border:none;border-radius:8px;width:30px;height:30px;display:flex;align-items:center;justify-content:center;cursor:pointer"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div id="tmc-chat-messages" style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px">
        <div class="tmc-msg tmc-msg-bot"><div class="tmc-msg-bubble" id="tmc-greeting-bubble">Hi there! Welcome to TapMyCar. How can I help you today?</div></div>
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

  // ─── TMC_MAKE_DRAGGABLE: long-press to drag, tap to open ────
  (function setupDraggableBubble() {
    const bubble = document.getElementById('tmc-chat-bubble');
    const badge = document.getElementById('tmc-chat-badge');
    if (!bubble) return;

    // Dynamically position bubble above bottom nav (if present)
    // Measures actual nav height + safe-area + gap — works on all screen sizes
    function positionBubbleAboveNav() {
      const nav = document.querySelector(
        '.mobile-bottom, .bnav, .bottom-nav, .bottom-tabs, .tab-bar, nav.bottom, [class*="bottom-nav"], [class*="mobile-nav"]'
      );

      // If user has dragged the bubble, don't overwrite their position
      if (bubble.style.top && bubble.style.top !== 'auto') return;

      let navHeight = 0;
      if (nav) {
        const rect = nav.getBoundingClientRect();
        navHeight = rect.height;
        // Only apply if nav is actually at/near bottom of viewport
        const isAtBottom = (window.innerHeight - rect.bottom) < 50;
        if (!isAtBottom) navHeight = 0;
      }

      if (navHeight > 0) {
        const gap = 16; // breathing room between bubble and nav
        const bubbleBottom = navHeight + gap;
        bubble.style.bottom = bubbleBottom + 'px';
        if (badge) badge.style.bottom = (bubbleBottom + 48) + 'px';
      } else {
        bubble.style.bottom = '24px';
        if (badge) badge.style.bottom = '72px';
      }
    }

    // Position immediately and re-measure on resize/orientation change
    positionBubbleAboveNav();
    // Re-check after a moment in case nav loads with delay
    setTimeout(positionBubbleAboveNav, 500);
    setTimeout(positionBubbleAboveNav, 1500);
    window.addEventListener('resize', positionBubbleAboveNav);
    window.addEventListener('orientationchange', positionBubbleAboveNav);

    let pressTimer = null;
    let isDragging = false;
    let startX = 0, startY = 0;
    let currentX = 0, currentY = 0;
    const LONG_PRESS_MS = 500;
    const DRAG_THRESHOLD = 6; // pixels before we count it as a drag

    function getPoint(e) {
      if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
      return { x: e.clientX, y: e.clientY };
    }

    function onPressStart(e) {
      const pt = getPoint(e);
      startX = pt.x;
      startY = pt.y;
      currentX = pt.x;
      currentY = pt.y;
      isDragging = false;

      pressTimer = setTimeout(() => {
        isDragging = true;
        bubble.style.transition = 'none';
        bubble.style.transform = 'scale(1.1)';
        bubble.style.cursor = 'grabbing';
        // Vibrate briefly on mobile if available
        if (navigator.vibrate) navigator.vibrate(30);
      }, LONG_PRESS_MS);
    }

    function onPressMove(e) {
      const pt = getPoint(e);
      const dx = pt.x - startX;
      const dy = pt.y - startY;

      // If user moves finger a lot BEFORE long-press fires → cancel the press entirely (they meant to scroll)
      if (!isDragging && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
        clearTimeout(pressTimer);
        pressTimer = null;
        return;
      }

      if (!isDragging) return;

      // We're dragging — reposition bubble
      e.preventDefault();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const size = 56;
      const margin = 8;

      let newLeft = pt.x - size / 2;
      let newTop = pt.y - size / 2;
      newLeft = Math.max(margin, Math.min(vw - size - margin, newLeft));
      newTop = Math.max(margin, Math.min(vh - size - margin, newTop));

      // Switch from bottom/right anchoring to top/left anchoring
      bubble.style.left = newLeft + 'px';
      bubble.style.top = newTop + 'px';
      bubble.style.right = 'auto';
      bubble.style.bottom = 'auto';

      // Hide the "Need help?" badge while dragging (it would look weird)
      if (badge) badge.style.display = 'none';

      currentX = pt.x;
      currentY = pt.y;
    }

    function onPressEnd(e) {
      clearTimeout(pressTimer);
      pressTimer = null;

      if (isDragging) {
        // End of drag — just release, don't open chat
        bubble.style.transition = 'transform .2s';
        bubble.style.transform = '';
        bubble.style.cursor = 'pointer';
        // Stop event from triggering onclick
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        isDragging = false;
        // Tiny settle animation
        setTimeout(() => { bubble.style.transition = ''; }, 220);
        return false;
      }
      // Not a drag → normal tap flow happens via the onclick="toggleChat()" already on bubble
      return true;
    }

    // Touch events (mobile)
    bubble.addEventListener('touchstart', onPressStart, { passive: true });
    bubble.addEventListener('touchmove', onPressMove, { passive: false });
    bubble.addEventListener('touchend', onPressEnd);
    bubble.addEventListener('touchcancel', () => { clearTimeout(pressTimer); isDragging = false; });

    // Mouse events (desktop)
    bubble.addEventListener('mousedown', onPressStart);
    document.addEventListener('mousemove', function(e) { if (pressTimer !== null || isDragging) onPressMove(e); });
    document.addEventListener('mouseup', function(e) { if (pressTimer !== null || isDragging) onPressEnd(e); });

    // If drag ended, the onclick for toggleChat should NOT fire.
    // Capture-phase click listener swallows the click that happens right after drag end.
    bubble.addEventListener('click', function(e) {
      if (bubble.__justDragged) {
        e.stopImmediatePropagation();
        e.preventDefault();
        bubble.__justDragged = false;
      }
    }, true);

    // Mark bubble as just-dragged so the click gets swallowed
    const origEnd = onPressEnd;
    bubble.addEventListener('touchend', function() {
      if (isDragging || (currentX !== startX || currentY !== startY)) {
        bubble.__justDragged = true;
        setTimeout(() => { bubble.__justDragged = false; }, 300);
      }
    });
    bubble.addEventListener('mouseup', function() {
      if (isDragging) {
        bubble.__justDragged = true;
        setTimeout(() => { bubble.__justDragged = false; }, 300);
      }
    });
  })();
  // ─── end TMC_MAKE_DRAGGABLE ──────────────────────────────────

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

// TMC_PATCH37 - chatbot now talks to the /api/chat backend
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

//  SMART OFFLINE RESPONSES 
function getSmartResponse(question) {
  const q = question.toLowerCase();

  // TMC_PATCH63_ETAG: deterministic answer for eTag-duration questions,
  // so the bot can never say the eTag is permanent / never expires.
  if (q.indexOf("etag") !== -1 || q.indexOf("e-tag") !== -1 ||
      (q.indexOf("free") !== -1 && (q.indexOf("tag") !== -1 || q.indexOf("qr") !== -1))) {
    if (q.indexOf("how long") !== -1 || q.indexOf("days") !== -1 ||
        q.indexOf("expire") !== -1 || q.indexOf("expir") !== -1 ||
        q.indexOf("last") !== -1 || q.indexOf("duration") !== -1 ||
        q.indexOf("permanent") !== -1 || q.indexOf("forever") !== -1 ||
        q.indexOf("indefinit") !== -1 || q.indexOf("30") !== -1) {
      return /* TMC_PATCH65_BILLING */ "Here's exactly how the eTag works. The eTag is free to download. To activate it, you pay a one-time $1 and choose your plan - Standard or Premium - and by activating you're agreeing to that plan. You then get 30 days to experience the full service, and you're free to cancel anytime within those 30 days if it's not for you. If you don't cancel: on day 30 your physical sticker ships and your card is charged for it ($9.99 for Standard, $24.99 for Premium), and on day 60 your annual plan begins ($9.99/year for Standard, $19.99/year for Premium) and renews yearly. You can always cancel before a charge in Settings. Full details are at tapmycar.io/pricing.";
    }
  }

  // Greetings
  if (q.match(/^(hi|hey|hello|good morning|good evening|sup|yo|howdy)/)) {
    return 'Hey there! Welcome to TapMyCar support. How can I help you today?';
  }

  // Thanks
  if (q.match(/^(thanks|thank you|thx|ty|appreciate)/)) {
    return 'You\'re welcome! Let me know if there\'s anything else I can help with. ';
  }

  // Activation
  if (q.includes('activate') || q.includes('activation')) {
    return 'To activate your tag, go to your dashboard and tap "Activate" or visit tapmycar.io/activate.html. Scan your QR code and follow the steps  it only takes a minute!';
  }

  // QR scanning issues
  if ((q.includes('qr') || q.includes('scan')) && (q.includes('not') || q.includes('won\'t') || q.includes('cant') || q.includes('can\'t') || q.includes('doesn\'t') || q.includes('issue') || q.includes('problem'))) {
    return 'Try these steps: make sure the QR is well-lit and flat (not crinkled). Hold your camera steady and zoom in slightly. If it still doesn\'t work, you can download a fresh PDF from your Tag page.';
  }

  // Masked calling
  if (q.includes('mask') || (q.includes('call') && q.includes('work')) || q.includes('privacy') || q.includes('number safe') || q.includes('hide number')) {
    return 'Your real phone number is never shared with anyone. When someone taps Call on your tag, the call routes through our secure proxy  neither side sees the other\'s real number. Completely private!';
  }

  // Refund
  if (q.includes('refund') || q.includes('money back') || q.includes('charge')) {
    return 'You can request a refund within 14 days of purchase - a $1 service fee is kept. Just open the Settings page and cancel: if you\'re within the window, a "Refund available" option appears and the refund goes back to your card automatically. Note: activation fees and shipped stickers are non-refundable.';
  }

  // Sticker / shipping
  if (q.includes('sticker') || q.includes('ship') || q.includes('deliver') || q.includes('physical')) {
    return 'Physical stickers ship after your 30-day period. You can check the status on your dashboard. If it\'s been longer than expected, email us at support@tapmycar.io and we\'ll look into it.';
  }

  // Pause tag
  if (q.includes('pause') || q.includes('disable') || q.includes('stop') || q.includes('turn off')) {
    return 'You can pause your tag anytime from your dashboard. When paused, strangers won\'t be able to contact you. Just toggle it back on whenever you\'re ready!';
  }

  // Pricing  only when explicitly asked
  if (q.includes('price') || q.includes('pricing') || q.includes('cost') || q.includes('how much') || q.includes('plan') || q.includes('subscription') || q.includes('upgrade')) {
    return 'We have plans for every need  from a free eTag to our Premium and Business options. Check out all the details at tapmycar.io/pricing.html. Happy to answer specific questions about any plan!';
  }

  // Cancel
  if (q.includes('cancel') || q.includes('unsubscribe') || q.includes('delete account')) {
    return 'You can cancel anytime  no long-term commitment. Email us at support@tapmycar.io and we\'ll take care of it for you right away.';
  }

  // Lost tag
  if (q.includes('lost') || q.includes('forgot') || q.includes('can\'t find') || q.includes('cant find')) {
    return 'No worries! Your tag is linked to your account. Just sign in at tapmycar.io/signin.html with your email  everything is still there and active.';
  }

  // Change info
  if (q.includes('change') && (q.includes('phone') || q.includes('email') || q.includes('name') || q.includes('number'))) {
    return 'You can update your personal info in the Settings page. Go to tapmycar.io/settings.html and make your changes there.';
  }

  // How it works
  if (q.includes('how') && (q.includes('work') || q.includes('use'))) {
    return 'It\'s simple! Register free, get your digital QR code, print and place it on your car. When someone needs to reach you, they scan the QR and can call you privately  your real number stays hidden. You control everything from your dashboard.';
  }

  // NFC
  if (q.includes('nfc') || q.includes('tap')) {
    return 'Our physical stickers come with both a QR code and NFC chip. Anyone can either scan the QR with their camera or tap their phone on the NFC chip  both work!';
  }

  // Multiple cars
  if (q.includes('multiple') || q.includes('second car') || q.includes('more than one') || q.includes('another car')) {
    return 'Our Premium plan supports up to 3 vehicles, and Business supports unlimited. Check tapmycar.io/pricing.html for details!';
  }

  // Emergency
  if (q.includes('emergency') || q.includes('911') || q.includes('accident')) {
    return 'In any life-threatening emergency, always call 911 first. TapMyCar is designed for non-emergency situations like parking issues, lights left on, or someone needing to reach you about your vehicle.';
  }

  // Default  friendly catch-all
  return 'Great question! Let me connect you with our team for the best answer. Email us at support@tapmycar.io and we\'ll get back to you within 24 hours. Is there anything else I can help with?';
}

// Auto-inject chatbot on every page

// TMC_PATCH40 - greet a signed-in user by their first name
function personalizeChatGreeting() {
  try {
    var bubble = document.getElementById('tmc-greeting-bubble');
    if (!bubble) return;
    var raw = (localStorage.getItem('tmc_name') || '').trim();
    if (!raw) return; // signed-out visitor - keep the generic greeting
    var first = raw.split(/\s+/)[0];
    if (!first) return;
    first = first.charAt(0).toUpperCase() + first.slice(1);
    bubble.textContent = 'Hi ' + first + '! Welcome back to TapMyCar. How can I help you today?';
  } catch (e) { /* keep the generic greeting on any error */ }
}

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(function () {
    injectChatbot();
    personalizeChatGreeting();
  }, 1000);
});

// 
// DASHBOARD FEATURES  Add to END of public/app.js
// 

//  INJECT PAUSE BUTTON ON DASHBOARD 
function injectPauseButton() { return;
  // Only run on dashboard page
  if (!window.location.pathname.includes('dashboard')) return;
  // Wait for dashboard to load
  setTimeout(() => {
    const tagTokenEl = document.querySelector('[id*="tag-token"], .tag-token, [data-tag-token]');
    // Find the tag card area  look for QR code or tag display section
    const tagCard = document.querySelector('.card') || document.querySelector('[id*="tag"]');
    if (!tagCard) return;

    // Check if pause button already exists
    if (document.getElementById('tmc-pause-btn')) return;

    // Get user's tag data from the page
    const s = getSession ? getSession() : null;
    if (!s) return;

    fetch('/api/get-dashboard?user_id=' + s.token)
      .then(r => r.json())
      .then(data => {
        if (!data.tags || data.tags.length === 0) return;
        const tag = data.tags.find(t => t.status === 'active' || t.status === 'paused') || data.tags[0];
        if (!tag) return;

        const isPaused = tag.status === 'paused';
        const btnHTML = `
          <div id="tmc-pause-btn" style="margin-top:10px">
            <button onclick="toggleTagPause('${tag.token}','${tag.status}')" style="width:100%;height:44px;border-radius:12px;border:1.5px solid ${isPaused ? 'var(--gn,#16A34A)' : 'var(--rd,#DC2626)'};background:${isPaused ? 'rgba(22,163,74,.08)' : 'rgba(220,38,38,.08)'};color:${isPaused ? 'var(--gn,#16A34A)' : 'var(--rd,#DC2626)'};font-size:13px;font-weight:700;cursor:pointer;font-family:'Inter',sans-serif;display:flex;align-items:center;justify-content:center;gap:8px">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                ${isPaused ? '<polygon points="5 3 19 12 5 21 5 3"/>' : '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'}
              </svg>
              ${isPaused ? 'Resume Tag  Go Active' : 'Pause Tag  Go Invisible'}
            </button>
            ${isPaused ? '<div style="text-align:center;font-size:10px;color:var(--rd,#DC2626);margin-top:6px;font-weight:600">Your tag is currently paused. Strangers cannot contact you.</div>' : '<div style="text-align:center;font-size:10px;color:var(--gy,#6B7280);margin-top:6px">Pausing hides your tag from strangers temporarily.</div>'}
          </div>
        `;

        // Insert after the first card
        tagCard.insertAdjacentHTML('afterend', btnHTML);
      });
  }, 2000);
}

document.addEventListener('DOMContentLoaded', () => {
  //setTimeout(injectPauseButton, 500);
});


//  SETTINGS SAVE TO SUPABASE 
async function saveSettings() {
  const s = getSession ? getSession() : null;
  if (!s) { showToast('Please sign in first'); return; }

  const name = document.getElementById('s-name')?.value?.trim();
  const email = document.getElementById('s-email')?.value?.trim();
  const phone = document.getElementById('s-phone')?.value?.trim();

  if (!name) { showToast('Name is required'); return; }

  const btn = document.querySelector('#save-btn, [onclick*="saveSettings"]');
  if (btn) { btn.textContent = 'Saving...'; btn.disabled = true; }

  try {
    const res = await fetch('/api/get-dashboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: s.token,
        name: name,
        email: email || undefined,
        phone: phone || undefined
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Settings saved!');
      // Update session with new name
      if (s.name !== name) {
        const session = JSON.parse(localStorage.getItem('tmc_session') || '{}');
        session.name = name;
        localStorage.setItem('tmc_session', JSON.stringify(session));
      }
    } else {
      showToast(data.error || 'Failed to save');
    }
  } catch(e) { showToast('Network error'); }

  if (btn) { btn.textContent = 'Save Changes'; btn.disabled = false; }
}


//  REFERRAL SYSTEM 
function generateReferralCode() {
  const s = getSession ? getSession() : null;
  if (!s) return '';
  // Create referral code from user ID
  const code = 'TMC-REF-' + s.token.slice(0, 6).toUpperCase();
  return code;
}

function getReferralLink() {
  const code = generateReferralCode();
  return 'https://tapmycar.io/register.html?ref=' + code;
}

function shareReferral() {
  const link = getReferralLink();
  const text = 'Get TapMyCar  privacy-first vehicle contact. When you buy a Standard plan, you get 1 free tag! Use my link: ' + link;

  if (navigator.share) {
    navigator.share({ title: 'TapMyCar Referral', text: text, url: link }).catch(() => {});
  } else {
    navigator.clipboard.writeText(text).then(() => {
      showToast('Referral link copied!');
    });
  }
}

function injectReferralCard() { return;
  if (!window.location.pathname.includes('dashboard')) return;
  setTimeout(() => {
    const pauseBtn = document.getElementById('tmc-pause-btn');
    const insertAfter = pauseBtn || document.querySelector('.card');
    if (!insertAfter || document.getElementById('tmc-referral-card')) return;

    const code = generateReferralCode();
    const link = getReferralLink();

    const html = `
      <div id="tmc-referral-card" style="background:linear-gradient(135deg,#FF6B00 0%,#FF8533 100%);border-radius:14px;padding:16px;margin-top:12px;color:#fff">
        <div style="font-size:14px;font-weight:800;margin-bottom:4px">Invite a Friend</div>
        <div style="font-size:11px;opacity:.85;line-height:1.5;margin-bottom:12px">Share your referral link. When they buy a Standard plan, they get 1 free tag!</div>
        <div style="background:rgba(255,255,255,.2);border-radius:10px;padding:10px 12px;font-size:11px;font-family:monospace;margin-bottom:10px;word-break:break-all">${link}</div>
        <div style="display:flex;gap:8px">
          <button onclick="shareReferral()" style="flex:1;height:38px;border-radius:10px;background:#fff;color:#FF6B00;font-size:12px;font-weight:700;border:none;cursor:pointer;font-family:'Inter',sans-serif">Share Link</button>
          <button onclick="navigator.clipboard.writeText('${link}');showToast('Link copied!')" style="flex:1;height:38px;border-radius:10px;background:rgba(255,255,255,.2);color:#fff;font-size:12px;font-weight:700;border:none;cursor:pointer;font-family:'Inter',sans-serif">Copy Link</button>
        </div>
      </div>
    `;

    insertAfter.insertAdjacentHTML('afterend', html);
  }, 2500);
}

document.addEventListener('DOMContentLoaded', () => {
  //setTimeout(injectReferralCard, 600);
});


//  SCAN LOCATION MAP (simple text-based for now, no Google Maps API needed) 
function injectScanMap() { return;
  if (!window.location.pathname.includes('dashboard') && !window.location.pathname.includes('activity')) return;

  setTimeout(() => {
    const s = getSession ? getSession() : null;
    if (!s) return;
    if (document.getElementById('tmc-scan-map')) return;

    fetch('/api/get-dashboard?user_id=' + s.token)
      .then(r => r.json())
      .then(data => {
        if (!data.recentScans || data.recentScans.length === 0) return;

        const referralCard = document.getElementById('tmc-referral-card');
        const insertAfter = referralCard || document.getElementById('tmc-pause-btn') || document.querySelector('.card');
        if (!insertAfter) return;

        const scans = data.recentScans.slice(0, 5);
        const scanHTML = scans.map(s => {
          const date = new Date(s.scanned_at).toLocaleString('en-US', {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
          const action = s.contact_action || s.action || 'view';
          const device = s.device_type || 'unknown';
          const actionColor = action === 'call' ? 'var(--gn,#16A34A)' : action === 'quick_message' ? 'var(--or,#FF6B00)' : 'var(--gy,#6B7280)';
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:.5px solid var(--bd,#E5E7EB)">
            <div>
              <div style="font-size:12px;font-weight:600;color:var(--bk,#111)">${date}</div>
              <div style="font-size:10px;color:var(--gy,#6B7280)">${device} device</div>
            </div>
            <span style="font-size:10px;font-weight:700;color:${actionColor};background:${actionColor}15;padding:3px 8px;border-radius:99px">${action}</span>
          </div>`;
        }).join('');

        const html = `
          <div id="tmc-scan-map" style="background:var(--gbl,#F9FAFB);border-radius:14px;padding:16px;margin-top:12px;border:.5px solid var(--bd,#E5E7EB)">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
              <div style="font-size:14px;font-weight:800;color:var(--bk,#111)">Recent Activity</div>
              <a href="/activity.html" style="font-size:11px;color:var(--or,#FF6B00);font-weight:600;text-decoration:none">View all </a>
            </div>
            ${scanHTML}
            <div style="text-align:center;margin-top:10px;font-size:10px;color:var(--gy,#6B7280)">Total scans: ${data.scanCount || 0}  This week: ${data.weekCount || 0}</div>
          </div>
        `;

        insertAfter.insertAdjacentHTML('afterend', html);
      });
  }, 3000);
}

document.addEventListener('DOMContentLoaded', () => {
  //setTimeout(injectScanMap, 700);
});


//  AUTO TAG ASSIGNMENT (on registration) 
// This runs on the success/dashboard page after registration
async function autoAssignTag() {
  const s = getSession ? getSession() : null;
  if (!s) return;

  // Check if user already has a tag
  try {
    const res = await fetch('/api/get-dashboard?user_id=' + s.token);
    const data = await res.json();

    if (data.tags && data.tags.length > 0) return; // Already has a tag

    // Find an unclaimed tag and assign it
    // We don't have a direct API for this, so we skip auto-assign
    // The user gets their tag via the activate page flow
    // This is a placeholder  full auto-assign needs admin to pre-allocate
    console.log('New user  no tag assigned yet. User should visit /activate.html');
  } catch(e) {}
}

// Run on dashboard load
if (window.location.pathname.includes('dashboard')) {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(autoAssignTag, 3000);
  });
}


// TMC_PATCH41_WEBPUSH: pushManager.subscribe() requires the VAPID key as a
// Uint8Array, not a string. This converts the base64url public key.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

async function registerPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const s = getSession();
  if (!s || !s.token) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array('BDJaBVzTHDODJtF9xeEwuaVsEb2axVw1xPkRCK1Gdv57G5iZFBY-jADC1Tx9A3rxZfVQsqyA1Uk4qYHBlNYnbyU')
    });
    const key = sub.getKey('p256dh');
    const auth = sub.getKey('auth');
    await fetch('/api/save-push-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: s.token,
        endpoint: sub.endpoint,
        p256dh: btoa(String.fromCharCode(...new Uint8Array(key))),
        auth: btoa(String.fromCharCode(...new Uint8Array(auth)))
      })
    });
  } catch(e) { console.error('Push registration error:', e); }
}

// TMC_PATCH57_ANNOUNCE_POPUP - in-app announcement popup.
// On page load, a logged-in user is shown the newest announcement they
// have not yet dismissed. Dismissing records it so it never shows again.
(function () {
  function tmcEscAnn(s) {
    return String(s == null ? "" : s).replace(/[<>&"]/g, function (c) {
      return ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;" })[c];
    });
  }

  function showAnnouncementPopup(ann, userId) {
    // TMC_PATCH58_POPUP_REDESIGN - Option 2: minimal, orange title.
    if (document.getElementById("tmc-ann-overlay")) return;

    var overlay = document.createElement("div");
    overlay.id = "tmc-ann-overlay";
    overlay.style.cssText = "position:fixed;inset:0;z-index:99999;" +
      "background:rgba(17,17,17,.45);display:flex;align-items:center;" +
      "justify-content:center;padding:24px;font-family:Inter,-apple-system," +
      "Segoe UI,Roboto,sans-serif";

    var bodyHtml = tmcEscAnn(ann.body).replace(/\r?\n/g, "<br>");
    overlay.innerHTML =
      '<div style="background:#fff;max-width:340px;width:100%;' +
        'border-radius:18px;box-shadow:0 14px 44px rgba(0,0,0,.28);' +
        'padding:30px 28px 26px;text-align:center">' +
          '<div style="font-size:19px;font-weight:800;color:#FF6B00;' +
            'margin-bottom:4px">TapMyCar Alert</div>' +
          '<div style="width:34px;height:2px;background:#E5E7EB;' +
            'margin:13px auto 17px"></div>' +
          /* TMC_PATCH61_NOTITLE: show the title row only when there is one */
          ((ann.title && String(ann.title).trim())
            ? ('<div style="font-size:15px;font-weight:700;color:#111;' +
               'margin-bottom:8px">' + tmcEscAnn(ann.title) + '</div>')
            : '') +
          '<div style="font-size:14px;line-height:1.65;color:#6B7280;' +
            'margin-bottom:24px">' + bodyHtml + '</div>' +
          '<button id="tmc-ann-close" style="padding:12px 36px;border:none;' +
            'border-radius:9px;background:#FF6B00;color:#fff;font-size:14px;' +
            'font-weight:700;cursor:pointer;font-family:inherit">Close</button>' +
      '</div>';

    document.body.appendChild(overlay);

    function markSeen() {
      try {
        fetch("/api/seen-announcement", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: userId, announcement_id: ann.id })
        }).catch(function () {});
      } catch (e) {}
    }
    function dismiss() {
      markSeen();
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }

    document.getElementById("tmc-ann-close").onclick = dismiss;
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) dismiss();
    });
  }

  function checkAnnouncement() {
    var token = null;
    try { token = localStorage.getItem("tmc_token"); } catch (e) {}
    if (!token) return;  // only logged-in users see in-app popups

    fetch("/api/get-announcement?user_id=" + encodeURIComponent(token))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.success && d.announcement) {
          showAnnouncementPopup(d.announcement, token);
        }
      })
      .catch(function () { /* silent - popup is non-critical */ });
  }

  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(checkAnnouncement, 1200);
  });
})();

/* TMC_PATCH39B applied */
