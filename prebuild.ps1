Write-Host "`n=== TapMyCar iOS Pre-Build Script ===" -ForegroundColor Cyan
Write-Host "Run this every time, right before triggering a Codemagic build.`n"

Set-Location "C:\Users\PRAVEEN CHANDU\Documents\tapmycar"

Write-Host "Step 1: Syncing Capacitor web assets into iOS project..." -ForegroundColor Yellow
npx cap sync ios

Write-Host "`nStep 2: Bumping iOS build number..." -ForegroundColor Yellow
$pbxPath = "ios\App\App.xcodeproj\project.pbxproj"
$content = Get-Content $pbxPath -Raw
$versions = [regex]::Matches($content, "CURRENT_PROJECT_VERSION = (\d+);") | ForEach-Object { [int]$_.Groups[1].Value }
$nextVersion = ($versions | Measure-Object -Maximum).Maximum + 1
$content = [regex]::Replace($content, "CURRENT_PROJECT_VERSION = \d+;", "CURRENT_PROJECT_VERSION = $nextVersion;")
Set-Content -Path $pbxPath -Value $content -NoNewline
Write-Host "Build number bumped to $nextVersion" -ForegroundColor Green

Write-Host "`nStep 3: Checking for anything to commit..." -ForegroundColor Yellow
$status = git status --porcelain
if ([string]::IsNullOrWhiteSpace($status)) {
    Write-Host "Nothing new to commit (only the build number bump will be committed)" -ForegroundColor Gray
}

git add -A
git commit -m "Pre-build sync + bump to build $nextVersion"

Write-Host "`nStep 4: Pushing to GitHub..." -ForegroundColor Yellow
git push

Write-Host "`n=== Done. Build number is $nextVersion. Go start a new Codemagic build now. ===" -ForegroundColor Green
