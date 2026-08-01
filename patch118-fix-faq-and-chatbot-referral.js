const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [now.getFullYear(), pad(now.getMonth()+1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes())].join('-');
const backupDir = 'backup-patch118-' + stamp;

function backup(filePath) {
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n=== TMC_PATCH118 - Hide financial FAQ entries on iOS, fix referral credit accuracy ===');

let anyChanged = false;

try {
  // ===================================================================
  // FIX 1 — help.html: hide refund policy + payment methods FAQ entries on iOS
  // ===================================================================
  const helpPath = path.join('public', 'help.html');
  if (fs.existsSync(helpPath)) {
    let content = fs.readFileSync(helpPath, 'utf8');
    const original = content;

    content = content.replace(
      '<div class="help-item"><div class="help-q">What\'s your refund policy?',
      '<div class="help-item tmc-hide-on-ios"><div class="help-q">What\'s your refund policy?'
    );
    content = content.replace(
      '<div class="help-item"><div class="help-q">Do you accept which payment methods?',
      '<div class="help-item tmc-hide-on-ios"><div class="help-q">Do you accept which payment methods?'
    );

    // FIX 2 — referral FAQ: correct the credit rule (only the SHARER gets credit,
    // not the friend who signs up) and hide it on iOS too, matching the now-hidden
    // Referrals feature itself.
    const oldReferralAnswer = 'Each TapMyCar account has a referral code (visible in <a href="/settings.html">Settings</a>). Share it with a friend; when they sign up and activate, both of you get a credit applied to your account. Credits reduce future charges automatically at checkout.';
    const newReferralAnswer = 'Each TapMyCar account has a referral code (visible in <a href="/settings.html">Settings</a>). Share it with a friend; when they sign up and activate, you (the person who shared the code) get a credit applied to your account. Credits reduce future charges automatically at checkout.';

    content = content.replace(oldReferralAnswer, newReferralAnswer);
    content = content.replace(
      '<div class="help-item"><div class="help-q">I have a referral code — how does it work?',
      '<div class="help-item tmc-hide-on-ios"><div class="help-q">I have a referral code — how does it work?'
    );

    if (content !== original) {
      backup(helpPath);
      fs.writeFileSync(helpPath, content, 'utf8');
      console.log('  help.html: hid refund policy + payment methods FAQ entries on iOS');
      console.log('  help.html: fixed referral credit wording (only sharer gets credit) + hid entry on iOS');
      anyChanged = true;
    } else {
      console.log('  help.html: already fixed or patterns not found - check manually');
    }
  } else {
    console.log('  public/help.html not found - skipped');
  }

  // ===================================================================
  // FIX 3 — api/chat.js: teach the chatbot the correct referral credit rule
  // ===================================================================
  const chatPath = path.join('api', 'chat.js');
  if (fs.existsSync(chatPath)) {
    let content = fs.readFileSync(chatPath, 'utf8');
    const original = content;

    const marker = 'REFERRAL CREDITS (TMC_PATCH118)';
    if (content.includes(marker)) {
      console.log('  api/chat.js: referral credit info already present');
    } else {
      const anchor = '- Promo or gift code: there\'s a "Have a promo code?" option on the checkout/registration flow, and redeemed codes show under "My family codes" on the dashboard.';
      const insertion = anchor + '\n- ' + marker + ': each account has a referral code (visible in Settings). ONLY the person who SHARED the code gets a credit when their friend signs up and activates - the friend who signs up does NOT get a credit themselves. Never say both people get a credit.';

      if (content.includes(anchor)) {
        content = content.replace(anchor, insertion);
        backup(chatPath);
        fs.writeFileSync(chatPath, content, 'utf8');
        console.log('  api/chat.js: added accurate referral credit rule to the chatbot');
        anyChanged = true;
      } else {
        console.log('  api/chat.js: anchor text not found - check manually');
      }
    }
  } else {
    console.log('  api/chat.js not found - skipped');
  }

  console.log('\n=== TMC_PATCH118 complete ===');
  if (anyChanged) {
    console.log('\nNext steps:');
    console.log('  1. api/chat.js change is backend-only (Vercel), live in ~60s, no rebuild needed');
    console.log('  2. help.html change needs: npx cap sync ios -> bump build -> commit -> push -> rebuild -> retest\n');
  }

} catch (err) {
  console.error('\nPATCH FAILED: ' + err.message);
  process.exit(1);
}
