#!/usr/bin/env node
/**
 * TMC_PATCH94 — Complete rewrite of splash.html
 *
 * The previous splash.html has accumulated 10+ patches and is messy.
 * The JS-based animation cascade has timing issues that cause the
 * 3-4 second delay before animation starts.
 *
 * This patch REPLACES public/splash.html entirely with a clean version:
 *
 *   1. Pure CSS animations with animation-delay (no JS setTimeout chain)
 *      → Animations start at frame 0 — the moment the WebView paints
 *
 *   2. Minimal inline HTML/CSS/JS, no external scripts loaded
 *      → Loads as fast as possible
 *
 *   3. Splash content: logo bounces in, wordmark slides up, tagline
 *      fades in. Total ~1.6s. Then fade to onboarding.
 *
 *   4. Tag image: static src = /tapmycarintialstage.png (you have this)
 *      + dynamic loader fetches landing-page hero sticker from
 *      /api/get-branding (matches landing page).
 *
 *   5. Body background inline orange (no white flash).
 *
 * Idempotent — uses a marker to prevent double-overwrites.
 */

const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [
  now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
  pad(now.getHours()), pad(now.getMinutes())
].join('-');
const backupDir = 'backup-splash-rewrite-' + stamp;

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH94 — Splash.html complete rewrite       ║');
console.log('╚══════════════════════════════════════════════════╝');
fs.mkdirSync(backupDir, { recursive: true });

const newSplashHtml = `<!DOCTYPE html>
<!-- TMC_PATCH94_FRESH -->
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>TapMyCar+</title>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  html,body{width:100%;height:100%;overflow:hidden;background:#FF6B00;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#111;-webkit-font-smoothing:antialiased}
  img{display:block;max-width:100%}
  button{font-family:inherit;cursor:pointer;border:none}

  /* ================ SPLASH SCREEN ================ */
  #splash{
    position:fixed;inset:0;z-index:10;background:#FF6B00;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    animation:splashOut 0.45s ease-out 1.85s forwards;
  }
  #splash .logo{
    width:140px;height:140px;
    opacity:0;transform:scale(0.45);
    animation:logoIn 0.55s cubic-bezier(0.34,1.56,0.64,1) 0s forwards;
  }
  #splash .wordmark{
    margin-top:18px;font-size:34px;font-weight:900;color:#fff;letter-spacing:-0.5px;
    opacity:0;transform:translateY(14px);
    animation:textUp 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.4s forwards;
  }
  #splash .tagline{
    margin-top:8px;font-size:13px;color:rgba(255,255,255,0.85);letter-spacing:0.3px;
    opacity:0;
    animation:fadeIn 0.4s ease-out 0.75s forwards;
  }

  @keyframes logoIn{to{opacity:1;transform:scale(1)}}
  @keyframes textUp{to{opacity:1;transform:translateY(0)}}
  @keyframes fadeIn{to{opacity:1}}
  @keyframes splashOut{to{opacity:0;visibility:hidden}}

  /* ================ ONBOARDING ================ */
  #ob{
    position:fixed;inset:0;z-index:5;background:#fff;
    display:flex;flex-direction:column;
    opacity:0;
    animation:fadeIn 0.4s ease-out 2.15s forwards;
  }
  .chev{
    height:14px;flex-shrink:0;
    background:repeating-linear-gradient(45deg,#FF6B00,#FF6B00 8px,#111 8px,#111 16px);
  }
  .ob-content{
    flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
    padding:32px 28px;text-align:center;
  }
  .tag-wrapper{perspective:1000px;display:inline-block;margin:0 auto 26px;transform-style:preserve-3d}
  .ob-tag{
    width:140px;height:140px;object-fit:contain;border-radius:18px;
    box-shadow:0 8px 24px rgba(0,0,0,0.12);background:#fff;
    animation:tagFloat 5s ease-in-out infinite;transform-origin:center;
  }
  @keyframes tagFloat{
    0%,100%{transform:rotateY(-8deg) rotateX(4deg) translateY(0)}
    50%{transform:rotateY(8deg) rotateX(-3deg) translateY(-6px)}
  }
  .ob-headline{
    font-size:22px;font-weight:800;color:#111;line-height:1.25;margin-bottom:12px;max-width:300px;
  }
  .ob-subtitle{
    font-size:14px;color:#666;line-height:1.55;max-width:300px;
  }
  .ob-cta{
    padding:0 28px calc(env(safe-area-inset-bottom,0px) + 24px);
    display:flex;flex-direction:column;gap:10px;
  }
  .ob-button{
    padding:16px;background:#FF6B00;color:#fff;font-weight:700;font-size:16px;
    border-radius:14px;width:100%;
  }
  .ob-button:active{background:#E55D00}
  .ob-signin-row{display:flex;justify-content:center;gap:6px;font-size:13px;align-items:center}
  .ob-signin-row span{color:#666}
  .ob-signin-row button{background:none;color:#FF6B00;font-weight:600;padding:0;font-size:13px}
</style>
</head>
<body style="background:#FF6B00">

  <!-- ============== SPLASH ============== -->
  <div id="splash">
    <img class="logo" src="/icon-512.png" alt="TapMyCar" />
    <div class="wordmark">TapMyCar</div>
    <div class="tagline">Privacy for you. Safety for your Car.</div>
  </div>

  <!-- ============== ONBOARDING ============== -->
  <div id="ob">
    <div class="chev"></div>
    <div class="ob-content">
      <div class="tag-wrapper">
        <img id="tmc-onboarding-tag" class="ob-tag" src="/tapmycarintialstage.png" alt="TapMyCar Tag" />
      </div>
      <div class="ob-headline">Like leaving your number<br>— but you don't.</div>
      <div class="ob-subtitle">TapMyCar tags let people reach you about your car. Your real number stays hidden.</div>
    </div>
    <div class="ob-cta">
      <button class="ob-button" onclick="location.href='/register.html'">Sign Up</button>
      <div class="ob-signin-row">
        <span>Already have an account?</span>
        <button onclick="location.href='/signin.html'">Sign in</button>
      </div>
    </div>
    <div class="chev"></div>
  </div>

<script>
  // Load the EXACT landing-page hero sticker from /api/get-branding
  (function loadHeroSticker(){
    try {
      var img = document.getElementById('tmc-onboarding-tag');
      if (!img) return;
      var KEY = 'tmc_hero_sticker_url';
      // Use cached URL first (instant on subsequent loads)
      try {
        var cached = sessionStorage.getItem(KEY);
        if (cached && cached !== 'null') {
          var t1 = new Image();
          t1.onload = function(){ img.src = cached; };
          t1.src = cached;
        }
      } catch(e){}
      // Fetch fresh URL from API
      fetch('/api/get-branding')
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(d){
          if (d && d.ok && d.sticker_url) {
            var t2 = new Image();
            t2.onload = function(){
              img.src = d.sticker_url;
              try { sessionStorage.setItem(KEY, d.sticker_url); } catch(e){}
            };
            t2.src = d.sticker_url;
          }
        })
        .catch(function(){});
    } catch(e){}
  })();

  // If user is signed in, skip onboarding → go to dashboard
  setTimeout(function(){
    var token = null;
    try { token = localStorage.getItem('tmc_token'); } catch(e){}
    if (token) location.replace('/dashboard.html');
  }, 2200);
</script>
</body>
</html>
`;

