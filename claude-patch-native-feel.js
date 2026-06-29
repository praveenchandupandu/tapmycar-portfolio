// claude-patch-native-feel.js
// Idempotent: adds smooth page transitions + native-app touch feel to app.css (root + public).
// Re-running replaces the managed block (never duplicates). Timestamped backups; auto-restore on failure. UTF-8, no BOM.
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");

const BLOCK = [
  "/* TMC_NATIVE_FEEL_START */",
  "/* Smooth cross-page transitions where supported (no-op on older WebViews) */",
  "@view-transition { navigation: auto; }",
  "@keyframes tmcPageIn { from { opacity: 0 } to { opacity: 1 } }",
  "body { animation: tmcPageIn .18s ease-out both; }",
  "/* Native feel: suppress long-press callout / text selection / drag on app UI */",
  "* { -webkit-touch-callout: none; -webkit-user-drag: none; }",
  "body { -webkit-user-select: none; user-select: none; }",
  "img, a, button, svg { -webkit-user-drag: none; }",
  "/* Keep real inputs and readable legal text fully selectable */",
  'input, textarea, select, [contenteditable="true"], .selectable,',
  ".legal-page, .legal-page * { -webkit-user-select: text; user-select: text; -webkit-touch-callout: default; }",
  "/* Instant tap feedback so navigation feels responsive */",
  ".bni:active { opacity: .55; }",
  ".hero-card:active { filter: brightness(.96); }",
  "@media (prefers-reduced-motion: reduce) { body { animation: none; } }",
  "/* TMC_NATIVE_FEEL_END */"
].join("\n");

const files = ["app.css", path.join("public", "app.css")];
const reBlock = /\/\* TMC_NATIVE_FEEL_START \*\/[\s\S]*?\/\* TMC_NATIVE_FEEL_END \*\//;

const backups = [];
try {
  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { console.log("skip (missing): " + rel); continue; }
    const bak = abs + "." + STAMP + ".bak";
    fs.copyFileSync(abs, bak);
    backups.push({ abs: abs, bak: bak });

    let css = fs.readFileSync(abs, "utf8");
    if (reBlock.test(css)) {
      css = css.replace(reBlock, function () { return BLOCK; });
      console.log("updated existing block in " + rel);
    } else {
      const sep = css.endsWith("\n") ? "\n" : "\n\n";
      css = css + sep + BLOCK + "\n";
      console.log("appended block to " + rel);
    }
    fs.writeFileSync(abs, css, { encoding: "utf8" });

    const after = fs.readFileSync(abs, "utf8");
    const count = (after.match(/TMC_NATIVE_FEEL_START/g) || []).length;
    if (count !== 1) throw new Error("expected exactly 1 block in " + rel + ", found " + count);
    console.log("ok " + rel + " (" + after.length + " chars, blocks: " + count + ")");
  }
  console.log("");
  console.log("DONE. Native-feel styles applied to root + public app.css.");
} catch (e) {
  console.error("ERROR: " + e.message);
  console.error("Restoring from backups...");
  for (const b of backups) {
    try { fs.copyFileSync(b.bak, b.abs); console.error("restored " + path.relative(ROOT, b.abs)); } catch (x) {}
  }
  process.exit(1);
}
