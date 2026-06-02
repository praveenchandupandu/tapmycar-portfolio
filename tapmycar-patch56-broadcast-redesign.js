/* ============================================================================
 * TapMyCar  Patch 56  rollback 55b admin UI, extend Broadcast (date+audience)
 * ----------------------------------------------------------------------------
 * Run from the project root:  node tapmycar-patch56-broadcast-redesign.js
 *
 * Patch 55b shipped a parallel Announcements admin tab. Praveen pointed out
 * Broadcast already does this via its 'inapp' channel. This patch:
 *
 *   1. ROLLBACK 55b:
 *      - Delete: api/admin-create-announcement.js
 *      - Delete: api/admin-list-announcements.js
 *      - Delete: api/admin-disable-announcement.js
 *      - Revert 5 admin HTML edits made by Patch 55b (nav button, TAB_TITLES,
 *        TAB_SUBS, the new panel, the JS loader). We anchor on the
 *        TMC_PATCH55B markers we added and remove them.
 *
 *   2. EXTEND Broadcast UI:
 *      - Add a small inline block under the In-app channel checkbox showing
 *        Start date, End date, and Audience selector. The block is visible
 *        ONLY when the inapp checkbox is checked. Defaults: start=now,
 *        end=now+14d, audience=all.
 *      - bcSend / bcPreview pass inapp_start_date / inapp_end_date /
 *        inapp_audience in the API body when inapp is among channels.
 *
 *   3. EXTEND send-broadcast.js:
 *      - Read inapp_start_date / inapp_end_date / inapp_audience from body.
 *      - Pass them into the announcements insert (the start_date, end_date,
 *        audience columns from Patch 55a). Falls back to start=now,
 *        end=now+14d, audience='all' if missing.
 *
 * Patch 55a BACKEND CHANGES STAY (the get-announcement.js date+audience
 * filter and dismiss-tracking fix are pure improvements that benefit
 * Broadcast's inapp channel directly).
 *
 * SAFE TO RE-RUN: each file skipped if it already contains TMC_PATCH56.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MARKER = 'TMC_PATCH56';
const STAMP = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const BACKUP_DIR = 'backup-patch56-' + STAMP;

function log(m) { console.log(m); }
function fail(m) { console.error('\n  ERROR: ' + m + '\n'); process.exit(1); }

const CREATE_EP  = path.join('api', 'admin-create-announcement.js');
const LIST_EP    = path.join('api', 'admin-list-announcements.js');
const DISABLE_EP = path.join('api', 'admin-disable-announcement.js');
const SEND_BC    = path.join('api', 'send-broadcast.js');
const ADMIN_HTML = path.join('public', 'cmshaveaccesstouser2026-npmevy.html');

/* ========================================================================
 * Rollback patterns for Patch 55b admin HTML edits.
 * Each find/replace inverts what 55b did. Reverts must be EXACT.
 * ======================================================================*/

const NAV_FIND = [
  '<button class="sb-item" data-tab="newsletter" onclick="navTo(\'newsletter\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"/><path d="M22 6l-10 7L2 6"/></svg><span>Newsletter</span></button><!-- TMC_PATCH52 -->',
  '    <button class="sb-item" data-tab="announcements" onclick="navTo(\'announcements\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l18-8-8 18-2-8-8-2z"/><path d="M11 13l5-2"/></svg><span>Announcements</span></button><!-- TMC_PATCH55B -->'
].join('\n');
const NAV_REPLACE = '<button class="sb-item" data-tab="newsletter" onclick="navTo(\'newsletter\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16H4z"/><path d="M22 6l-10 7L2 6"/></svg><span>Newsletter</span></button><!-- TMC_PATCH52 -->';

const TT_FIND = '"retention": "Retention", "refunds": "Refunds", "newsletter": "Newsletter", "announcements": "Announcements"}; /* TMC_PATCH42 */';
const TT_REPLACE = '"retention": "Retention", "refunds": "Refunds", "newsletter": "Newsletter"}; /* TMC_PATCH42 */';

