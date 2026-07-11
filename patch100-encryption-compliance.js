const fs = require("fs");
const path = require("path");
const plistPath = path.join("ios", "App", "App", "Info.plist");

if (!fs.existsSync(plistPath)) {
  console.log("ERROR: Info.plist not found at " + plistPath);
  process.exit(1);
}

let content = fs.readFileSync(plistPath, "utf8");

if (content.includes("ITSAppUsesNonExemptEncryption")) {
  console.log("Already present - no changes needed");
} else {
  const closingTag = "</dict>\n</plist>";
  const idx = content.lastIndexOf(closingTag);
  if (idx === -1) {
    console.log("ERROR: could not find closing </dict></plist> tag");
    process.exit(1);
  }
  const insertion = "\t<key>ITSAppUsesNonExemptEncryption</key>\n\t<false/>\n";
  content = content.slice(0, idx) + insertion + content.slice(idx);
  fs.writeFileSync(plistPath, content, "utf8");
  console.log("Added ITSAppUsesNonExemptEncryption = false to Info.plist");
}
