// ============================================================================
// TapMyCar - Patch 44 (Notification System, STAGE 3b): Admin Broadcast tab
//
// PREREQUISITE
//   Patch 43 deployed (api/send-broadcast.js live and tested).
//
// WHAT THIS PATCH DOES (all edits to public/admin.html, then sync to root)
//   1. Adds a "Broadcast" item to the admin sidebar (after "Audit").
//   2. Registers TAB_TITLES / TAB_SUBS entries so the page header reads
//      "Broadcast" instead of the raw id.
//   3. Adds a new <div class="panel" id="panel-broadcast"> with:
//        - channel notice (email only for now; push/SMS noted as Stage 4)
//        - recipient picker: All users / By plan / Specific (ids or emails)
//        - subject + message fields
//        - a live "this will send to N users" preview (calls dry_run)
//        - a Send button with a confirm step
//        - a send-history list
//   4. Adds a <script> block with the tab's logic, including a navTo wrapper
//      so opening the tab loads history (same pattern as the Promos tab).
//   5. Syncs public/admin.html -> root admin.html.
//
//   The UI talks only to /api/send-broadcast (from Patch 43) and uses the
//   existing global "adminKey" variable for auth.
//
// Properties: idempotent (safe to re-run), backs up admin.html before editing.
//   NOTE: admin.html is HTML, so node --check does not apply; instead the
//   patch verifies each anchor matches exactly once before editing.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch44-${ts}`);

const log  = (s) => console.log(s);
const ok   = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function backup(absPath, label) {
  if (!fs.existsSync(absPath)) return;
  const dest = path.join(BACKUP_DIR, label);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(absPath, dest);
}
// Exactly-once replace. Function replacer keeps $ literal.
function replaceOnce(src, find, replace, label) {
  const idx = src.indexOf(find);
  if (idx === -1) errExit(label + ': anchor not found - admin.html differs from expected.');
  if (src.indexOf(find, idx + find.length) !== -1) {
    errExit(label + ': anchor matches more than once - cannot safely patch.');
  }
  return src.replace(find, function () { return replace; });
}

log('');
log('TapMyCar Patch 44 (Stage 3b) - Admin Broadcast tab');
log('==================================================');

const adminPath = path.join(PUBLIC, 'admin.html');
if (!fs.existsSync(adminPath)) errExit('public/admin.html not found');
let html = fs.readFileSync(adminPath, 'utf8');

