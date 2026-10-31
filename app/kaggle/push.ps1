# Starts (or checks) the inference server on both Kaggle accounts.
#   .\app\kaggle\push.ps1          start notebook 09 on both accounts (background "Save & Run All")
#   .\app\kaggle\push.ps1 status   show Kaggle run status and whether each public URL answers
# Needs: kaggle.json (repo root, token1/token2) and app/kaggle/accounts.local.json (copy of accounts.example.json).
param([string]$Action = "start", [double]$Hours = 0) # -Hours 1 for a short test run (default: run_hours in accounts.local.json, else 11.5)
$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\..\.."
$tokens = Get-Content "$root\kaggle.json" -Raw | ConvertFrom-Json
$cfgPath = "$PSScriptRoot\accounts.local.json"
if (-not (Test-Path $cfgPath)) { throw "Missing $cfgPath. Copy accounts.example.json to accounts.local.json and fill it in." }
$cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
$runHours = if ($Hours -gt 0) { $Hours } elseif ($cfg.run_hours) { [double]$cfg.run_hours } else { 11.5 }

function Invoke-Kaggle([string]$token, [string[]]$kaggleArgs) {
  $env:KAGGLE_API_TOKEN = $token
  $ErrorActionPreference = "Continue" # kaggle writes "not found" to stderr; that is an answer, not a crash
  try {
    $out = & kaggle @kaggleArgs 2>&1 | Where-Object { "$_" -notmatch "outdated" }
    return ($out | ForEach-Object { "$_" })
  } finally { Remove-Item Env:KAGGLE_API_TOKEN -ErrorAction SilentlyContinue }
}

function Test-Url([string]$domain) {
  try {
    $r = Invoke-RestMethod "https://$domain/health" -Headers @{ "ngrok-skip-browser-warning" = "1" } -TimeoutSec 8
    return "online, models: " + ($r.models -join ", ")
  } catch { return "offline" }
}

foreach ($a in $cfg.accounts) {
  # kaggle_token is either a key name in kaggle.json ("token1") or the key itself ("KGAT_...")
  $token = if ("$($a.kaggle_token)" -like "KGAT_*") { $a.kaggle_token } else { $tokens.($a.kaggle_token) }
  if (-not $token) { throw "No Kaggle API token for account $($a.shard): set kaggle_token to token1/token2 or the KGAT_ key" }
  $user = $a.username
  $kernel = "$user/selfrefine-09-inference-server"
  Write-Host "`n=== Account $($a.shard): $user ($( if ($a.shard -eq 'a') { '4B models' } else { '2B models' } ))" -ForegroundColor Cyan

  if ($Action -eq "status") {
    Invoke-Kaggle $token @("kernels", "status", $kernel) | Write-Host
    Write-Host "Public URL https://$($a.ngrok_domain): $(Test-Url $a.ngrok_domain)"
    continue
  }

  if (-not $a.ngrok_authtoken -or -not $a.ngrok_domain) { throw "Fill ngrok_authtoken and ngrok_domain for account $($a.shard) in accounts.local.json" }

  # 1. Private dataset with this account's settings (read by the notebook's settings cell)
  $dir = Join-Path $env:TEMP "selfrefine-config-$($a.shard)"
  New-Item -ItemType Directory -Force $dir | Out-Null
  $server = [ordered]@{ APP_API_KEY = $cfg.app_api_key; NGROK_AUTHTOKEN = $a.ngrok_authtoken; NGROK_DOMAIN = $a.ngrok_domain; SHARD = $a.shard; MODE = $cfg.mode; RUN_HOURS = $runHours }
  [IO.File]::WriteAllText("$dir\server_config.json", ($server | ConvertTo-Json))
  $meta = [ordered]@{ title = "selfrefine-server-config"; id = "$user/selfrefine-server-config"; licenses = @(@{ name = "other" }) }
  [IO.File]::WriteAllText("$dir\dataset-metadata.json", ($meta | ConvertTo-Json -Depth 3))
  $exists = (Invoke-Kaggle $token @("datasets", "status", "$user/selfrefine-server-config")) -match "ready"
  if ($exists) { Invoke-Kaggle $token @("datasets", "version", "-p", $dir, "-m", "update settings") | Select-Object -Last 1 | Write-Host }
  else { Invoke-Kaggle $token @("datasets", "create", "-p", $dir) | Select-Object -Last 1 | Write-Host }
  Remove-Item -Recurse -Force $dir # the folder holds the tokens, don't leave it in TEMP
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep 5
    if ((Invoke-Kaggle $token @("datasets", "status", "$user/selfrefine-server-config")) -match "ready") { break }
  }

  # 2. Push notebook 09 as a private GPU notebook and start a background run
  $kdir = Join-Path $env:TEMP "selfrefine-kernel-$($a.shard)"
  New-Item -ItemType Directory -Force $kdir | Out-Null
  Copy-Item "$root\notebooks\09_inference_server.ipynb" "$kdir\09_inference_server.ipynb"
  $kmeta = [ordered]@{
    id = $kernel; title = "selfrefine-09-inference-server"; code_file = "09_inference_server.ipynb"
    language = "python"; kernel_type = "notebook"; is_private = $true
    enable_gpu = $true; enable_internet = $true; machine_shape = "NvidiaTeslaT4"
    dataset_sources = @("$user/selfrefine-adapters", "$user/selfrefine-server-config")
    competition_sources = @(); kernel_sources = @()
  }
  [IO.File]::WriteAllText("$kdir\kernel-metadata.json", ($kmeta | ConvertTo-Json -Depth 3))
  Invoke-Kaggle $token @("kernels", "push", "-p", $kdir) | Write-Host
  Write-Host "Logs: https://www.kaggle.com/code/$kernel (log in as $user)"
}

if ($Action -ne "status") {
  Write-Host "`nBoth runs started (they stop by themselves after $runHours h). Ready in about 10 to 15 minutes. Check with: .\app\kaggle\push.ps1 status" -ForegroundColor Green
}
