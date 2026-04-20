// ════════════════════════════════════════════════════════════════
// TapMyCar — Session 6: Review system frontend integration
// ════════════════════════════════════════════════════════════════
// Surgical edits only:
//   1. settings.html — add "Leave a review" button + modal + handler
//   2. landing.html  — replace static Mike R. testimonial with dynamic loop
//                      (falls back to Mike R. if no approved reviews exist yet)
//   3. admin.html    — add Reviews tab + moderation UI
// ════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
let totalFixes = 0;

function patchFile(relPath, patches) {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) {
    console.log(`  [SKIP] ${relPath} not found`);
    return;
  }
  let content = fs.readFileSync(fullPath, 'utf8');
  let fileChanges = 0;

  for (const { name, find, replace } of patches) {
    if (content.includes(find)) {
      content = content.replace(find, replace);
      console.log(`  [FIX] ${relPath} :: ${name}`);
      fileChanges++;
      totalFixes++;
    } else if (replace && content.includes(replace.split('\n')[0])) {
      console.log(`  [OK]  ${relPath} :: ${name} (already patched)`);
    } else {
      console.log(`  [WARN] ${relPath} :: ${name} \u2014 pattern not found`);
    }
  }

  if (fileChanges > 0) {
    fs.writeFileSync(fullPath, content, 'utf8');
    const baseName = path.basename(relPath);
    fs.copyFileSync(fullPath, path.join(ROOT, baseName));
  }
}

console.log('\u2550\u2550\u2550 Session 6: Review system frontend integration \u2550\u2550\u2550');
console.log('');

// ────────────────────────────────────────────────────────────────
// 1. settings.html: Add "Leave a review" row + modal + handler
// ────────────────────────────────────────────────────────────────
console.log('Part 1: settings.html');

