// Patch generate-tokens.js to mark batch tags as tag_type='physical'

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

const filePath = path.join(ROOT, 'api', 'generate-tokens.js');
if (!fs.existsSync(filePath)) {
  console.error('api/generate-tokens.js not found');
  process.exit(1);
}
let content = fs.readFileSync(filePath, 'utf8');

if (content.indexOf("tag_type: 'physical'") !== -1) {
  console.log('[OK] generate-tokens.js already marks physical tags');
  process.exit(0);
}

// Use regex that handles any whitespace/line endings
const insertPattern = /\.insert\(\{\s*token,\s*status:\s*'unclaimed',\s*batch_number:\s*batch_number\s*\|\|\s*null\s*\}\)/;

if (!insertPattern.test(content)) {
  console.error('[ERROR] Could not find insert pattern in generate-tokens.js');
  console.error('Current file content around insert:');
  const insertIdx = content.indexOf('.insert');
  if (insertIdx !== -1) {
    console.error(content.substring(insertIdx, insertIdx + 200));
  }
  process.exit(1);
}

const newInsert = ".insert({\r\n        token,\r\n        status: 'unclaimed',\r\n        batch_number: batch_number || null,\r\n        tag_type: 'physical'\r\n      })";

content = content.replace(insertPattern, newInsert);

fs.writeFileSync(filePath, content, 'utf8');
console.log('[FIX] Added tag_type physical to generate-tokens.js');
