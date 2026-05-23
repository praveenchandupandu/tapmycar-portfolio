// ============================================================================
// TapMyCar - Patch 48 (Notification System, STAGE 4c-b): Tag picker + detail UI
//
// PREREQUISITE
//   Patch 47 deployed (api/send-broadcast.js supports mode:"tag" and
//   action:"detail").
//
// WHAT THIS PATCH DOES (edits public/admin.html, then syncs to root)
//   1. Adds a 4th recipient mode button "By tag" next to All / By plan /
//      Specific.
//   2. Adds a "By tag" filter row: tag type (any/physical/etag), status
//      (any/active/paused/inactive/voided), batch number, specific token -
//      all optional, combined as an AND filter.
//   3. Swaps the Broadcast tab script (located by marker) so it:
//        - handles the "tag" mode in bcRecipients(),
//        - shows the new tag filter row,
//        - makes each history row CLICKABLE -> expands to show the actual
//          recipient list (name, contact, channel, sent/failed) via the
//          action:"detail" endpoint,
//        - preview wording uses the new "base" field for clearer messaging.
//   4. Syncs public/admin.html -> root.
//
//   No backend or SQL change.
//
// Properties: idempotent (safe to re-run), backs up admin.html before editing.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch48-${ts}`);

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
function replaceOnce(src, find, replace, label) {
  const idx = src.indexOf(find);
  if (idx === -1) errExit(label + ': anchor not found - admin.html differs from expected.');
  if (src.indexOf(find, idx + find.length) !== -1) {
    errExit(label + ': anchor matches more than once.');
  }
  return src.replace(find, function () { return replace; });
}

log('');
log('TapMyCar Patch 48 (Stage 4c-b) - Tag picker + recipient detail UI');
log('=================================================================');

const adminPath = path.join(PUBLIC, 'admin.html');
if (!fs.existsSync(adminPath)) errExit('public/admin.html not found');
let html = fs.readFileSync(adminPath, 'utf8');

