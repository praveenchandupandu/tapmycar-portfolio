#!/usr/bin/env node
/**
 * TMC_PATCH91 — Complete splash overhaul
 *
 * Supersedes Patch 90 (you said you didn't execute it). Includes
 * everything Patch 90 did + more:
 *
 *   A. Kill ALL flashes (white AND empty orange) — 4 layers each set
 *      to orange so EVERY frame of the launch is the same orange.
 *
 *   B. Make the animated splash start INSTANTLY on script execution
 *      (no 250ms delay, no waiting for 'load' event). Logo begins its
 *      animation in the very first frame the WebView paints.
 *
 *   C. Speed up the splash animation overall (~30% faster). Less
 *      idle waiting between steps. Total time ~2.4s instead of 3.5s.
 *
 *   D. Re-add the 3D float animation to the onboarding tag (Patch 88
 *      accidentally removed it).
 *
 *   E. Set the body background to orange inline (immediate paint,
 *      before CSS loads).
 *
 *   Result the user perceives:
 *     Tap icon → orange screen with animation ALREADY running.
 *     No "loading background", no white flash, no waiting.
 *
 * Idempotent.
 */

const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [
  now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
  pad(now.getHours()), pad(now.getMinutes())
].join('-');
const backupDir = 'backup-splash-overhaul-' + stamp;

