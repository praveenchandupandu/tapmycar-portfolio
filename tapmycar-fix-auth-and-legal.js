// ═══════════════════════════════════════════════════════════════════
// TapMyCar — Session 4 fix script
// ═══════════════════════════════════════════════════════════════════
// Addresses:
//   1. Sign-in works for non-existent emails (security bug)
//      → patches signin.html + register.html to send mode parameter
//   2. Privacy + Terms pages 404 (missing from repo)
//      → recreates public/privacy.html and public/terms.html
//
// Run: node tapmycar-fix-auth-and-legal.js
// ═══════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

// ─── 1. Patch signin.html: add mode: 'signin' ──────────────
const signinPath = path.join(ROOT, 'public', 'signin.html');
if (fs.existsSync(signinPath)) {
  let content = fs.readFileSync(signinPath, 'utf8');
  let changed = false;

  // Send OTP call
  if (content.includes("body: JSON.stringify({ email, type: 'email' })")) {
    content = content.replace(
      "body: JSON.stringify({ email, type: 'email' })",
      "body: JSON.stringify({ email, type: 'email', mode: 'signin' })"
    );
    console.log('[FIX] signin.html :: send-otp now sends mode:signin');
    changed = true;
  }

  // Verify OTP call
  if (content.includes("body: JSON.stringify({ email, code, type: 'email' })")) {
    content = content.replace(
      "body: JSON.stringify({ email, code, type: 'email' })",
      "body: JSON.stringify({ email, code, type: 'email', mode: 'signin' })"
    );
    console.log('[FIX] signin.html :: verify-otp now sends mode:signin');
    changed = true;
  }

  // Improve error handling to show helpful message when no account found
  const oldErrorCheck = `if (!res.ok) { showError(data.error || 'Failed to send code'); return; }`;
  const newErrorCheck = `if (!res.ok) {
      if (data.no_account) {
        showError('No account found. Please register first.');
        setTimeout(() => { window.location.href = '/register.html'; }, 2000);
      } else {
        showError(data.error || 'Failed to send code');
      }
      return;
    }`;
  if (content.includes(oldErrorCheck)) {
    content = content.replace(oldErrorCheck, newErrorCheck);
    console.log('[FIX] signin.html :: helpful redirect to register on no_account');
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(signinPath, content, 'utf8');
    fs.copyFileSync(signinPath, path.join(ROOT, 'signin.html'));
    console.log('[SYNC] signin.html');
  } else {
    console.log('[OK]  signin.html :: no changes needed (already patched or different code)');
  }
}

// ─── 2. Patch register.html: add mode: 'register' ──────────
const regPath = path.join(ROOT, 'public', 'register.html');
if (fs.existsSync(regPath)) {
  let content = fs.readFileSync(regPath, 'utf8');
  let changed = false;

  // Find and patch send-otp calls (could be in multiple forms)
  const sendOtpPatches = [
    { find: `type: 'email' }`, replace: `type: 'email', mode: 'register' }` },
    { find: `'type': 'email' }`, replace: `'type': 'email', 'mode': 'register' }` }
  ];

  for (const { find, replace } of sendOtpPatches) {
    // Only patch send-otp body, not verify-otp (which has code)
    if (content.includes(find) && !content.includes(replace)) {
      // Count occurrences of send-otp vs verify-otp contexts
      const sendOtpRegex = new RegExp('send-otp[^}]+?' + find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 's');
      if (sendOtpRegex.test(content)) {
        content = content.replace(sendOtpRegex, (match) => match.replace(find, replace));
        console.log('[FIX] register.html :: send-otp now sends mode:register');
        changed = true;
      }
    }
  }

  if (changed) {
    fs.writeFileSync(regPath, content, 'utf8');
    fs.copyFileSync(regPath, path.join(ROOT, 'register.html'));
    console.log('[SYNC] register.html');
  } else {
    console.log('[OK]  register.html :: send-otp already has mode param or pattern not found');
  }
}

// ─── 3. Create privacy.html if missing ──────────────────────
const privacyHTML = getPrivacyHTML();
const privacyPath = path.join(ROOT, 'public', 'privacy.html');
const privacyRootPath = path.join(ROOT, 'privacy.html');
fs.writeFileSync(privacyPath, privacyHTML, 'utf8');
fs.writeFileSync(privacyRootPath, privacyHTML, 'utf8');
console.log('[CREATE] public/privacy.html + privacy.html');

// ─── 4. Create terms.html if missing ────────────────────────
const termsHTML = getTermsHTML();
const termsPath = path.join(ROOT, 'public', 'terms.html');
const termsRootPath = path.join(ROOT, 'terms.html');
fs.writeFileSync(termsPath, termsHTML, 'utf8');
fs.writeFileSync(termsRootPath, termsHTML, 'utf8');
console.log('[CREATE] public/terms.html + terms.html');

