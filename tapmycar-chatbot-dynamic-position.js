// ═══════════════════════════════════════════════════════════════
// Dynamic chatbot positioning:
// Instead of hardcoded 110px, measure actual bottom-nav height
// + safe-area inset + gap, and position bubble ABOVE the nav.
// Also re-measure on window resize/orientation change.
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

const filePath = path.join(ROOT, 'public', 'app.js');
if (!fs.existsSync(filePath)) {
  console.error('public/app.js not found');
  process.exit(1);
}
let content = fs.readFileSync(filePath, 'utf8');

// Find the existing hardcoded block we added
const oldBlock = `    // Auto-offset up when page has bottom nav (dashboard, tag, verify, activity, admin mobile)
    const hasBottomNav = !!(
      document.querySelector('.mobile-bottom') ||
      document.querySelector('.bottom-nav') ||
      document.querySelector('.bottom-tabs') ||
      document.querySelector('.tab-bar')
    );
    if (hasBottomNav) {
      bubble.style.bottom = '110px';
      if (badge) badge.style.bottom = '158px';
    }`;

const newBlock = `    // Dynamically position bubble above bottom nav (if present)
    // Measures actual nav height + safe-area + gap — works on all screen sizes
    function positionBubbleAboveNav() {
      const nav = document.querySelector(
        '.mobile-bottom, .bottom-nav, .bottom-tabs, .tab-bar, nav.bottom, [class*="bottom-nav"], [class*="mobile-nav"]'
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
    window.addEventListener('orientationchange', positionBubbleAboveNav);`;

if (content.includes(newBlock.substring(0, 60))) {
  console.log('[OK] Dynamic positioning already in place');
  process.exit(0);
}

if (!content.includes(oldBlock)) {
  console.log('[WARN] Could not find hardcoded block. Trying flexible match...');
  // Try matching just the core change
  const flexMatch = content.match(/\s*\/\/ Auto-offset up when page has bottom nav[\s\S]*?if \(hasBottomNav\) \{[\s\S]*?\}/);
  if (flexMatch) {
    content = content.replace(flexMatch[0], '\n' + newBlock);
    console.log('[FIX] Replaced hardcoded positioning with dynamic measurement (flex match)');
  } else {
    console.error('[ERROR] Could not locate chatbot positioning code. Manual inspection needed.');
    process.exit(1);
  }
} else {
  content = content.replace(oldBlock, newBlock);
  console.log('[FIX] Replaced hardcoded positioning with dynamic measurement');
}

fs.writeFileSync(filePath, content, 'utf8');
if (fs.existsSync(path.join(ROOT, 'app.js'))) {
  fs.copyFileSync(filePath, path.join(ROOT, 'app.js'));
}
console.log('[SYNC] public/app.js -> app.js');
console.log('');
console.log('Commit and push:');
console.log('  git add -A');
console.log('  git commit -m "Chatbot: dynamically measure bottom nav for auto-positioning"');
console.log('  git push');
