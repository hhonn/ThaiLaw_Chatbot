param(
    [string]$BaseUrl = "http://127.0.0.1:8000",
    [int]$SampleCount = 20,
    [int]$Days = 30,
    [int]$Limit = 3000,
    [string]$Group = "real",
    [string]$Topic = "",
    [string]$Domain = "",
    [string]$Risk = ""
)

$ErrorActionPreference = "Stop"

$workspace = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $workspace ".env"

if (-not (Test-Path $envFile)) {
    throw "Missing .env file at $envFile"
}

$adminKey = ""
Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $parts = $line.Split("=", 2)
    if ($parts.Count -eq 2 -and $parts[0].Trim() -eq "ANALYTICS_ADMIN_KEY") {
        $adminKey = $parts[1].Trim()
    }
}

if (-not $adminKey) {
    throw "ANALYTICS_ADMIN_KEY not found in .env"
}

$headers = @{ "x-analytics-key" = $adminKey }

$bootstrapBody = @{
    sample_count = $SampleCount
    days = $Days
    limit = $Limit
    topic = if ($Topic) { $Topic } else { $null }
    domain = if ($Domain) { $Domain } else { $null }
    risk = if ($Risk) { $Risk } else { $null }
} | ConvertTo-Json

$bootstrapRes = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/analytics/bootstrap-training-data" -Headers $headers -ContentType "application/json" -Body $bootstrapBody

$snapshotBody = @{
    days = $Days
    limit = $Limit
    topic = if ($Topic) { $Topic } else { $null }
    domain = if ($Domain) { $Domain } else { $null }
    risk = if ($Risk) { $Risk } else { $null }
    group = $Group
} | ConvertTo-Json

$snapshotRes = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/analytics/export/snapshot" -Headers $headers -ContentType "application/json" -Body $snapshotBody

Write-Output ("Bootstrap created pairs: {0}" -f $bootstrapRes.sample.created_pairs)
Write-Output ("Snapshot folder: {0}" -f $snapshotRes.base_dir)
$snapshotRes.files | ForEach-Object {
    Write-Output ("{0} ({1} rows)" -f $_.name, $_.count)
}
