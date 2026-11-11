# banmo_tag Extension Build & Package Script (ASCII-only for PowerShell 5.1 compatibility)
# Layout: extension/ (runtime files) - tests/ (test runner) - docs/ (CHANGELOG etc.) - dist/ (build output, git-ignored)
$ErrorActionPreference = "Stop"

$scriptDir = $PSScriptRoot
if (-not $scriptDir) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}
$rootDir = Split-Path -Parent $scriptDir

$extDir = Join-Path $rootDir "extension"
$testRunner = Join-Path $rootDir "tests\run-tests.ps1"
$changelogPath = Join-Path $rootDir "docs\CHANGELOG.md"
$distDir = Join-Path $rootDir "dist"

Write-Host "[0/3] Verifying version consistency between manifest.json and CHANGELOG.md..." -ForegroundColor Cyan
$manifestJson = Get-Content -Path (Join-Path $extDir "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$changelogText = Get-Content -Path $changelogPath -Raw -Encoding UTF8
$verMatch = [regex]::Match($changelogText, '## \[v([0-9]+\.[0-9]+\.[0-9]+)\]')
if (-not $verMatch.Success -or $verMatch.Groups[1].Value -ne $manifestJson.version) {
    Write-Host "[ERROR] Version mismatch! manifest.json=$($manifestJson.version), CHANGELOG.md=$($verMatch.Groups[1].Value)" -ForegroundColor Red
    exit 1
}
Write-Host "  Verified version v$($manifestJson.version)" -ForegroundColor Green

# Static checks (same as CI) when Node.js is available, so problems are found before push
Write-Host "[1/3] Static checks (scripts/validate.js, ESLint)..." -ForegroundColor Cyan
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "  [SKIP] Node.js not found. Install Node.js to run the same static checks as CI." -ForegroundColor Yellow
} else {
    & node (Join-Path $rootDir "scripts\validate.js")
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Build aborted because static checks failed." -ForegroundColor Red
        exit 1
    }
    $eslintBin = Join-Path $rootDir "node_modules\eslint\bin\eslint.js"
    if (Test-Path $eslintBin) {
        Push-Location $rootDir
        try {
            & node $eslintBin .
            $lintExit = $LASTEXITCODE
        } finally {
            Pop-Location
        }
        if ($lintExit -ne 0) {
            Write-Host "[ERROR] Build aborted because ESLint found problems." -ForegroundColor Red
            exit 1
        }
        Write-Host "  ESLint passed" -ForegroundColor Green
    } else {
        Write-Host "  [SKIP] ESLint not installed. Run 'npm ci' once to enable it." -ForegroundColor Yellow
    }
}

Write-Host "[2/3] Running automated unit tests..." -ForegroundColor Cyan
& powershell -ExecutionPolicy Bypass -File $testRunner
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Build aborted because unit tests failed." -ForegroundColor Red
    exit 1
}

Write-Host "[3/3] Packaging runtime extension files..." -ForegroundColor Cyan
# Same code for both browsers; only manifest.json differs.
#   Chrome : extension/manifest.json (background.service_worker only; Chrome MV3 rejects background.scripts)
#   Firefox: dist/firefox/ built by scripts/build-firefox.js (extension/manifest.json + extension/manifest.firefox.json)
$runtimeItems = @(
    "manifest.json",
    "shared.js",
    "content.js",
    "background.js",
    "popup.html",
    "popup.js",
    "popup",
    "theme.js",
    "styles.css",
    "icons"
)

foreach ($item in $runtimeItems) {
    $p = Join-Path $extDir $item
    if (-not (Test-Path $p)) {
        Write-Host "[ERROR] Missing required runtime item: $p" -ForegroundColor Red
        exit 1
    }
}

if (-not (Test-Path $distDir)) {
    New-Item -ItemType Directory -Path $distDir | Out-Null
}

# Build a zip with forward-slash entry names ("icons/icon16.png").
# Compress-Archive on Windows PowerShell 5.1 writes backslashes ("icons\icon16.png"),
# which other tools and the Chrome Web Store may not treat as folders.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
function New-ExtensionZip([string]$sourceDir, [string]$zipPath) {
    if (Test-Path $zipPath) {
        Remove-Item -Force $zipPath
    }
    $srcFull = (Resolve-Path $sourceDir).Path.TrimEnd('\')
    $zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($item in $runtimeItems) {
            $p = Join-Path $srcFull $item
            if (Test-Path $p -PathType Container) {
                $files = Get-ChildItem -Path $p -Recurse -File | Sort-Object FullName
            } else {
                $files = @(Get-Item $p)
            }
            foreach ($f in $files) {
                $entryName = $f.FullName.Substring($srcFull.Length + 1).Replace('\', '/')
                [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
            }
        }
    } finally {
        $zip.Dispose()
    }
}

$version = $manifestJson.version
$chromeZip = Join-Path $distDir "banmo_tag-v$version-chrome.zip"
New-ExtensionZip $extDir $chromeZip
Write-Host "SUCCESS: Chrome  -> dist/banmo_tag-v$version-chrome.zip" -ForegroundColor Green

if (-not $node) {
    Write-Host "[ERROR] Node.js is required to build the Firefox package (scripts/build-firefox.js)." -ForegroundColor Red
    exit 1
}
& node (Join-Path $rootDir "scripts/build-firefox.js") | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Failed to build dist/firefox." -ForegroundColor Red
    exit 1
}
$firefoxZip = Join-Path $distDir "banmo_tag-v$version-firefox.zip"
New-ExtensionZip (Join-Path $distDir "firefox") $firefoxZip
Write-Host "SUCCESS: Firefox -> dist/banmo_tag-v$version-firefox.zip" -ForegroundColor Green
exit 0