patchFile('public/settings.html', [
  {
    name: 'add Leave a review row in App section',
    find: `  <!-- App -->
  <div class="sl">App</div>
  <div class="set-row" onclick="window.location.href='/landing.html'"><div class="set-l"><div class="set-ic" style="background:var(--orl)"><svg viewBox="0 0 24 24" stroke="var(--or)"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div><div><div class="set-t">About TapMyCar</div><div class="set-s">Privacy for you. Safety for your car.</div></div></div><div class="arr"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></div></div>`,
    replace: `  <!-- App -->
  <div class="sl">App</div>
  <div class="set-row" onclick="window.location.href='/landing.html'"><div class="set-l"><div class="set-ic" style="background:var(--orl)"><svg viewBox="0 0 24 24" stroke="var(--or)"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div><div><div class="set-t">About TapMyCar</div><div class="set-s">Privacy for you. Safety for your car.</div></div></div><div class="arr"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></div></div>
  <div class="set-row" onclick="openReviewModal()" id="leave-review-row"><div class="set-l"><div class="set-ic" style="background:var(--orl)"><svg viewBox="0 0 24 24" stroke="var(--or)"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg></div><div><div class="set-t">Leave a review</div><div class="set-s">Share your experience with TapMyCar</div></div></div><div class="arr"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></div></div>
  <div class="set-row" onclick="window.location.href='/reviews.html'"><div class="set-l"><div class="set-ic" style="background:var(--orl)"><svg viewBox="0 0 24 24" stroke="var(--or)"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg></div><div><div class="set-t">All reviews</div><div class="set-s">See what others say</div></div></div><div class="arr"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></div></div>`
  },
  {
    name: 'add review modal HTML before closing body',
    find: `</body>`,
    replace: `<!-- Review Modal -->
<div id="review-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;align-items:flex-end;justify-content:center" onclick="if(event.target===this)closeReviewModal()">
  <div style="background:#fff;width:100%;max-width:430px;border-radius:20px 20px 0 0;padding:24px 20px;max-height:85vh;overflow-y:auto">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div style="font-size:20px;font-weight:800;color:#111">Share your experience</div>
      <button onclick="closeReviewModal()" style="background:none;border:none;font-size:24px;color:#9CA3AF;cursor:pointer;padding:4px">\u00D7</button>
    </div>
    <div style="font-size:13px;color:#6B7280;margin-bottom:16px;line-height:1.5">Your review will be visible after our team approves it. Reviews help others trust TapMyCar.</div>

    <label style="font-size:12px;font-weight:700;color:#111;display:block;margin-bottom:6px">Your name</label>
    <input type="text" id="rev-name" placeholder="e.g. Sarah M." maxlength="60" style="width:100%;height:42px;border:1.5px solid #E5E7EB;border-radius:11px;padding:0 12px;font-size:14px;margin-bottom:14px;font-family:inherit;box-sizing:border-box">

    <label style="font-size:12px;font-weight:700;color:#111;display:block;margin-bottom:6px">City <span style="color:#9CA3AF;font-weight:400">(optional)</span></label>
    <input type="text" id="rev-city" placeholder="e.g. Hartford, CT" maxlength="60" style="width:100%;height:42px;border:1.5px solid #E5E7EB;border-radius:11px;padding:0 12px;font-size:14px;margin-bottom:14px;font-family:inherit;box-sizing:border-box">

    <label style="font-size:12px;font-weight:700;color:#111;display:block;margin-bottom:6px">Your review</label>
    <textarea id="rev-text" placeholder="What do you love about TapMyCar? Share specifics about how it helped you." maxlength="500" rows="5" style="width:100%;border:1.5px solid #E5E7EB;border-radius:11px;padding:10px 12px;font-size:14px;margin-bottom:6px;font-family:inherit;resize:vertical;box-sizing:border-box"></textarea>
    <div style="font-size:11px;color:#9CA3AF;margin-bottom:16px"><span id="rev-count">0</span> / 500 characters (min 10)</div>

    <button class="btn" id="rev-submit-btn" onclick="submitReview()" style="margin-bottom:8px">Submit review</button>
    <button class="btn-o" onclick="closeReviewModal()">Cancel</button>
  </div>
</div>

<script>
function openReviewModal() {
  if (!s || !s.token) { window.location.href = '/signin.html'; return; }
  document.getElementById('rev-name').value = (localStorage.getItem('tmc_name') || '').slice(0, 60);
  document.getElementById('rev-modal-update-count')();
  document.getElementById('review-modal').style.display = 'flex';
}
function closeReviewModal() {
  document.getElementById('review-modal').style.display = 'none';
}
async function submitReview() {
  const name = document.getElementById('rev-name').value.trim();
  const city = document.getElementById('rev-city').value.trim();
  const text = document.getElementById('rev-text').value.trim();

  if (!name) { showToast('Please enter your name'); return; }
  if (text.length < 10) { showToast('Review must be at least 10 characters'); return; }

  const btn = document.getElementById('rev-submit-btn');
  btn.textContent = 'Submitting...'; btn.disabled = true;

  try {
    const res = await fetch('/api/submit-review', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ user_id: s.token, name, city, text })
    });
    const data = await res.json();
    if (data.success) {
      closeReviewModal();
      showToast('Thank you! Your review is awaiting approval.');
      document.getElementById('rev-text').value = '';
      document.getElementById('rev-city').value = '';
    } else {
      showToast(data.error || 'Failed to submit review');
    }
  } catch (e) { showToast('Network error \u2014 please try again'); }
  btn.textContent = 'Submit review'; btn.disabled = false;
}

// Live character count
window.addEventListener('DOMContentLoaded', () => {
  const ta = document.getElementById('rev-text');
  const counter = document.getElementById('rev-count');
  // Provide a wrapper that the open function can call
  const updateCount = () => { counter.textContent = ta.value.length; };
  document.getElementById('rev-modal-update-count') === null;
  // Attach a no-arg handler accessible by id-style call we used above
  Object.defineProperty(document.getElementById('rev-text'), 'updateCount', { value: updateCount });
  ta.addEventListener('input', updateCount);
  // Patch openReviewModal call to safely update
  const realOpen = openReviewModal;
  window.openReviewModal = function() {
    if (!s || !s.token) { window.location.href = '/signin.html'; return; }
    document.getElementById('rev-name').value = (localStorage.getItem('tmc_name') || '').slice(0, 60);
    updateCount();
    document.getElementById('review-modal').style.display = 'flex';
  };
});

// Auto-open if user came via #leave-review hash
window.addEventListener('load', () => {
  if (window.location.hash === '#leave-review') {
    setTimeout(() => openReviewModal(), 300);
  }
});
</script>
</body>`
  }
]);

// ────────────────────────────────────────────────────────────────
// 2. landing.html: replace static testimonial with dynamic loop
// ────────────────────────────────────────────────────────────────
console.log('');
console.log('Part 2: landing.html');

