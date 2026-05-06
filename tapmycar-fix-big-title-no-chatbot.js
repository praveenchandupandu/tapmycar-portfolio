// ═══════════════════════════════════════════════════════════════
// TapMyCar — bigger brand title + uppercase tagline + no chatbot
// ═══════════════════════════════════════════════════════════════
// Three changes to public/contact.html:
//
//   1. Brand title scaled up to 26px (was 15px), logo to 44px
//   2. Tagline restyled as compact uppercase tracked text:
//      "PRIVACY FOR YOU · SAFETY FOR YOUR CAR"
//   3. Chatbot bubble + window suppressed on this page only
//      (app.js auto-injects on every page; we hide just here so
//      strangers contacting an owner don't see an AI assistant)
//
// app.js stays untouched — chatbot still works on dashboard, settings,
// landing page, and everywhere else. Suppression is local.
//
// Run from project root:  node tapmycar-fix-big-title-no-chatbot.js
// Idempotent. Touches only public/contact.html.
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const TARGET = path.join(ROOT, 'public', 'contact.html');

if (!fs.existsSync(TARGET)) {
  console.error('ERROR: public/contact.html not found.');
  process.exit(1);
}

// Backup
const now = new Date();
const stamp = now.getFullYear() + '-' +
  String(now.getMonth()+1).padStart(2,'0') + '-' +
  String(now.getDate()).padStart(2,'0') + '-' +
  String(now.getHours()).padStart(2,'0') +
  String(now.getMinutes()).padStart(2,'0');
const BACKUP = path.join(ROOT, 'backup-bigtitle-nobot-' + stamp);
fs.mkdirSync(BACKUP, { recursive: true });
fs.copyFileSync(TARGET, path.join(BACKUP, 'contact.html'));
console.log('  Backup: ' + path.relative(ROOT, BACKUP));
console.log('');

let html = fs.readFileSync(TARGET, 'utf8');


// ────────────────────────────────────────────────────────────
// FIX 1 — Replace the brand area with bigger title + uppercase tagline
// ────────────────────────────────────────────────────────────
console.log('━━━ Fix 1: Bigger title + uppercase tagline ━━━');
{
  if (html.indexOf('TMC_BRAND_BIG_UPPERCASE') !== -1) {
    console.log('  Already patched, skipping');
  } else {
    // Match the post-prior-patch brand-l block (the one with TMC_BRAND_TITLE_RESTORED).
    const oldBrandRegex = /<div class="v6-brand-l" style="gap:11px"><!-- TMC_BRAND_TITLE_RESTORED --><img src="\/logo\.png"[^>]*><div class="v6-brand-text"[^>]*><div style="font-size:15px[^"]*"[^>]*>Tap<span[^>]*>My<\/span>Car<\/div><div style="font-size:10px[^"]*"[^>]*>Privacy for you,<br>Safety for your Car<\/div><\/div><\/div>/;

    const newBrand = `<div class="v6-brand-l" style="gap:13px;align-items:center"><!-- TMC_BRAND_BIG_UPPERCASE --><img src="/logo.png" alt="TapMyCar" style="height:44px;width:auto;display:block;flex-shrink:0"><div class="v6-brand-text" style="gap:4px"><div style="font-size:26px;font-weight:800;color:#0E0E0E;letter-spacing:-0.7px;line-height:1">Tap<span style="color:#FF6B00">My</span>Car</div><div style="font-size:9px;color:#6B7280;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;line-height:1.2">Privacy for you &middot; Safety for your car</div></div></div>`;

    if (!oldBrandRegex.test(html)) {
      console.error('  ERROR: could not find TMC_BRAND_TITLE_RESTORED brand-l block.');
      console.error('  Has the file structure changed since the last brand patch?');
      process.exit(1);
    }
    html = html.replace(oldBrandRegex, newBrand);
    console.log('  Brand area: 26px title + 44px logo + uppercase tagline');
  }
}


// ────────────────────────────────────────────────────────────
// FIX 2 — Suppress chatbot on contact.html only
// ────────────────────────────────────────────────────────────
console.log('');
console.log('━━━ Fix 2: Hide chatbot on contact page ━━━');
{
  if (html.indexOf('TMC_NO_CHATBOT_HERE') !== -1) {
    console.log('  Already patched, skipping');
  } else {
    // Inject a small style block + script before </body>.
    // CSS hides the bubble/badge/window if app.js manages to inject them
    // (handles the 1s setTimeout race). The script also removes them
    // outright so they don't sit in the DOM.
    const suppressBlock = `
<!-- TMC_NO_CHATBOT_HERE -->
<style id="tmc-no-chatbot-css">
  #tmc-chat-bubble, #tmc-chat-badge, #tmc-chat-window {
    display: none !important;
    visibility: hidden !important;
    pointer-events: none !important;
  }
</style>
<script id="tmc-no-chatbot-js">
  // Override injectChatbot on this page so app.js's auto-inject is a no-op.
  window.injectChatbot = function(){};
  // Belt-and-suspenders: if anything still injected the elements, remove them.
  function tmcStripChatbot(){
    ['tmc-chat-bubble','tmc-chat-badge','tmc-chat-window'].forEach(id => {
      const el = document.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
  }
  document.addEventListener('DOMContentLoaded', () => {
    tmcStripChatbot();
    setTimeout(tmcStripChatbot, 1100); // catches app.js's 1000ms inject
    setTimeout(tmcStripChatbot, 2500);
  });
</script>`;

    const bodyClose = /<\/body>/;
    if (!bodyClose.test(html)) {
      console.error('  ERROR: contact.html has no </body>');
      process.exit(1);
    }
    html = html.replace(bodyClose, suppressBlock + '\n</body>');
    console.log('  Chatbot suppressed on contact.html (app.js untouched, works elsewhere)');
  }
}


fs.writeFileSync(TARGET, html, 'utf8');

console.log('');
console.log('═══════════════════════════════════════════════');
console.log('  BIG TITLE + NO CHATBOT COMPLETE');
console.log('═══════════════════════════════════════════════');
console.log('  Backup: ' + path.relative(ROOT, BACKUP));
console.log('');
console.log('Deploy:');
console.log('  git add public/contact.html');
console.log('  git commit -m "Bigger brand title + uppercase tagline + no chatbot on contact page"');
console.log('  git push');
console.log('');
console.log('After deploy, on mobile:');
console.log('  - Big bold "TapMyCar" title with orange "My"');
console.log('  - Uppercase tagline below: PRIVACY FOR YOU · SAFETY FOR YOUR CAR');
console.log('  - No orange chat bubble in the bottom-right corner');
console.log('  - Chatbot still works on dashboard, settings, landing, etc.');
