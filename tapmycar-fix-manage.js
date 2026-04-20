// Fix manage.html so that the user's current plan is hidden from "Available Plans"
// and only shows genuine upgrade options
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();

const filePath = path.join(ROOT, 'public', 'manage.html');
if (!fs.existsSync(filePath)) {
  console.log('manage.html not found');
  process.exit(1);
}
let content = fs.readFileSync(filePath, 'utf8');

const oldBlock = `    if (userPlan === 'standard') {
      document.getElementById('btn-standard').textContent = 'Current Plan';
      document.getElementById('btn-standard').disabled = true;
      document.getElementById('btn-standard').style.opacity = '0.5';
      document.getElementById('upgraded-section').style.display = 'block';
      document.getElementById('upgraded-plan-name').textContent = 'Standard';
      document.getElementById('another-tag-msg').textContent = 'Want to protect more vehicles? Upgrade to Premium for up to 3 cars.';
    } else if (userPlan === 'premium') {
      document.getElementById('btn-standard').textContent = 'Downgrade';
      document.getElementById('btn-premium').textContent = 'Current Plan';
      document.getElementById('btn-premium').disabled = true;
      document.getElementById('btn-premium').style.opacity = '0.5';
      document.getElementById('upgraded-section').style.display = 'block';
      document.getElementById('upgraded-plan-name').textContent = 'Premium';
      document.getElementById('another-tag-msg').textContent = 'You can protect up to 3 vehicles. Scan a new tag to add another car.';
    }`;

const newBlock = `    // Hide the user's current plan from "Available Plans" so only upgrades are shown
    if (userPlan === 'standard') {
      // On Standard → hide Standard card, show Premium as upgrade
      document.getElementById('plan-standard').style.display = 'none';
      document.getElementById('upgraded-section').style.display = 'block';
      document.getElementById('upgraded-plan-name').textContent = 'Standard';
      document.getElementById('another-tag-msg').textContent = 'Upgrade to Premium to protect up to 3 vehicles in your family.';
    } else if (userPlan === 'premium') {
      // On Premium → hide both (you're at the top)
      document.getElementById('plan-standard').style.display = 'none';
      document.getElementById('plan-premium').style.display = 'none';
      document.getElementById('upgraded-section').style.display = 'block';
      document.getElementById('upgraded-plan-name').textContent = 'Premium';
      document.getElementById('another-tag-msg').textContent = 'You can protect up to 3 vehicles. Share Premium codes with family.';
      // Also hide the "Available Plans" heading since nothing is available
      const avHeading = document.querySelector('[data-available-plans-heading]');
      if (avHeading) avHeading.style.display = 'none';
    }
    // Free plan users (etag) see both cards unchanged — they can upgrade to either`;

if (content.includes(oldBlock)) {
  content = content.replace(oldBlock, newBlock);
  console.log('[FIX] manage.html :: hide current plan from Available Plans');
} else if (content.includes("document.getElementById('plan-standard').style.display = 'none';")) {
  console.log('[OK]  manage.html :: already patched');
} else {
  console.log('[WARN] manage.html :: pattern not found, manual review needed');
}

// Also tag the Available Plans heading so we can hide it for Premium users
const oldHeading = `<div style="font-size:14px;font-weight:700;color:var(--bk);margin-bottom:10px">Available Plans</div>`;
const newHeading = `<div data-available-plans-heading style="font-size:14px;font-weight:700;color:var(--bk);margin-bottom:10px">Available Plans</div>`;
if (content.includes(oldHeading)) {
  content = content.replace(oldHeading, newHeading);
  console.log('[FIX] manage.html :: tagged Available Plans heading');
}

fs.writeFileSync(filePath, content, 'utf8');

// Sync to root
const rootPath = path.join(ROOT, 'manage.html');
fs.copyFileSync(filePath, rootPath);
console.log('[SYNC] public/manage.html → manage.html');

console.log('\nDone. Run: git add -A && git commit -m "Fix manage.html current-plan display" && git push');
