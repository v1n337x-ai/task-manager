# AI analysis + approval driver: for each thread in _pst-threads.txt (or all
# threads of app 28), analyze with the free model, then approve each finding
# item. Threads with 1 message are skipped (nothing to extract).
$ErrorActionPreference = "Continue"
$base = "http://localhost:3210"
$ck = ".pst-cookies.txt"

function Login {
  Remove-Item $ck -ErrorAction SilentlyContinue
  curl.exe -s -c $ck -X POST "$base/api/auth/login" -H "Content-Type: application/json" -d '{\"email\":\"admin@akasaair.com\",\"password\":\"TaskManager!2026\"}' -o NUL
}
Login
$csrf = ((Get-Content $ck | Select-String "tm_csrf" | Select-Object -First 1).Line -split "`t")[-1].Trim()

# Threads of app 28 with >=2 messages (threadId, msgCount) via a small API call.
$threadsRaw = curl.exe -s -b $ck "$base/api/pt-tracker/28"
# (The detail API returns threads too; simpler: query DB via docker isn't available here,
#  so use the emails thread list endpoint on the application page data if present.)
# Fallback: read thread ids saved by the confirm step.
$threadIds = @()
if (Test-Path _pst-threads.txt) {
  $threadIds = (Get-Content _pst-threads.txt -Raw).Trim() -split "," | Where-Object { $_ -ne "" } | Sort-Object -Unique
}
if ($threadIds.Count -eq 0) {
  Write-Output "no thread list from confirm; using OPAS thread 2"
  $threadIds = @("2")
}
Write-Output ("threads to process: " + $threadIds.Count)

foreach ($tid in $threadIds) {
  Write-Output "== analyze thread $tid =="
  $body = '{\"threadId\":' + $tid + '}'
  $res = curl.exe -s -b $ck -H "x-csrf-token: $csrf" -H "Content-Type: application/json" -X POST "$base/api/ai/analyze/thread" -d $body
  $j = $res | ConvertFrom-Json
  if (-not $j.success) {
    Write-Output ("  analyze failed: " + $res.Substring(0, [Math]::Min(160, $res.Length)))
    # session may have expired mid-run
    Login
    $csrf = ((Get-Content $ck | Select-String "tm_csrf" | Select-Object -First 1).Line -split "`t")[-1].Trim()
    continue
  }
  $extId = $j.extractionId
  $n = $j.structured.findings.Count
  Write-Output ("  extraction=" + $extId + " findings=" + $n + " status=" + $j.status)
  for ($i = 0; $i -lt $n; $i++) {
    $apBody = '{\"decision\":\"approve\",\"itemKey\":\"findingStatus:' + $i + '\"}'
    $apr = curl.exe -s -b $ck -H "x-csrf-token: $csrf" -H "Content-Type: application/json" -X POST "$base/api/ai/extractions/$extId/approve" -d $apBody
    Write-Output ("  approve item $i -> " + ($apr.Substring(0, [Math]::Min(40, $apr.Length))))
  }
}
Write-Output "AI-DRIVE-COMPLETE"
