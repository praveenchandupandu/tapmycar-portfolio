// Push register.html content to bottom of screen by ensuring the
// button wrapper has margin-top:auto inside a min-height:100dvh
// flex container. Button + Sign in link + footer cluster will sit
// at the bottom of visible screen (like signin page does).

const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
let totalFixes = 0;

const registerPath = path.join(ROOT, 'public', 'register.html');
if (!fs.existsSync(registerPath)) {
  console.error('public/register.html not found');
  process.exit(1);
}
let content = fs.readFileSync(registerPath, 'utf8');
let changed = false;

// Check .page-inner has min-height:100dvh
const oldPageInner1 = '.page-inner{display:flex;flex-direction:column;padding-bottom:32px;}';
const oldPageInner2 = '.page-inner{display:flex;flex-direction:column;min-height:calc(100vh - 12px);}';
const oldPageInner3 = '.page-inner{display:flex;flex-direction:column;min-height:auto;padding-bottom:32px;}';
const newPageInner = '.page-inner{display:flex;flex-direction:column;min-height:calc(100dvh - 12px);}';

if (content.includes(oldPageInner1)) {
  content = content.replace(oldPageInner1, newPageInner);
  console.log('[FIX] .page-inner :: added min-height:100dvh');
  changed = true;
  totalFixes++;
} else if (content.includes(oldPageInner2)) {
  content = content.replace(oldPageInner2, newPageInner);
  console.log('[FIX] .page-inner :: vh → dvh');
  changed = true;
  totalFixes++;
} else if (content.includes(oldPageInner3)) {
  content = content.replace(oldPageInner3, newPageInner);
  console.log('[FIX] .page-inner :: replaced min-height:auto with 100dvh');
  changed = true;
  totalFixes++;
} else if (content.includes('min-height:calc(100dvh - 12px)')) {
  console.log('[OK] .page-inner already uses 100dvh');
}

// Ensure button wrapper uses margin-top:auto (step1 - Send verification button)
const step1Variants = [
  { from: '<div style="margin-top:32px">\n    <button class="btn" onclick="sendOTP()">Send verification code', to: '<div style="margin-top:auto">\n    <button class="btn" onclick="sendOTP()">Send verification code' },
  { from: '<div style="margin-top:24px">\n    <button class="btn" onclick="sendOTP()">Send verification code', to: '<div style="margin-top:auto">\n    <button class="btn" onclick="sendOTP()">Send verification code' },
  { from: '<div style="margin-top:16px">\n    <button class="btn" onclick="sendOTP()">Send verification code', to: '<div style="margin-top:auto">\n    <button class="btn" onclick="sendOTP()">Send verification code' }
];
for (const v of step1Variants) {
  if (content.includes(v.from)) {
    content = content.replace(v.from, v.to);
    console.log('[FIX] step1 button wrapper → margin-top:auto');
    changed = true;
    totalFixes++;
    break;
  }
}

// Same for step2 verifyOTP button
const step2Variants = [
  { from: '<div style="margin-top:32px">\n    <button class="btn" onclick="verifyOTP()"', to: '<div style="margin-top:auto">\n    <button class="btn" onclick="verifyOTP()"' },
  { from: '<div style="margin-top:24px">\n    <button class="btn" onclick="verifyOTP()"', to: '<div style="margin-top:auto">\n    <button class="btn" onclick="verifyOTP()"' },
  { from: '<div style="margin-top:16px">\n    <button class="btn" onclick="verifyOTP()"', to: '<div style="margin-top:auto">\n    <button class="btn" onclick="verifyOTP()"' }
];
for (const v of step2Variants) {
  if (content.includes(v.from)) {
    content = content.replace(v.from, v.to);
    console.log('[FIX] step2 button wrapper → margin-top:auto');
    changed = true;
    totalFixes++;
    break;
  }
}

if (changed) {
  fs.writeFileSync(registerPath, content, 'utf8');
  const rootCopy = path.join(ROOT, 'register.html');
  if (fs.existsSync(rootCopy)) fs.copyFileSync(registerPath, rootCopy);
  console.log('[SYNC] public/register.html -> register.html');
}

console.log('');
console.log('═'.repeat(50));
console.log(`Total fixes: ${totalFixes}`);
console.log('═'.repeat(50));

if (totalFixes === 0) {
  console.log('[WARN] No changes applied. Current state might differ. Checking...');
  console.log('Run this to see current state:');
  console.log('  Select-String -Path "public\\register.html" -Pattern "margin-top|page-inner"');
}

console.log('');
console.log('Commit and push:');
console.log('  git add -A');
console.log('  git commit -m "Register: push content to bottom with margin-top:auto + dvh"');
console.log('  git push');