const TS_FIND = '"retention": "Exit reasons, opt-in counts, lapsed emails", "refunds": "Failed Stripe refund attempts needing manual review", "newsletter": "Post-deletion newsletter signups  export to CSV for Mailchimp/Beehiiv", "announcements": "Create and manage in-app popup announcements"}; /* TMC_PATCH42 */';
const TS_REPLACE = '"retention": "Exit reasons, opt-in counts, lapsed emails", "refunds": "Failed Stripe refund attempts needing manual review", "newsletter": "Post-deletion newsletter signups  export to CSV for Mailchimp/Beehiiv"}; /* TMC_PATCH42 */';

/* For the Patch 55b panel + JS removal, find each block's unique start and
   end and remove the entire range. We use markers we inserted in Patch 55b. */

/* ========================================================================
 * Broadcast UI extension  add the date+audience controls inside Broadcast.
 * Anchor: the existing inapp checkbox label so we insert just below it.
 * ======================================================================*/

const BC_UI_FIND = '<input type="checkbox" id="bc-ch-inapp" onchange="bcResetCount()"> In-app popup</label>';

const BC_UI_REPLACE = [
  '<input type="checkbox" id="bc-ch-inapp" onchange="bcResetCount(); bcToggleInappOpts()"> In-app popup</label>',
  '              <!-- TMC_PATCH56: inapp-only options. Shown when In-app is checked. -->',
  '              <div id="bc-inapp-opts" style="display:none;margin:10px 0 0 24px;padding:12px 14px;border-left:3px solid #FF6B00;background:#FFF7ED;border-radius:0 9px 9px 0">',
  '                <div style="font-size:11px;font-weight:700;color:#9A3412;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px">In-app popup options</div>',
  '                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">',
  '                  <div>',
  '                    <label style="font-size:11px;color:#6B7280;display:block;margin-bottom:3px">Start</label>',
  '                    <input type="datetime-local" id="bc-inapp-start" class="bc-input" style="font-size:13px">',
  '                  </div>',
  '                  <div>',
  '                    <label style="font-size:11px;color:#6B7280;display:block;margin-bottom:3px">End</label>',
  '                    <input type="datetime-local" id="bc-inapp-end" class="bc-input" style="font-size:13px">',
  '                  </div>',
  '                </div>',
  '                <div>',
  '                  <label style="font-size:11px;color:#6B7280;display:block;margin-bottom:3px">Audience</label>',
  '                  <select id="bc-inapp-audience" class="bc-select" style="font-size:13px">',
  '                    <option value="all">All users</option>',
  '                    <option value="existing">Existing users only (signed up before this broadcast)</option>',
  '                  </select>',
  '                </div>',
  '              </div>'
].join('\n');

/* JS  add bcToggleInappOpts helper, defaults filler, and include the
   new fields in bcApi payload. Anchor on bcChannels function for one
   insertion, and on the two existing bcApi calls for the other two. */

const BC_JS_FIND = "    var inappEl = document.getElementById(\"bc-ch-inapp\");\r\n    if (inappEl && inappEl.checked) out.push(\"inapp\");";

/* The file actually has \n line endings inside this script tag; the grep
   above showed \r\n because of overall CRLF. Our driver normalizes to \n
   before matching, so the find string uses \n. */
const BC_JS_FIND_NORM = "    var inappEl = document.getElementById(\"bc-ch-inapp\");\n    if (inappEl && inappEl.checked) out.push(\"inapp\");";

