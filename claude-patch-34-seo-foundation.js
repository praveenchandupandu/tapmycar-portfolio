#!/usr/bin/env node
/* ============================================================================
 * claude-patch-34-seo-foundation.js
 * ----------------------------------------------------------------------------
 * tapmycar.io returns ZERO results for site:tapmycar.io - Google has not
 * indexed the site at all. This is a discovery problem, not a ranking problem.
 * No amount of keyword tuning helps a site Google has never crawled.
 *
 * Three things are missing that Google looks for first:
 *
 *   1. robots.txt   - crawlers check this before anything else. Its absence
 *                     is not fatal, but it is also where the sitemap is
 *                     advertised, which IS how Google finds all your pages.
 *   2. sitemap.xml  - an explicit list of every page worth indexing. Without
 *                     it Google has to guess by following links, and pages
 *                     with no inbound links may never be found.
 *   3. canonical +  - canonical prevents your content being treated as
 *      structured     duplicate across / and /landing. Structured data
 *      data           (JSON-LD) is what produces rich results and helps Google
 *                     understand you are a product/organisation, not a blog.
 *
 * WHAT THIS PATCH DOES NOT DO: it cannot make you rank first. Ranking is
 * earned over weeks through indexing, content and links. What it does is make
 * the site indexable and correctly described, which is the prerequisite. The
 * single highest-impact step is NOT in this patch - it is submitting the site
 * to Google Search Console by hand, which only the domain owner can do. The
 * patch prints instructions for that at the end.
 *
 * ROBOTS POLICY: private/authenticated pages (dashboard, billing, settings,
 * admin, tag pages, contact pages) are DISALLOWED. This matters for privacy -
 * your product's whole promise is that a tag page is seen by whoever scans the
 * sticker, NOT indexed and searchable by strangers on Google. Marketing pages
 * are allowed.
 *
 * SAFE / IDEMPOTENT: new files are only created if absent; edited files get a
 * timestamped backup, an anchor that must match exactly once, and are re-parsed
 * and restored on any failure.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');

const MARKER = 'TMC_PATCH34_SEO';
const SITE = 'https://www.tapmycar.io';
const PUB = 'public';

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
         p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
const backups = [];
function die(msg) {
  for (const b of backups) { try { fs.copyFileSync(b.bak, b.file); } catch (e) {} }
  console.error('\n  ABORTED: ' + msg);
  console.error(backups.length ? '  Restored ' + backups.length + ' file(s).\n' : '  Nothing was changed.\n');
  process.exit(1);
}
function countOf(hay, needle) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

if (!fs.existsSync(PUB)) die('Cannot find public/. Run from the tapmycar project root.');

/* Pages safe to index. Deliberately EXCLUDES anything private or
   session-bound. Tag and contact pages are excluded on purpose: indexing them
   would expose customers' vehicle pages to Google search, which contradicts
   the privacy promise of the product. */
const INDEXABLE = [
  ['/', '1.0', 'weekly'],
  ['/landing', '0.9', 'weekly'],
  ['/pricing', '0.9', 'weekly'],
  ['/knowmore', '0.8', 'monthly'],
  ['/business', '0.8', 'monthly'],
  ['/for-tow-companies', '0.7', 'monthly'],
  ['/towing', '0.6', 'monthly'],
  ['/help', '0.6', 'monthly'],
  ['/reviews', '0.5', 'monthly'],
  ['/register', '0.5', 'monthly'],
  ['/signin', '0.3', 'yearly'],
  ['/privacy', '0.3', 'yearly'],
  ['/terms', '0.3', 'yearly']
];

/* Private areas kept out of search results. */
const DISALLOW = [
  '/dashboard', '/settings', '/billing', '/renew', '/activate', '/activity',
  '/manage', '/my-tows', '/claim', '/reset', '/verify', '/payment-success',
  '/delete-account', '/unsubscribe', '/towing-signin', '/splash', '/voice',
  '/tag/', '/contact', '/r/', '/api/', '/cmshaveaccesstouser2026-npmevy.html'
];

const today = new Date().toISOString().slice(0, 10);
let created = [], edited = [], skipped = [];

