#!/usr/bin/env node
/* ============================================================================
 * claude-patch-37-product-offers.js
 * ----------------------------------------------------------------------------
 * FIXES: Google Search Console "Product snippets" critical error --
 *   "Either 'offers', 'review', or 'aggregateRating' should be specified".
 *
 * WHY: Patch 34 injected a Product JSON-LD block on landing.html and
 * pricing.html carrying name/description/brand/category/url but NO price
 * information. Google requires a schema.org/Product to include at least one
 * of offers, review, or aggregateRating. We add `offers` (real prices) --
 * NOT review/aggregateRating, because those must reflect genuine customer
 * reviews shown on the page and inventing them violates Google's policy.
 *
 * The price range 9.99 - 24.99 is the physical tag price (Standard / Premium),
 * expressed as an AggregateOffer, which is exactly what a product with tiers
 * should use.
 *
 * SCOPE: website only. Google crawls the website (Vercel), not the app, so a
 * git push is all this fix needs -- no `npx cap sync`, no app rebuild. (The
 * edited files ride along harmlessly in the next app build regardless.)
 *
 * HOW IT WORKS: JSON-aware, not text-anchored. For each target file it finds
 * every <script type="application/ld+json"> block, parses the JSON, and only
 * touches blocks whose @type is "Product" that lack offers/review/
 * aggregateRating. Organization and any already-fixed Product blocks are left
 * exactly as-is. Re-running is a no-op.
 *
 * SAFE / IDEMPOTENT: timestamped backup per edited file; JSON re-parsed and
 * re-validated after write; every backup restored on any failure.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');

const PUB = 'public';
const TARGETS = ['landing.html', 'pricing.html'];

/* AggregateOffer = the correct shape for a product sold at more than one
   price point. lowPrice + priceCurrency are the fields Google requires. */
const OFFERS = {
  '@type': 'AggregateOffer',
  priceCurrency: 'USD',
  lowPrice: '9.99',
  highPrice: '24.99',
  offerCount: '2',
  availability: 'https://schema.org/InStock',
  url: 'https://www.tapmycar.io/pricing'
};

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
  let touchedThisFile = 0;
  let alreadyOk = 0;

  const out = src.replace(LDJSON_RE, function (whole, inner) {
    let obj;
    try { obj = JSON.parse(inner.trim()); }
    catch (e) { return whole; }          // not our block / not parseable -> leave it

    if (!obj || obj['@type'] !== 'Product') return whole;   // only Products
    if (obj.offers || obj.review || obj.aggregateRating) {  // already satisfies Google
      alreadyOk++;
      return whole;
    }

    // normalise a non-www product url while we're here (harmless if already www)
    if (typeof obj.url === 'string') {
      obj.url = obj.url.replace('https://tapmycar.io', 'https://www.tapmycar.io');
    }
    obj.offers = OFFERS;

    let json = JSON.stringify(obj, null, 2);
    if (eol === '\r\n') json = json.replace(/\n/g, '\r\n');
    if (/[^\x00-\x7F]/.test(json)) die('internal error: non-ASCII in generated JSON-LD for ' + rel);

    touchedThisFile++;
    return '<script type="application/ld+json">' + eol + json + eol + '</script>';
  });

  if (touchedThisFile === 0) {
    skipped.push(rel + (alreadyOk ? ' (already has offers - skipped)'
                                  : ' (no Product block needing offers)'));
    continue;
  }

  // --- write with backup ---
  const bak = full + '.tmcbak-' + stamp();
  fs.copyFileSync(full, bak);
  backups.push({ file: full, bak: bak });
  fs.writeFileSync(full, out, 'latin1');

  // --- verify ---
  const chk = fs.readFileSync(full, 'latin1');
  if (countOf(chk, 'application/ld+json') !== blocksBefore)
    die('ld+json block count changed in ' + rel);
  if (countOf(chk, '</head>') !== countOf(src, '</head>'))
    die('head tag count changed in ' + rel);
  if (countOf(chk, '<html') !== countOf(src, '<html'))
    die('html tag count changed in ' + rel);
  const nb = (src.match(/[^\x00-\x7F]/g) || []).length;
  const na = (chk.match(/[^\x00-\x7F]/g) || []).length;
  if (nb !== na) die('special-character count changed in ' + rel + ' (' + nb + ' -> ' + na + ')');

  // every ld+json block must still be valid JSON, and every Product must now
  // carry offers/review/aggregateRating
  let m, seen = 0, productsOk = 0, products = 0;
  const re = new RegExp(LDJSON_RE.source, 'gi');
  while ((m = re.exec(chk)) !== null) {
    seen++;
    let o;
    try { o = JSON.parse(m[1].trim()); }
    catch (e) { die('produced invalid JSON-LD in ' + rel); }
    if (o['@type'] === 'Product') {
      products++;
      if (o.offers || o.review || o.aggregateRating) productsOk++;
    }
  }
  if (seen !== blocksBefore) die('post-write ld+json block count mismatch in ' + rel);
  if (products === 0 || productsOk !== products)
    die('a Product block still lacks offers in ' + rel);

  edited.push('public/' + rel + '  (' + touchedThisFile + ' Product block' +
              (touchedThisFile === 1 ? '' : 's') + ' fixed)');
}

console.log('\n  OK  Product offers added.\n');
if (edited.length)  { console.log('      Edited:');  edited.forEach(f => console.log('        ~ ' + f)); }
if (skipped.length) { console.log('      Skipped:'); skipped.forEach(f => console.log('        . ' + f)); }
console.log('');
console.log('      Deploy is website-only: git push. No cap sync / app rebuild needed.');
console.log('      After it is live, in Search Console open the Product snippets');
console.log('      report and click "Validate Fix" so Google re-crawls the pages.');
console.log('');
