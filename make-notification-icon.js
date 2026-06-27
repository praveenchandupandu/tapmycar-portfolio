/**
 * make-notification-icon.js
 * Generates the Android status-bar notification icon (white silhouette)
 * from an existing transparent-background logo, at all 5 densities,
 * and wires it into AndroidManifest.xml (idempotent, with backup).
 *
 * Run from the project root:  node make-notification-icon.js
 */
const fs = require("fs");
const path = require("path");
const Jimp = require("jimp");

// ---- CONFIG ---------------------------------------------------------------
// Source logo. Must have a TRANSPARENT background (a mark on clear space).
// Default is the adaptive-icon foreground. If the result looks too busy
// shrunk down, change this ONE line to the simpler shield mark and re-run:
//     const SOURCE = path.join("tapmycar-logo-assets", "shield-icon.png");
const SOURCE = path.join("assets", "icon-foreground.png");

const RES_DIR = path.join("android", "app", "src", "main", "res");
const MANIFEST = path.join("android", "app", "src", "main", "AndroidManifest.xml");
const ICON_NAME = "ic_stat_icon";

// Status-bar icon sizes (24dp base).
const DENSITIES = { mdpi: 24, hdpi: 36, xhdpi: 48, xxhdpi: 72, xxxhdpi: 96 };

// How much of each square the artwork fills (rest is breathing room).
const CONTENT_RATIO = 0.85;
// ---------------------------------------------------------------------------

function log(msg) { console.log(msg); }

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`\n[STOP] Source image not found: ${SOURCE}`);
    console.error(`Edit the SOURCE line at the top of this script to point at a real file.\n`);
    process.exit(1);
  }
  log(`Source: ${SOURCE}`);

  const src = await Jimp.read(SOURCE);

  // --- Safety check: is there enough transparency to make a silhouette? ---
  let transparent = 0;
  const total = src.bitmap.width * src.bitmap.height;
  src.scan(0, 0, src.bitmap.width, src.bitmap.height, function (x, y, idx) {
    if (this.bitmap.data[idx + 3] < 10) transparent++;
  });
  const transFrac = transparent / total;
  log(`Transparency: ${(transFrac * 100).toFixed(1)}% of pixels are clear.`);
  if (transFrac < 0.05) {
    console.error(
      `\n[WARNING] This image is almost fully opaque, so the silhouette would be a solid white box.`
    );
    console.error(
      `Use a transparent mark instead. Change SOURCE to tapmycar-logo-assets/shield-icon.png and re-run.\n`
    );
    process.exit(1);
  }

  // --- Crop transparent margins down to just the mark ---
  const mark = src.clone();
  mark.autocrop({ tolerance: 0.002, cropOnlyFrames: false });
  log(`Cropped mark size: ${mark.bitmap.width} x ${mark.bitmap.height}`);

  // --- Whiten: keep the shape (alpha), force colour to white ---
  mark.scan(0, 0, mark.bitmap.width, mark.bitmap.height, function (x, y, idx) {
    this.bitmap.data[idx] = 255;     // R
    this.bitmap.data[idx + 1] = 255; // G
    this.bitmap.data[idx + 2] = 255; // B
    // alpha (idx+3) left untouched
  });

  // --- Generate each density ---
  const made = [];
  for (const [density, size] of Object.entries(DENSITIES)) {
    const box = Math.round(size * CONTENT_RATIO);
    const piece = mark.clone().scaleToFit(box, box);
    const canvas = new Jimp(size, size, 0x00000000); // transparent square
    const x = Math.round((size - piece.bitmap.width) / 2);
    const y = Math.round((size - piece.bitmap.height) / 2);
    canvas.composite(piece, x, y);

    const dir = path.join(RES_DIR, `drawable-${density}`);
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `${ICON_NAME}.png`);
    await canvas.writeAsync(out);
    made.push(`${out}  (${size}x${size})`);
  }
  log(`\nGenerated icons:`);
  made.forEach((m) => log(`  ${m}`));

  // --- Visible preview (white mark on dark bg) so you can eyeball it ---
  const PREVIEW = `${ICON_NAME}_PREVIEW.png`;
  const pv = new Jimp(160, 160, 0x1f2937ff); // dark slate, opaque
  const pmark = mark.clone().scaleToFit(120, 120);
  pv.composite(pmark, Math.round((160 - pmark.bitmap.width) / 2), Math.round((160 - pmark.bitmap.height) / 2));
  await pv.writeAsync(PREVIEW);
  log(`\nPreview written: ${PREVIEW}  (open it to see the white icon on a dark background)`);

  // --- Patch the manifest (idempotent, with backup) ---
  patchManifest();
}

function patchManifest() {
  if (!fs.existsSync(MANIFEST)) {
    console.error(`\n[WARNING] Manifest not found at ${MANIFEST} — skipping manifest edit.`);
    return;
  }
  let xml = fs.readFileSync(MANIFEST, "utf8");

  if (xml.indexOf("default_notification_icon") !== -1) {
    log(`\nManifest already references the notification icon — no change needed.`);
    return;
  }

  const closeIdx = xml.lastIndexOf("</application>");
  if (closeIdx === -1) {
    console.error(`\n[WARNING] Could not find </application> in manifest — skipping manifest edit.`);
    return;
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${MANIFEST}.bak-${ts}`;
  fs.writeFileSync(backup, xml, "utf8");

  const block =
    `\n        <!-- TapMyCar: status-bar notification icon (white silhouette) -->\n` +
    `        <meta-data\n` +
    `            android:name="com.google.firebase.messaging.default_notification_icon"\n` +
    `            android:resource="@drawable/${ICON_NAME}" />\n`;

  xml = xml.slice(0, closeIdx) + block + xml.slice(closeIdx);
  fs.writeFileSync(MANIFEST, xml, "utf8");
  log(`\nManifest patched. Backup saved: ${backup}`);
}

main().catch((e) => {
  console.error("\n[ERROR]", e.message);
  process.exit(1);
});