const BC_JS_REPLACE_NORM = [
  '    var inappEl = document.getElementById("bc-ch-inapp");',
  '    if (inappEl && inappEl.checked) out.push("inapp");',
  '  }',
  '',
  '  /* TMC_PATCH56: toggle inapp-options block visibility + prime defaults. */',
  '  window.bcToggleInappOpts = function () {',
  '    var box   = document.getElementById("bc-inapp-opts");',
  '    var cb    = document.getElementById("bc-ch-inapp");',
  '    if (!box || !cb) return;',
  '    box.style.display = cb.checked ? "block" : "none";',
  '    if (cb.checked) {',
  '      var startEl = document.getElementById("bc-inapp-start");',
  '      var endEl   = document.getElementById("bc-inapp-end");',
  '      function toLocal(d) {',
  '        var pad = function (n) { return String(n).padStart(2, "0"); };',
  '        return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate()) +',
  '               "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());',
  '      }',
  '      if (startEl && !startEl.value) startEl.value = toLocal(new Date());',
  '      if (endEl   && !endEl.value)   endEl.value   = toLocal(new Date(Date.now() + 14*86400000));',
  '    }',
  '  };',
  '',
  '  /* TMC_PATCH56: append inapp options to a payload object if checked. */',
  '  window.bcInappOpts = function () {',
  '    var cb = document.getElementById("bc-ch-inapp");',
  '    if (!cb || !cb.checked) return null;',
  '    var s = document.getElementById("bc-inapp-start");',
  '    var e = document.getElementById("bc-inapp-end");',
  '    var a = document.getElementById("bc-inapp-audience");',
  '    var out = {};',
  '    try { if (s && s.value) out.inapp_start_date = new Date(s.value).toISOString(); } catch (x) {}',
  '    try { if (e && e.value) out.inapp_end_date   = new Date(e.value).toISOString(); } catch (x) {}',
  '    out.inapp_audience = (a && a.value) || "all";',
  '    return out;',
  '  };',
  '',
  '  var _bcStartFiller = function () { /* nothing here  needed only so we close fn properly below */'
].join('\n');

/* That was too clever; lets do it a different way  add the helpers AFTER
   the bcChannels function ends, and have bcSend/bcPreview attach inapp opts.
   I will replace just the two existing bcApi(...) calls to merge inapp opts. */

/* ACTUALLY: simpler & more reliable approach  one focused replacement that
   inserts helpers immediately after the line we anchor on. Then two more
   replacements on the two bcApi callsites. */

const BC_HELPER_INSERT_AFTER = '    if (inappEl && inappEl.checked) out.push("inapp");';
const BC_HELPER_BLOCK = [
  '    if (inappEl && inappEl.checked) out.push("inapp");',
  '    return out;',
  '  };',
  '',
  '  /* TMC_PATCH56: inapp-options visibility + payload helper. */',
  '  window.bcToggleInappOpts = function () {',
  '    var box = document.getElementById("bc-inapp-opts");',
  '    var cb  = document.getElementById("bc-ch-inapp");',
  '    if (!box || !cb) return;',
  '    box.style.display = cb.checked ? "block" : "none";',
  '    if (cb.checked) {',
  '      var startEl = document.getElementById("bc-inapp-start");',
  '      var endEl   = document.getElementById("bc-inapp-end");',
  '      function toLocal(d) {',
  '        var pad = function (n) { return String(n).padStart(2, "0"); };',
  '        return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate()) +',
  '               "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());',
  '      }',
  '      if (startEl && !startEl.value) startEl.value = toLocal(new Date());',
  '      if (endEl   && !endEl.value)   endEl.value   = toLocal(new Date(Date.now() + 14*86400000));',
  '    }',
  '  };',
  '  window.bcInappOpts = function () {',
  '    var cb = document.getElementById("bc-ch-inapp");',
  '    if (!cb || !cb.checked) return null;',
  '    var s = document.getElementById("bc-inapp-start");',
  '    var e = document.getElementById("bc-inapp-end");',
  '    var a = document.getElementById("bc-inapp-audience");',
  '    var out = {};',
  '    try { if (s && s.value) out.inapp_start_date = new Date(s.value).toISOString(); } catch (x) {}',
  '    try { if (e && e.value) out.inapp_end_date   = new Date(e.value).toISOString(); } catch (x) {}',
  '    out.inapp_audience = (a && a.value) || "all";',
  '    return out;',
  '  };',
  '  var _bcUnusedSentinel56 = true;  // padding to preserve original closing line below'
].join('\n');

/* The function bcChannels originally ends with:
     return out;
   };
   We are about to inject after the `out.push("inapp")` line, BEFORE
   `return out;`. Our injection ends with a `return out;` + `}` then helpers.
   The ORIGINAL `return out; }` lines that follow will now be orphaned.
   We must therefore consume them too. Better to anchor on the whole tail. */

/* RESTART with a clean anchor: include the closing `return out; };` in the find. */

