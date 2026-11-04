# banmo_tag Automated Headless Test Runner
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$scriptDir = $PSScriptRoot
if (-not $scriptDir) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}
if (-not $scriptDir) {
    $scriptDir = Get-Location
}

# 1. Detect Chrome or Edge browser executable
$browserCandidates = @(
    "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "${env:LocalAppData}\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)

$browser = $null
foreach ($path in $browserCandidates) {
    if (Test-Path $path) {
        $browser = $path
        break
    }
}

if (-not $browser) {
    Write-Host "[ERROR] Could not find Google Chrome or Microsoft Edge browser." -ForegroundColor Red
    exit 1
}

$browserName = if ($browser -like "*chrome*") { "Google Chrome" } else { "Microsoft Edge" }
Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  banmo_tag Extension Automated Test Runner" -ForegroundColor Cyan
Write-Host "  Browser Engine: $browserName" -ForegroundColor DarkGray
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

$htmlFile = Join-Path $scriptDir "test-runner.html"
if (-not (Test-Path $htmlFile)) {
    Write-Host "[ERROR] test-runner.html not found in $scriptDir" -ForegroundColor Red
    exit 1
}

$testHtmlUrl = "file:///" + ($htmlFile -replace "\\", "/")
$tempOut = [System.IO.Path]::GetTempFileName()
$tempErr = [System.IO.Path]::GetTempFileName()

try {
    # 2. Run Headless Browser and dump DOM after tests finish
    $process = Start-Process -FilePath $browser `
        -ArgumentList "--headless=new", "--disable-gpu", "--no-sandbox", "--dump-dom", "`"$testHtmlUrl`"" `
        -RedirectStandardOutput $tempOut `
        -RedirectStandardError $tempErr `
        -NoNewWindow -PassThru -Wait

    if (-not (Test-Path $tempOut)) {
        Write-Host "[ERROR] Failed to obtain DOM output from browser." -ForegroundColor Red
        exit 1
    }

    $html = [System.IO.File]::ReadAllText($tempOut, [System.Text.Encoding]::UTF8)

    # 3. Parse JSON Report
    $jsonMatch = [regex]::Match($html, '<script id="test-results-data" type="application/json">([\s\S]*?)</script>')
    if (-not $jsonMatch.Success) {
        Write-Host "[ERROR] Could not extract test report JSON from runner DOM." -ForegroundColor Red
        exit 1
    }

    $report = $jsonMatch.Groups[1].Value | ConvertFrom-Json

    # 4. Display test suites and results
    foreach ($suite in $report.suites) {
        Write-Host "[SUITE] $($suite.name)" -ForegroundColor White
        foreach ($t in $suite.tests) {
            if ($t.passed) {
                Write-Host "   PASS " -ForegroundColor Green -NoNewline
                Write-Host " $($t.name)" -ForegroundColor Gray
            } else {
                Write-Host "   FAIL " -ForegroundColor Red -NoNewline
                Write-Host " $($t.name)" -ForegroundColor Yellow
                if ($t.error) {
                    Write-Host "        $($t.error)" -ForegroundColor Red
                }
            }
        }
        Write-Host ""
    }

    # 5. Output Summary
    Write-Host "----------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host "Test Summary:" -ForegroundColor White
    Write-Host "  - Total Tests : $($report.total)"
    Write-Host "  - Passed      : $($report.passed)" -ForegroundColor Green
    if ($report.failed -gt 0) {
        Write-Host "  - Failed      : $($report.failed)" -ForegroundColor Red
    } else {
        Write-Host "  - Failed      : 0" -ForegroundColor DarkGray
    }
    Write-Host "  - Duration    : $($report.duration)" -ForegroundColor DarkYellow
    Write-Host "----------------------------------------------------------" -ForegroundColor DarkGray

    if ($report.total -eq 0) {
        Write-Host "[WARNING] No test cases detected." -ForegroundColor Yellow
        exit 1
    }

    if ($report.failed -eq 0) {
        Write-Host "SUCCESS: All automated test cases verified successfully! (ALL PASS)" -ForegroundColor Green
        exit 0
    } else {
        Write-Host "FAILURE: Some test cases failed. Please review error details above." -ForegroundColor Red
        exit 1
    }

} finally {
    if (Test-Path $tempOut) {
        Remove-Item -Force $tempOut -ErrorAction SilentlyContinue
    }
    if (Test-Path $tempErr) {
        Remove-Item -Force $tempErr -ErrorAction SilentlyContinue
    }
}
