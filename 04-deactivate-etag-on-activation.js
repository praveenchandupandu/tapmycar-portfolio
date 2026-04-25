// FIX: get-tag.js — auto-deactivate eTags when physical sticker activates

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

const filePath = path.join(ROOT, 'api', 'get-tag.js');
if (!fs.existsSync(filePath)) {
  console.error('api/get-tag.js not found');
  process.exit(1);
}
let content = fs.readFileSync(filePath, 'utf8');

if (content.indexOf('Auto-deactivate eTags when physical') !== -1) {
  console.log('[OK] get-tag.js already has eTag auto-deactivate logic');
  process.exit(0);
}

// Use regex to find the activation block — flexible whitespace + CRLF
// Anchor: from "// Normal claim/update" to the line "const updates = {"
const anchorPattern = /(\/\/ Normal claim\/update\s*\r?\n\s*if \(!user_id\) \{\s*\r?\n\s*return res\.status\(400\)\.json\(\{ error: 'user_id required' \}\);\s*\r?\n\s*\}\s*\r?\n\s*\r?\n\s*)(const updates = \{)/;

const match = content.match(anchorPattern);
if (!match) {
  console.error('[ERROR] Could not find activation anchor.');
  console.error('Checking what the file has around "Normal claim/update":');
  const idx = content.indexOf('Normal claim/update');
  if (idx !== -1) {
    console.error(JSON.stringify(content.substring(idx, idx + 300)));
  } else {
    console.error('"Normal claim/update" comment not found at all.');
  }
  process.exit(1);
}

// Build the deactivation block as an array (no escape issues)
const deactivateBlock = [
  "",
  "    // Auto-deactivate eTags when physical tag activates",
  "    // If the tag being activated is a physical sticker (not an eTag),",
  "    // deactivate any existing eTags owned by this user. Prevents user",
  "    // from having both eTag and physical active simultaneously.",
  "    try {",
  "      const { data: tagBeingActivated } = await supabase",
  "        .from('tags')",
  "        .select('tag_type, token')",
  "        .eq('token', cleanToken)",
  "        .single();",
  "",
  "      const isPhysicalActivation = tagBeingActivated && (",
  "        tagBeingActivated.tag_type === 'physical' ||",
  "        (tagBeingActivated.token && tagBeingActivated.token.indexOf('TMC-ET') !== 0)",
  "      );",
  "",
  "      if (isPhysicalActivation) {",
  "        const { data: existingEtags } = await supabase",
  "          .from('tags')",
  "          .select('id, token')",
  "          .eq('owner_id', user_id)",
  "          .eq('tag_type', 'etag')",
  "          .neq('token', cleanToken)",
  "          .in('status', ['claimed', 'active']);",
  "",
  "        if (existingEtags && existingEtags.length > 0) {",
  "          const etagIds = existingEtags.map(t => t.id);",
  "          await supabase",
  "            .from('tags')",
  "            .update({ status: 'inactive' })",
  "            .in('id', etagIds);",
  "          console.log('Deactivated', existingEtags.length, 'eTag(s) for user', user_id, 'after physical activation');",
  "        }",
  "      }",
  "    } catch (etagErr) {",
  "      console.error('eTag deactivation error (non-fatal):', etagErr);",
  "    }",
  "",
  "    "
].join('\r\n');

// Replace: keep the original prefix (claim/update comment + user_id check), 
// inject our deactivation block, then continue with const updates = {
content = content.replace(anchorPattern, '$1' + deactivateBlock + '$2');

fs.writeFileSync(filePath, content, 'utf8');
console.log('[FIX] Added auto-deactivate-eTags logic to get-tag.js');
