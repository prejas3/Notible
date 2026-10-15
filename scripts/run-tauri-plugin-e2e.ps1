param(
    [string]$DataDirectory = "",
    [string]$PackagePath = ""
)

$repoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($DataDirectory)) {
    $DataDirectory = Join-Path ([IO.Path]::GetTempPath()) ("notible-tauri-plugin-e2e-" + [guid]::NewGuid().ToString("N"))
} elseif (-not [IO.Path]::IsPathRooted($DataDirectory)) {
    $DataDirectory = Join-Path $repoRoot $DataDirectory
}
if ([string]::IsNullOrWhiteSpace($PackagePath)) {
    $PackagePath = Join-Path $repoRoot "release\test\example.hello-0.1.0.zip"
} elseif (-not [IO.Path]::IsPathRooted($PackagePath)) {
    $PackagePath = Join-Path $repoRoot $PackagePath
}

New-Item -ItemType Directory -Force -Path $DataDirectory | Out-Null
if (-not (Test-Path -LiteralPath $PackagePath)) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "create-plugin-test-package.ps1") -OutputPath $PackagePath
    if ($LASTEXITCODE -ne 0) { throw "Could not create plugin test package" }
}

$env:NOTIBLE_TEST_APP_DATA_DIR = (Resolve-Path -LiteralPath $DataDirectory).Path
$env:NOTIBLE_TEST_PLUGIN_PACKAGE = (Resolve-Path -LiteralPath $PackagePath).Path

Write-Output "Test data directory: $env:NOTIBLE_TEST_APP_DATA_DIR"
Write-Output "Plugin package: $env:NOTIBLE_TEST_PLUGIN_PACKAGE"
Write-Output "Starting Tauri dev. In Settings > Plugins install the ZIP, restart the app, disable it, then install a newer version to exercise rollback."
Write-Output "The process is intentionally interactive; close it with Ctrl+C when the flow is complete."

Push-Location $repoRoot
try {
    & npm.cmd run tauri dev
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