const landingPath = path.join(ROOT, 'public', 'landing.html');
if (fs.existsSync(landingPath)) {
  let content = fs.readFileSync(landingPath, 'utf8');
  let changed = false;

  // Find the testimonials wrapper containing Mike R., wrap it with id so JS can replace
  const oldBlock = `<div class="test-name">Mike R.</div>`;
  if (content.includes(oldBlock) && !content.includes('id="testimonials-container"')) {
    // Find the parent element and add id - simplest approach: add a marker comment + dynamic loader
    // We inject a script at the end that replaces the testimonial section content with approved reviews if any
    const injectionPoint = '</body>';
    const dynamicScript = `
<script>
// Dynamic reviews loader - replaces fake testimonial with real approved reviews if any exist
(async function loadApprovedReviews() {
  try {
    const res = await fetch('/api/get-reviews?status=approved&limit=3');
    const data = await res.json();
    if (!data.reviews || data.reviews.length === 0) return; // keep fallback Mike R.

    // Find the testimonial card (the one containing Mike R. originally) and replace its inner content with first approved review
    const testNames = document.querySelectorAll('.test-name');
    if (testNames.length === 0) return;

    // Build replacement HTML using the first approved review (most recent)
    const r = data.reviews[0];
    const escape = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

    // Replace name and city/sub fields with first review
    testNames[0].textContent = escape(r.name);
    const subs = document.querySelectorAll('.test-sub');
    if (subs.length > 0 && r.city) subs[0].textContent = escape(r.city);

    // Find the matching quote element. The site uses a quote text right above the author block.
    // Try to find the closest preceding paragraph or italic text and replace its content.
    const card = testNames[0].closest('div').parentElement;
    if (card) {
      const quoteEl = card.querySelector('p, .test-quote, em, i');
      if (quoteEl) quoteEl.textContent = '"' + escape(r.text) + '"';
    }
  } catch (e) {
    // Silent fallback - landing keeps showing Mike R. testimonial
  }
})();
</script>
</body>`;

    content = content.replace('</body>', dynamicScript);
    changed = true;
    console.log('  [FIX] landing.html :: injected dynamic reviews loader (falls back to Mike R. if no approved reviews)');
    totalFixes++;
  } else if (content.includes('loadApprovedReviews')) {
    console.log('  [OK]  landing.html :: dynamic reviews loader already present');
  } else {
    console.log('  [WARN] landing.html :: could not find Mike R. testimonial to enhance');
  }

  if (changed) {
    fs.writeFileSync(landingPath, content, 'utf8');
    fs.copyFileSync(landingPath, path.join(ROOT, 'landing.html'));
  }
}

// ────────────────────────────────────────────────────────────────
// 3. admin.html: add Reviews tab
// ────────────────────────────────────────────────────────────────
console.log('');
console.log('Part 3: admin.html \u2014 Reviews moderation tab');

