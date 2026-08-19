#Requires -Version 5.1
<#
.SYNOPSIS
  Installs OpenCode Desktop (fork by Alltomatos) on Windows.

.DESCRIPTION
  Downloads the latest release installer from GitHub and runs it silently.

.EXAMPLE
  irm https://raw.githubusercontent.com/alltomatos/opencode/prod/install.ps1 | iex
#>

$ErrorActionPreference = "Stop"

$repo = "alltomatos/opencode"
$assetName = "opencode-desktop-win-x64.exe"

Write-Host "OpenCode Desktop installer (fork by Alltomatos)" -ForegroundColor Cyan

$release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" -Headers @{ "User-Agent" = "opencode-installer" }
$asset = $release.assets | Where-Object { $_.name -eq $assetName } | Select-Object -First 1

if (-not $asset) {
    throw "Could not find $assetName in the latest release of $repo."
}

$version = $release.tag_name
Write-Host "Latest version: $version" -ForegroundColor Green

$installerPath = Join-Path $env:TEMP $assetName
Write-Host "Downloading installer..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $installerPath -UseBasicParsing

Write-Host "Running installer..."
Start-Process -FilePath $installerPath -Wait

Remove-Item $installerPath -Force -ErrorAction SilentlyContinue

Write-Host "Done. OpenCode Desktop $version installed." -ForegroundColor Green
