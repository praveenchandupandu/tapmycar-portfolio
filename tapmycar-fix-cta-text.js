// Change "Get your free eTag" text to "Explore TapMyCar"
// Keeps the /register.html link as-is

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

const filePath = path.join(ROOT, 'public', 'landing.html');
if (!fs.existsSync(filePath)) {
  console.error('public/landing.html not found');
  process.exit(1);
}
let content = fs.readFileSync(filePath, 'utf8');
let fixes = 0;

// Targeted replacements (only in button contexts, not headings)
const replacements = [
  {
    find: '<a href="/register.html" class="hero-btn-primary">Get your free eTag </a>',
    replace: '<a href="/register.html" class="hero-btn-primary">Explore TapMyCar</a>',
    label: 'Hero primary button'
  },
  {
    find: '<a href="/register.html" class="hero-btn-primary">Get your free eTag</a>',
    replace: '<a href="/register.html" class="hero-btn-primary">Explore TapMyCar</a>',
    label: 'Hero primary button (no trailing space)'
  },
  {
    find: '<a href="/register.html" class="cta-btn">Get your free eTag </a>',
    replace: '<a href="/register.html" class="cta-btn">Explore TapMyCar</a>',
    label: 'Bottom CTA button'
  },
  {
    find: '<a href="/register.html" class="cta-btn">Get your free eTag</a>',
    replace: '<a href="/register.html" class="cta-btn">Explore TapMyCar</a>',
    label: 'Bottom CTA button (no trailing space)'
  }
];

for (const r of replacements) {
  if (content.includes(r.find)) {
    content = content.replace(r.find, r.replace);
    console.log(`[FIX] ${r.label}`);
    fixes++;
  }
}

if (fixes === 0) {
  console.log('[WARN] No matches found. Checking for existing Explore TapMyCar text...');
  if (content.includes('Explore TapMyCar')) {
    console.log('[OK] Already changed to Explore TapMyCar');
  }
} else {
  fs.writeFileSync(filePath, content, 'utf8');
  fs.copyFileSync(filePath, path.join(ROOT, 'landing.html'));
  console.log('[SYNC] public/landing.html -> landing.html');
}

console.log('');
console.log('='.repeat(50));
console.log(`Total fixes: ${fixes}`);
console.log('='.repeat(50));
console.log('');
console.log('Commit and push:');
console.log('  git add -A');
console.log('  git commit -m "Landing: change CTA buttons to Explore TapMyCar"');
console.log('  git push');
