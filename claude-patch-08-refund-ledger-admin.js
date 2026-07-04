#!/usr/bin/env node
/* ============================================================================
 * claude-patch-08-refund-ledger-admin.js
 * ----------------------------------------------------------------------------
 * Surfaces the full refund_log ledger inside the admin dashboard.
 *
 * Two parts:
 *   1) NEW api/admin-refund-log.js  -> returns refund_log rows (admin-only).
 *   2) EDIT the admin dashboard (public/cmshaveaccesstouser2026-npmevy.html):
 *      add a "Complete ledger" section under the existing Refunds panel that
 *      lists every refund (Cancel button, account deletion, manual Stripe) with
 *      who / amount / when / source / status. Existing failed & successful
 *      sections are untouched.
 *
 * REQUIRES: refund_log table (already created) + patch 07 (webhook logger).
 * SCOPE: one new API file + the admin HTML (mirrored to root if a copy exists).
 * Serverless + static -> git push redeploys. No cap sync / rebuild / ?v bump.
 *
 * SAFE / IDEMPOTENT: backups, UTF-8 no-BOM, endpoint skipped if it exists,
 * HTML skipped if already patched (TMC_PATCH08_LEDGER), HTML anchor must match
 * exactly once, node --check on the new endpoint with restore-on-failure.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ENDPOINT = path.join('api', 'admin-refund-log.js');
const HTML = path.join('public', 'cmshaveaccesstouser2026-npmevy.html');
const ROOT_HTML = 'cmshaveaccesstouser2026-npmevy.html';
const HTML_MARKER = 'TMC_PATCH08_LEDGER';

const ENDPOINT_CONTENT = `// TMC_PATCH08_LEDGER: admin endpoint - full refund ledger from refund_log.
// refund_log captures every refund (Cancel button, account deletion, and
// manual Stripe refunds) and survives account deletion.

const { createClient } = require('@supabase/supabase-js');
const { resolveAdmin } = require('./_admin-auth');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  const admin = await resolveAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorized' });

  const q = req.query || {};
  const limit = Math.min(parseInt(q.limit || '200', 10) || 200, 500);

  const { data, error } = await supabase
    .from('refund_log')
    .select('id, created_at, source, status, amount_cents, currency, user_id, user_email, user_name, plan, stripe_refund_id, stripe_charge_id, stripe_customer_id, subscription_id')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, refunds: data || [] });
};
`;

const HTML_BLOCK = `
          <!-- TMC_PATCH08_LEDGER: complete refund ledger (all sources) -->
          <div class="section-title" style="margin-top:24px">Complete ledger — all refunds</div>
          <span class="section-link" onclick="loadRefundLedger()" style="cursor:pointer">Refresh</span>
          <div style="font-size:12px;color:#6B7280;margin:6px 0 14px;line-height:1.5">Every refund recorded from Stripe — Cancel button, account deletion, and manual Stripe refunds. Includes deleted accounts.</div>
          <div id="refunds-ledger-wrap"></div>
          <script>
          /* TMC_PATCH08_LEDGER */
          (function(){
            if (window.__tmcLedgerInit) return; window.__tmcLedgerInit = true;
            async function loadRefundLedger(){
              var wrap = document.getElementById('refunds-ledger-wrap');
              if(!wrap) return;
              wrap.innerHTML = '<div style="padding:16px;font-size:13px;color:#6B7280;text-align:center">Loading ledger...</div>';
              try{
                var res = await fetch('/api/admin-refund-log?limit=200', { credentials:'include' });
                var data = await res.json();
                var rows = (data && data.refunds) || [];
                if(!rows.length){ wrap.innerHTML = '<div style="background:#fff;border:1px solid #E5E7EB;border-radius:14px;padding:18px;font-size:13px;color:#6B7280;text-align:center">No refunds recorded yet.</div>'; return; }
                var html = '';
                for(var i=0;i<rows.length;i++){
                  var r = rows[i];
                  var amt = '$' + (((r.amount_cents||0))/100).toFixed(2);
                  var when = r.created_at ? new Date(r.created_at).toLocaleString() : '';
                  var who = (r.user_email || r.user_name || (r.user_id ? ('user ' + String(r.user_id).slice(0,8)) : 'deleted user'));
                  var srcLabel = r.source==='auto_cancel' ? 'Cancel button' : r.source==='auto_delete' ? 'Account deletion' : r.source==='manual_stripe' ? 'Manual (Stripe)' : (r.source||'other');
                  var ok = (r.status==='succeeded');
                  var badge = '<span style="font-size:10px;font-weight:800;padding:2px 8px;border-radius:10px;background:'+(ok?'#DCFCE7':'#FEE2E2')+';color:'+(ok?'#065F46':'#991B1B')+'">'+(r.status||'?')+'</span>';
                  html += '<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:12px 14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:10px">'
                    + '<div style="min-width:0"><div style="font-size:13px;font-weight:700;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+who+'</div>'
                    + '<div style="font-size:11px;color:#6B7280">'+srcLabel+' &middot; '+when+(r.stripe_refund_id?(' &middot; '+r.stripe_refund_id):'')+'</div></div>'
                    + '<div style="text-align:right;white-space:nowrap"><div style="font-size:14px;font-weight:800;color:'+(ok?'#065F46':'#991B1B')+'">-'+amt+'</div>'+badge+'</div>'
                    + '</div>';
                }
                wrap.innerHTML = html;
              }catch(e){ wrap.innerHTML = '<div style="padding:16px;font-size:13px;color:#DC2626;text-align:center">Could not load ledger.</div>'; }
            }
            window.loadRefundLedger = loadRefundLedger;
            document.addEventListener('click', function(e){
              var btn = e.target.closest && e.target.closest('[data-tab="refunds"]');
              if(btn) setTimeout(loadRefundLedger, 40);
            });
            setTimeout(loadRefundLedger, 1400);
          })();
          </script>`;

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

console.log('claude-patch-08-refund-ledger-admin.js');
console.log('--------------------------------------');
let failed = false;

// ---- Part 1: create the endpoint (skip if present) ----
if (fs.existsSync(ENDPOINT)) {
  console.log(ENDPOINT + ': already exists (skip).');
} else {
  try {
    fs.writeFileSync(ENDPOINT, Buffer.from(ENDPOINT_CONTENT, 'utf8'));
    try { execFileSync(process.execPath, ['--check', ENDPOINT], { stdio: 'pipe' }); }
    catch (e) { fs.unlinkSync(ENDPOINT); console.log(ENDPOINT + ': FAILED node --check -> removed.'); console.log('   ' + String(e.message || e)); process.exit(1); }
    console.log(ENDPOINT + ': created.');
  } catch (e) { console.log(ENDPOINT + ': FAILED to create (' + String(e.message || e) + ').'); process.exit(1); }
}

// ---- Part 2: edit the admin HTML ----
if (!fs.existsSync(HTML)) { console.log('ABORT - ' + HTML + ' not found.'); process.exit(1); }
const html = fs.readFileSync(HTML, 'utf8');
if (html.indexOf(HTML_MARKER) !== -1) {
  console.log(HTML + ': ledger section already present (skip).');
} else {
  const A = /<div id="refunds-success-wrap"><\/div>/;
  const cnt = (html.match(new RegExp(A, 'g')) || []).length;
  if (cnt !== 1) { console.log('ABORT - refunds-success-wrap anchor matched ' + cnt + ' (expected 1). HTML unchanged.'); process.exit(1); }

  const b = HTML + '.bak-' + stamp();
  fs.copyFileSync(HTML, b);
  try {
    const updated = html.replace(A, function (m) { return m + HTML_BLOCK; });
    if (updated.indexOf(HTML_MARKER) === -1) throw new Error('post-edit marker missing');
    fs.writeFileSync(HTML, Buffer.from(updated, 'utf8'));
    let extra = '';
    if (fs.existsSync(ROOT_HTML)) { const rb = ROOT_HTML + '.bak-' + stamp(); fs.copyFileSync(ROOT_HTML, rb); fs.copyFileSync(HTML, ROOT_HTML); extra = ' -> mirrored to root'; }
    console.log(HTML + ': ledger section added.' + extra + '  (backup: ' + path.basename(b) + ')');
  } catch (e) {
    fs.copyFileSync(b, HTML);
    console.log(HTML + ': FAILED -> restored (' + String(e.message || e) + ').');
    failed = true;
  }
}

console.log('--------------------------------------');
console.log(failed ? 'Done WITH ERRORS.' : 'Done. git add/commit/push -> Vercel redeploys.');
process.exit(failed ? 1 : 0);
