// claude-patch-glow.js
// Idempotent: adds an ambient brand glow + glassy bottom nav to app.css (root + public).
// Scoped to app screens only (skips body.wide-page legal/marketing pages).
// Re-running replaces the managed block. Timestamped backups; auto-restore on failure. UTF-8, no BOM.
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");

const BLOCK = [
  "/* TMC_GLOW_START */",
  "/* Ambient brand glow behind app screens (not legal/wide pages) */",
  "body:not(.wide-page)::before {",
  "  content: \"\";",
  "  position: fixed;",
  "  top: 0; left: 0; right: 0; height: 420px;",
  "  z-index: -1; pointer-events: none;",
  "  background: radial-gradient(120% 100% at 50% -10%, rgba(255,107,0,.18) 0%, rgba(255,107,0,.07) 38%, rgba(255,255,255,0) 72%);",
  "  animation: tmcGlowIn .55s ease-out both;",
  "}",
  "@keyframes tmcGlowIn { from { opacity: 0 } to { opacity: 1 } }",
  "/* Elevated, glassy bottom nav */",
  ".bnav {",
  "  background: rgba(255,255,255,.82);",
  "  -webkit-backdrop-filter: saturate(180%) blur(14px);",
  "  backdrop-filter: saturate(180%) blur(14px);",
  "  border-top: none;",
  "  box-shadow: 0 -6px 24px rgba(17,17,17,.07);",
  "}",
  "@media (prefers-reduced-motion: reduce) { body:not(.wide-page)::before { animation: none } }",
  "/* TMC_GLOW_END */"
].join("\n");

const files = ["app.css", path.join("public", "app.css")];
const reBlock = /\/\* TMC_GLOW_START \*\/[\s\S]*?\/\* TMC_GLOW_END \*\//;

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
    const count = (after.match(/TMC_GLOW_START/g) || []).length;
    if (count !== 1) throw new Error("expected exactly 1 block in " + rel + ", found " + count);
    console.log("ok " + rel + " (" + after.length + " chars, blocks: " + count + ")");
  }
  console.log("");
  console.log("DONE. Ambient glow applied to root + public app.css.");
} catch (e) {
  console.error("ERROR: " + e.message);
  console.error("Restoring from backups...");
  for (const b of backups) {
    try { fs.copyFileSync(b.bak, b.abs); console.error("restored " + path.relative(ROOT, b.abs)); } catch (x) {}
  }
  process.exit(1);
}