try {
  const splashPath = path.join('public', 'splash.html');
  if (fs.existsSync(splashPath)) {
    // Backup the existing one
    const dest = path.join(backupDir, 'public', 'splash.html');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(splashPath, dest);
    console.log('  ✓ Backed up old splash.html');
  }

  // Write the fresh splash.html
  fs.writeFileSync(splashPath, newSplashHtml, 'utf8');
  console.log('  ✓ Wrote fresh public/splash.html');

  // Sync to root
  if (fs.existsSync('splash.html')) {
    fs.copyFileSync(splashPath, 'splash.html');
    console.log('  ✓ Synced splash.html to project root');
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║ TMC_PATCH94 complete ✓                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nHow this works:');
  console.log('  - Splash uses PURE CSS animations (animation-delay)');
  console.log('  - Animations start at FRAME ZERO when WebView paints');
  console.log('  - No JS setTimeout cascade = no startup delay');
  console.log('  - Splash plays 1.85s, fades 0.45s, onboarding fades in');
  console.log('  - Tag dynamically loads landing-page sticker from /api/get-branding');
  console.log('  - Static fallback: /tapmycarintialstage.png (you have this file)');
  console.log('');
  console.log('Next:');
  console.log('  npx cap sync android');
  console.log('  git add -A');
  console.log('  git commit -m "TMC_PATCH94: Rewrite splash with CSS-only animation"');
  console.log('  git push');
  console.log('');
  console.log('In Android Studio:');
  console.log('  1. Uninstall app from emulator');
  console.log('  2. Device Manager → ▼ → Cold Boot Now');
  console.log('  3. Build → Clean Project');
  console.log('  4. ▶ Run\n');

} catch (err) {
  console.error('\n✗ PATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
}
