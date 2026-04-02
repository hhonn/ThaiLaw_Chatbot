param(
    [string]$TaskName = "ThaiLawBot-DailyAnalytics",
    [string]$RunTime = "02:00",
    [string]$BaseUrl = "http://127.0.0.1:8000"
)

$ErrorActionPreference = "Stop"

$workspace = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $PSScriptRoot "run_daily_bootstrap.ps1"

if (-not (Test-Path $runner)) {
    throw "Runner script not found: $runner"
}

$command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$runner`" -BaseUrl `"$BaseUrl`""

schtasks /Create /TN $TaskName /TR $command /SC DAILY /ST $RunTime /F | Out-Null

Write-Output "Created task: $TaskName"
Write-Output "Schedule: daily at $RunTime"
Write-Output "Runner: $runner"