function backup(filePath) {
  if (!fs.existsSync(filePath)) return;
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH91 — Complete splash overhaul           ║');
console.log('╚══════════════════════════════════════════════════╝');
fs.mkdirSync(backupDir, { recursive: true });

try {
  // ====================================================================
  // FIX A1 — capacitor.config.ts: android.backgroundColor
  // ====================================================================
  const configPath = 'capacitor.config.ts';
  if (fs.existsSync(configPath)) {
    let c = fs.readFileSync(configPath, 'utf8');
    if (c.indexOf('backgroundColor: "#FF6B00"') !== -1 && c.indexOf('android:') !== -1) {
      console.log('  ⏩ android.backgroundColor already set');
    } else if (/android:\s*\{[^}]*backgroundColor/.test(c)) {
      console.log('  ⏩ android.backgroundColor already set (different format)');
    } else if (/android:\s*\{/.test(c)) {
      backup(configPath);
      c = c.replace(/(android:\s*\{)/, '$1\n    backgroundColor: "#FF6B00", // TMC_PATCH91');
      fs.writeFileSync(configPath, c, 'utf8');
      console.log('  ✓ Added backgroundColor to existing android block');
    } else if (/(\s*plugins:)/.test(c)) {
      backup(configPath);
      c = c.replace(/(\s*plugins:)/, '\n  android: {\n    backgroundColor: "#FF6B00" // TMC_PATCH91\n  },$1');
      fs.writeFileSync(configPath, c, 'utf8');
      console.log('  ✓ Created android block with backgroundColor');
    }
  }

  // ====================================================================
  // FIX A2 — Android styles.xml: windowBackground = orange
  // ====================================================================
  const stylesPath = path.join('android', 'app', 'src', 'main', 'res', 'values', 'styles.xml');
  if (fs.existsSync(stylesPath)) {
    let x = fs.readFileSync(stylesPath, 'utf8');
    if (x.indexOf('TMC_PATCH91_WINDOW_BG') === -1) {
      backup(stylesPath);
      const noActionBarRe = /(<style name="AppTheme\.NoActionBar"[^>]*>)/;
      if (noActionBarRe.test(x)) {
        x = x.replace(noActionBarRe,
          '$1\n        <!-- TMC_PATCH91_WINDOW_BG kill white flash -->\n' +
          '        <item name="android:windowBackground">@color/colorPrimary_tmc</item>'
        );
        fs.writeFileSync(stylesPath, x, 'utf8');
        console.log('  ✓ Added windowBackground to AppTheme.NoActionBar');
      }
    } else {
      console.log('  ⏩ styles.xml windowBackground already set');
    }
  }

  // ====================================================================
  // FIX A3 — Android colors.xml: define colorPrimary_tmc
  // ====================================================================
  const colorsPath = path.join('android', 'app', 'src', 'main', 'res', 'values', 'colors.xml');
  if (fs.existsSync(colorsPath)) {
    let cx = fs.readFileSync(colorsPath, 'utf8');
    if (cx.indexOf('colorPrimary_tmc') === -1) {
      backup(colorsPath);
      cx = cx.replace('</resources>', '    <color name="colorPrimary_tmc">#FF6B00</color>\n</resources>');
      fs.writeFileSync(colorsPath, cx, 'utf8');
      console.log('  ✓ Added colorPrimary_tmc to colors.xml');
    } else {
      console.log('  ⏩ colorPrimary_tmc already defined');
    }
  }

  // ====================================================================
  // FIX A4 — index.html: inline body background
  // ====================================================================
  const indexPath = path.join('public', 'index.html');
  if (fs.existsSync(indexPath)) {
    let i = fs.readFileSync(indexPath, 'utf8');
    if (i.indexOf('data-tmc-patch91') === -1) {
      backup(indexPath);
      i = i.replace(/<body([^>]*)>/, function (m, attrs) {
        if (/style\s*=/.test(attrs)) {
          // already has style attr, inject background into it
          return '<body' + attrs.replace(/style\s*=\s*"([^"]*)"/, function (mm, sv) {
            if (sv.indexOf('background') !== -1) return mm;
            return 'style="' + sv + ';background:#FF6B00"';
          }) + ' data-tmc-patch91="1">';
        }
        return '<body' + attrs + ' style="background:#FF6B00" data-tmc-patch91="1">';
      });
      fs.writeFileSync(indexPath, i, 'utf8');
      console.log('  ✓ Added inline orange background to index.html body');
      if (fs.existsSync('index.html')) fs.copyFileSync(indexPath, 'index.html');
    } else {
      console.log('  ⏩ index.html already has inline bg');
    }
  }

  // ====================================================================
  // FIX A5 + B + C + D + E — splash.html: bg + immediate start + tag anim
  // ====================================================================
  const splashPath = path.join('public', 'splash.html');
  if (fs.existsSync(splashPath)) {
    let s = fs.readFileSync(splashPath, 'utf8');
    const sOrig = s;
    backup(splashPath);

    // FIX A5 — inline body bg
    if (s.indexOf('data-tmc-patch91') === -1) {
      s = s.replace(/<body([^>]*)>/, function (m, attrs) {
        if (/style\s*=/.test(attrs)) {
          return '<body' + attrs.replace(/style\s*=\s*"([^"]*)"/, function (mm, sv) {
            if (sv.indexOf('background') !== -1) return mm;
            return 'style="' + sv + ';background:#FF6B00"';
          }) + ' data-tmc-patch91="1">';
        }
        return '<body' + attrs + ' style="background:#FF6B00" data-tmc-patch91="1">';
      });
      console.log('  ✓ splash.html body inline bg added');
    }

    // FIX B — Animation starts immediately (no waiting for load + 250ms)
    const loadHandlerRe = /window\.addEventListener\('load',\s*function\(\)\s*\{\s*setTimeout\(run,\s*250\);\s*\}\);/;
    if (loadHandlerRe.test(s)) {
      s = s.replace(loadHandlerRe,
        '// TMC_PATCH91 start animation IMMEDIATELY\n' +
        '  if (document.readyState === "loading") {\n' +
        '    document.addEventListener("DOMContentLoaded", function(){ run(); });\n' +
        '  } else {\n' +
        '    run();\n' +
        '  }'
      );
      console.log('  ✓ Animation now starts immediately (no 250ms delay)');
    } else if (s.indexOf('TMC_PATCH91 start animation IMMEDIATELY') !== -1) {
      console.log('  ⏩ Animation already starts immediately');
    } else {
      console.log('  ⚠ Could not find original load handler — may already be patched');
    }

    // FIX C — Speed up animation timings (~30% faster overall)
    // The animation uses setTimeout values. Let's reduce some of them.
    // Adjust based on what we know about the existing timings.
    const speedups = [
      [/setTimeout\(function\(\)\{\s*car\.className\s*=\s*'drive';\s*\},\s*670\)/, "setTimeout(function(){ car.className = 'drive'; }, 400)"],
      [/setTimeout\(function\(\)\{\s*phone\.className\s*=\s*'move';\s*\},\s*1300\)/, "setTimeout(function(){ phone.className = 'move'; }, 850)"],
      [/setTimeout\(function\(\)\{\s*phone\.className\s*\+=\s*'\s*tap';\s*ripple\.className\s*=\s*'go';\s*\},\s*1750\)/, "setTimeout(function(){ phone.className += ' tap'; ripple.className = 'go'; }, 1200)"],
      [/setTimeout\(function\(\)\{\s*tagline\.className\s*=\s*'show';\s*\},\s*2400\)/, "setTimeout(function(){ tagline.className = 'show'; }, 1700)"],
      [/setTimeout\(next,\s*3500\)/, "setTimeout(next, 2400)"]
    ];
    let speedCount = 0;
    speedups.forEach(([re, repl]) => {
      if (re.test(s)) {
        s = s.replace(re, repl);
        speedCount++;
      }
    });
    if (speedCount > 0) {
      console.log('  ✓ Sped up ' + speedCount + ' animation steps');
    } else {
      console.log('  ⏩ Animation timings already adjusted (or pattern not found)');
    }

    // FIX D — Restore tag float animation on onboarding tag
    if (s.indexOf('TMC_PATCH91_TAG_ANIM') === -1) {
      // Add CSS rules before </style>
      const animCss =
        '\n/* TMC_PATCH91_TAG_ANIM restore 3D float animation on onboarding tag */\n' +
        '#tmc-onboarding-tag-wrapper{perspective:1000px;display:inline-block;margin:0 auto 28px;transform-style:preserve-3d}\n' +
        '#tmc-onboarding-tag{animation:tmcTagFloat91 5s ease-in-out infinite;transform-origin:center;display:block}\n' +
        '@keyframes tmcTagFloat91{0%,100%{transform:rotateY(-8deg) rotateX(4deg) translateY(0)}50%{transform:rotateY(8deg) rotateX(-3deg) translateY(-6px)}}\n';
      const styleClose = /(<\/style>)/;
      if (styleClose.test(s)) {
        s = s.replace(styleClose, animCss + '$1');
        console.log('  ✓ Added tag float animation CSS');
      }

      // Wrap the image if not already wrapped
      if (s.indexOf('id="tmc-onboarding-tag-wrapper"') === -1) {
        s = s.replace(/(<img id="tmc-onboarding-tag"[^>]*>)/, '<div id="tmc-onboarding-tag-wrapper">$1</div>');
        // Remove margin-bottom from inline image style (wrapper has it now)
        s = s.replace(/(id="tmc-onboarding-tag"[^>]*style="[^"]*?)margin:0 auto 28px;?/g, '$1');
        console.log('  ✓ Wrapped tag image in animation container');
      }
    } else {
      console.log('  ⏩ Tag animation already added');
    }

    if (s !== sOrig) {
      fs.writeFileSync(splashPath, s, 'utf8');
      console.log('  ✓ Saved public/splash.html');
      if (fs.existsSync('splash.html')) fs.copyFileSync(splashPath, 'splash.html');
    }
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║ TMC_PATCH91 complete ✓                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nNext PowerShell commands:');
  console.log('  npx cap sync android');
  console.log('  git add -A');
  console.log('  git commit -m "TMC_PATCH91: Complete splash overhaul"');
  console.log('  git push');
  console.log('');
  console.log('In Android Studio:');
  console.log('  1. Uninstall app from emulator');
  console.log('  2. Device Manager → Cold Boot Now (wait full reboot)');
  console.log('  3. Build → Clean Project');
  console.log('  4. ▶ Run');
  console.log('');
  console.log('Expected: Tap icon → orange + animation already running.');
  console.log('No white flash, no empty orange, no waiting. Just animation.\n');

} catch (err) {
  console.error('\n✗ PATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
}
