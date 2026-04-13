const fs = require('fs');
let content = fs.readFileSync('public/activity.html', 'utf8');
const old = "contentHTML = scan.photo_url";
const neu = "contentHTML = ''; if(scan.message_text){contentHTML += '<div style=\"background:#FFF3EC;border-radius:12px;padding:14px;margin-bottom:12px\"><div style=\"font-size:11px;color:#FF6B00;font-weight:700\">Message from stranger</div><div style=\"font-size:14px;color:#111\">\"' + scan.message_text + '\"</div></div>';} contentHTML += scan.photo_url";
content = content.replace(old, neu);
fs.writeFileSync('public/activity.html', content, 'utf8');
console.log('done');