patchFile('public/admin.html', [
  {
    name: 'add Reviews tab button next to Leads',
    find: `  <div class="tab" onclick="showTab('leads')">Leads</div>
</div>`,
    replace: `  <div class="tab" onclick="showTab('leads')">Leads</div>
  <div class="tab" onclick="showTab('reviews')">Reviews</div>
</div>`
  },
  {
    name: 'add Reviews panel + JS handlers before closing body',
    find: `</body>`,
    replace: `<!-- REVIEWS TAB -->
<div class="panel" id="panel-reviews">
  <div class="asl">Reviews moderation</div>
  <div style="display:flex;gap:8px;margin-bottom:16px">
    <button onclick="loadReviewsTab('pending')" class="rev-tab-btn" id="rev-tab-pending" style="background:#FF6B00;color:#fff;border:none;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Pending <span id="rev-pending-count" style="background:rgba(255,255,255,0.3);padding:2px 6px;border-radius:8px;margin-left:4px">0</span></button>
    <button onclick="loadReviewsTab('approved')" class="rev-tab-btn" id="rev-tab-approved" style="background:#1E2D4A;color:#94A3B8;border:none;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Approved</button>
    <button onclick="loadReviewsTab('rejected')" class="rev-tab-btn" id="rev-tab-rejected" style="background:#1E2D4A;color:#94A3B8;border:none;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Rejected</button>
  </div>
  <div id="reviews-list"><div class="empty">Click a tab to load reviews</div></div>
</div>

<script>
let currentReviewTab = null;

async function loadReviewsTab(status) {
  currentReviewTab = status;
  // Toggle button styling
  document.querySelectorAll('.rev-tab-btn').forEach(b => {
    b.style.background = '#1E2D4A';
    b.style.color = '#94A3B8';
  });
  const activeBtn = document.getElementById('rev-tab-' + status);
  if (activeBtn) {
    activeBtn.style.background = '#FF6B00';
    activeBtn.style.color = '#fff';
  }

  const container = document.getElementById('reviews-list');
  container.innerHTML = '<div class="empty">Loading...</div>';

  try {
    const res = await fetch('/api/get-reviews?status=' + status + '&limit=200&admin_key=' + encodeURIComponent(getAdminKey()));
    const data = await res.json();

    if (!data.reviews || data.reviews.length === 0) {
      container.innerHTML = '<div class="empty">No ' + status + ' reviews</div>';
      if (status === 'pending') document.getElementById('rev-pending-count').textContent = '0';
      return;
    }

    if (status === 'pending') document.getElementById('rev-pending-count').textContent = data.reviews.length;

    container.innerHTML = data.reviews.map(r => {
      const created = new Date(r.created_at).toLocaleString();
      const cityLine = r.city ? ' \u00B7 ' + escapeHtml(r.city) : '';
      const actions = status === 'pending'
        ? '<button onclick="moderateReview(\\'' + r.id + '\\', \\'approve\\')" style="background:#16A34A;color:#fff;border:none;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;margin-right:6px">Approve</button>' +
          '<button onclick="moderateReview(\\'' + r.id + '\\', \\'reject\\')" style="background:#DC2626;color:#fff;border:none;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Reject</button>'
        : '<button onclick="moderateReview(\\'' + r.id + '\\', \\'delete\\')" style="background:#1E2D4A;color:#fff;border:1px solid #94A3B8;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">Delete</button>';

      return '<div style="background:#0F172A;border:1px solid #1E2D4A;border-radius:12px;padding:16px;margin-bottom:12px">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">' +
          '<div><div style="font-size:13px;font-weight:700;color:#fff">' + escapeHtml(r.name) + cityLine + '</div>' +
          '<div style="font-size:10px;color:#64748B;margin-top:2px">' + created + '</div></div>' +
          '<div>' + actions + '</div>' +
        '</div>' +
        '<div style="font-size:13px;color:#CBD5E1;line-height:1.5;font-style:italic">"' + escapeHtml(r.text) + '"</div>' +
      '</div>';
    }).join('');
  } catch (e) {
    container.innerHTML = '<div class="empty">Failed to load: ' + e.message + '</div>';
  }
}

async function moderateReview(reviewId, action) {
  const confirmText = action === 'delete' ? 'Permanently delete this review?' : action === 'reject' ? 'Reject this review?' : null;
  if (confirmText && !confirm(confirmText)) return;

  try {
    const res = await fetch('/api/moderate-review', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ review_id: reviewId, action, admin_key: getAdminKey() })
    });
    const data = await res.json();
    if (data.success) {
      // Reload current tab
      loadReviewsTab(currentReviewTab);
    } else {
      alert('Error: ' + (data.error || 'unknown'));
    }
  } catch (e) { alert('Network error: ' + e.message); }
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function getAdminKey() {
  // Read from same place admin.html stores it (URL param, localStorage, prompt)
  return localStorage.getItem('admin_key') || new URLSearchParams(window.location.search).get('key') || '';
}

// Auto-load pending count on admin page load
window.addEventListener('load', () => {
  setTimeout(() => {
    fetch('/api/get-reviews?status=pending&limit=200&admin_key=' + encodeURIComponent(getAdminKey()))
      .then(r => r.json())
      .then(d => {
        if (d.reviews) {
          document.getElementById('rev-pending-count').textContent = d.reviews.length;
        }
      })
      .catch(() => {});
  }, 1000);
});
</script>
</body>`
  }
]);

console.log('');
console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
console.log(`Total fixes applied: ${totalFixes}`);
console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
console.log('');
console.log('REMINDER: also drop these new files into the project:');
console.log('  api/submit-review.js');
console.log('  api/get-reviews.js');
console.log('  api/moderate-review.js');
console.log('  public/reviews.html');
console.log('');
console.log('AND run reviews-migration.sql in Supabase BEFORE testing');
console.log('');
console.log('Then commit and push:');
console.log('  git add -A');
console.log('  git commit -m "Session 6: review system with admin moderation"');
console.log('  git push');
