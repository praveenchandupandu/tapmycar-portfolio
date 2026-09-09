#!/usr/bin/env node
/* ============================================================================
 * claude-patch-38-product-image.js
 * ----------------------------------------------------------------------------
 * Adds the recommended `image` field to the Product JSON-LD on landing.html
 * and pricing.html. This clears the "non-critical issue" the Rich Results
 * Test flagged after Patch 37, and lets your search result show a product
 * image (the sticker hero) instead of text only.
 *
 * NOT required for validity -- Patch 37 already made the snippet valid. This
 * is the one optional field worth adding. (priceValidUntil is the other
 * optional field Google mentions; we skip it, because it needs an arbitrary
 * expiry date and adds nothing for a product with no sale end.)
 *
 * IMAGE: https://www.tapmycar.io/sticker-hero.png -- already served from
 * public/ on the Vercel CDN (the hero image fixed in an earlier session).
 *
 * SCOPE: website only. git push deploys it; no cap sync / app rebuild.
 *
 * JSON-aware and idempotent, same engine as Patch 37: only Product blocks
 * lacking `image` are touched; re-running is a no-op; backup + restore on any
 * failure.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');

const PUB = 'public';
const TARGETS = ['landing.html', 'pricing.html'];
const IMAGE_URL = 'https://www.tapmycar.io/sticker-hero.png';

const LDJSON_RE = /<script\s+type=["']application\/ld\+json["']\s*>([\s\S]*?)<\/script>/gi;

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
         p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
function countOf(hay, needle) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

const backups = [];
function die(msg) {
  for (const b of backups) { try { fs.copyFileSync(b.bak, b.file); } catch (e) {} }
  console.error('\n  ABORTED: ' + msg);
  console.error(backups.length ? '  Restored ' + backups.length + ' file(s).\n'
                               : '  Nothing was changed.\n');
  process.exit(1);
}

if (!fs.existsSync(PUB)) die('Cannot find public/. Run from the tapmycar project root.');

let edited = [], skipped = [];

for (const rel of TARGETS) {
  const full = path.join(PUB, rel);
  if (!fs.existsSync(full)) { skipped.push(rel + ' (not found)'); continue; }

  const src = fs.readFileSync(full, 'latin1');
  const eol = src.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
  const blocksBefore = countOf(src, 'application/ld+json');

  let touched = 0, alreadyOk = 0, sawProduct = 0;

  const out = src.replace(LDJSON_RE, function (whole, inner) {
    let obj;
    try { obj = JSON.parse(inner.trim()); } catch (e) { return whole; }
    if (!obj || obj['@type'] !== 'Product') return whole;
    sawProduct++;
    if (obj.image) { alreadyOk++; return whole; }

    // Insert `image` right after description if present, else at the end.
    // JSON key order is cosmetic, but this keeps the block readable.
    const ordered = {};
    for (const k of Object.keys(obj)) {
      ordered[k] = obj[k];
      if (k === 'description') ordered.image = IMAGE_URL;
    }
    if (!ordered.image) ordered.image = IMAGE_URL;

    let json = JSON.stringify(ordered, null, 2);
    if (eol === '\r\n') json = json.replace(/\n/g, '\r\n');
    if (/[^\x00-\x7F]/.test(json)) die('internal error: non-ASCII in generated JSON-LD for ' + rel);

    touched++;
    return '<script type="application/ld+json">' + eol + json + eol + '</script>';
  });

  if (touched === 0) {
    skipped.push(rel + (alreadyOk ? ' (Product already has image - skipped)'
                        : sawProduct ? ' (Product block present but not rewritten)'
                        : ' (no Product block)'));
    continue;
  }

  const bak = full + '.tmcbak-' + stamp();
  fs.copyFileSync(full, bak);
  backups.push({ file: full, bak: bak });
  fs.writeFileSync(full, out, 'latin1');

  const chk = fs.readFileSync(full, 'latin1');
  if (countOf(chk, 'application/ld+json') !== blocksBefore) die('ld+json block count changed in ' + rel);
  if (countOf(chk, '</head>') !== countOf(src, '</head>')) die('head tag count changed in ' + rel);
  if (countOf(chk, '<html') !== countOf(src, '<html')) die('html tag count changed in ' + rel);
  const nb = (src.match(/[^\x00-\x7F]/g) || []).length;
  const na = (chk.match(/[^\x00-\x7F]/g) || []).length;
  if (nb !== na) die('special-character count changed in ' + rel + ' (' + nb + ' -> ' + na + ')');

  let m, seen = 0, prod = 0, prodImg = 0, prodOffers = 0;
  const re = new RegExp(LDJSON_RE.source, 'gi');
  while ((m = re.exec(chk)) !== null) {
    seen++;
    let o;
    try { o = JSON.parse(m[1].trim()); } catch (e) { die('produced invalid JSON-LD in ' + rel); }
    if (o['@type'] === 'Product') {
      prod++;
      if (o.image) prodImg++;
      if (o.offers || o.review || o.aggregateRating) prodOffers++;
    }
  }
  if (seen !== blocksBefore) die('post-write block count mismatch in ' + rel);
  if (prod === 0 || prodImg !== prod) die('a Product block still lacks image in ' + rel);
  if (prodOffers !== prod) die('Patch 37 offers went missing in ' + rel + ' -- restored');

  edited.push('public/' + rel);
}

console.log('\n  OK  Product image added.\n');
if (edited.length)  { console.log('      Edited:');  edited.forEach(f => console.log('        ~ ' + f)); }
if (skipped.length) { console.log('      Skipped:'); skipped.forEach(f => console.log('        . ' + f)); }
console.log('');
console.log('      git push deploys it (website only, no cap sync).');
console.log('      Re-run the Rich Results Test afterwards -- the non-critical');
console.log('      image warning should be gone.');
console.log('');