/* ── 1. robots.txt ─────────────────────────────────────────────────────── */
const robotsPath = path.join(PUB, 'robots.txt');
if (fs.existsSync(robotsPath)) {
  skipped.push('robots.txt (already exists - left untouched)');
} else {
  const robots = [
    '# ' + MARKER,
    '# TapMyCar - Praman Tech LLC',
    '',
    'User-agent: *',
    ''
  ].concat(DISALLOW.map(d => 'Disallow: ' + d)).concat([
    '',
    'Allow: /',
    '',
    '# Sitemap tells crawlers about every page worth indexing.',
    'Sitemap: ' + SITE + '/sitemap.xml',
    ''
  ]).join('\n');
  if (/[^\x00-\x7F]/.test(robots)) die('internal error: non-ASCII in robots.txt.');
  fs.writeFileSync(robotsPath, robots, 'latin1');
  created.push('public/robots.txt');
}

/* ── 2. sitemap.xml ────────────────────────────────────────────────────── */
const sitemapPath = path.join(PUB, 'sitemap.xml');
if (fs.existsSync(sitemapPath)) {
  skipped.push('sitemap.xml (already exists - left untouched)');
} else {
  const entries = INDEXABLE.map(function (e) {
    return [
      '  <url>',
      '    <loc>' + SITE + e[0] + '</loc>',
      '    <lastmod>' + today + '</lastmod>',
      '    <changefreq>' + e[2] + '</changefreq>',
      '    <priority>' + e[1] + '</priority>',
      '  </url>'
    ].join('\n');
  }).join('\n');
  const sitemap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- ' + MARKER + ' -->',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entries,
    '</urlset>',
    ''
  ].join('\n');
  if (/[^\x00-\x7F]/.test(sitemap)) die('internal error: non-ASCII in sitemap.xml.');
  fs.writeFileSync(sitemapPath, sitemap, 'latin1');
  created.push('public/sitemap.xml');
}

/* ── 3. canonical + JSON-LD on the two entry pages ─────────────────────── */
const ORG_LD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'TapMyCar',
  legalName: 'Praman Tech LLC',
  url: SITE,
  logo: SITE + '/sticker-hero.png',
  description: 'Privacy-first vehicle contact. A NFC and QR sticker for your car that lets anyone reach you about your parked vehicle without ever seeing your real phone number.',
  email: 'support@tapmycar.io',
  address: { '@type': 'PostalAddress', addressRegion: 'CT', addressCountry: 'US' },
  sameAs: []
};

const PRODUCT_LD = {
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: 'TapMyCar Vehicle Contact Tag',
  description: 'NFC and QR sticker for your car. Strangers can call you about your parked vehicle through a masked number, so your real phone number stays private. Instant scan alerts to your phone.',
  brand: { '@type': 'Brand', name: 'TapMyCar' },
  category: 'Vehicle Accessories',
  url: SITE + '/pricing'
};

