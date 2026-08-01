const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [now.getFullYear(), pad(now.getMonth()+1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes())].join('-');
const backupDir = 'backup-patch119-' + stamp;

function backup(filePath) {
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n=== TMC_PATCH119 - Chatbot: redirect purchase questions to website + fix markdown rendering ===');

let anyChanged = false;

try {
  // ===================================================================
  // FIX 1 — api/chat.js: never walk the user through buying/upgrading
  //          in-app, always point to the website instead
  // ===================================================================
  const chatPath = path.join('api', 'chat.js');
  if (fs.existsSync(chatPath)) {
    let content = fs.readFileSync(chatPath, 'utf8');
    const original = content;

    const marker = 'CRITICAL - PURCHASE QUESTIONS (TMC_PATCH119)';
    if (content.includes(marker)) {
      console.log('  api/chat.js: purchase-redirect rule already present');
    } else {
      const anchor = 'YOUR JOB\nYou solve people\'s problems directly and conversationally. You are NOT a deflection bot. Walk users through solutions step by step, like a knowledgeable friend would. Only suggest emailing support@tapmycar.io for things that genuinely need account access you don\'t have (refund status, a missing physical shipment, billing disputes, account deletion). For everything else - explain, guide, and solve it yourself.';

      const insertion = anchor + '\n\n' + marker + ': if the user asks how to buy, purchase, upgrade, subscribe to, or activate a paid plan (Standard, Premium, Business), do NOT walk them through in-app steps or explain how to select/confirm a plan. Instead, tell them warmly that plans and pricing are handled on the website, and direct them to tapmycar.io/pricing to see options and complete it there. Keep it brief - one or two sentences, not a numbered walkthrough. This applies even if they ask "how do I upgrade" or "how do I buy premium" specifically - always send them to the website rather than describing the purchase steps yourself.';

      if (content.includes(anchor)) {
        content = content.replace(anchor, insertion);
        backup(chatPath);
        fs.writeFileSync(chatPath, content, 'utf8');
        console.log('  api/chat.js: added rule - chatbot now redirects purchase questions to the website');
        anyChanged = true;
      } else {
        console.log('  api/chat.js: anchor text not found - check manually');
      }
    }
  } else {
    console.log('  api/chat.js not found - skipped');
  }

  // ===================================================================
  // FIX 2 — app.js: render **bold** and line breaks in bot messages
  //          instead of showing raw markdown asterisks
  // ===================================================================
  const appPath = path.join('public', 'app.js');
  if (fs.existsSync(appPath)) {
    let content = fs.readFileSync(appPath, 'utf8');
    const original = content;

    const marker = 'TMC_PATCH119_MARKDOWN_RENDER';
    if (content.includes(marker)) {
      console.log('  app.js: markdown rendering already present');
    } else {
      const oldFn =
        'function addChatMessage(text, isUser) {\r\n' +
        '  const msgs = document.getElementById(\'tmc-chat-messages\');\r\n' +
        '  const div = document.createElement(\'div\');\r\n' +
        '  div.className = \'tmc-msg \' + (isUser ? \'tmc-msg-user\' : \'tmc-msg-bot\');\r\n' +
        '  div.innerHTML = `<div class="tmc-msg-bubble">${text}</div>`;\r\n' +
        '  msgs.appendChild(div);\r\n' +
        '  msgs.scrollTop = msgs.scrollHeight;\r\n' +
        '}\r\n';

      const newFn =
        '// ' + marker + '\r\n' +
        'function tmcFormatBotMessage(text) {\r\n' +
        '  var escaped = String(text)\r\n' +
        '    .replace(/&/g, \'&amp;\').replace(/</g, \'&lt;\').replace(/>/g, \'&gt;\');\r\n' +
        '  escaped = escaped.replace(/\\*\\*(.+?)\\*\\*/g, \'<strong>$1</strong>\');\r\n' +
        '  escaped = escaped.replace(/\\n/g, \'<br>\');\r\n' +
        '  return escaped;\r\n' +
        '}\r\n' +
        '\r\n' +
        'function addChatMessage(text, isUser) {\r\n' +
        '  const msgs = document.getElementById(\'tmc-chat-messages\');\r\n' +
        '  const div = document.createElement(\'div\');\r\n' +
        '  div.className = \'tmc-msg \' + (isUser ? \'tmc-msg-user\' : \'tmc-msg-bot\');\r\n' +
        '  var rendered = isUser ? text : tmcFormatBotMessage(text);\r\n' +
        '  div.innerHTML = `<div class="tmc-msg-bubble">${rendered}</div>`;\r\n' +
        '  msgs.appendChild(div);\r\n' +
        '  msgs.scrollTop = msgs.scrollHeight;\r\n' +
        '}\r\n';

      if (content.includes(oldFn)) {
        content = content.replace(oldFn, newFn);
        backup(appPath);
        fs.writeFileSync(appPath, content, 'utf8');
        console.log('  app.js: fixed - bot messages now render **bold** and line breaks properly');
        anyChanged = true;
      } else {
        console.log('  app.js: addChatMessage function not found in expected form - check manually');
      }
    }
  } else {
    console.log('  public/app.js not found - skipped');
  }

  console.log('\n=== TMC_PATCH119 complete ===');
  if (anyChanged) {
    console.log('\nNext steps:');
    console.log('  1. api/chat.js change is backend-only, live in ~60s, no rebuild needed');
    console.log('  2. app.js change needs: npx cap sync ios -> bump build -> commit -> push -> rebuild -> retest\n');
  }

} catch (err) {
  console.error('\nPATCH FAILED: ' + err.message);
  process.exit(1);
}
