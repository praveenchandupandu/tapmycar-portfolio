// TapMyCar — app.js
// Global utilities and helpers

const API = {
  sendOTP: (phone) => fetch('/api/send-otp', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({phone})
  }).then(r => r.json()),

  verifyOTP: (phone, code) => fetch('/api/verify-otp', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({phone, code})
  }).then(r => r.json()),
};

// Show toast notification
function showToast(message, icon = 'check') {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    t.innerHTML = `
      <div class="toast-ic">
        <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <span id="toast-msg"></span>
    `;
    document.body.appendChild(t);
  }
  document.getElementById('toast-msg').textContent = message;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3200);
}

// OTP input — auto advance between boxes
function initOTP() {
  const boxes = document.querySelectorAll('.otp-box');
  boxes.forEach((box, i) => {
    box.addEventListener('input', (e) => {
      if (e.target.value.length === 1) {
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

// Get OTP value from boxes
function getOTPValue() {
  return Array.from(document.querySelectorAll('.otp-box'))
    .map(b => b.value).join('');
}

// Save session
function saveSession(token, phone, name) {
  localStorage.setItem('tmc_token', token);
  localStorage.setItem('tmc_phone', phone);
  localStorage.setItem('tmc_name', name);
}

// Get session
function getSession() {
  return {
    token: localStorage.getItem('tmc_token'),
    phone: localStorage.getItem('tmc_phone'),
    name: localStorage.getItem('tmc_name'),
  };
}

// Check if logged in — redirect if not
function requireAuth() {
  const { token } = getSession();
  if (!token) window.location.href = '/signin.html';
  return token;
}

// Format phone number as user types
function formatPhone(input) {
  input.addEventListener('input', (e) => {
    let v = e.target.value.replace(/\D/g, '');
    if (v.length >= 10) {
      v = '+1 (' + v.slice(0,3) + ') ' + v.slice(3,6) + '-' + v.slice(6,10);
    }
    e.target.value = v;
  });
}

// Resend OTP countdown
function startCountdown(btnId, seconds = 60) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  let s = seconds;
  btn.disabled = true;
  const iv = setInterval(() => {
    btn.textContent = `Resend (${s}s)`;
    s--;
    if (s < 0) {
      clearInterval(iv);
      btn.textContent = 'Resend code';
      btn.disabled = false;
    }
  }, 1000);
}

document.addEventListener('DOMContentLoaded', () => {
  initOTP();
});