const BC_TAIL_FIND_NORM = [
  '    var inappEl = document.getElementById("bc-ch-inapp");',
  '    if (inappEl && inappEl.checked) out.push("inapp");',
  '    return out;',
  '  }'
].join('\n');

const BC_TAIL_REPLACE_NORM = [
  '    var inappEl = document.getElementById("bc-ch-inapp");',
  '    if (inappEl && inappEl.checked) out.push("inapp");',
  '    return out;',
  '  }',
  '',
  '  /* TMC_PATCH56: inapp-options visibility + payload helper. */',
  '  window.bcToggleInappOpts = function () {',
  '    var box = document.getElementById("bc-inapp-opts");',
  '    var cb  = document.getElementById("bc-ch-inapp");',
  '    if (!box || !cb) return;',
  '    box.style.display = cb.checked ? "block" : "none";',
  '    if (cb.checked) {',
  '      var startEl = document.getElementById("bc-inapp-start");',
  '      var endEl   = document.getElementById("bc-inapp-end");',
  '      function toLocal(d) {',
  '        var pad = function (n) { return String(n).padStart(2, "0"); };',
  '        return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate()) +',
  '               "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());',
  '      }',
  '      if (startEl && !startEl.value) startEl.value = toLocal(new Date());',
  '      if (endEl   && !endEl.value)   endEl.value   = toLocal(new Date(Date.now() + 14*86400000));',
  '    }',
  '  };',
  '  window.bcInappOpts = function () {',
  '    var cb = document.getElementById("bc-ch-inapp");',
  '    if (!cb || !cb.checked) return null;',
  '    var s = document.getElementById("bc-inapp-start");',
  '    var e = document.getElementById("bc-inapp-end");',
  '    var a = document.getElementById("bc-inapp-audience");',
  '    var out = {};',
  '    try { if (s && s.value) out.inapp_start_date = new Date(s.value).toISOString(); } catch (x) {}',
  '    try { if (e && e.value) out.inapp_end_date   = new Date(e.value).toISOString(); } catch (x) {}',
  '    out.inapp_audience = (a && a.value) || "all";',
  '    return out;',
  '  };'
].join('\n');

/* Now update the two bcApi calls to merge inapp opts. */
const BC_PREVIEW_FIND  = 'bcApi({ channels: channels, dry_run: true, recipients: bcRecipients() })';
const BC_PREVIEW_REPL  = 'bcApi(Object.assign({ channels: channels, dry_run: true, recipients: bcRecipients() }, (typeof bcInappOpts === "function" && bcInappOpts()) || {}))';

const BC_SEND_FIND  = 'bcApi({ channels: channels, subject: subject, body: body, recipients: rcp })';
const BC_SEND_REPL  = 'bcApi(Object.assign({ channels: channels, subject: subject, body: body, recipients: rcp }, (typeof bcInappOpts === "function" && bcInappOpts()) || {}))';

/* ========================================================================
 * send-broadcast.js  read fields + insert with new columns.
 * ======================================================================*/

const SB_FIND = [
  "      const annTitle = (subject && String(subject).trim()) ? String(subject).trim() : '';",
  "      const { error: annErr } = await supabase.from('announcements').insert({",
  "        title: annTitle, body: String(body.body),",
  "        active: true, created_by: 'admin', broadcast_id: broadcastId",
  "      });"
].join('\n');

const SB_REPLACE = [
  "      const annTitle = (subject && String(subject).trim()) ? String(subject).trim() : '';",
  "      /* TMC_PATCH56: read date window + audience from request. Defaults",
  "         keep behavior backward-compatible (start=now, end=now+14d, all). */",
  "      const _nowMs56 = Date.now();",
  "      let _startMs56 = body.inapp_start_date ? Date.parse(body.inapp_start_date) : _nowMs56;",
  "      let _endMs56   = body.inapp_end_date   ? Date.parse(body.inapp_end_date)   : (_nowMs56 + 14*86400000);",
  "      if (isNaN(_startMs56)) _startMs56 = _nowMs56;",
  "      if (isNaN(_endMs56) || _endMs56 <= _startMs56) _endMs56 = _startMs56 + 14*86400000;",
  "      const _aud56 = (body.inapp_audience === 'existing') ? 'existing' : 'all';",
  "      const { error: annErr } = await supabase.from('announcements').insert({",
  "        title: annTitle, body: String(body.body),",
  "        active: true, created_by: 'admin', broadcast_id: broadcastId,",
  "        start_date: new Date(_startMs56).toISOString(),",
  "        end_date:   new Date(_endMs56).toISOString(),",
  "        audience:   _aud56",
  "      });"
].join('\n');