if (html.indexOf('TMC_PATCH44_BROADCAST') !== -1) {
  skip('public/admin.html (all 4 edits)');
} else {
  backup(adminPath, 'public/admin.html');

  // --------------------------------------------------------------------------
  // EDIT 1 - sidebar item after "Audit"
  // --------------------------------------------------------------------------
  const SIDEBAR_ANCHOR = '<span>Audit</span></button>';
  const SIDEBAR_NEW = SIDEBAR_ANCHOR +
    '\r\n    <button class="sb-item" data-tab="broadcast" onclick="navTo(\'broadcast\')">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M3 11l18-8-8 18-2-8-8-2z"/></svg>' +
    '<span>Broadcast</span></button><!-- TMC_PATCH44_BROADCAST -->';
  html = replaceOnce(html, SIDEBAR_ANCHOR, SIDEBAR_NEW, 'Edit 1 sidebar');
  ok('Edit 1 - sidebar "Broadcast" item added');

  // --------------------------------------------------------------------------
  // EDIT 2 - TAB_TITLES + TAB_SUBS entries
  // --------------------------------------------------------------------------
  html = replaceOnce(html,
    '"audit": "Audit"}',
    '"audit": "Audit", "broadcast": "Broadcast"}',
    'Edit 2a TAB_TITLES');
  html = replaceOnce(html,
    '"audit": "Admin actions and system health"}',
    '"audit": "Admin actions and system health", "broadcast": "Compose and send notifications to users"}',
    'Edit 2b TAB_SUBS');
  ok('Edit 2 - TAB_TITLES / TAB_SUBS entries registered');

  // --------------------------------------------------------------------------
  // EDIT 3 - the broadcast panel, inserted after panel-reviews closes
  // --------------------------------------------------------------------------
  const PANEL_ANCHOR =
    '        <div id="reviews-list"><div class="empty">Loading reviews...</div></div>\r\n' +
    '      </div>\r\n';

  const PANEL = [
    '',
    '      <!-- TMC_PATCH44_BROADCAST panel -->',
    '      <div class="panel" id="panel-broadcast">',
    '        <style>',
    '          .bc-wrap{max-width:680px}',
    '          .bc-card{background:#fff;border:1px solid #E5E7EB;border-radius:14px;',
    '            padding:20px;margin-bottom:18px}',
    '          .bc-label{font-size:12px;font-weight:700;color:#374151;',
    '            text-transform:uppercase;letter-spacing:.04em;margin:0 0 8px}',
    '          .bc-input,.bc-textarea,.bc-select{width:100%;border:1px solid #D1D5DB;',
    '            border-radius:9px;padding:10px 12px;font-size:14px;font-family:inherit;',
    '            box-sizing:border-box;color:#111}',
    '          .bc-textarea{min-height:120px;resize:vertical}',
    '          .bc-row{margin-bottom:16px}',
    '          .bc-modes{display:flex;gap:8px;flex-wrap:wrap}',
    '          .bc-mode{flex:1;min-width:120px;border:1px solid #D1D5DB;background:#F9FAFB;',
    '            border-radius:9px;padding:10px;font-size:13px;font-weight:600;cursor:pointer;',
    '            color:#374151;font-family:inherit}',
    '          .bc-mode.active{border-color:#FF6B00;background:#FFF4EC;color:#C2410C}',
    '          .bc-note{background:#EFF6FF;border:1px solid #BFDBFE;color:#1E40AF;',
    '            font-size:12px;border-radius:9px;padding:10px 12px;line-height:1.55}',
    '          .bc-count{font-size:14px;font-weight:700;color:#111;padding:8px 0}',
    '          .bc-count .n{color:#FF6B00}',
    '          .bc-btn{background:#FF6B00;color:#fff;border:none;border-radius:9px;',
    '            padding:11px 20px;font-size:14px;font-weight:700;cursor:pointer;',
    '            font-family:inherit}',
    '          .bc-btn:disabled{opacity:.5;cursor:not-allowed}',
    '          .bc-btn-ghost{background:#fff;color:#374151;border:1px solid #D1D5DB;',
    '            border-radius:9px;padding:11px 18px;font-size:13px;font-weight:600;',
    '            cursor:pointer;font-family:inherit}',
    '          .bc-hist-row{border:1px solid #E5E7EB;border-radius:10px;padding:12px 14px;',
    '            margin-bottom:8px;font-size:13px}',
    '          .bc-hist-row .s{font-weight:700;color:#111}',
    '          .bc-hist-row .m{color:#6B7280;font-size:12px;margin-top:3px}',
    '          .bc-result{font-size:13px;border-radius:9px;padding:10px 12px;margin-top:12px}',
    '          .bc-result.ok{background:#DCFCE7;color:#166534}',
    '          .bc-result.err{background:#FEE2E2;color:#991B1B}',
    '        </style>',
    '',
    '        <div class="bc-wrap">',
    '          <div class="bc-card">',
    '            <div class="bc-note" style="margin-bottom:16px">',
    '              <b>Email channel.</b> Push and SMS channels are coming in a later stage.',
    '              Announcement emails automatically skip users who have unsubscribed,',
    '              and every email includes a required unsubscribe link.',
    '            </div>',
    '',
    '            <div class="bc-row">',
    '              <p class="bc-label">Recipients</p>',
    '              <div class="bc-modes">',
    '                <button type="button" class="bc-mode active" data-mode="all"',
    '                  onclick="bcSetMode(\'all\')">All users</button>',
    '                <button type="button" class="bc-mode" data-mode="plan"',
    '                  onclick="bcSetMode(\'plan\')">By plan</button>',
    '                <button type="button" class="bc-mode" data-mode="specific"',
    '                  onclick="bcSetMode(\'specific\')">Specific</button>',
    '              </div>',
    '            </div>',
    '',
    '            <div class="bc-row" id="bc-plan-row" style="display:none">',
    '              <p class="bc-label">Plan</p>',
    '              <select class="bc-select" id="bc-plan" onchange="bcResetCount()">',
    '                <option value="etag">eTag</option>',
    '                <option value="standard">Standard</option>',
    '                <option value="premium">Premium</option>',
    '              </select>',
    '            </div>',
    '',
    '            <div class="bc-row" id="bc-specific-row" style="display:none">',
    '              <p class="bc-label">User emails or IDs (comma or newline separated)</p>',
    '              <textarea class="bc-textarea" id="bc-ids" style="min-height:70px"',
    '                placeholder="someone@example.com, another@example.com"',
    '                oninput="bcResetCount()"></textarea>',
    '            </div>',
    '',
    '            <div class="bc-row">',
    '              <button type="button" class="bc-btn-ghost" id="bc-preview-btn"',
    '                onclick="bcPreview()">Preview recipient count</button>',
    '              <div class="bc-count" id="bc-count"></div>',
    '            </div>',
    '          </div>',
    '',
    '          <div class="bc-card">',
    '            <div class="bc-row">',
    '              <p class="bc-label">Subject</p>',
    '              <input class="bc-input" id="bc-subject" maxlength="150"',
    '                placeholder="e.g. Important update about your TapMyCar account">',
    '            </div>',
    '            <div class="bc-row">',
    '              <p class="bc-label">Message</p>',
    '              <textarea class="bc-textarea" id="bc-body"',
    '                placeholder="Write your message. Plain text - line breaks are kept."></textarea>',
    '            </div>',
    '            <button type="button" class="bc-btn" id="bc-send-btn"',
    '              onclick="bcSend()">Send broadcast</button>',
    '            <div id="bc-result"></div>',
    '          </div>',
    '',
    '          <div class="bc-card">',
    '            <p class="bc-label">Send history</p>',
    '            <div id="bc-history"><div class="empty">Loading history\u2026</div></div>',
    '          </div>',
    '        </div>',
    '      </div>',
    ''
  ].join('\r\n');

  html = replaceOnce(html, PANEL_ANCHOR, PANEL_ANCHOR + PANEL, 'Edit 3 panel');
  ok('Edit 3 - broadcast panel inserted');

  // --------------------------------------------------------------------------
  // EDIT 4 - the tab's script, inserted before </body>
  // --------------------------------------------------------------------------
  const SCRIPT = [
    '',
    '<script>',
    '// TMC_PATCH44_BROADCAST - admin broadcast tab logic',
    '(function(){',
    '  var bcMode = "all";',
    '',
    '  window.bcSetMode = function(m){',
    '    bcMode = m;',
    '    document.querySelectorAll(".bc-mode").forEach(function(b){',
    '      b.classList.toggle("active", b.getAttribute("data-mode") === m);',
    '    });',
    '    document.getElementById("bc-plan-row").style.display = (m === "plan") ? "" : "none";',
    '    document.getElementById("bc-specific-row").style.display = (m === "specific") ? "" : "none";',
    '    bcResetCount();',
    '  };',
    '',
    '  window.bcResetCount = function(){',
    '    document.getElementById("bc-count").innerHTML = "";',
    '  };',
    '',
    '  function bcRecipients(){',
    '    if (bcMode === "plan") {',
    '      return { mode: "plan", plan: document.getElementById("bc-plan").value };',
    '    }',
    '    if (bcMode === "specific") {',
    '      var raw = document.getElementById("bc-ids").value || "";',
    '      var ids = raw.split(/[,\\n]/).map(function(s){return s.trim();})',
    '        .filter(function(s){return s.length;});',
    '      return { mode: "specific", ids: ids };',
    '    }',
    '    return { mode: "all" };',
    '  }',
    '',
    '  function bcApi(payload){',
    '    payload.admin_key = (typeof adminKey === "string" ? adminKey : "");',
    '    return fetch("/api/send-broadcast", {',
    '      method: "POST",',
    '      headers: { "Content-Type": "application/json" },',
    '      body: JSON.stringify(payload)',
    '    }).then(function(r){ return r.json(); });',
    '  }',
    '',
    '  window.bcPreview = function(){',
    '    var btn = document.getElementById("bc-preview-btn");',
    '    var out = document.getElementById("bc-count");',
    '    btn.disabled = true; out.innerHTML = "Checking\u2026";',
    '    bcApi({ channel: "email", dry_run: true, recipients: bcRecipients() })',
    '      .then(function(d){',
    '        btn.disabled = false;',
    '        if (d && d.success) {',
    '          var extra = d.excluded_opted_out',
    '            ? " (" + d.excluded_opted_out + " unsubscribed, skipped)" : "";',
    '          out.innerHTML = "This will send to <span class=\\"n\\">" + d.count +',
    '            "</span> user" + (d.count === 1 ? "" : "s") + extra;',
    '        } else {',
    '          out.textContent = (d && d.error) ? d.error : "Could not get count";',
    '        }',
    '      })',
    '      .catch(function(){ btn.disabled = false; out.textContent = "Network error"; });',
    '  };',
    '',
    '  window.bcSend = function(){',
    '    var subject = (document.getElementById("bc-subject").value || "").trim();',
    '    var body = (document.getElementById("bc-body").value || "").trim();',
    '    var res = document.getElementById("bc-result");',
    '    res.innerHTML = "";',
    '    if (!subject) { res.className=""; res.innerHTML = bcMsg("err","Enter a subject."); return; }',
    '    if (!body) { res.innerHTML = bcMsg("err","Enter a message."); return; }',
    '',
    '    var rcp = bcRecipients();',
    '    if (rcp.mode === "specific" && (!rcp.ids || !rcp.ids.length)) {',
    '      res.innerHTML = bcMsg("err","Add at least one recipient email or ID."); return;',
    '    }',
    '',
    '    var who = rcp.mode === "all" ? "ALL users"',
    '      : rcp.mode === "plan" ? ("users on the " + rcp.plan + " plan")',
    '      : (rcp.ids.length + " specific user(s)");',
    '    if (!confirm("Send this email broadcast to " + who + "?\\n\\nThis cannot be undone.")) return;',
    '',
    '    var btn = document.getElementById("bc-send-btn");',
    '    btn.disabled = true; btn.textContent = "Sending\u2026";',
    '    bcApi({ channel: "email", subject: subject, body: body, recipients: rcp })',
    '      .then(function(d){',
    '        btn.disabled = false; btn.textContent = "Send broadcast";',
    '        if (d && d.success) {',
    '          res.innerHTML = bcMsg("ok","Sent to " + d.sent + " user(s)." +',
    '            (d.failed ? (" " + d.failed + " failed.") : "") +',
    '            (d.excluded_opted_out ? (" " + d.excluded_opted_out + " unsubscribed user(s) skipped.") : ""));',
    '          document.getElementById("bc-subject").value = "";',
    '          document.getElementById("bc-body").value = "";',
    '          bcLoadHistory();',
    '        } else {',
    '          res.innerHTML = bcMsg("err",(d && d.error) ? d.error : "Send failed.");',
    '        }',
    '      })',
    '      .catch(function(){',
    '        btn.disabled = false; btn.textContent = "Send broadcast";',
    '        res.innerHTML = bcMsg("err","Network error - broadcast not sent.");',
    '      });',
    '  };',
    '',
    '  function bcMsg(kind, text){',
    '    return \'<div class="bc-result \' + kind + \'">\' + bcEsc(text) + \'</div>\';',
    '  }',
    '  function bcEsc(s){',
    '    return String(s == null ? "" : s).replace(/[<>&"]/g, function(c){',
    '      return ({"<":"&lt;",">":"&gt;","&":"&amp;","\\"":"&quot;"})[c];',
    '    });',
    '  }',
    '',
    '  window.bcLoadHistory = function(){',
    '    var box = document.getElementById("bc-history");',
    '    if (!box) return;',
    '    box.innerHTML = \'<div class="empty">Loading history\\u2026</div>\';',
    '    bcApi({ action: "history" })',
    '      .then(function(d){',
    '        if (!d || !d.success) { box.innerHTML = \'<div class="empty">Could not load history.</div>\'; return; }',
    '        var list = d.broadcasts || [];',
    '        if (!list.length) { box.innerHTML = \'<div class="empty">No broadcasts sent yet.</div>\'; return; }',
    '        box.innerHTML = list.map(function(b){',
    '          var when = b.created_at ? new Date(b.created_at).toLocaleString() : "";',
    '          return \'<div class="bc-hist-row">\' +',
    '            \'<div class="s">\' + bcEsc(b.subject || "(no subject)") + \'</div>\' +',
    '            \'<div class="m">\' + bcEsc(b.channel || "email") + \' \\u00b7 sent \' + (b.sent||0) +',
    '            (b.failed ? (\' \\u00b7 \' + b.failed + \' failed\') : \'\') +',
    '            \' \\u00b7 \' + when + \'</div></div>\';',
    '        }).join("");',
    '      })',
    '      .catch(function(){ box.innerHTML = \'<div class="empty">Network error.</div>\'; });',
    '  };',
    '',
    '  // Load history whenever the Broadcast tab is opened (same pattern as Promos).',
    '  var prevNavTo = window.navTo;',
    '  window.navTo = function(id){',
    '    var r = (typeof prevNavTo === "function") ? prevNavTo.apply(this, arguments) : undefined;',
    '    if (id === "broadcast") { try { bcLoadHistory(); } catch(e){} }',
    '    return r;',
    '  };',
    '})();',
    '</script>',
    ''
  ].join('\r\n');

  html = replaceOnce(html, '</body>', SCRIPT + '</body>', 'Edit 4 script');
  ok('Edit 4 - broadcast tab script inserted');

  fs.writeFileSync(adminPath, html, { encoding: 'utf8' });
  ok('public/admin.html written');
}

// ----------------------------------------------------------------------------
// Sync to root
// ----------------------------------------------------------------------------
log('');
log('Sync to root');
const adminRoot = path.join(ROOT, 'admin.html');
backup(adminRoot, 'root-admin.html');
fs.copyFileSync(adminPath, adminRoot);
ok('Synced admin.html -> root');

// ----------------------------------------------------------------------------
// DONE
// ----------------------------------------------------------------------------
log('');
log('==================================================');
log('Patch 44 (Stage 3b) applied.');
if (fs.existsSync(BACKUP_DIR)) log('Backups: ' + path.basename(BACKUP_DIR));
log('');
log('  Commit + push, wait ~60s, then on /admin.html:');
log('   1. Sign in. A new "Broadcast" item appears in the left sidebar.');
log('   2. Open it. Pick "Specific", enter your own email, click');
log('      "Preview recipient count" -> should say "will send to 1 user".');
log('   3. Type a subject + message, click "Send broadcast", confirm.');
log('      -> green "Sent to 1 user", email arrives, history list updates.');
log('   4. Try "All users" -> Preview -> confirms the full count with any');
log('      unsubscribed users shown as skipped.');
log('');
