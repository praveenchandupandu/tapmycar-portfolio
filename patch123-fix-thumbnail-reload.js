const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [now.getFullYear(), pad(now.getMonth()+1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes())].join('-');
const backupDir = 'backup-patch123-' + stamp;

function backup(filePath) {
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n=== TMC_PATCH123 - Make video thumbnails self-heal instead of needing a manual reload ===');
console.log('These images are hosted on Supabase Storage, which is known to sometimes fail to');
console.log('serve a file correctly on its very first request (a known caching quirk for that');
console.log('service). This adds automatic retry when an image fails to load, so it fixes');
console.log('itself within the same page load instead of requiring you to reload.');

try {
  const reelsPath = path.join('public', 'tmc-reels.js');
  if (!fs.existsSync(reelsPath)) throw new Error(reelsPath + ' not found');

  let content = fs.readFileSync(reelsPath, 'utf8');
  const original = content;

  const marker = 'TMC_PATCH123_IMG_RETRY';
  if (content.includes(marker)) {
    console.log('\n  Already fixed - no changes needed');
  } else {
    const oldImg1 = '\'<img loading="lazy" src="\' + v.thumbnail_url + \'" alt="">\'';
    const oldImg2 = '\'<img loading="lazy" src="\' + v.thumbnail_url + \'" alt="">\'';
    const newImg = '\'<img loading="lazy" src="\' + v.thumbnail_url + \'" alt="" onerror="tmcRetryImg(this)">\'';

    const count = content.split(oldImg1).length - 1;
    if (count < 2) {
      throw new Error('Expected 2 occurrences of the thumbnail <img> pattern, found ' + count + ' - check public/tmc-reels.js manually');
    }

    content = content.split(oldImg1).join(newImg);

    const helper =
      '// ' + marker + '\n' +
      'function tmcRetryImg(imgEl) {\n' +
      '  var attempts = parseInt(imgEl.getAttribute(\'data-tmc-retry\') || \'0\', 10);\n' +
      '  if (attempts >= 2) { imgEl.onerror = null; imgEl.style.display = \'none\'; return; }\n' +
      '  imgEl.setAttribute(\'data-tmc-retry\', String(attempts + 1));\n' +
      '  var baseUrl = imgEl.getAttribute(\'data-tmc-src\') || imgEl.src.split(\'?\')[0];\n' +
      '  imgEl.setAttribute(\'data-tmc-src\', baseUrl);\n' +
      '  setTimeout(function () {\n' +
      '    imgEl.src = baseUrl + \'?retry=\' + Date.now();\n' +
      '  }, 600 * (attempts + 1));\n' +
      '}\n\n';

    content = helper + content;

    backup(reelsPath);
    fs.writeFileSync(reelsPath, content, 'utf8');
    console.log('\n  Fixed - thumbnails now auto-retry up to 2 times (with increasing delay) if they');
    console.log('  fail to load, self-healing within the same page view');
  }

  console.log('\n=== TMC_PATCH123 complete ===');
  console.log('\nThis is a WEBSITE-only fix for now (tmc-reels.js is shared, so it also fixes the');
  console.log('same thumbnails inside the app once synced/rebuilt later - not urgent to rebuild');
  console.log('just for this).\n');

} catch (err) {
  console.error('\nPATCH FAILED: ' + err.message);
  process.exit(1);
}