function injectSeo(file, canonicalPath, ld) {
  const full = path.join(PUB, file);
  if (!fs.existsSync(full)) { skipped.push(file + ' (not found)'); return; }
  const src = fs.readFileSync(full, 'latin1');
  if (src.indexOf(MARKER) !== -1) { skipped.push(file + ' (already patched)'); return; }

  if (countOf(src, '</head>') !== 1) { skipped.push(file + ' (no single </head> - skipped)'); return; }

  const hasCanonical = /rel=["']canonical["']/.test(src);
  const block = [
    '',
    '<!-- ' + MARKER + ' -->',
    hasCanonical ? '' : '<link rel="canonical" href="' + SITE + canonicalPath + '">',
    '<meta name="robots" content="index, follow, max-image-preview:large">',
    '<script type="application/ld+json">',
    JSON.stringify(ld, null, 2),
    '<' + '/script>',
    ''
  ].filter(Boolean).join('\n');

  if (/[^\x00-\x7F]/.test(block)) die('internal error: non-ASCII in SEO block for ' + file);

  const bak = full + '.tmcbak-' + stamp();
  fs.copyFileSync(full, bak);
  backups.push({ file: full, bak: bak });

  const out = src.replace('</head>', function () { return block + '</head>'; });
  fs.writeFileSync(full, out, 'latin1');

  const chk = fs.readFileSync(full, 'latin1');
  if (chk.indexOf(MARKER) === -1) die('verification failed: marker missing in ' + file);
  if (countOf(chk, '</head>') !== 1) die('head tag count changed in ' + file);
  if (countOf(chk, '<html') !== countOf(src, '<html')) die('html tag count changed in ' + file);
  try { JSON.parse(JSON.stringify(ld)); } catch (e) { die('invalid JSON-LD for ' + file); }
  const nb = (src.match(/[^\x00-\x7F]/g) || []).length;
  const na = (chk.match(/[^\x00-\x7F]/g) || []).length;
  if (nb !== na) die('special characters changed in ' + file + ' (' + nb + ' -> ' + na + ')');
  edited.push('public/' + file);
}

try {
  injectSeo('index.html', '/', ORG_LD);
  injectSeo('landing.html', '/landing', PRODUCT_LD);
  injectSeo('pricing.html', '/pricing', PRODUCT_LD);
} catch (e) {
  if (e && e.__tmcDie) throw e;
  die('unexpected error during injection: ' + (e && e.message));
}

/* ── 4. og:url must use the production domain ──────────────────────────────
   Vercel serves www.tapmycar.io as Production; tapmycar.io 307-redirects to
   it, and Google has already selected www as canonical. Every og:url in the
   codebase points at the NON-www version, which contradicts that. Mismatched
   signals are exactly why Google had to guess a canonical. Only the pages we
   actually want indexed are corrected here - private pages are left alone. */
const OG_PAGES = ['index.html', 'landing.html', 'pricing.html', 'knowmore.html',
                  'business.html', 'for-tow-companies.html', 'help.html', 'reviews.html'];
let ogFixed = 0;
for (const f of OG_PAGES) {
  const full = path.join(PUB, f);
  if (!fs.existsSync(full)) continue;
  const s = fs.readFileSync(full, 'latin1');
  if (s.indexOf('content="https://tapmycar.io') === -1) continue;

  const already = backups.some(b => b.file === full);
  if (!already) {
    const bak = full + '.tmcbak-' + stamp();
    fs.copyFileSync(full, bak);
    backups.push({ file: full, bak: bak });
  }

  /* Only rewrite inside og:url / og:image / twitter:image meta content -
     never touch links, scripts or API base URLs. */
  const out = s.replace(
    /(<meta\s+(?:property|name)="(?:og:url|og:image|twitter:image)"\s+content=")https:\/\/tapmycar\.io/g,
    function (m, p1) { ogFixed++; return p1 + 'https://www.tapmycar.io'; }
  );

  if (out !== s) {
    fs.writeFileSync(full, out, 'latin1');
    const chk = fs.readFileSync(full, 'latin1');
    if (countOf(chk, '<html') !== countOf(s, '<html')) die('html tag count changed in ' + f);
    const nb = (s.match(/[^\x00-\x7F]/g) || []).length;
    const na = (chk.match(/[^\x00-\x7F]/g) || []).length;
    if (nb !== na) die('special characters changed in ' + f);
  }
}

/* ── Report ────────────────────────────────────────────────────────────── */
console.log('\n  OK  SEO foundation in place.\n');
if (created.length) { console.log('      Created:'); created.forEach(f => console.log('        + ' + f)); }
if (edited.length)  { console.log('      Edited:');  edited.forEach(f => console.log('        ~ ' + f)); }
if (skipped.length) { console.log('      Skipped:'); skipped.forEach(f => console.log('        . ' + f)); }
console.log('');
console.log('      Sitemap lists ' + INDEXABLE.length + ' public pages on www.tapmycar.io');
console.log('      Corrected ' + ogFixed + ' og:url / og:image tags to the www domain.');
console.log('      ' + DISALLOW.length + ' private paths blocked from search results');
console.log('      (tag and contact pages are blocked ON PURPOSE - customer');
console.log('       vehicle pages must never be searchable on Google).');
console.log('');
console.log('  ====================================================');
console.log('  THIS PATCH ALONE WILL NOT GET YOU INDEXED.');
console.log('  The step that actually matters must be done by hand:');
console.log('');
console.log('    1. Go to search.google.com/search-console');
console.log('    2. Add property: tapmycar.io  (choose Domain)');
console.log('    3. Verify via DNS TXT record in Cloudflare');
console.log('    4. Sitemaps -> submit: sitemap.xml');
console.log('    5. URL Inspection -> enter tapmycar.io -> Request Indexing');
console.log('');
console.log('  Indexing typically takes a few days to two weeks.');
console.log('  ====================================================\n');