if (html.indexOf('TMC_PATCH48_TAGUI') !== -1) {
  skip('public/admin.html (tag picker + detail)');
} else {
  if (html.indexOf('TMC_PATCH46_CHANNELS') === -1) {
    errExit('Patch 46 not found - apply Patches 44-47 first.');
  }
  backup(adminPath, 'public/admin.html');

  // --------------------------------------------------------------------------
  // EDIT 1 - add the "By tag" mode button
  // --------------------------------------------------------------------------
  const MODE_ANCHOR =
    '                <button type="button" class="bc-mode" data-mode="specific"\r\n' +
    '                  onclick="bcSetMode(\'specific\')">Specific</button>\r\n';
  const MODE_NEW = MODE_ANCHOR +
    '                <button type="button" class="bc-mode" data-mode="tag"\r\n' +
    '                  onclick="bcSetMode(\'tag\')">By tag</button><!-- TMC_PATCH48_TAGUI -->\r\n';
  html = replaceOnce(html, MODE_ANCHOR, MODE_NEW, 'Edit 1 mode button');
  ok('Edit 1 - "By tag" mode button added');

  // --------------------------------------------------------------------------
  // EDIT 2 - add the tag filter row after the specific-row block
  // --------------------------------------------------------------------------
  const SPECIFIC_ROW_END =
    '            <div class="bc-row" id="bc-specific-row" style="display:none">\r\n' +
    '              <p class="bc-label">User emails or IDs (comma or newline separated)</p>\r\n' +
    '              <textarea class="bc-textarea" id="bc-ids" style="min-height:70px"\r\n' +
    '                placeholder="someone@example.com, another@example.com"\r\n' +
    '                oninput="bcResetCount()"></textarea>\r\n' +
    '            </div>\r\n';

  const TAG_ROW = SPECIFIC_ROW_END + [
    '',
    '            <div class="bc-row" id="bc-tag-row" style="display:none">',
    '              <p class="bc-label">Tag filters (all optional, combined)</p>',
    '              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">',
    '                <select class="bc-select" id="bc-tag-type" style="flex:1;min-width:140px"',
    '                  onchange="bcResetCount()">',
    '                  <option value="">Any tag type</option>',
    '                  <option value="physical">Physical</option>',
    '                  <option value="etag">eTag</option>',
    '                </select>',
    '                <select class="bc-select" id="bc-tag-status" style="flex:1;min-width:140px"',
    '                  onchange="bcResetCount()">',
    '                  <option value="">Any status</option>',
    '                  <option value="active">Active</option>',
    '                  <option value="paused">Paused</option>',
    '                  <option value="inactive">Inactive</option>',
    '                  <option value="voided">Voided</option>',
    '                </select>',
    '              </div>',
    '              <div style="display:flex;gap:8px;flex-wrap:wrap">',
    '                <input class="bc-input" id="bc-tag-batch" style="flex:1;min-width:140px"',
    '                  placeholder="Batch number (optional)" oninput="bcResetCount()">',
    '                <input class="bc-input" id="bc-tag-token" style="flex:1;min-width:140px"',
    '                  placeholder="Specific tag token (optional)" oninput="bcResetCount()">',
    '              </div>',
    '              <div class="bc-note" style="margin-top:8px">',
    '                Targets the <b>owners</b> of tags matching these filters. A user who',
    '                owns several matching tags is counted once.',
    '              </div>',
    '            </div>',
    ''
  ].join('\r\n');

  html = replaceOnce(html, SPECIFIC_ROW_END, TAG_ROW, 'Edit 2 tag filter row');
  ok('Edit 2 - tag filter row added');

  // --------------------------------------------------------------------------
  // EDIT 3 - add styles for expandable history rows
  // --------------------------------------------------------------------------
  const STYLE_ANCHOR = '          .bc-result.err{background:#FEE2E2;color:#991B1B}\r\n';
  const STYLE_NEW = STYLE_ANCHOR + [
    '          .bc-hist-row{cursor:pointer}',
    '          .bc-hist-row:hover{background:#FAFAFA}',
    '          .bc-hist-detail{margin-top:10px;border-top:1px solid #E5E7EB;padding-top:8px}',
    '          .bc-rcp{display:flex;justify-content:space-between;gap:10px;',
    '            font-size:12px;padding:4px 0;border-bottom:1px solid #F3F4F6}',
    '          .bc-rcp .who{color:#374151}',
    '          .bc-rcp .st{font-weight:700}',
    '          .bc-rcp .st.sent{color:#16A34A}',
    '          .bc-rcp .st.failed{color:#DC2626}',
    '          .bc-caret{color:#9CA3AF;font-size:11px}',
    ''
  ].join('\r\n');
  html = replaceOnce(html, STYLE_ANCHOR, STYLE_NEW, 'Edit 3 detail styles');
  ok('Edit 3 - expandable history styles added');

  // --------------------------------------------------------------------------
  // EDIT 4 - swap the Broadcast tab script (located by marker)
  // --------------------------------------------------------------------------
  const SCRIPT_START = '<script>\r\n// TMC_PATCH44_BROADCAST - admin broadcast tab logic';
  const s1 = html.indexOf(SCRIPT_START);
  if (s1 === -1) errExit('Edit 4: broadcast script block not found.');
  const s2 = html.indexOf('</script>', s1);
  if (s2 === -1) errExit('Edit 4: end of broadcast script block not found.');

  const NEW_SCRIPT = [
    '<script>',
    '// TMC_PATCH44_BROADCAST - admin broadcast tab logic',
    '// TMC_PATCH46_CHANNELS - multi-channel (email / push / sms)',
    '// TMC_PATCH48_TAGUI - by-tag targeting + expandable recipient detail',
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
    '    var tagRow = document.getElementById("bc-tag-row");',
    '    if (tagRow) tagRow.style.display = (m === "tag") ? "" : "none";',
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
    '    if (bcMode === "tag") {',
    '      var r = { mode: "tag" };',
    '      var t = document.getElementById("bc-tag-type").value;',
    '      var s = document.getElementById("bc-tag-status").value;',
    '      var b = (document.getElementById("bc-tag-batch").value || "").trim();',
    '      var k = (document.getElementById("bc-tag-token").value || "").trim();',
    '      if (t) r.tag_type = t;',
    '      if (s) r.status = s;',
    '      if (b) r.batch_number = b;',
    '      if (k) r.token = k;',
    '      return r;',
    '    }',
    '    return { mode: "all" };',
    '  }',
    '',
    '  function bcChannels(){',
    '    var out = [];',
    '    if (document.getElementById("bc-ch-email").checked) out.push("email");',
    '    if (document.getElementById("bc-ch-push").checked)  out.push("push");',
    '    if (document.getElementById("bc-ch-sms").checked)   out.push("sms");',
    '    return out;',
    '  }',
    '  var CH_LABEL = { email: "Email", push: "Web push", sms: "SMS" };',
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
    '    var channels = bcChannels();',
    '    var out = document.getElementById("bc-count");',
    '    if (!channels.length) { out.textContent = "Select at least one channel."; return; }',
    '    var btn = document.getElementById("bc-preview-btn");',
    '    btn.disabled = true; out.innerHTML = "Checking\u2026";',
    '    bcApi({ channels: channels, dry_run: true, recipients: bcRecipients() })',
    '      .then(function(d){',
    '        btn.disabled = false;',
    '        if (d && d.success) {',
    '          var parts = channels.map(function(c){',
    '            var n = (d.counts && d.counts[c]) || 0;',
    '            return CH_LABEL[c] + ": <span class=\\"n\\">" + n + "</span>";',
    '          });',
    '          var head = (typeof d.base === "number")',
    '            ? (d.base + " user" + (d.base === 1 ? "" : "s") + " matched \u2014 ")',
    '            : "Will send \u2014 ";',
    '          out.innerHTML = head + parts.join(" &nbsp;\u00b7&nbsp; ");',
    '        } else {',
    '          out.textContent = (d && d.error) ? d.error : "Could not get count";',
    '        }',
    '      })',
    '      .catch(function(){ btn.disabled = false; out.textContent = "Network error"; });',
    '  };',
    '',
    '  window.bcSend = function(){',
    '    var channels = bcChannels();',
    '    var subject = (document.getElementById("bc-subject").value || "").trim();',
    '    var body = (document.getElementById("bc-body").value || "").trim();',
    '    var res = document.getElementById("bc-result");',
    '    res.innerHTML = "";',
    '    if (!channels.length) { res.innerHTML = bcMsg("err","Select at least one channel."); return; }',
    '    if (!subject) { res.innerHTML = bcMsg("err","Enter a subject."); return; }',
    '    if (!body) { res.innerHTML = bcMsg("err","Enter a message."); return; }',
    '',
    '    var rcp = bcRecipients();',
    '    if (rcp.mode === "specific" && (!rcp.ids || !rcp.ids.length)) {',
    '      res.innerHTML = bcMsg("err","Add at least one recipient email or ID."); return;',
    '    }',
    '',
    '    var who = rcp.mode === "all" ? "ALL users"',
    '      : rcp.mode === "plan" ? ("users on the " + rcp.plan + " plan")',
    '      : rcp.mode === "tag" ? "owners of the matching tags"',
    '      : (rcp.ids.length + " specific user(s)");',
    '    var chNames = channels.map(function(c){ return CH_LABEL[c]; }).join(", ");',
    '    if (!confirm("Send via " + chNames + " to " + who + "?\\n\\nThis cannot be undone.")) return;',
    '',
    '    var btn = document.getElementById("bc-send-btn");',
    '    btn.disabled = true; btn.textContent = "Sending\u2026";',
    '    bcApi({ channels: channels, subject: subject, body: body, recipients: rcp })',
    '      .then(function(d){',
    '        btn.disabled = false; btn.textContent = "Send broadcast";',
    '        if (d && d.success) {',
    '          var lines = Object.keys(d.results || {}).map(function(c){',
    '            var r = d.results[c];',
    '            return CH_LABEL[c] + ": " + r.sent + " sent" +',
    '              (r.failed ? (", " + r.failed + " failed") : "");',
    '          });',
    '          res.innerHTML = bcMsg("ok","Broadcast sent. " + lines.join(" \u00b7 "));',
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
    '  // Toggle the expandable recipient detail under a history row.',
    '  window.bcToggleDetail = function(bid, el){',
    '    var box = el.querySelector(".bc-hist-detail");',
    '    var caret = el.querySelector(".bc-caret");',
    '    if (box) {',
    '      box.parentNode.removeChild(box);',
    '      if (caret) caret.textContent = "\u25b8 show recipients";',
    '      return;',
    '    }',
    '    box = document.createElement("div");',
    '    box.className = "bc-hist-detail";',
    '    box.innerHTML = "Loading recipients\u2026";',
    '    el.appendChild(box);',
    '    if (caret) caret.textContent = "\u25be hide recipients";',
    '    bcApi({ action: "detail", broadcast_id: bid })',
    '      .then(function(d){',
    '        if (!d || !d.success) { box.innerHTML = "Could not load recipients."; return; }',
    '        var list = d.recipients || [];',
    '        if (!list.length) { box.innerHTML = "No recipient records."; return; }',
    '        box.innerHTML = list.map(function(r){',
    '          var who = (r.name ? bcEsc(r.name) + " \u00b7 " : "") + bcEsc(r.contact || "");',
    '          var st = r.status === "failed" ? "failed" : "sent";',
    '          return \'<div class="bc-rcp"><span class="who">\' + who +',
    '            \' <span style="color:#9CA3AF">(\' + bcEsc(r.channel) + \')</span></span>\' +',
    '            \'<span class="st \' + st + \'">\' + st + \'</span></div>\';',
    '        }).join("");',
    '      })',
    '      .catch(function(){ box.innerHTML = "Network error loading recipients."; });',
    '  };',
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
    '        box.innerHTML = "";',
    '        list.forEach(function(b){',
    '          var when = b.created_at ? new Date(b.created_at).toLocaleString() : "";',
    '          var chans = (b.channels && b.channels.length)',
    '            ? b.channels.map(function(c){ return CH_LABEL[c] || c; }).join(", ")',
    '            : "email";',
    '          var row = document.createElement("div");',
    '          row.className = "bc-hist-row";',
    '          row.innerHTML =',
    '            \'<div class="s">\' + bcEsc(b.subject || "(no subject)") + \'</div>\' +',
    '            \'<div class="m">\' + bcEsc(chans) + \' \\u00b7 sent \' + (b.sent||0) +',
    '            (b.failed ? (\' \\u00b7 \' + b.failed + \' failed\') : \'\') +',
    '            \' \\u00b7 \' + when +',
    '            \' &nbsp; <span class="bc-caret">\\u25b8 show recipients</span></div>\';',
    '          row.onclick = function(){ bcToggleDetail(b.broadcast_id, row); };',
    '          box.appendChild(row);',
    '        });',
    '      })',
    '      .catch(function(){ box.innerHTML = \'<div class="empty">Network error.</div>\'; });',
    '  };',
    '',
    '  var prevNavTo = window.navTo;',
    '  window.navTo = function(id){',
    '    var r = (typeof prevNavTo === "function") ? prevNavTo.apply(this, arguments) : undefined;',
    '    if (id === "broadcast") { try { bcLoadHistory(); } catch(e){} }',
    '    return r;',
    '  };',
    '})();',
    '</script>'
  ].join('\r\n');

  html = html.slice(0, s1) + NEW_SCRIPT + html.slice(s2 + '</script>'.length);
  ok('Edit 4 - broadcast tab script swapped (tag mode + detail)');

  fs.writeFileSync(adminPath, html, { encoding: 'utf8' });
  ok('public/admin.html written');
}

log('');
log('Sync to root');
const adminRoot = path.join(ROOT, 'admin.html');
backup(adminRoot, 'root-admin.html');
fs.copyFileSync(adminPath, adminRoot);
ok('Synced admin.html -> root');

log('');
log('=================================================================');
log('Patch 48 (Stage 4c-b) applied.');
if (fs.existsSync(BACKUP_DIR)) log('Backups: ' + path.basename(BACKUP_DIR));
log('');
log('  Commit + push, wait ~60s, hard-refresh /admin.html, open Broadcast.');
log('  TEST:');
log('   1. Recipients row now has a 4th button: "By tag".');
log('   2. Click "By tag" -> a filter row appears (tag type, status, batch,');
log('      token). Pick tag type = Physical, click Preview ->');
log('      "<N> users matched - Email: <N>".');
log('   3. Leave all tag filters blank + Preview -> owners of ALL tags.');
log('   4. In Send history, CLICK a past broadcast row -> it expands to');
log('      show each recipient (name, contact, channel, sent/failed).');
log('      Click again -> collapses.');
log('');
log('  That completes Stage 4. Next: Stage 5 - automatic scan notifications.');
log('');