/* ========================================================================
 * DRIVER
 * ======================================================================*/

log('\nTapMyCar  Patch 56  rollback 55b admin UI + extend Broadcast\n');
log('Backup -> ' + BACKUP_DIR + '\n');

function backupAndWrite(file, original, updated) {
  const dest = path.join(BACKUP_DIR, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
  fs.writeFileSync(file, updated, 'utf8');
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });
let changed = 0;

/* 1) Delete 55b endpoint files */
for (const ep of [CREATE_EP, LIST_EP, DISABLE_EP]) {
  if (fs.existsSync(ep)) {
    fs.mkdirSync(path.join(BACKUP_DIR, 'api'), { recursive: true });
    fs.copyFileSync(ep, path.join(BACKUP_DIR, ep));
    fs.unlinkSync(ep);
    log(ep + ': deleted');
    changed++;
  } else {
    log(ep + ': already absent');
  }
}

/* 2) Admin HTML  rollback + extension edits */
{
  const original = fs.readFileSync(ADMIN_HTML, 'utf8');
  if (original.indexOf(MARKER) !== -1) {
    log(ADMIN_HTML + ': skip (already patched with TMC_PATCH56)');
  } else {
    const wasCRLF = original.indexOf('\r\n') !== -1;
    let updated = original.replace(/\r\n/g, '\n');

    /* ---- ROLLBACK 55b edits ---- */

    /* nav button: remove the announcements line */
    if (updated.indexOf('data-tab="announcements"') !== -1) {
      const i = updated.indexOf(NAV_FIND);
      if (i === -1) fail('rollback: NAV_FIND not found');
      updated = updated.replace(NAV_FIND, () => NAV_REPLACE);
    }

    /* TAB_TITLES / TAB_SUBS rollback */
    if (updated.indexOf(', "announcements": "Announcements"}') !== -1) {
      if (updated.indexOf(TT_FIND) === -1) fail('rollback: TT_FIND not found');
      updated = updated.replace(TT_FIND, () => TT_REPLACE);
    }
    if (updated.indexOf(', "announcements": "Create and manage') !== -1) {
      if (updated.indexOf(TS_FIND) === -1) fail('rollback: TS_FIND not found');
      updated = updated.replace(TS_FIND, () => TS_REPLACE);
    }

    /* 55b panel removal: from <!-- TMC_PATCH55B Announcements panel --> to
       the line before <!-- TMC_PATCH52 Newsletter panel --> */
    const panelStart = updated.indexOf('      <!-- TMC_PATCH55B Announcements panel -->');
    if (panelStart !== -1) {
      const panelEnd = updated.indexOf('      <!-- TMC_PATCH52 Newsletter panel -->', panelStart);
      if (panelEnd === -1) fail('rollback: could not locate end of 55b panel');
      updated = updated.slice(0, panelStart) + updated.slice(panelEnd);
    }

    /* 55b JS removal: the block we inserted starts with the marker comment
       and ends just before the TMC_PATCH52 newsletter tab loader marker. */
    const jsStart = updated.indexOf('/* TMC_PATCH55B announcements tab logic */');
    if (jsStart !== -1) {
      const jsEnd = updated.indexOf('/* TMC_PATCH52 newsletter tab loader */', jsStart);
      if (jsEnd === -1) fail('rollback: could not locate end of 55b JS');
      updated = updated.slice(0, jsStart) + updated.slice(jsEnd);
    }

    /* ---- EXTEND Broadcast ---- */

    if (updated.indexOf(BC_UI_FIND) === -1) fail('extend: BC_UI_FIND not found');
    if (updated.indexOf(BC_UI_FIND, updated.indexOf(BC_UI_FIND) + 1) !== -1) fail('extend: BC_UI_FIND not unique');
    updated = updated.replace(BC_UI_FIND, () => BC_UI_REPLACE);

    if (updated.indexOf(BC_TAIL_FIND_NORM) === -1) fail('extend: BC_TAIL_FIND_NORM not found');
    if (updated.indexOf(BC_TAIL_FIND_NORM, updated.indexOf(BC_TAIL_FIND_NORM) + 1) !== -1) fail('extend: BC_TAIL_FIND_NORM not unique');
    updated = updated.replace(BC_TAIL_FIND_NORM, () => BC_TAIL_REPLACE_NORM);

    if (updated.indexOf(BC_PREVIEW_FIND) === -1) fail('extend: BC_PREVIEW_FIND not found');
    if (updated.indexOf(BC_PREVIEW_FIND, updated.indexOf(BC_PREVIEW_FIND) + 1) !== -1) fail('extend: BC_PREVIEW_FIND not unique');
    updated = updated.replace(BC_PREVIEW_FIND, () => BC_PREVIEW_REPL);

    if (updated.indexOf(BC_SEND_FIND) === -1) fail('extend: BC_SEND_FIND not found');
    if (updated.indexOf(BC_SEND_FIND, updated.indexOf(BC_SEND_FIND) + 1) !== -1) fail('extend: BC_SEND_FIND not unique');
    updated = updated.replace(BC_SEND_FIND, () => BC_SEND_REPL);

    if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');
    backupAndWrite(ADMIN_HTML, original, updated);

    /* syntax-check the broadcast script block */
    const s = fs.readFileSync(ADMIN_HTML, 'utf8');
    const at = s.indexOf('TMC_PATCH56: inapp-options visibility');
    if (at !== -1) {
      const a = s.lastIndexOf('<script>', at) + 8;
      const b = s.indexOf('</script>', at);
      fs.writeFileSync('/tmp/p56-admin-chk.js', s.slice(a, b));
      try {
        execSync('node --check /tmp/p56-admin-chk.js', { stdio: 'pipe' });
        log(ADMIN_HTML + ': rolled back + extended, node --check OK');
      } catch (e) {
        fs.writeFileSync(ADMIN_HTML, original, 'utf8');
        fail('node --check FAILED  admin restored.\n' + String(e.stderr || e.message));
      }
    }
    changed++;
  }
}

