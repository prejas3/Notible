param([switch]$Quick)

$ErrorActionPreference = "Stop"
$log = Join-Path $env:TEMP "notible-demo-last.log"
try {
  $repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
  $demoArgs = @("run", "demo", "--")
  if ($Quick) { $demoArgs += "--skip-build" }
  $demoArgs += @("--name", "demo")

  Set-Location -LiteralPath $repo
  $mode = if ($Quick) { "quick (existing debug build)" } else { "full (fresh debug build)" }
  Write-Host "Notible Demo - $mode" -ForegroundColor Cyan
  Write-Host "Workspace: $repo"
  Write-Host "Output log: $log"
  Write-Host ""

  if (-not $Quick) {
    Write-Host "Stopping disposable Notible sandboxes before the fresh build..."
    & node.exe (Join-Path $repo "scripts\cdp\sandbox.cjs") stop-all
    if ($LASTEXITCODE -ne 0) { throw "sandbox stop-all failed with exit code $LASTEXITCODE" }
  }

  # Windows PowerShell turns native stderr into error records. The demo runner
  # intentionally probes for an old sandbox, so do not let that probe stop the
  # pipeline before its own catch can handle the clean first-run case.
  $ErrorActionPreference = "Continue"
  & npm.cmd @demoArgs 2>&1 | Tee-Object -FilePath $log
  $exitCode = $LASTEXITCODE
  Write-Host ""
  if ($exitCode -eq 0) {
    Write-Host "Demo finished successfully. This window stays open for review." -ForegroundColor Green
  } else {
    Write-Host "Demo failed with exit code $exitCode. Review the FAIL line(s) above." -ForegroundColor Red
  }
} catch {
  $exitCode = 1
  $message = "Launcher failed: $($_.Exception.Message)"
  Write-Host $message -ForegroundColor Red
  Set-Content -LiteralPath $log -Value $message
}
$host.UI.RawUI.WindowTitle = "Notible Demo - exit $exitCode"
