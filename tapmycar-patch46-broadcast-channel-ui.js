// ============================================================================
// TapMyCar - Patch 46 (Notification System, STAGE 4b): Broadcast channel UI
//
// PREREQUISITE
//   Patches 44 (broadcast tab) and 45 (push+sms backend) deployed.
//
// WHAT THIS PATCH DOES (edits public/admin.html, then syncs to root)
//   1. Replaces the static "Email channel" note in the Broadcast tab with a
//      real CHANNEL PICKER: three checkboxes - Email, Web push, SMS - with a
//      short note about each channel's opt-in/opt-out rule.
//   2. Replaces the Broadcast tab's script block (the one Patch 44 added)
//      with an updated version that:
//        - reads the selected channels,
//        - preview shows a PER-CHANNEL recipient count,
//        - send transmits a "channels" array and reports per-channel results,
//        - blocks sending if no channel is selected.
//      The script is located and swapped by its marker comment, so this is
//      robust regardless of minor whitespace.
//   3. Syncs public/admin.html -> root.
//
//   No backend change (Patch 45 already supports all three channels).
//
// Properties: idempotent (safe to re-run), backs up admin.html before editing.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch46-${ts}`);

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
log('TapMyCar Patch 46 (Stage 4b) - Broadcast channel UI');
log('===================================================');

const adminPath = path.join(PUBLIC, 'admin.html');
if (!fs.existsSync(adminPath)) errExit('public/admin.html not found');
let html = fs.readFileSync(adminPath, 'utf8');

if (html.indexOf('TMC_PATCH46_CHANNELS') !== -1) {
  skip('public/admin.html (channel UI)');
} else {
  if (html.indexOf('TMC_PATCH44_BROADCAST') === -1) {
    errExit('Patch 44 broadcast tab not found - apply Patch 44 first.');
  }
  backup(adminPath, 'public/admin.html');

  // --------------------------------------------------------------------------
  // EDIT 1 - replace the static note with a channel picker
  // --------------------------------------------------------------------------
  const NOTE_ANCHOR =
    '            <div class="bc-note" style="margin-bottom:16px">\r\n' +
    '              <b>Email channel.</b> Push and SMS channels are coming in a later stage.\r\n' +
    '              Announcement emails automatically skip users who have unsubscribed,\r\n' +
    '              and every email includes a required unsubscribe link.\r\n' +
    '            </div>\r\n';

  const CHK = 'style="display:inline-flex;align-items:center;gap:6px;' +
    'margin-right:18px;font-size:14px;font-weight:600;color:#374151;cursor:pointer"';
  const CHANNEL_PICKER = [
    '            <!-- TMC_PATCH46_CHANNELS -->',
    '            <div class="bc-row">',
    '              <p class="bc-label">Channels</p>',
    '              <label ' + CHK + '>',
    '                <input type="checkbox" id="bc-ch-email" checked onchange="bcResetCount()"> Email</label>',
    '              <label ' + CHK + '>',
    '                <input type="checkbox" id="bc-ch-push" onchange="bcResetCount()"> Web push</label>',
    '              <label ' + CHK + '>',
    '                <input type="checkbox" id="bc-ch-sms" onchange="bcResetCount()"> SMS</label>',
    '              <div class="bc-note" style="margin-top:10px">',
    '                <b>Email</b> skips unsubscribed users and includes an unsubscribe link.',
    '                <b>Web push</b> reaches only users who enabled browser notifications.',
    '                <b>SMS</b> goes only to users who explicitly opted in (and costs money per message).',
    '              </div>',
    '            </div>',
    ''
  ].join('\r\n');

  html = replaceOnce(html, NOTE_ANCHOR, CHANNEL_PICKER, 'Edit 1 channel picker');
  ok('Edit 1 - channel picker replaces the static note');

  // --------------------------------------------------------------------------
  // EDIT 2 - swap the Broadcast tab script block (located by marker)
  // --------------------------------------------------------------------------
  const SCRIPT_START = '<script>\r\n// TMC_PATCH44_BROADCAST - admin broadcast tab logic';
  const s1 = html.indexOf(SCRIPT_START);
  if (s1 === -1) errExit('Edit 2: Patch 44 script block not found.');
  const s2 = html.indexOf('</script>', s1);
  if (s2 === -1) errExit('Edit 2: end of Patch 44 script block not found.');
  const oldScript = html.slice(s1, s2 + '</script>'.length);

  const NEW_SCRIPT = [
    '<script>',
    '// TMC_PATCH44_BROADCAST - admin broadcast tab logic',
    '// TMC_PATCH46_CHANNELS - multi-channel (email / push / sms)',
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
    '  // Which channel checkboxes are ticked.',
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
    '            return CH_LABEL[c] + ": <span class=\\"n\\">" + ((d.counts && d.counts[c]) || 0) + "</span>";',
    '          });',
    '          out.innerHTML = "Will send \u2014 " + parts.join(" &nbsp;\u00b7&nbsp; ");',
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
    '          var chans = (b.channels && b.channels.length)',
    '            ? b.channels.map(function(c){ return CH_LABEL[c] || c; }).join(", ")',
    '            : "email";',
    '          return \'<div class="bc-hist-row">\' +',
    '            \'<div class="s">\' + bcEsc(b.subject || "(no subject)") + \'</div>\' +',
    '            \'<div class="m">\' + bcEsc(chans) + \' \\u00b7 sent \' + (b.sent||0) +',
    '            (b.failed ? (\' \\u00b7 \' + b.failed + \' failed\') : \'\') +',
    '            \' \\u00b7 \' + when + \'</div></div>\';',
    '        }).join("");',
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
  ok('Edit 2 - broadcast tab script swapped (multi-channel)');

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

log('');
log('===================================================');
log('Patch 46 (Stage 4b) applied.');
if (fs.existsSync(BACKUP_DIR)) log('Backups: ' + path.basename(BACKUP_DIR));
log('');
log('  Commit + push, wait ~60s, hard-refresh /admin.html, open Broadcast.');
log('  TEST:');
log('   1. The "Channels" row shows 3 checkboxes (Email ticked by default).');
log('   2. Tick Email + Web push, pick "Specific", enter your own email,');
log('      click Preview -> "Will send - Email: 1  Web push: 1".');
log('   3. Add a subject + message, Send -> confirm dialog lists both');
log('      channels -> green per-channel result, email + push both arrive.');
log('   4. Tick SMS only, Preview -> SMS: 0 (correct - no opted-in users).');
log('   5. Untick everything, try Preview -> "Select at least one channel."');
log('   6. History rows now show which channels each broadcast used.');
log('');
log('  That completes Stage 4. Next: Stage 5 - automatic scan notifications.');
log('');
