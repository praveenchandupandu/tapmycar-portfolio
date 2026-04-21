// ═══════════════════════════════════════════════════════════════
// FINAL fix for Reviews panel placement + styling in admin.html
// ═══════════════════════════════════════════════════════════════
// Strategy:
//   1. Find and DELETE all existing Reviews panel markup + scripts
//   2. Insert a fresh, correctly-styled Reviews panel INSIDE content-wrap
//      right after the scans panel (matching the flow of other panels)
//   3. Insert the Reviews JS in the main <script> block where other
//      functions live, not floating at end of body
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

const filePath = path.join(ROOT, 'public', 'admin.html');
if (!fs.existsSync(filePath)) {
  console.error('public/admin.html not found');
  process.exit(1);
}
let content = fs.readFileSync(filePath, 'utf8');

console.log('Step 1: Removing all existing Reviews markup...');

// Remove Reviews panel HTML — find the `<!-- REVIEWS TAB -->` comment and 
// remove through the closing </div> of panel-reviews
const reviewsPanelStart = content.indexOf('<!-- REVIEWS TAB -->');
if (reviewsPanelStart !== -1) {
  // Panel ends with <div id="reviews-list">...</div>\n</div>
  const reviewsListIdx = content.indexOf('<div id="reviews-list">', reviewsPanelStart);
  if (reviewsListIdx !== -1) {
    // Find the closing </div></div> sequence (panel closer)
    const afterList = reviewsListIdx + '<div id="reviews-list">'.length;
    // First </div> closes reviews-list, second closes panel-reviews
    const firstClose = content.indexOf('</div>', afterList);
    const secondClose = content.indexOf('</div>', firstClose + 6);
    if (secondClose !== -1) {
      const panelEnd = secondClose + 6;
      content = content.substring(0, reviewsPanelStart) + content.substring(panelEnd);
      console.log('  [OK] Removed old panel HTML');
    }
  }
}

// Remove old Reviews script block (the one with `let currentReviewTab`)
content = content.replace(/<script>\s*let currentReviewTab[\s\S]*?<\/script>\s*/g, '');
console.log('  [OK] Removed old Reviews script');

// Remove TAB_TITLES/SUBS reviews entries so we re-add cleanly
content = content.replace(/, ?"reviews": "Reviews"/g, '');
content = content.replace(/, ?"reviews": "Review moderation[^"]*"/g, '');
content = content.replace(/, ?"reviews": "Approve reviews[^"]*"/g, '');

console.log('Step 2: Inserting Reviews panel in correct location...');

// The correct insertion point: right before </div>\n  </main> (closes content-wrap)
const newPanelHtml = `
      <!-- REVIEWS TAB -->
      <div class="panel" id="panel-reviews">
        <div class="kpi-grid">
          <div class="kpi-mini"><div class="kpi-mini-label">Pending</div><div class="kpi-mini-value warn" id="rev-pending-count">0</div></div>
          <div class="kpi-mini"><div class="kpi-mini-label">Approved</div><div class="kpi-mini-value green" id="rev-approved-count">0</div></div>
          <div class="kpi-mini"><div class="kpi-mini-label">On landing</div><div class="kpi-mini-value orange" id="rev-landing-count">0</div></div>
        </div>

        <div class="pill-group" style="margin-bottom:20px">
          <button class="pill active" id="rev-tab-pending" onclick="loadReviewsTab('pending')">Pending</button>
          <button class="pill" id="rev-tab-approved" onclick="loadReviewsTab('approved')">Approved</button>
          <button class="pill" id="rev-tab-rejected" onclick="loadReviewsTab('rejected')">Rejected</button>
        </div>

        <div id="reviews-list"><div class="empty">Loading reviews...</div></div>
      </div>
`;

// Find the closing of content-wrap: look for </div>\n  </main>
const insertBeforePattern = /(\s*)<\/div>\s*<\/main>/;
const match = content.match(insertBeforePattern);
if (!match) {
  console.error('ERROR: could not find content-wrap closing tag');
  process.exit(1);
}
content = content.replace(insertBeforePattern, newPanelHtml + '$1</div>\n  </main>');
console.log('  [OK] Panel inserted inside content-wrap');

console.log('Step 3: Adding Reviews JS + TAB_TITLES...');

