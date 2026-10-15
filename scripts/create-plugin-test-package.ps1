param(
    [string]$OutputPath = ""
)

$repoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $repoRoot "release\test\example.hello-0.1.0.zip"
} elseif (-not [IO.Path]::IsPathRooted($OutputPath)) {
    $OutputPath = Join-Path $repoRoot $OutputPath
}

$sourceRoot = Join-Path $repoRoot "plugins\examples\hello-plugin"
$stageRoot = Join-Path ([IO.Path]::GetTempPath()) ("notible-plugin-test-" + [guid]::NewGuid().ToString("N"))
$outputDirectory = Split-Path -Parent $OutputPath

try {
    New-Item -ItemType Directory -Force -Path $stageRoot, $outputDirectory | Out-Null
    Copy-Item -LiteralPath (Join-Path $sourceRoot "plugin.json") -Destination $stageRoot
    Copy-Item -LiteralPath (Join-Path $sourceRoot "index.js") -Destination $stageRoot
    Compress-Archive -Path (Join-Path $stageRoot "*") -DestinationPath $OutputPath -CompressionLevel Optimal -Force
    Write-Output (Resolve-Path -LiteralPath $OutputPath)
} finally {
    if (Test-Path -LiteralPath $stageRoot) {
        Remove-Item -LiteralPath $stageRoot -Recurse -Force
    }
}
