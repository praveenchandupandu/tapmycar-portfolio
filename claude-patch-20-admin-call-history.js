#!/usr/bin/env node
/* ============================================================================
 * claude-patch-20-admin-call-history.js
 * ----------------------------------------------------------------------------
 * Surfaces the call_logs table in the admin dashboard as a "Call history" view,
 * so you can look up who called through any tag (caller number, tag, owner,
 * time, duration, status) — e.g. for a lawful police request.
 *
 * Two parts (same pattern as the refund ledger, patch 08):
 *   1) NEW api/admin-call-log.js  -> admin-only endpoint returning call_logs rows
 *      (optionally filtered by ?token=TMC-XXXX to pull all calls for one tag).
 *   2) EDIT the admin dashboard: add a "Call history" panel + nav tab.
 *
 * SCOPE: backend + admin page. git push deploys. Does NOT touch the in-review
 * Android bundle (api/ is server-side; admin is used in-browser).
 *
 * SAFE / IDEMPOTENT: backups, UTF-8 no-BOM, endpoint skipped if it exists,
 * HTML skipped if already patched, anchors must match once, node --check on the
 * new endpoint with restore-on-failure.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ENDPOINT = path.join('api', 'admin-call-log.js');
const HTML = path.join('public', 'cmshaveaccesstouser2026-npmevy.html');
const ROOT = 'cmshaveaccesstouser2026-npmevy.html';
const MARKER = 'TMC_CALL_HISTORY';

const ENDPOINT_CONTENT = `// TMC_CALL_HISTORY: admin endpoint - call_logs (who called through each tag).
// Every masked call logs both real numbers here (see inbound-call.js). This
// read-only endpoint powers the admin "Call history" view. Release a caller's
// number only via a lawful request.

const { createClient } = require('@supabase/supabase-js');
const { resolveAdmin } = require('./_admin-auth');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  const admin = await resolveAdmin(req);
  if (!admin) return res.status(401).json({ error: 'Unauthorized' });

  const q = req.query || {};
  const limit = Math.min(parseInt(q.limit || '200', 10) || 200, 500);

  let query = supabase
    .from('call_logs')
    .select('id, created_at, bridged_at, ended_at, duration_seconds, status, tag_token, stranger_phone, owner_phone, owner_user_id, twilio_call_sid')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (q.token) {
    query = query.eq('tag_token', String(q.token).toUpperCase().trim());
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, calls: data || [] });
};
`;

const NAV_ANCHOR = '<span class="section-link" onclick="loadRefundLedger()" style="cursor:pointer">Refresh</span>';

const PANEL_ANCHOR = '<div id="refunds-ledger-wrap"></div>';

const PANEL_BLOCK = `
          <!-- TMC_CALL_HISTORY: who called through each tag -->
          <div class="section-title" style="margin-top:28px">Call history</div>
          <span class="section-link" onclick="loadCallHistory()" style="cursor:pointer">Refresh</span>
          <div style="font-size:12px;color:#6B7280;margin:6px 0 10px;line-height:1.5">Every masked call, newest first — caller number, tag, owner, time, duration. Search a tag to pull all its calls (e.g. for a police request). Share numbers only via a lawful request.</div>
          <input id="callhist-token" type="text" placeholder="Filter by tag token e.g. TMC-XXXXXX (blank = all)" style="width:100%;max-width:360px;padding:9px 12px;border:1px solid #E5E7EB;border-radius:10px;font-size:13px;margin-bottom:12px" oninput="this.value=this.value.toUpperCase()" onkeydown="if(event.key==='Enter')loadCallHistory()">
          <div id="callhist-wrap"></div>
          <script>
          /* TMC_CALL_HISTORY */
          (function(){
            if (window.__tmcCallHistInit) return; window.__tmcCallHistInit = true;
            function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
            async function loadCallHistory(){
              var wrap = document.getElementById('callhist-wrap');
              if(!wrap) return;
              var tok = (document.getElementById('callhist-token')||{}).value || '';
              wrap.innerHTML = '<div style="padding:16px;font-size:13px;color:#6B7280;text-align:center">Loading calls...</div>';
              try{
                var url = '/api/admin-call-log?limit=200' + (tok.trim() ? '&token=' + encodeURIComponent(tok.trim()) : '');
                var res = await fetch(url, { credentials:'include' });
                var data = await res.json();
                var rows = (data && data.calls) || [];
                if(!rows.length){ wrap.innerHTML = '<div style="background:#fff;border:1px solid #E5E7EB;border-radius:14px;padding:18px;font-size:13px;color:#6B7280;text-align:center">No calls found.</div>'; return; }
                var html = '';
                for(var i=0;i<rows.length;i++){
                  var r = rows[i];
                  var when = r.created_at ? new Date(r.created_at).toLocaleString() : '';
                  var dur = (r.duration_seconds!=null) ? (r.duration_seconds + 's') : '—';
                  var st = r.status || '?';
                  var ok = (st==='completed' || st==='bridged');
                  var badge = '<span style="font-size:10px;font-weight:800;padding:2px 8px;border-radius:10px;background:'+(ok?'#DCFCE7':'#F3F4F6')+';color:'+(ok?'#065F46':'#374151')+'">'+esc(st)+'</span>';
                  html += '<div style="background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:12px 14px;margin-bottom:8px">'
                    + '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px">'
                    + '<div style="font-size:14px;font-weight:800;color:#111">'+esc(r.stranger_phone||'unknown caller')+'</div>'
                    + '<div style="text-align:right">'+badge+'<div style="font-size:11px;color:#6B7280;margin-top:2px">'+esc(dur)+'</div></div>'
                    + '</div>'
                    + '<div style="font-size:11px;color:#6B7280;margin-top:6px">Tag <b>'+esc(r.tag_token||'')+'</b> &middot; owner '+esc(r.owner_phone||'')+' &middot; '+esc(when)+'</div>'
                    + '</div>';
                }
                wrap.innerHTML = html;
              }catch(e){ wrap.innerHTML = '<div style="padding:16px;font-size:13px;color:#DC2626;text-align:center">Could not load call history.</div>'; }
            }
            window.loadCallHistory = loadCallHistory;
            document.addEventListener('click', function(e){
              var btn = e.target.closest && e.target.closest('[data-tab="refunds"]');
              if(btn) setTimeout(loadCallHistory, 60);
            });
            setTimeout(loadCallHistory, 1500);
          })();
          </script>`;

function stamp() {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

console.log('claude-patch-20-admin-call-history.js');
console.log('-------------------------------------');
let failed = false;

// Part 1: endpoint
if (fs.existsSync(ENDPOINT)) {
  console.log(ENDPOINT + ': already exists (skip).');
} else {
  try {
    fs.writeFileSync(ENDPOINT, Buffer.from(ENDPOINT_CONTENT, 'utf8'));
    try { execFileSync(process.execPath, ['--check', ENDPOINT], { stdio: 'pipe' }); }
    catch (e) { fs.unlinkSync(ENDPOINT); console.log(ENDPOINT + ': FAILED node --check -> removed.'); console.log('   ' + String(e.message||e)); process.exit(1); }
    console.log(ENDPOINT + ': created.');
  } catch (e) { console.log(ENDPOINT + ': FAILED to create (' + String(e.message||e) + ').'); process.exit(1); }
}

// Part 2: admin HTML — insert the Call history block right after the refund ledger wrap
if (!fs.existsSync(HTML)) { console.log('ABORT - ' + HTML + ' not found.'); process.exit(1); }
const html = fs.readFileSync(HTML, 'utf8');
if (html.indexOf(MARKER) !== -1) {
  console.log(HTML + ': Call history already present (skip).');
} else {
  const cnt = html.split(PANEL_ANCHOR).length - 1;
  if (cnt !== 1) { console.log('ABORT - refunds-ledger-wrap anchor matched ' + cnt + ' (expected 1). Is patch 08 applied? No change.'); process.exit(1); }
  const b = HTML + '.bak-' + stamp();
  fs.copyFileSync(HTML, b);
  try {
    const updated = html.replace(PANEL_ANCHOR, PANEL_ANCHOR + PANEL_BLOCK);
    if (updated.indexOf(MARKER) === -1) throw new Error('post-edit marker missing');
    fs.writeFileSync(HTML, Buffer.from(updated, 'utf8'));
    let extra = '';
    if (fs.existsSync(ROOT)) { const rb = ROOT + '.bak-' + stamp(); fs.copyFileSync(ROOT, rb); fs.copyFileSync(HTML, ROOT); extra = ' -> mirrored to root'; }
    console.log(HTML + ': Call history panel added.' + extra + '  (backup: ' + path.basename(b) + ')');
  } catch (e) {
    fs.copyFileSync(b, HTML);
    console.log(HTML + ': FAILED -> restored (' + String(e.message||e) + ').');
    failed = true;
  }
}

console.log('-------------------------------------');
console.log(failed ? 'Done WITH ERRORS.' : 'Done. git add/commit/push -> Vercel redeploys. (No cap sync / rebuild.)');
process.exit(failed ? 1 : 0);
