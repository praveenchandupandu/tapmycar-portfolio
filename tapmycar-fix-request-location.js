// ═══════════════════════════════════════════════════════════════
// TapMyCar — fix the actual scan regression
// ═══════════════════════════════════════════════════════════════
// Root cause confirmed via the API response Praveen captured:
// the API returns the tag correctly, with status='active'. The
// page initially displays correctly, then loadTag() calls
// requestLocation() which references DOM element 'location-notice'.
// My V6 deploy removed that element from the active-state markup.
// The null reference throws, loadTag's catch fires, and
// showState('invalid') flips the page to the red Invalid Tag.
//
// Fix: make requestLocation() defensive — bail out if location-notice
// isn't present. This adds zero new functionality, just prevents the
// missing-element crash. Affects only public/contact.html.
//
// Run from project root:  node tapmycar-fix-request-location.js
// Idempotent.
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
const BACKUP = path.join(ROOT, 'backup-reqloc-' + stamp);
fs.mkdirSync(BACKUP, { recursive: true });
fs.copyFileSync(TARGET, path.join(BACKUP, 'contact.html'));
console.log('  Backup: ' + path.relative(ROOT, BACKUP));

let html = fs.readFileSync(TARGET, 'utf8');

if (html.indexOf('TMC_REQ_LOC_DEFENSIVE') !== -1) {
  console.log('  contact.html: already patched, skipping');
  process.exit(0);
}

// Match the existing requestLocation function (handles both Windows CRLF
// and Unix LF line endings, and any whitespace variation).
const oldRegex = /function requestLocation\(\)\{\s*\r?\n?\s*const notice\s*=\s*document\.getElementById\(['"]location-notice['"]\);\s*\r?\n?\s*notice\.style\.display\s*=\s*['"]block['"];\s*\r?\n?\s*setTimeout\(\(\)\s*=>\s*\{\s*\r?\n?\s*if\s*\(\s*['"]geolocation['"]\s*in\s+navigator\s*\)\s*\{\s*\r?\n?\s*navigator\.geolocation\.getCurrentPosition\(\s*\r?\n?\s*\(pos\)\s*=>\s*\{\s*saveLocation\(pos\.coords\.latitude,\s*pos\.coords\.longitude\);\s*notice\.style\.display\s*=\s*['"]none['"];\s*\},\s*\r?\n?\s*\(\)\s*=>\s*\{\s*notice\.style\.display\s*=\s*['"]none['"];\s*\}\s*\r?\n?\s*\);\s*\r?\n?\s*\}else\{notice\.style\.display\s*=\s*['"]none['"];\}\s*\r?\n?\s*\},\s*2000\);\s*\r?\n?\s*\}/;

const newFn = `function requestLocation(){
  // TMC_REQ_LOC_DEFENSIVE — null-check notice element before .style access.
  // The V6 contact-page redesign removed the inline location-notice element;
  // this guard prevents a TypeError that would otherwise flip the page to
  // the red Invalid Tag state via loadTag's catch block.
  const notice=document.getElementById('location-notice');
  if(notice)notice.style.display='block';
  setTimeout(()=>{
    if('geolocation'in navigator){
      navigator.geolocation.getCurrentPosition(
        (pos)=>{saveLocation(pos.coords.latitude,pos.coords.longitude);if(notice)notice.style.display='none';},
        ()=>{if(notice)notice.style.display='none';}
      );
    }else{if(notice)notice.style.display='none';}
  },2000);
}`;

if (!oldRegex.test(html)) {
  console.error('  ERROR: contact.html — could not find requestLocation function.');
  console.error('  This patch expects the standard requestLocation() format.');
  process.exit(1);
}

html = html.replace(oldRegex, newFn);
fs.writeFileSync(TARGET, html, 'utf8');

console.log('  contact.html: requestLocation now null-safe');
console.log('');
console.log('═══════════════════════════════════════════════');
console.log('  REQUEST-LOCATION FIX COMPLETE');
console.log('═══════════════════════════════════════════════');
console.log('  Backup: ' + path.relative(ROOT, BACKUP));
console.log('');
console.log('Deploy:');
console.log('  git add public/contact.html');
console.log('  git commit -m "Fix scan regression: null-safe requestLocation"');
console.log('  git push');
console.log('');
console.log('After deploy, hard-refresh the contact URL in incognito.');
console.log('You should see the V6 contact page (not the red Invalid Tag).');
