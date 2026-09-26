[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$bridgeRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $bridgeRoot ".venv\Scripts\python.exe"
$environmentPath = Join-Path $bridgeRoot ".env"

if (-not (Test-Path -LiteralPath $pythonPath -PathType Leaf)) {
    throw "MT5 bridge virtual environment not found at $pythonPath. Install requirements first."
}

if (-not (Test-Path -LiteralPath $environmentPath -PathType Leaf)) {
    throw "MT5 bridge environment file not found at $environmentPath. Copy .env.example to .env and configure it locally."
}

Set-Location -LiteralPath $bridgeRoot
& $pythonPath -m mt5_bridge
exit $LASTEXITCODE