/* 3) send-broadcast.js  pass through new fields */
{
  const original = fs.readFileSync(SEND_BC, 'utf8');
  if (original.indexOf(MARKER) !== -1) {
    log(SEND_BC + ': skip (already patched)');
  } else {
    const wasCRLF = original.indexOf('\r\n') !== -1;
    let updated = original.replace(/\r\n/g, '\n');
    if (updated.indexOf(SB_FIND) === -1) fail('send-broadcast: SB_FIND not found');
    if (updated.indexOf(SB_FIND, updated.indexOf(SB_FIND) + 1) !== -1) fail('send-broadcast: SB_FIND not unique');
    updated = updated.replace(SB_FIND, () => SB_REPLACE);
    if (wasCRLF) updated = updated.replace(/\n/g, '\r\n');
    backupAndWrite(SEND_BC, original, updated);
    try {
      execSync('node --check "' + SEND_BC + '"', { stdio: 'pipe' });
      log(SEND_BC + ': patched, node --check OK');
      changed++;
    } catch (e) {
      fs.writeFileSync(SEND_BC, original, 'utf8');
      fail('node --check FAILED  send-broadcast restored.\n' + String(e.stderr || e.message));
    }
  }
}

log('');
if (changed === 0) {
  log('All files already patched. Nothing to do.\n');
} else {
  log('Done. Files changed: ' + changed + '\n');
  log('NEXT STEPS:');
  log('  1. git add -A');
  log('  2. git commit -m "Patch 56: revert 55b admin UI, extend Broadcast"');
  log('  3. git push  (wait ~60s for Vercel)');
  log('  4. Open admin  Announcements sidebar item is GONE (correct).');
  log('  5. Click Broadcast  check In-app popup  options block appears');
  log('     under it with Start, End, Audience.');
  log('  6. Fill subject + body + check In-app  Send.');
  log('     Verify announcements row got start_date / end_date / audience.\n');
}
