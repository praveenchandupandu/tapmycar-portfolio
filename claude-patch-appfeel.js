// claude-patch-appfeel.js
// Re-applies the glow + native touch feel, LEAN: no @view-transition, no backdrop-filter (those caused the lag).
// Glow uses a background layer (no pseudo/z-index) so it renders reliably and stays for the whole page.
// Scoped to app screens (skips body.wide-page legal pages). Idempotent. Backups + auto-restore. UTF-8, no BOM.
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");

const BLOCK = [
  "/* TMC_APPFEEL_START */",
  "/* Ambient brand glow on app screens — stays for the whole page; removed on legal/wide pages. */",
  "body:not(.wide-page) {",
  "  background-color: var(--wh);",
  "  background-image: radial-gradient(120% 130% at 50% -10%, rgba(255,107,0,.18) 0%, rgba(255,107,0,.06) 40%, rgba(255,255,255,0) 72%);",
  "  background-repeat: no-repeat;",
  "  background-position: top center;",
  "  background-size: 100% 460px;",
  "  animation: tmcFadeIn .2s ease-out both;",
  "}",
  "@keyframes tmcFadeIn { from { opacity: 0 } to { opacity: 1 } }",
  "/* Native feel: stop long-press from selecting text / dragging UI / showing the web callout */",
  "* { -webkit-touch-callout: none; -webkit-user-drag: none; }",
  "body { -webkit-user-select: none; user-select: none; }",
  "img, a, button, svg { -webkit-user-drag: none; }",
  "/* Keep real inputs and readable legal text fully selectable */",
  'input, textarea, select, [contenteditable="true"], .selectable,',
  ".legal-page, .legal-page * { -webkit-user-select: text; user-select: text; -webkit-touch-callout: default; }",
  "@media (prefers-reduced-motion: reduce) { body:not(.wide-page) { animation: none } }",
  "/* TMC_APPFEEL_END */"
].join("\n");

const files = ["app.css", path.join("public", "app.css")];
const reBlock = /\/\* TMC_APPFEEL_START \*\/[\s\S]*?\/\* TMC_APPFEEL_END \*\//;

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
    const count = (after.match(/TMC_APPFEEL_START/g) || []).length;
    if (count !== 1) throw new Error("expected exactly 1 block in " + rel + ", found " + count);
    console.log("ok " + rel + " (" + after.length + " chars, blocks: " + count + ")");
  }
  console.log("");
  console.log("DONE. Glow + native touch feel re-applied (lean).");
} catch (e) {
  console.error("ERROR: " + e.message);
  console.error("Restoring from backups...");
  for (const b of backups) {
    try { fs.copyFileSync(b.bak, b.abs); console.error("restored " + path.relative(ROOT, b.abs)); } catch (x) {}
  }
  process.exit(1);
}
