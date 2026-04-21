// Fix landing.html dynamic review loader to properly update
// the quote paragraph, avatar letter, name, and city.

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

const filePath = path.join(ROOT, 'public', 'landing.html');
if (!fs.existsSync(filePath)) {
  console.error('public/landing.html not found');
  process.exit(1);
}
let content = fs.readFileSync(filePath, 'utf8');

// Remove the old broken loader script block
const oldScriptPattern = /<script>\s*\/\/ Dynamic reviews loader[\s\S]*?<\/script>/g;
const hadOld = oldScriptPattern.test(content);
content = content.replace(oldScriptPattern, '');
if (hadOld) console.log('[FIX] Removed broken old review loader');

// Also remove any loadApprovedReviews block
content = content.replace(/<script>\s*\(async function loadApprovedReviews[\s\S]*?<\/script>/g, '');

// Insert new correct loader right before </body>
const newScript = `
<script>
// Dynamic testimonial loader - replaces fake Mike R. with most recent FEATURED review
(async function() {
  try {
    const res = await fetch('/api/get-reviews?status=approved&landing_only=true&limit=1');
    const data = await res.json();
    if (!data.reviews || data.reviews.length === 0) return; // keep Mike R. fallback

    const r = data.reviews[0];
    const esc = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

    // Find the testimonial container
    const testContainer = document.querySelector('.testimonial');
    if (!testContainer) return;

    // 1. Replace the quote paragraph (first <p> child of .testimonial)
    const quoteEl = testContainer.querySelector('p');
    if (quoteEl) quoteEl.innerHTML = '&quot;' + esc(r.text) + '&quot;';

    // 2. Replace the avatar letter
    const avEl = testContainer.querySelector('.test-av');
    if (avEl) avEl.textContent = (r.name || 'U')[0].toUpperCase();

    // 3. Replace name
    const nameEl = testContainer.querySelector('.test-name');
    if (nameEl) nameEl.textContent = r.name;

    // 4. Replace city/subtitle (if present)
    const subEl = testContainer.querySelector('.test-sub');
    if (subEl) subEl.textContent = r.city || 'Verified user';
  } catch (e) {
    // Silent - landing keeps Mike R. fallback
  }
})();
</script>
</body>`;

content = content.replace('</body>', newScript);

fs.writeFileSync(filePath, content, 'utf8');
fs.copyFileSync(filePath, path.join(ROOT, 'landing.html'));
console.log('[FIX] Inserted correct dynamic review loader');
console.log('[SYNC] public/landing.html -> landing.html');
console.log('');
console.log('Now commit and push:');
console.log('  git add -A');
console.log('  git commit -m "Fix landing dynamic review to replace quote text + avatar"');
console.log('  git push');