console.log('\n═══════════════════════════════════════════════════');
console.log('Done.');
console.log('═══════════════════════════════════════════════════');
console.log('\nNext: move the api files too, then commit and push:');
console.log('  Move-Item "$env:USERPROFILE\\Downloads\\send-otp.js" "api\\send-otp.js" -Force');
console.log('  Move-Item "$env:USERPROFILE\\Downloads\\verify-otp.js" "api\\verify-otp.js" -Force');
console.log('  git add -A');
console.log('  git commit -m "Session 4: signin security + privacy/terms pages restored"');
console.log('  git push');

// ═══════════════════════════════════════════════════════════════
// PRIVACY HTML TEMPLATE
// ═══════════════════════════════════════════════════════════════
function getPrivacyHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#FF6B00">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy · TapMyCar</title>
  <link rel="stylesheet" href="/app.css">
  <style>
    .legal-page{max-width:780px;margin:0 auto;padding:20px 24px 60px;font-family:Inter,sans-serif;background:#fff;color:#111;line-height:1.7}
    .legal-page h1{font-size:28px;font-weight:800;margin:20px 0 8px}
    .legal-page .eff{font-size:12px;color:#6B7280;margin-bottom:32px}
    .legal-page h2{font-size:17px;font-weight:700;margin:28px 0 10px;color:#111}
    .legal-page p, .legal-page li{font-size:14px;color:#374151;margin-bottom:10px}
    .legal-page ul{padding-left:22px;margin-bottom:12px}
    .legal-page a{color:#FF6B00}
    .back-link{display:inline-block;font-size:13px;color:#FF6B00;text-decoration:none;font-weight:600;margin-bottom:20px}
  </style>
</head>
<body>
<div class="legal-page">
  <a href="/" class="back-link">← Back to TapMyCar</a>
  <h1>Privacy Policy</h1>
  <div class="eff">Effective date: April 20, 2026 · Last updated: April 20, 2026</div>

  <p>TapMyCar ("we," "our," "us") is operated by Praman Tech LLC, a Connecticut limited liability company. We respect your privacy and are committed to being transparent about what information we collect and how we use it.</p>

  <h2>1. Information we collect</h2>
  <p>To provide our service, we collect:</p>
  <ul>
    <li><b>Account information:</b> your name, email address, and phone number (used to verify your identity and deliver masked calls).</li>
    <li><b>Vehicle information you choose to provide:</b> license plate, make, model, year, and color. This is optional.</li>
    <li><b>Shipping address:</b> collected only when you purchase a physical sticker.</li>
    <li><b>Payment information:</b> processed securely through Stripe; we never see or store your full card number.</li>
    <li><b>Scan data:</b> when someone scans your tag, we log the time, approximate location (based on IP), device type, and whether they placed a call.</li>
    <li><b>Referral data:</b> if you invite friends, we track who signed up using your referral code to issue rewards.</li>
  </ul>

  <h2>2. How we use information</h2>
  <ul>
    <li>To connect scanners of your tag to you via our masked-call system (your real number is never shared).</li>
    <li>To ship physical stickers to your provided address.</li>
    <li>To process payments and manage subscription renewals.</li>
    <li>To send transactional emails (order confirmations, renewal reminders, account alerts).</li>
    <li>To improve the product, detect fraud, and debug issues.</li>
  </ul>

  <h2>3. What we never do</h2>
  <ul>
    <li>We never share your phone number, email, or home address with anyone who scans your tag.</li>
    <li>We never sell your personal data to third parties.</li>
    <li>We never use your information for advertising outside TapMyCar.</li>
  </ul>

  <h2>4. Third-party services</h2>
  <p>We share information only with the service providers we depend on to operate:</p>
  <ul>
    <li><b>Stripe</b> — processes payments; receives your name, email, and billing details.</li>
    <li><b>Twilio</b> — routes masked calls; receives your phone number and the scanner's phone number during a call.</li>
    <li><b>Resend</b> — sends transactional emails; receives your email address.</li>
    <li><b>Supabase</b> — stores our database; all data encrypted at rest.</li>
    <li><b>Vercel</b> — hosts our website and API.</li>
  </ul>

  <h2>5. Data retention</h2>
  <p>We retain your account data as long as your account is active. When you delete your account, we delete your personal data within 30 days, except where we are legally required to retain records (for example, tax records for completed orders).</p>

  <h2>6. Your rights (CCPA / GDPR)</h2>
  <ul>
    <li><b>Right to access</b> — you can request a copy of the data we hold about you.</li>
    <li><b>Right to delete</b> — you can request deletion of your account and data at any time.</li>
    <li><b>Right to correct</b> — you can update your information from the Settings page.</li>
    <li><b>Right to opt out of sale</b> — we don't sell data, but you can confirm this in writing by emailing us.</li>
  </ul>
  <p>To exercise any of these rights, email <a href="mailto:support@tapmycar.io">support@tapmycar.io</a>.</p>

  <h2>7. Children</h2>
  <p>TapMyCar is not intended for children under 13 (COPPA). We do not knowingly collect information from children. If you believe a child has created an account, email us and we'll delete it.</p>

  <h2>8. Security</h2>
  <p>We use industry-standard security practices: encrypted connections (HTTPS), encrypted storage, least-privilege access to databases, and we do not store credit-card numbers on our servers. No system is perfectly secure, but we work hard to protect your data.</p>

  <h2>9. Cookies and tracking</h2>
  <p>We use essential cookies to keep you signed in. We do not use third-party advertising cookies or cross-site tracking.</p>

  <h2>10. Changes to this policy</h2>
  <p>We may update this policy occasionally. If we make material changes, we'll notify you by email or a prominent notice on the app. The "Last updated" date at the top will always reflect the most recent version.</p>

  <h2>11. Contact</h2>
  <p>Questions about privacy? Email <a href="mailto:support@tapmycar.io">support@tapmycar.io</a> or write to:</p>
  <p>Praman Tech LLC<br>
  359 Lasalle Street<br>
  New Britain, CT 06051<br>
  United States</p>

  <h2>12. California residents</h2>
  <p>Under the California Consumer Privacy Act (CCPA), California residents have specific rights regarding their personal information. We honor all CCPA rights by default for all users, regardless of location.</p>

  <div style="margin-top:40px;padding-top:20px;border-top:1px solid #E5E7EB;font-size:11px;color:#9CA3AF;text-align:center">
    <a href="/terms.html">Terms of Service</a> · <a href="/privacy.html">Privacy Policy</a> · © 2026 Praman Tech LLC
  </div>
</div>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════
// TERMS HTML TEMPLATE
// ═══════════════════════════════════════════════════════════════
function getTermsHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#FF6B00">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Terms of Service · TapMyCar</title>
  <link rel="stylesheet" href="/app.css">
  <style>
    .legal-page{max-width:780px;margin:0 auto;padding:20px 24px 60px;font-family:Inter,sans-serif;background:#fff;color:#111;line-height:1.7}
    .legal-page h1{font-size:28px;font-weight:800;margin:20px 0 8px}
    .legal-page .eff{font-size:12px;color:#6B7280;margin-bottom:32px}
    .legal-page h2{font-size:17px;font-weight:700;margin:28px 0 10px;color:#111}
    .legal-page p, .legal-page li{font-size:14px;color:#374151;margin-bottom:10px}
    .legal-page ul{padding-left:22px;margin-bottom:12px}
    .legal-page a{color:#FF6B00}
    .back-link{display:inline-block;font-size:13px;color:#FF6B00;text-decoration:none;font-weight:600;margin-bottom:20px}
  </style>
</head>
<body>
<div class="legal-page">
  <a href="/" class="back-link">← Back to TapMyCar</a>
  <h1>Terms of Service</h1>
  <div class="eff">Effective date: April 20, 2026 · Last updated: April 20, 2026</div>

  <p>Welcome to TapMyCar, operated by Praman Tech LLC ("TapMyCar," "we," "us"). By creating an account or using our service, you agree to these Terms of Service ("Terms"). If you don't agree, don't use the service.</p>

  <h2>1. What TapMyCar does</h2>
  <p>TapMyCar provides physical and digital tags (NFC + QR stickers or printable eTags) that let strangers reach you privately through our masked-calling system. When someone scans your tag, they can place a voice call to you without ever seeing your real phone number. You can screen every call before answering.</p>

  <h2>2. Accounts</h2>
  <p>To use TapMyCar, you must be 13 or older and provide accurate information. You are responsible for keeping your password and phone access secure. You agree not to share your account with others.</p>

  <h2>3. Pricing and billing</h2>
  <ul>
    <li><b>Free eTag:</b> $0. Digital-only tag. Masked calls are disabled until you pay to activate.</li>
    <li><b>Activation:</b> $1 one-time fee. Enables masked calling for 30 days. After 30 days, your chosen plan (Standard or Premium) begins automatically.</li>
    <li><b>Standard plan:</b> $9.99 one-time for the physical sticker, plus $9.99 per year annual subscription (first annual charge at day 30 after direct purchase, or day 60 after $1 activation).</li>
    <li><b>Premium plan:</b> $24.99 one-time for 3 physical stickers (for family), plus $19.99 per year annual subscription. Includes 3 gift codes for family members to register their own account under your subscription.</li>
    <li><b>Prepay option:</b> at checkout you may choose to prepay your first annual fee. This pushes your next recurring charge out by 365 days.</li>
    <li><b>Automatic renewal:</b> annual subscriptions renew automatically on the anniversary of your first annual charge. We send you a renewal reminder email before each charge.</li>
    <li><b>Business plan:</b> $49/month, arranged by contacting us directly.</li>
  </ul>

  <h2>4. Cancellation and refunds</h2>
  <ul>
    <li>You can cancel your subscription anytime from the Settings page.</li>
    <li>Cancellation stops future charges.</li>
    <li>Physical stickers are <b>non-refundable once shipped</b>, as each sticker is uniquely coded to your account and cannot be resold.</li>
    <li>Annual subscription fees are <b>refundable within 14 days of the annual charge</b>. Outside that window, they are non-refundable but you can still cancel to stop future renewals.</li>
    <li>The $1 activation fee is refundable only if you cancel before day 30.</li>
    <li>Upon cancellation, your tag(s) are disabled — strangers who scan will see "Tag inactive."</li>
    <li>For Premium: if the main buyer cancels, all family members' tags are also disabled.</li>
  </ul>

  <h2>5. Acceptable use</h2>
  <p>You agree not to use TapMyCar for harassment, stalking, spam, fraud, or illegal purposes. We reserve the right to suspend or terminate any account that abuses the service, with or without notice.</p>

  <h2>6. Scanner privacy</h2>
  <p>When someone scans your tag, we ask them to identify themselves before connecting the call. We log scans to help you know when and where your car was contacted. Scanners see a privacy notice explaining that we do not share your personal information with them.</p>

  <h2>7. Disclaimer of warranties</h2>
  <p>TapMyCar is provided "as is" without warranties of any kind. We do not guarantee uninterrupted service or that masked calls will always connect. We are not a substitute for emergency services (911 / your local emergency number).</p>

  <h2>8. Limitation of liability</h2>
  <p>To the fullest extent allowed by law, our total liability for any claim arising from your use of TapMyCar is limited to the greater of $100 or the fees you paid us in the 12 months before the claim arose. We are not liable for indirect, incidental, or consequential damages.</p>

  <h2>9. Indemnification</h2>
  <p>You agree to defend and indemnify Praman Tech LLC from claims arising out of your misuse of the service, your violation of these Terms, or your violation of any rights of a third party.</p>

  <h2>10. Governing law and disputes</h2>
  <p>These Terms are governed by the laws of the State of Connecticut, USA, without regard to conflict-of-laws rules. Any dispute will be resolved in the state or federal courts located in Hartford County, Connecticut.</p>

  <h2>11. Changes to these Terms</h2>
  <p>We may update these Terms occasionally. If we make material changes, we'll notify you by email or a prominent in-app notice. The "Last updated" date at the top will always reflect the most recent version. Continued use after a change means you accept the new Terms.</p>

  <h2>12. Termination</h2>
  <p>You can close your account at any time from the Settings page. We can suspend or terminate your account if you violate these Terms. Upon termination, your tags are disabled and your subscription is cancelled.</p>

  <h2>13. Physical stickers — shipping and handling</h2>
  <p>Physical stickers ship from the United States within 2-3 business days via standard mail. Delivery typically takes 3-7 business days within the US. We do not currently ship internationally. If your sticker does not arrive within 14 days, email us and we'll ship a replacement.</p>

  <h2>14. Emergency contact system (Premium only)</h2>
  <p>Premium users may optionally designate an emergency contact who receives calls if you don't answer within 3 rings. The emergency contact must consent to this arrangement. We are not responsible for failure of the emergency-contact system in any specific situation.</p>

  <h2>15. Referrals</h2>
  <p>When you refer a friend who signs up and purchases a paid plan, you earn rewards (currently $3 credit for the first referral, and a "choice reward" — free plan year or $4.99 coupon — for additional referrals). Abuse of the referral system (fake accounts, self-referrals, spam) results in forfeiture of rewards.</p>

  <h2>16. Third-party services</h2>
  <p>Payments are processed by Stripe. Calls are routed by Twilio. Emails are sent by Resend. By using TapMyCar you also consent to the terms of these providers where applicable.</p>

  <h2>17. Contact</h2>
  <p>Questions about these Terms? Email <a href="mailto:support@tapmycar.io">support@tapmycar.io</a> or write to:</p>
  <p>Praman Tech LLC<br>
  359 Lasalle Street<br>
  New Britain, CT 06051<br>
  United States</p>

  <div style="margin-top:40px;padding-top:20px;border-top:1px solid #E5E7EB;font-size:11px;color:#9CA3AF;text-align:center">
    <a href="/terms.html">Terms of Service</a> · <a href="/privacy.html">Privacy Policy</a> · © 2026 Praman Tech LLC
  </div>
</div>
</body>
</html>`;
}
