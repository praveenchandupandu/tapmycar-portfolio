// ============================================================================
// TapMyCar - Patch 34a: Welcome page redesign + identity-check screen
//
// Touches ONLY public/contact.html.
//
// What this patch does:
//   1. Replaces the unclaimed-state HTML block with a modern design that
//      matches the rest of the app (dashboard.html visual language).
//      - White background, clean orange accent card with the token
//      - Spaced-letter token display (T M C - X X X X X X)
//      - 3 feature rows redesigned
//      - One primary CTA: "Activate The Tag"
//      - No "View Plans" link in hero (per user)
//      - Pricing-style footer: Privacy Policy · Terms of Service
//
//   2. Inserts a NEW state-identity screen between unclaimed and step1.
//      Shown when user clicks "Activate The Tag". Asks:
//        "First, are you with us already?"
//      with two animated cards:
//        - "I'm already a TapMyCar user" -> /signin.html
//        - "I'm new here" -> calls startActivation() (existing inline new-user flow)
//      Back arrow returns to unclaimed.
//      Footer with privacy/terms links.
//
//   3. Wires "Activate The Tag" to proceedFromWelcome() which:
//        - If user already signed in -> startActivation() directly (existing
//          logic shows verify-existing screen)
//        - If not signed in -> showState('identity') for the choice screen
//
//   4. Adds 'identity' to the showState() list.
//
//   5. Adds modest CSS animations: slide-in for screens, hover lift for
//      identity cards, press effect on primary button.
//
// What this patch does NOT do (deferred):
//   - Plan picker (Standard/Premium/eTag) -> separate patch
//   - Verification gate on contact.html GET -> separate patch (security)
//   - Free-user activation block -> separate patch
//   - Signin/register ?continue=... so user returns here after auth -> Patch 34b
//   - Active-tag (claimed) page redesign -> deferred
//
// Properties: idempotent, uses safeReplace (function callback) to avoid the
// $-token interpretation bug, backs up contact.html.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch34a-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function readFile(p) {
  if (!fs.existsSync(p)) errExit('File not found: ' + p);
  return fs.readFileSync(p, 'utf8');
}
function backup(file) {
  if (!fs.existsSync(file)) return;
  const rel = path.relative(ROOT, file);
  const dest = path.join(BACKUP_DIR, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
}
function writeFile(p, content) {
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  fs.writeFileSync(p, content, 'utf8');
}

// SAFE replace: use function callback to bypass $-token interpretation in
// replacement strings. CRITICAL: settings.html corruption happened because
// $' is a regex special token in the replacement arg. Function callback
// returns the literal string and never expands $-tokens.
function safeReplace(content, oldStr, newStr) {
  const oldCRLF = oldStr.replace(/\n/g, '\r\n');
  if (content.includes(oldStr)) return content.replace(oldStr, () => newStr);
  if (content.includes(oldCRLF)) {
    const newCRLF = newStr.replace(/\n/g, '\r\n');
    return content.replace(oldCRLF, () => newCRLF);
  }
  return null;
}

log('');
log('TapMyCar Patch 34a \u2014 welcome page redesign + identity-check screen');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH34A_WELCOME_REDESIGN';

const file = path.join(PUBLIC, 'contact.html');
const content = readFile(file);

if (content.includes(MARKER)) {
  skip('contact.html (already patched)');
  process.exit(0);
}

backup(file);
let updated = content;

// =====================================================================
// 34a.1  Replace the unclaimed-state HTML block
// =====================================================================

const oldUnclaimed = `<!-- UNCLAIMED -->
<div id="state-unclaimed" class="page" style="display:none">
  <div style="background:#FF6B00;padding:40px 24px 32px;text-align:center;position:relative;overflow:hidden">
    <div style="position:absolute;width:180px;height:180px;border-radius:50%;background:rgba(255,255,255,.06);right:-40px;top:-40px"></div>
    <div style="position:absolute;width:120px;height:120px;border-radius:50%;background:rgba(255,255,255,.04);left:-30px;bottom:-30px"></div>
    <div style="font-size:13px;font-weight:600;color:rgba(255,255,255,.8);margin-bottom:6px;letter-spacing:.05em">WELCOME TO</div>
    <div style="font-size:28px;font-weight:800;color:#fff;margin-bottom:4px">TapMyCar<span style="color:rgba(255,255,255,.6)">.</span></div>
    <div style="font-size:12px;color:rgba(255,255,255,.7);margin-bottom:24px">Privacy-first vehicle contact</div>
    <div style="background:rgba(0,0,0,.2);border-radius:16px;padding:16px;margin-bottom:20px;text-align:left">
      <div style="font-size:10px;color:rgba(255,255,255,.6);margin-bottom:6px;text-transform:uppercase;letter-spacing:.08em">Your Official Tag</div>
      <div style="font-size:28px;font-weight:800;color:#fff;letter-spacing:4px;margin-bottom:4px" id="unclaimed-token">---------</div>
      <div style="font-size:11px;color:rgba(255,255,255,.6)">This tag was made exclusively for you</div>
    </div>
    <div style="font-size:13px;color:rgba(255,255,255,.85);line-height:1.7">Activate your tag so strangers can reach you privately when they need your attention  without ever seeing your real phone number.</div>
  </div>
  <div class="chev"></div>
  <div style="padding:24px;display:flex;flex-direction:column;gap:14px;flex:1">
    <div style="display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:#F9FAFB;border-radius:12px;border:.5px solid #E5E7EB">
        <div style="width:34px;height:34px;border-radius:9px;background:#FFF3EC;display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF6B00" stroke-width="2" stroke-linecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
        <div style="font-size:13px;color:#111">Your real number is <strong>never shared</strong> with anyone</div>
      </div>
      <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:#F9FAFB;border-radius:12px;border:.5px solid #E5E7EB">
        <div style="width:34px;height:34px;border-radius:9px;background:#FFF3EC;display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF6B00" stroke-width="2" stroke-linecap="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07"/></svg></div>
        <div style="font-size:13px;color:#111">Strangers can call you <strong>instantly and privately</strong></div>
      </div>
      <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:#F9FAFB;border-radius:12px;border:.5px solid #E5E7EB">
        <div style="width:34px;height:34px;border-radius:9px;background:#FFF3EC;display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF6B00" stroke-width="2" stroke-linecap="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></div>
        <div style="font-size:13px;color:#111">You <strong>screen every call</strong> before speaking to anyone</div>
      </div>
    </div>
    <div style="margin-top:auto;display:flex;flex-direction:column;gap:10px">
      <button class="btn" onclick="startActivation()">Activate your tag </button>
      <a href="/signin.html" style="text-align:center;font-size:13px;color:#6B7280;text-decoration:none;padding:8px 0">Already have an account? <span style="color:#FF6B00;font-weight:600">Sign in</span></a>
    </div>
  </div>
</div>`;

const newUnclaimed = `<!-- UNCLAIMED \u2014 ${MARKER} -->
<style>
  /* ${MARKER}: small animation set, scoped to the redesigned screens */
  @keyframes p34a-fade-in {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes p34a-slide-in {
    from { opacity: 0; transform: translateX(20px); }
    to { opacity: 1; transform: translateX(0); }
  }
  .p34a-anim { animation: p34a-fade-in .35s ease-out both; }
  .p34a-anim-slide { animation: p34a-slide-in .35s ease-out both; }
  .p34a-anim-stagger-1 { animation: p34a-fade-in .35s ease-out .08s both; }
  .p34a-anim-stagger-2 { animation: p34a-fade-in .35s ease-out .16s both; }
  .p34a-anim-stagger-3 { animation: p34a-fade-in .35s ease-out .24s both; }
  .p34a-anim-stagger-4 { animation: p34a-fade-in .35s ease-out .32s both; }
  .p34a-anim-stagger-5 { animation: p34a-fade-in .35s ease-out .40s both; }

  .p34a-token-card {
    background: linear-gradient(135deg, #FF6B00 0%, #FF8533 100%);
    border-radius: 18px;
    padding: 22px 18px;
    text-align: center;
    color: #fff;
    box-shadow: 0 8px 24px rgba(255, 107, 0, 0.20);
    position: relative;
    overflow: hidden;
  }
  .p34a-token-card::before {
    content: ''; position: absolute; width: 160px; height: 160px;
    border-radius: 50%; background: rgba(255,255,255,.08);
    right: -50px; top: -50px;
  }
  .p34a-token-card::after {
    content: ''; position: absolute; width: 100px; height: 100px;
    border-radius: 50%; background: rgba(255,255,255,.06);
    left: -30px; bottom: -30px;
  }
  .p34a-token-label {
    font-size: 10px; font-weight: 700; letter-spacing: .12em;
    text-transform: uppercase; color: rgba(255,255,255,.85); margin-bottom: 8px;
    position: relative; z-index: 1;
  }
  .p34a-token-value {
    font-size: 26px; font-weight: 800; letter-spacing: 4px; color: #fff;
    position: relative; z-index: 1;
    font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
  }
  .p34a-token-sub {
    font-size: 11px; color: rgba(255,255,255,.75); margin-top: 6px;
    position: relative; z-index: 1;
  }

  .p34a-feature {
    display: flex; align-items: center; gap: 13px;
    padding: 13px 14px; background: #fff;
    border-radius: 14px; border: 1px solid #F1F1F1;
    transition: transform .15s ease, box-shadow .15s ease;
  }
  .p34a-feature:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.04); }
  .p34a-feature-ic {
    width: 38px; height: 38px; border-radius: 11px; background: #FFF3EC;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .p34a-feature-text { font-size: 13.5px; color: #111; line-height: 1.5; }
  .p34a-feature-text strong { color: #FF6B00; font-weight: 700; }

  .p34a-primary-btn {
    background: #FF6B00; color: #fff; font-size: 15px; font-weight: 700;
    padding: 16px 24px; border: none; border-radius: 14px; cursor: pointer;
    font-family: 'Inter', system-ui, sans-serif;
    transition: transform .12s ease, box-shadow .12s ease, background .12s ease;
    box-shadow: 0 4px 14px rgba(255, 107, 0, 0.28);
    width: 100%;
  }
  .p34a-primary-btn:hover { background: #E85F00; transform: translateY(-1px); box-shadow: 0 6px 18px rgba(255, 107, 0, 0.34); }
  .p34a-primary-btn:active { transform: translateY(0); box-shadow: 0 2px 8px rgba(255, 107, 0, 0.30); }

  .p34a-footer-links {
    text-align: center; padding: 18px 0 14px; font-size: 11px;
    color: #9CA3AF; line-height: 1.6;
  }
  .p34a-footer-links a {
    color: #FF6B00; text-decoration: none; font-weight: 600;
  }
  .p34a-footer-links a:hover { text-decoration: underline; }

  .p34a-identity-card {
    display: flex; align-items: center; gap: 14px;
    padding: 18px 18px; background: #fff;
    border-radius: 16px; border: 1.5px solid #F1F1F1;
    cursor: pointer; text-decoration: none; color: inherit;
    transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease;
    text-align: left;
  }
  .p34a-identity-card:hover, .p34a-identity-card:focus {
    transform: translateY(-2px);
    border-color: #FF6B00;
    box-shadow: 0 8px 24px rgba(255, 107, 0, 0.12);
  }
  .p34a-identity-card:active { transform: translateY(0); }
  .p34a-identity-ic {
    width: 48px; height: 48px; border-radius: 14px; background: #FFF3EC;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .p34a-identity-title { font-size: 15px; font-weight: 700; color: #111; margin-bottom: 2px; }
  .p34a-identity-sub { font-size: 12px; color: #6B7280; line-height: 1.4; }
  .p34a-identity-arrow { color: #FF6B00; flex-shrink: 0; opacity: .6; transition: opacity .18s ease, transform .18s ease; }
  .p34a-identity-card:hover .p34a-identity-arrow { opacity: 1; transform: translateX(3px); }

  .p34a-back-btn {
    width: 38px; height: 38px; border-radius: 50%;
    background: #F3F4F6; border: none; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background .15s ease;
  }
  .p34a-back-btn:hover { background: #E5E7EB; }

  @media (min-width: 540px) {
    .p34a-identity-cards { flex-direction: row; }
    .p34a-identity-card { flex: 1; }
  }
</style>

<div id="state-unclaimed" class="page" style="display:none;background:#fff">
  <div class="p34a-anim" style="padding:20px 22px 8px;display:flex;align-items:center;justify-content:center">
    <img src="/logo.png" onerror="this.style.display='none'" alt="" style="width:32px;height:32px;border-radius:8px;margin-right:9px">
    <div style="font-size:18px;font-weight:800;color:#111">TapMyCar<span style="color:#FF6B00">.</span></div>
  </div>

  <div style="padding:0 22px;flex:1;display:flex;flex-direction:column">
    <div class="p34a-token-card p34a-anim-stagger-1" style="margin-top:14px">
      <div class="p34a-token-label">Your Official Tag</div>
      <div class="p34a-token-value" id="unclaimed-token">--------</div>
      <div class="p34a-token-sub">This tag was made just for you</div>
    </div>

    <div class="p34a-anim-stagger-2" style="margin-top:22px;text-align:center">
      <div style="font-size:20px;font-weight:800;color:#111;margin-bottom:6px">Privacy-first vehicle contact</div>
      <div style="font-size:13px;color:#6B7280;line-height:1.55;max-width:320px;margin:0 auto">Activate your tag so strangers can reach you privately \u2014 without ever seeing your real number.</div>
    </div>

    <div style="display:flex;flex-direction:column;gap:9px;margin-top:22px">
      <div class="p34a-feature p34a-anim-stagger-3">
        <div class="p34a-feature-ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF6B00" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
        <div class="p34a-feature-text">Your real number is <strong>never shared</strong></div>
      </div>
      <div class="p34a-feature p34a-anim-stagger-4">
        <div class="p34a-feature-ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF6B00" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg></div>
        <div class="p34a-feature-text">Strangers reach you <strong>instantly and privately</strong></div>
      </div>
      <div class="p34a-feature p34a-anim-stagger-5">
        <div class="p34a-feature-ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF6B00" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>
        <div class="p34a-feature-text">You <strong>screen every call</strong> before answering</div>
      </div>
    </div>

    <div style="margin-top:auto;padding:24px 0 8px">
      <button class="p34a-primary-btn p34a-anim-stagger-5" onclick="proceedFromWelcome()">Activate The Tag</button>
    </div>

    <div class="p34a-footer-links">
      <a href="/privacy.html">Privacy Policy</a> &nbsp;\u00b7&nbsp; <a href="/terms.html">Terms of Service</a>
    </div>
  </div>
</div>

<!-- IDENTITY CHECK \u2014 ${MARKER} -->
<div id="state-identity" class="page" style="display:none;background:#fff">
  <div style="padding:20px 22px 0;display:flex;align-items:center;gap:12px" class="p34a-anim">
    <button class="p34a-back-btn" onclick="showState('unclaimed')" aria-label="Back"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>
    <div style="font-size:13px;color:#6B7280">Activate your tag</div>
  </div>

  <div style="padding:32px 22px 0;flex:1;display:flex;flex-direction:column">
    <div class="p34a-anim-stagger-1" style="text-align:center;margin-bottom:8px">
      <div style="font-size:24px;font-weight:800;color:#111;margin-bottom:8px;line-height:1.25">First, are you with us already?</div>
      <div style="font-size:13.5px;color:#6B7280;line-height:1.55;max-width:300px;margin:0 auto">Pick one to continue activating your tag.</div>
    </div>

    <div class="p34a-identity-cards p34a-anim-stagger-2" style="display:flex;flex-direction:column;gap:12px;margin-top:32px">
      <a href="/signin.html" class="p34a-identity-card">
        <div class="p34a-identity-ic">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FF6B00" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
          </svg>
        </div>
        <div style="flex:1;min-width:0">
          <div class="p34a-identity-title">I'm already a TapMyCar user</div>
          <div class="p34a-identity-sub">Sign in to attach this tag to your account</div>
        </div>
        <svg class="p34a-identity-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </a>

      <a href="javascript:void(0)" onclick="startActivation()" class="p34a-identity-card">
        <div class="p34a-identity-ic">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FF6B00" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>
          </svg>
        </div>
        <div style="flex:1;min-width:0">
          <div class="p34a-identity-title">I'm new here</div>
          <div class="p34a-identity-sub">Create your account and activate your tag</div>
        </div>
        <svg class="p34a-identity-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </a>
    </div>

    <div style="margin-top:auto" class="p34a-footer-links">
      <a href="/privacy.html">Privacy Policy</a> &nbsp;\u00b7&nbsp; <a href="/terms.html">Terms of Service</a>
    </div>
  </div>
</div>`;

const r1 = safeReplace(updated, oldUnclaimed, newUnclaimed);
if (!r1) errExit('contact.html: unclaimed state anchor not found');
updated = r1;
ok('Unclaimed state HTML replaced + identity state inserted');

// =====================================================================
// 34a.2  Add 'identity' to showState list
// =====================================================================

const oldShowList = `['loading','invalid','disabled','unclaimed','verify-existing','step1','step2','step3','step4','active','success'].forEach`;
const newShowList = `['loading','invalid','disabled','unclaimed','identity','verify-existing','step1','step2','step3','step4','active','success'].forEach`;

const r2 = safeReplace(updated, oldShowList, newShowList);
if (!r2) errExit('contact.html: showState list anchor not found');
updated = r2;
ok('showState list includes identity');

// =====================================================================
// 34a.3  Add proceedFromWelcome() function and helper for signed-in users
// =====================================================================

// Insert after the existing startActivation function. Find its closing
// brace by anchoring on the start of the next function.
const fnAnchor = `async function startActivation(){`;

const fnNew = `// ${MARKER}: routed from the "Activate The Tag" button on the welcome screen.
// If user is signed in we go straight to verify-existing (existing logic).
// If not signed in we show the identity-check screen where they pick
// "already a user" vs "new here".
function proceedFromWelcome() {
  try {
    var sToken = localStorage.getItem('tmc_token');
    var sPhone = localStorage.getItem('tmc_phone');
    var sName = localStorage.getItem('tmc_name');
    var sEmail = localStorage.getItem('tmc_email');
    if (sToken && sPhone && sName && sEmail) {
      // Already signed in \u2014 skip identity check, run existing activation
      startActivation();
      return;
    }
  } catch (e) {}
  showState('identity');
}

async function startActivation(){`;

const r3 = safeReplace(updated, fnAnchor, fnNew);
if (!r3) errExit('contact.html: startActivation anchor not found for proceedFromWelcome insert');
updated = r3;
ok('proceedFromWelcome() inserted');

// =====================================================================
// Write + verify
// =====================================================================

writeFile(file, updated);

const final = readFile(file);
const markerCount = (final.match(new RegExp(MARKER, 'g')) || []).length;
const hasIdentityState = final.includes('state-identity');
const hasProceedFn = final.includes('function proceedFromWelcome()');
const hasIdentityInList = final.includes("'unclaimed','identity'");
const hasOldButton = final.includes('onclick="startActivation()">Activate your tag');
const lineCount = final.split('\n').length;

log('');
log('Verification:');
log('  ' + MARKER + ' markers: ' + markerCount + ' (>=1 expected)');
log('  identity state present: ' + hasIdentityState);
log('  proceedFromWelcome function present: ' + hasProceedFn);
log('  identity in showState list: ' + hasIdentityInList);
log('  old "Activate your tag" button removed: ' + !hasOldButton);
log('  total lines: ' + lineCount);

if (!markerCount) errExit('No markers in file \u2014 patch likely did not apply');
if (!hasIdentityState) errExit('state-identity missing');
if (!hasProceedFn) errExit('proceedFromWelcome missing');
if (!hasIdentityInList) errExit('identity not in showState list');
if (hasOldButton) errExit('Old activate button still present \u2014 replacement failed');

ok('contact.html patched and validated');

log('');
log('==============================================================');
log('Patch 34a complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 34a: welcome page redesign + identity-check"');
log('  git push');
log('  Wait ~60 seconds.');
log('');
log('Test plan (in fresh incognito \u2014 unregister service worker if needed):');
log('  A) NOT signed in, scan an unclaimed tag:');
log('     1. New welcome screen shows: white background, modern hero card,');
log('        3 feature rows, "Activate The Tag" big orange button.');
log('     2. Footer links: Privacy Policy \u00b7 Terms of Service');
log('     3. Click "Activate The Tag":');
log('        - Slides to identity screen with "First, are you with us already?"');
log('        - Two cards: "I am already a user" and "I am new here"');
log('     4. Click "I am new here" \u2192 existing step1 (register) flow runs');
log('     5. Click "I am already a user" \u2192 goes to /signin.html');
log('        (NOTE: returning to activation after signin is Patch 34b)');
log('  B) SIGNED IN, scan an unclaimed tag:');
log('     1. Same welcome screen.');
log('     2. Click "Activate The Tag" \u2192 SKIPS identity screen, goes');
log('        directly to verify-existing step (current behavior).');
log('  C) Active or disabled tag: existing screens unchanged.');
log('==============================================================');
