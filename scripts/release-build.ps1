# Builds and signs the current Notible release (Core + builtin plugins,
# src-tauri/tauri.conf.json — the default Tauri config).
#
# Produces exactly 6 files in release/<version>/updater/:
#   Notible_<version>_x64-setup.exe(.sig), Notible_<version>_x64_en-US.msi(.sig),
#   latest.json, SHA256SUMS
#
# Requires a signing key pair at C:\Users\<you>\.notible\notible.key(.pub).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release-build.ps1

$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$version = (Get-Content -Raw (Join-Path $projectRoot 'package.json') | ConvertFrom-Json).version

Set-Location -LiteralPath $projectRoot

$targetDir = if ($env:NOTIBLE_RELEASE_TARGET_DIR) {
  [IO.Path]::GetFullPath($env:NOTIBLE_RELEASE_TARGET_DIR)
} else {
  Join-Path $projectRoot 'src-tauri\target'
}

# Tauri renames Cargo's executable to mainBinaryName before bundling. Windows
# cannot replace that destination while a copy launched from target is running.
# Check before compilation and the signing-password prompt; never kill the app
# automatically, since it may have unsaved notes. Installed copies elsewhere
# do not block this rename and must not be included.
$tauriConfig = Get-Content -Raw (Join-Path $projectRoot 'src-tauri\tauri.conf.json') | ConvertFrom-Json
$releaseExecutables = @(
  [IO.Path]::GetFullPath((Join-Path $targetDir 'release\notible.exe'))
  [IO.Path]::GetFullPath((Join-Path $targetDir "release\$($tauriConfig.mainBinaryName).exe"))
)
$blockingApps = @(Get-Process | Where-Object {
  $processPath = $_.Path
  $processPath -and $releaseExecutables -contains $processPath
})
if ($blockingApps.Count -gt 0) {
  $blockingDetails = ($blockingApps | ForEach-Object { "$($_.ProcessName) (PID $($_.Id)): $($_.Path)" }) -join '; '
  throw "Release binary is in use: $blockingDetails. Save your notes and fully quit this app (including the system tray), then run this script again."
}

& npm.cmd run release:check:published
if ($LASTEXITCODE -ne 0) { throw "Published-version check failed with exit code $LASTEXITCODE" }
# mcp-server/runtime/node.exe is git-ignored; the bundle needs it (hash-pinned download).
& npm.cmd run setup:node-runtime
if ($LASTEXITCODE -ne 0) { throw "Node runtime setup failed with exit code $LASTEXITCODE" }
$nsisArtifact = Join-Path $targetDir "release\bundle\nsis\Notible_${version}_x64-setup.exe"
$msiArtifact = Join-Path $targetDir "release\bundle\msi\Notible_${version}_x64_en-US.msi"

$signingDir = Join-Path $env:USERPROFILE '.notible'
$privateKeyPath = Join-Path $signingDir 'notible.key'
$publicKeyPath = Join-Path $signingDir 'notible.key.pub'
if (-not (Test-Path -LiteralPath $privateKeyPath)) { throw "Private signing key not found: $privateKeyPath" }
if (-not (Test-Path -LiteralPath $publicKeyPath)) { throw "Public signing key not found: $publicKeyPath" }

$env:CARGO_TARGET_DIR = $targetDir
$env:TAURI_SIGNING_PRIVATE_KEY = $privateKeyPath
$env:VITE_NOTIBLE_UPDATER_ENABLED = 'true'
$releasePassword = Read-Host 'Tauri signing key password' -AsSecureString
$releasePasswordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($releasePassword)
try {
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($releasePasswordPtr)
  & npm.cmd run tauri:build -- --bundles nsis,msi
  if ($LASTEXITCODE -ne 0) { throw "Tauri build failed with exit code $LASTEXITCODE" }
  if (-not (Test-Path -LiteralPath "$nsisArtifact.sig")) { throw "NSIS signature was not created: $nsisArtifact.sig" }
  if (-not (Test-Path -LiteralPath "$msiArtifact.sig")) { throw "MSI signature was not created: $msiArtifact.sig" }
  # RELEASE-SAFETY (Hive #15): an exe built with debug-assertions (e.g. via RUSTFLAGS) exposes debug-only commands.
  & node.exe scripts/debug-build-marker.cjs --release (Join-Path $targetDir "release\$($tauriConfig.mainBinaryName).exe")
  if ($LASTEXITCODE -ne 0) { throw "The release exe was built with debug-assertions; rebuild without them (check RUSTFLAGS)." }
  & npm.cmd run release:updater-package -- --artifact $nsisArtifact --url "https://updates.szymonjankiewicz.com/Notible_${version}_x64-setup.exe" --extra-artifact $msiArtifact
  if ($LASTEXITCODE -ne 0) { throw "Updater package preparation failed with exit code $LASTEXITCODE" }
  & npm.cmd run release:validate-package
  if ($LASTEXITCODE -ne 0) { throw "Updater package validation failed with exit code $LASTEXITCODE" }
  Write-Host "Release $version is ready in release\$version\updater." -ForegroundColor Green
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($releasePasswordPtr)
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
}
