const fs = require('fs');
let content = fs.readFileSync('public/activity.html', 'utf8');
const old = `  if (action === 'quick_message') {
    contentHTML = scan.message_text
      ? '<div style="background:#FFF3EC;border:1.5px solid #FFE4CC;border-radius:12px;padding:14px;margin-bottom:12px"><div style="font-size:11px;color:#FF6B00;font-weight:700;margin-bottom:6px">Message from stranger</div><div style="font-size:15px;color:#111;font-weight:600">"' + scan.message_text + '"</div></div>'
      : '<div style="background:#F9FAFB;border-radius:12px;padding:14px;text-align:center;color:#6B7280;font-size:13px">No message content saved</div>';`;
const neu = `  if (action === 'quick_message') {
    if (scan.message_text) {
      contentHTML += '<div style="background:#FFF3EC;border:1.5px solid #FFE4CC;border-radius:12px;padding:14px;margin-bottom:12px"><div style="font-size:11px;color:#FF6B00;font-weight:700;margin-bottom:6px">Message from stranger</div><div style="font-size:15px;color:#111;font-weight:600">"' + scan.message_text + '"</div></div>';
    } else {
      contentHTML += '<div style="background:#F9FAFB;border-radius:12px;padding:14px;text-align:center;color:#6B7280;font-size:13px">No message content saved</div>';
    }
    if (scan.photo_url) {
      contentHTML += '<div style="margin-bottom:12px"><div style="font-size:11px;color:#7C3AED;font-weight:700;margin-bottom:8px">Photo sent by stranger</div><img src="' + scan.photo_url + '" style="width:100%;border-radius:12px;max-height:240px;object-fit:cover"></div>';
    }
    if (scan.latitude && scan.longitude) {
      contentHTML += '<div id="detail-map-container" style="height:180px;border-radius:14px;overflow:hidden;margin-bottom:12px;background:#F3F4F6"></div><a href="https://maps.google.com/?q=' + scan.latitude + ',' + scan.longitude + '" target="_blank" style="display:block;background:#FF6B00;color:#fff;font-size:13px;font-weight:700;padding:13px 0;border-radius:13px;text-align:center;text-decoration:none;margin-bottom:8px">View on Google Maps</a>';
    }`;
content = content.replace(old, neu);
fs.writeFileSync('public/activity.html', content, 'utf8');
console.log(content.includes('photo_url') ? 'done' : 'not found');
