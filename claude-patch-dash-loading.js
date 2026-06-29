// claude-patch-dash-loading.js
// Cleans the dashboard's pre-data state so it never flashes the wrong info:
//   - plan badge starts EMPTY and is hidden until loadDashboard() sets the real plan (no false "Free")
//   - stat numbers start as a neutral dash instead of a hard "0"
// Does NOT touch any data-loading logic. Idempotent. Backups + auto-restore. UTF-8, no BOM.
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const files = ["dashboard.html", path.join("public", "dashboard.html")];

const edits = [
  { label: "plan badge starts empty",
    find: 'id="plan-badge">Free</div>',
    repl: 'id="plan-badge"></div>' },
  { label: "scans stat -> loading dash",
    find: 'id="stat-scans">0</div>',
    repl: 'id="stat-scans">&#8211;</div>' },
  { label: "week stat -> loading dash",
    find: 'id="stat-week">0</div>',
    repl: 'id="stat-week">&#8211;</div>' },
  { label: "hide empty plan badge (CSS)",
    guard: "#plan-badge:empty",
    find: "transform:scale(.75)}}",
    repl: "transform:scale(.75)}}\n    #plan-badge:empty{display:none}" }
];

const backups = [];
try {
  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { console.log("skip (missing): " + rel); continue; }
    const bak = abs + "." + STAMP + ".bak";
    fs.copyFileSync(abs, bak);
    backups.push({ abs: abs, bak: bak });

    let html = fs.readFileSync(abs, "utf8");
    let applied = 0, skipped = 0;
    for (const e of edits) {
      if (e.guard && html.indexOf(e.guard) !== -1) { skipped++; continue; }
      if (html.indexOf(e.find) !== -1) {
        html = html.replace(e.find, function () { return e.repl; });
        applied++;
      } else { skipped++; }
    }
    fs.writeFileSync(abs, html, { encoding: "utf8" });

    const after = fs.readFileSync(abs, "utf8");
    if (after.indexOf('id="plan-badge">Free</div>') !== -1) throw new Error("plan badge still defaults to Free in " + rel);
    console.log("ok " + rel + " (applied " + applied + ", skipped " + skipped + ")");
  }
  console.log("");
  console.log("DONE. Dashboard no longer flashes false Free / 0 before data loads.");
} catch (e) {
  console.error("ERROR: " + e.message);
  console.error("Restoring from backups...");
  for (const b of backups) {
    try { fs.copyFileSync(b.bak, b.abs); console.error("restored " + path.relative(ROOT, b.abs)); } catch (x) {}
  }
  process.exit(1);
}
