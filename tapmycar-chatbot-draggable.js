// ═══════════════════════════════════════════════════════════════
// Chatbot improvements:
//   1. Auto-offset up by 80px when page has bottom nav (dashboard etc.)
//   2. Long-press (500ms) to drag bubble anywhere on screen
//   3. Single tap still opens/closes chat (drag vs tap detection)
//   4. Position resets on each page load (no localStorage)
//   5. Bubble stays within viewport bounds during drag
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

// Idempotency check
if (content.includes('TMC_MAKE_DRAGGABLE')) {
  console.log('[OK] Chatbot is already draggable. Nothing to do.');
  process.exit(0);
}

// We insert a block AFTER `document.body.appendChild(container);` inside injectChatbot
const insertAfter = 'document.body.appendChild(container);';

const newCode = `document.body.appendChild(container);

  // ─── TMC_MAKE_DRAGGABLE: long-press to drag, tap to open ────
  (function setupDraggableBubble() {
    const bubble = document.getElementById('tmc-chat-bubble');
    const badge = document.getElementById('tmc-chat-badge');
    if (!bubble) return;

    // Auto-offset up when page has bottom nav (dashboard, tag, verify, activity, admin mobile)
    const hasBottomNav = !!(
      document.querySelector('.mobile-bottom') ||
      document.querySelector('.bottom-nav') ||
      document.querySelector('.bottom-tabs') ||
      document.querySelector('.tab-bar')
    );
    if (hasBottomNav) {
      bubble.style.bottom = '88px';
      if (badge) badge.style.bottom = '136px';
    }

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
  // ─── end TMC_MAKE_DRAGGABLE ──────────────────────────────────`;

if (!content.includes(insertAfter)) {
  console.error('[ERROR] Could not find insertion point "document.body.appendChild(container);"');
  process.exit(1);
}

content = content.replace(insertAfter, newCode);

fs.writeFileSync(filePath, content, 'utf8');
// app.js is also in root sometimes
if (fs.existsSync(path.join(ROOT, 'app.js'))) {
  fs.copyFileSync(filePath, path.join(ROOT, 'app.js'));
}

console.log('[FIX] Added draggable chatbot + bottom-nav offset');
console.log('[SYNC] public/app.js -> app.js');
console.log('');
console.log('Now commit and push:');
console.log('  git add -A');
console.log('  git commit -m "Chatbot: long-press draggable + auto-offset above bottom nav"');
console.log('  git push');
