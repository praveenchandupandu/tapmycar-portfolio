// FIX: replace assignFreeTag function in api/verify-otp.js
// Safe version: uses TMC-ET prefix, never grabs physical inventory,
// limits to 1 tag per user account.

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

const filePath = path.join(ROOT, 'api', 'verify-otp.js');
if (!fs.existsSync(filePath)) {
  console.error('api/verify-otp.js not found');
  process.exit(1);
}
let content = fs.readFileSync(filePath, 'utf8');

if (content.indexOf('TMC-ET') !== -1) {
  console.log('[OK] verify-otp.js already updated with TMC-ET prefix');
  process.exit(0);
}

// Find function start (works for both LF and CRLF)
const funcStartMarker = 'async function assignFreeTag(userId)';
const startIdx = content.indexOf(funcStartMarker);
if (startIdx === -1) {
  console.error('[ERROR] Could not find assignFreeTag function');
  process.exit(1);
}

// Find a comment line just BEFORE this function (might be optional)
let realStart = startIdx;
const commentMarker = '// Auto-assign an unclaimed tag to a new user';
const commentIdx = content.lastIndexOf(commentMarker, startIdx);
if (commentIdx !== -1 && commentIdx > startIdx - 200) {
  realStart = commentIdx;
}

// Find end: where module.exports starts
const handlerIdx = content.indexOf('module.exports = async function handler', realStart);
if (handlerIdx === -1) {
  console.error('[ERROR] Could not find handler boundary');
  process.exit(1);
}

const newFunc = [
  "// Auto-assign a free eTag to a new user",
  "// IMPORTANT:",
  "//   - Free eTags use TMC-ET prefix to distinguish from physical TMC- stickers",
  "//   - Tags marked with tag_type='etag' are NEVER pulled from physical inventory",
  "//   - Limit: 1 free eTag per user account ever",
  "async function assignFreeTag(userId) {",
  "  try {",
  "    // 1. Check if user already has ANY tag - don't double-assign",
  "    const { data: existingTags } = await supabase",
  "      .from('tags')",
  "      .select('token, tag_type, status')",
  "      .eq('owner_id', userId)",
  "      .neq('status', 'deleted')",
  "      .limit(1);",
  "",
  "    if (existingTags && existingTags.length > 0) {",
  "      console.log('User', userId, 'already has tag', existingTags[0].token, '- skipping free eTag generation');",
  "      return existingTags[0].token;",
  "    }",
  "",
  "    // 2. Generate a fresh eTag with TMC-ET prefix",
  "    //    NOTE: We do NOT pull from unclaimed physical inventory.",
  "    //    Physical tags are reserved for paying users only.",
  "    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';",
  "    let attempt = 0;",
  "    let newToken = null;",
  "",
  "    while (attempt < 5 && !newToken) {",
  "      attempt++;",
  "      let random = '';",
  "      for (let i = 0; i < 5; i++) {",
  "        random += chars[Math.floor(Math.random() * chars.length)];",
  "      }",
  "      const candidate = 'TMC-ET' + random;",
  "",
  "      const { data: existing } = await supabase",
  "        .from('tags')",
  "        .select('token')",
  "        .eq('token', candidate)",
  "        .limit(1);",
  "",
  "      if (!existing || existing.length === 0) {",
  "        newToken = candidate;",
  "      }",
  "    }",
  "",
  "    if (!newToken) {",
  "      console.error('Could not generate unique eTag token after 5 attempts');",
  "      return null;",
  "    }",
  "",
  "    // 3. Insert the new eTag with tag_type='etag' so admin can filter",
  "    const { data: newTag, error } = await supabase",
  "      .from('tags')",
  "      .insert({",
  "        token: newToken,",
  "        status: 'claimed',",
  "        owner_id: userId,",
  "        claimed_at: new Date().toISOString(),",
  "        plan: 'etag',",
  "        tag_type: 'etag',",
  "        vehicle_label: 'My Vehicle'",
  "      })",
  "      .select()",
  "      .single();",
  "",
  "    if (error) {",
  "      console.error('Failed to generate eTag:', error);",
  "      return null;",
  "    }",
  "",
  "    console.log('Generated free eTag', newToken, 'for user', userId);",
  "    return newToken;",
  "",
  "  } catch(e) {",
  "    console.error('Free eTag assignment error:', e);",
  "    return null;",
  "  }",
  "}",
  "",
  ""
].join('\r\n');  // Use CRLF to match the existing file

content = content.substring(0, realStart) + newFunc + content.substring(handlerIdx);

fs.writeFileSync(filePath, content, 'utf8');
console.log('[FIX] Replaced assignFreeTag in verify-otp.js');
console.log('       Uses TMC-ET prefix');
console.log('       Never pulls from physical inventory');
console.log('       Limits to 1 tag per user');