// Add Reviews entries to TAB_TITLES and TAB_SUBS
content = content.replace(
  '"upgrade": "Upgrade tracker"',
  '"upgrade": "Upgrade tracker", "reviews": "Reviews"'
);
content = content.replace(
  '"upgrade": "Users approaching day 30 auto-upgrade"',
  '"upgrade": "Users approaching day 30 auto-upgrade", "reviews": "Approve reviews, toggle visibility, feature on landing"'
);

// Add the Reviews JS block right before </body>
const reviewsScript = `
<script>
// ─── REVIEWS MODERATION ──────────────────────────────────
let currentReviewTab = 'pending';

function getAdminKey() {
  if (typeof adminKey !== 'undefined' && adminKey) return adminKey;
  return localStorage.getItem('tmc_admin_key') || '';
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function loadReviewsTab(status) {
  currentReviewTab = status;
  // Toggle pill style
  ['pending','approved','rejected'].forEach(s => {
    const btn = document.getElementById('rev-tab-' + s);
    if (btn) btn.classList.toggle('active', s === status);
  });

  const container = document.getElementById('reviews-list');
  container.innerHTML = '<div class="empty">Loading...</div>';

  try {
    const res = await fetch('/api/get-reviews?status=' + status + '&limit=200&admin_key=' + encodeURIComponent(getAdminKey()));
    const data = await res.json();

    if (!data.reviews || data.reviews.length === 0) {
      container.innerHTML = '<div class="empty">No ' + status + ' reviews</div>';
      return;
    }

    // Count featured on landing + sort
    const featured = status === 'approved'
      ? data.reviews.filter(r => r.featured_on_landing).sort((a,b) => (a.landing_order||0) - (b.landing_order||0))
      : [];

    container.innerHTML = data.reviews.map(r => renderReviewCard(r, status, featured)).join('');
  } catch (e) {
    container.innerHTML = '<div class="empty">Failed to load: ' + e.message + '</div>';
  }
}

function renderReviewCard(r, status, featuredList) {
  const created = new Date(r.created_at).toLocaleString('en-US', {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'});
  const cityLine = r.city ? ' · ' + escapeHtml(r.city) : '';

  // Top-right actions (approve/reject for pending, delete for rejected)
  let topActions = '';
  if (status === 'pending') {
    topActions =
      '<button class="gen-btn success" style="height:36px;padding:0 16px;font-size:12px" onclick="moderateReview(\\'' + r.id + '\\', \\'approve\\')">Approve</button>' +
      '<button class="gen-btn danger" style="height:36px;padding:0 16px;font-size:12px" onclick="moderateReview(\\'' + r.id + '\\', \\'reject\\')">Reject</button>';
  } else if (status === 'rejected') {
    topActions = '<button class="gen-btn-outline" style="height:36px;border-color:var(--danger);color:var(--danger);padding:0 16px;font-size:12px" onclick="moderateReview(\\'' + r.id + '\\', \\'delete\\')">Delete</button>';
  }

  // Bottom controls (approved reviews only)
  let controls = '';
  if (status === 'approved') {
    const visON = r.visible_on_reviews !== false;
    const featON = r.featured_on_landing === true;
    const landingIdx = featON && featuredList ? featuredList.findIndex(f => f.id === r.id) : -1;
    const landingBadge = landingIdx >= 0
      ? '<span class="ba" style="background:var(--brand-soft);color:var(--brand)">Landing #' + (landingIdx + 1) + '</span>'
      : '';

    const visBtn = '<button class="gen-btn-outline" style="height:32px;padding:0 12px;font-size:11px;' +
      (visON ? 'border-color:var(--success);color:var(--success)' : 'border-color:var(--text-4);color:var(--text-4)') +
      '" onclick="moderateReview(\\'' + r.id + '\\', \\'toggle_reviews_page\\')">Reviews page: ' + (visON ? 'ON' : 'OFF') + '</button>';

    const featBtn = '<button class="gen-btn-outline" style="height:32px;padding:0 12px;font-size:11px;' +
      (featON ? 'border-color:var(--brand);color:var(--brand)' : 'border-color:var(--text-4);color:var(--text-4)') +
      '" onclick="moderateReview(\\'' + r.id + '\\', \\'toggle_landing\\')">Landing: ' + (featON ? 'ON' : 'OFF') + '</button>';

    let arrows = '';
    if (featON) {
      arrows =
        '<button class="gen-btn-outline" style="height:32px;width:32px;padding:0;font-size:14px" title="Move up" onclick="moderateReview(\\'' + r.id + '\\', \\'move_up\\')">↑</button>' +
        '<button class="gen-btn-outline" style="height:32px;width:32px;padding:0;font-size:14px" title="Move down" onclick="moderateReview(\\'' + r.id + '\\', \\'move_down\\')">↓</button>';
    }

    controls =
      '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);display:flex;flex-wrap:wrap;gap:6px;align-items:center">' +
        visBtn + featBtn + arrows + landingBadge +
        '<button class="gen-btn-outline" style="height:32px;padding:0 12px;font-size:11px;border-color:var(--danger);color:var(--danger);margin-left:auto" onclick="moderateReview(\\'' + r.id + '\\', \\'delete\\')">Delete</button>' +
      '</div>';
  }

  return '<div class="order-card">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px;flex-wrap:wrap">' +
      '<div style="min-width:0;flex:1">' +
        '<div style="font-size:14px;font-weight:700;color:var(--text)">' + escapeHtml(r.name) + cityLine + '</div>' +
        '<div style="font-size:11px;color:var(--text-4);margin-top:3px">' + created + '</div>' +
      '</div>' +
      (topActions ? '<div style="display:flex;gap:6px;flex-shrink:0">' + topActions + '</div>' : '') +
    '</div>' +
    '<div style="font-size:13px;color:var(--text-2);line-height:1.6;font-style:italic">"' + escapeHtml(r.text) + '"</div>' +
    controls +
  '</div>';
}

async function moderateReview(reviewId, action) {
  const confirmTexts = { 'delete': 'Permanently delete this review?', 'reject': 'Reject this review?' };
  if (confirmTexts[action] && !confirm(confirmTexts[action])) return;

  try {
    const res = await fetch('/api/moderate-review', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ review_id: reviewId, action, admin_key: getAdminKey() })
    });
    const data = await res.json();
    if (data.success) {
      loadReviewsTab(currentReviewTab);
      updateReviewCounts();
      if (typeof showToast === 'function') showToast('Updated');
    } else {
      alert('Error: ' + (data.error || 'unknown'));
    }
  } catch (e) { alert('Network error: ' + e.message); }
}

async function updateReviewCounts() {
  try {
    const key = encodeURIComponent(getAdminKey());
    const [pendingRes, approvedRes] = await Promise.all([
      fetch('/api/get-reviews?status=pending&limit=200&admin_key=' + key).then(r => r.json()),
      fetch('/api/get-reviews?status=approved&limit=200&admin_key=' + key).then(r => r.json())
    ]);
    const pendingCount = (pendingRes.reviews || []).length;
    const approvedCount = (approvedRes.reviews || []).length;
    const landingCount = (approvedRes.reviews || []).filter(r => r.featured_on_landing).length;
    const pEl = document.getElementById('rev-pending-count'); if (pEl) pEl.textContent = pendingCount;
    const aEl = document.getElementById('rev-approved-count'); if (aEl) aEl.textContent = approvedCount;
    const lEl = document.getElementById('rev-landing-count'); if (lEl) lEl.textContent = landingCount;
  } catch (e) { /* silent */ }
}

// Auto-load counts and first tab when navigating to reviews
document.addEventListener('click', function(e) {
  const t = e.target.closest('[data-tab="reviews"]');
  if (t) setTimeout(() => { updateReviewCounts(); loadReviewsTab('pending'); }, 100);
});

// Also load counts once after admin login completes
window.addEventListener('load', function() {
  setTimeout(updateReviewCounts, 1500);
});
</script>
`;

// Place the Reviews script right before </body>
content = content.replace('</body>', reviewsScript + '\n</body>');

fs.writeFileSync(filePath, content, 'utf8');
fs.copyFileSync(filePath, path.join(ROOT, 'admin.html'));

console.log('  [OK] Script block added');
console.log('  [OK] TAB_TITLES/SUBS updated');
console.log('  [SYNC] public/admin.html -> admin.html');
console.log('');
console.log('Now commit and push:');
console.log('  git add -A');
console.log('  git commit -m "Rebuild Reviews panel with proper layout"');
console.log('  git push');
