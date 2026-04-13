const fs = require('fs');
let content = fs.readFileSync('public/activity.html', 'utf8');
const old = `  if ((action === 'view' || action === 'quick_message') && scan.latitude && scan.longitude && document.getElementById('detail-map-container')) {
    setTimeout(() => {`;
const neu = `  if ((action === 'view' || action === 'quick_message') && scan.latitude && scan.longitude) {
    setTimeout(() => {
      if (!document.getElementById('detail-map-container')) return;`;
content = content.replace(old, neu);
fs.writeFileSync('public/activity.html', content, 'utf8');
console.log('done');
