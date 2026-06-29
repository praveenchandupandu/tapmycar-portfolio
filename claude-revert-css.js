// claude-revert-css.js
// Reverts the two cosmetic CSS patches: removes the TMC_GLOW and TMC_NATIVE_FEEL
// managed blocks from app.css (root + public). Leaves everything else (incl. legal pages) untouched.
// Safe to run even if a block isn't present. Timestamped backups; auto-restore on failure. UTF-8, no BOM.
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");

const files = ["app.css", path.join("public", "app.css")];
const blocks = [
  /\n*\/\* TMC_GLOW_START \*\/[\s\S]*?\/\* TMC_GLOW_END \*\//,
  /\n*\/\* TMC_NATIVE_FEEL_START \*\/[\s\S]*?\/\* TMC_NATIVE_FEEL_END \*\//
];

const backups = [];
try {
  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { console.log("skip (missing): " + rel); continue; }
    const bak = abs + "." + STAMP + ".bak";
    fs.copyFileSync(abs, bak);
    backups.push({ abs: abs, bak: bak });

    let css = fs.readFileSync(abs, "utf8");
    let removed = 0;
    for (const re of blocks) {
      const before = css.length;
      css = css.replace(re, "");
      if (css.length !== before) removed++;
    }
    css = css.replace(/\s+$/, "") + "\n";
    fs.writeFileSync(abs, css, { encoding: "utf8" });

    const after = fs.readFileSync(abs, "utf8");
    const g = (after.match(/TMC_GLOW_START/g) || []).length;
    const n = (after.match(/TMC_NATIVE_FEEL_START/g) || []).length;
    if (g !== 0 || n !== 0) throw new Error("blocks still present in " + rel + " (glow=" + g + ", native=" + n + ")");
    console.log("cleaned " + rel + " (removed " + removed + " block(s), " + after.length + " chars)");
  }
  console.log("");
  console.log("DONE. Cosmetic CSS reverted. Privacy/Terms untouched.");
} catch (e) {
  console.error("ERROR: " + e.message);
  console.error("Restoring from backups...");
  for (const b of backups) {
    try { fs.copyFileSync(b.bak, b.abs); console.error("restored " + path.relative(ROOT, b.abs)); } catch (x) {}
  }
  process.exit(1);
}
