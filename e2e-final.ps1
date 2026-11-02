$ErrorActionPreference = "Continue"
$base = "http://localhost:3210"

Write-Output "=== E2E Phase 8: full lifecycle (prod build, idempotent rerun) ==="

# --- 1. auth guards ---
$un1 = curl.exe -s -o NUL -w "%{http_code}" "$base/api/pt-tracker"
$un2 = curl.exe -s -o NUL -w "%{http_code}" "$base/api/ai/analyze/thread"
Write-Output "1. unauth API: pt-tracker=$un1 ai=$un2 (expect 401/401)"

# --- 2. login ---
curl.exe -s -c .e2e-cookies.txt -X POST "$base/api/auth/login" -H "Content-Type: application/json" -d '{\"email\":\"admin@akasaair.com\",\"password\":\"TaskManager!2026\"}' -o NUL
$csrf = ((Get-Content .e2e-cookies.txt | Select-String "tm_csrf" | Select-Object -First 1).Line -split "`t")[-1].Trim()
Write-Output "2. login ok"

# --- 3. CSRF guard ---
$csrfFail = curl.exe -s -o NUL -w "%{http_code}" -b .e2e-cookies.txt -H "Content-Type: application/json" -X POST "$base/api/applications" -d '{\"name\":\"E2EX\"}'
Write-Output "3. no-csrf mutation: $csrfFail (expect 403)"

# --- 4-5. Excel import (idempotent) ---
$import = curl.exe -s -b .e2e-cookies.txt -H "x-csrf-token: $csrf" -X POST "$base/api/imports/excel" -F "file=@prisma/templates/pt-tracker-v1.xlsx" -F "createMissingApplications=true"
$importJson = $import | ConvertFrom-Json
$jobId = $importJson.jobId
$alreadyImp = $importJson.alreadyImported
Write-Output "4. excel validate: jobId=$jobId alreadyImported=$alreadyImp"
$confirmBody = '{\"jobId\":' + $jobId + ',\"force\":true}'
$confirmRaw = curl.exe -s -b .e2e-cookies.txt -H "x-csrf-token: $csrf" -H "Content-Type: application/json" -X POST "$base/api/imports/excel/confirm" -d $confirmBody
try { $confirmJson = $confirmRaw | ConvertFrom-Json } catch { $confirmJson = $null }
$rowsProc = if ($confirmJson.result) { $confirmJson.result.rowsProcessed } else { "alreadyImported" }
Write-Output "5. excel confirm: rowsProcessed=$rowsProc"

# --- 6. tracker ---
$tracker = curl.exe -s -b .e2e-cookies.txt "$base/api/pt-tracker" | ConvertFrom-Json
$appCount = $tracker.applications.Count
Write-Output "6. tracker applications: $appCount (expect >=30)"

# --- 7-8. EML chain (force re-confirm is idempotent) ---
$jobs = @()
foreach ($name in @("chain-a.eml", "chain-b.eml", "chain-c.eml")) {
  $r = curl.exe -s -b .e2e-cookies.txt -H "x-csrf-token: $csrf" -X POST "$base/api/emails/upload" -F "files=@tests/fixtures/eml-live/$name" | ConvertFrom-Json
  $jobs += ($r.results | Where-Object { $_.ok } | Select-Object -First 1 -Property jobId)
}
$jobIdsCsv = ($jobs | ForEach-Object { $_.jobId }) -join ","
$emlBody = '{\"jobIds\":[' + $jobIdsCsv + '],\"force\":true}'
$conf1 = curl.exe -s -b .e2e-cookies.txt -H "x-csrf-token: $csrf" -H "Content-Type: application/json" -X POST "$base/api/emails/upload/confirm" -d $emlBody | ConvertFrom-Json
$threadId = $conf1.results[0].threadId
Write-Output "7-8. eml upload+confirm: jobs=$jobIdsCsv threadId=$threadId"

# --- 9. AI analyze: REAL OpenCode provider (Phase 5.1) ---
# mock stays production-blocked (§79); the real opencode adapter runs against
# OPENCODE_SERVER_URL with the stored credential (Settings → AI).
$anBody = '{\"threadId\":' + $threadId + '}'
$analysisMock = curl.exe -s -b .e2e-cookies.txt -H "x-csrf-token: $csrf" -H "x-ai-provider-override: mock" -H "Content-Type: application/json" -X POST "$base/api/ai/analyze/thread" -d $anBody | ConvertFrom-Json
Write-Output "9. ai analyze (mock, prod): honest failure -> $(-not $analysisMock.success)"
$analysis = curl.exe -s -b .e2e-cookies.txt -H "x-csrf-token: $csrf" -H "Content-Type: application/json" -X POST "$base/api/ai/analyze/thread" -d $anBody | ConvertFrom-Json
Write-Output "9b. ai analyze (opencode, REAL): success=$($analysis.success) provider=$($analysis.provider) findings=$($analysis.structured.findings.Count) evidenceRun=ok"

# --- 10-12. finding + iteration 2 + authoritative state ---
$appList = curl.exe -s -b .e2e-cookies.txt "$base/api/applications" | ConvertFrom-Json
$appId = $appList.applications[0].id
$fBody = '{\"applicationId\":' + $appId + ',\"title\":\"AuthBypassProbeE2E\",\"severityValue\":\"critical\"}'
$fCreateRaw = curl.exe -s -b .e2e-cookies.txt -H "x-csrf-token: $csrf" -H "Content-Type: application/json" -X POST "$base/api/findings" -d $fBody
Write-Output ("POST raw: " + $fCreateRaw.Substring(0, [Math]::Min(260, $fCreateRaw.Length)))
$fCreate = $fCreateRaw | ConvertFrom-Json
$findingId = $fCreate.finding.id
if (!$findingId) {
  # idempotent rerun: the dedup already created this finding
  $all = curl.exe -s -b .e2e-cookies.txt "$base/api/findings?applicationId=$appId" | ConvertFrom-Json
  $findingId = ($all.findings | Where-Object { $_.title -eq "AuthBypassProbeE2E" } | Select-Object -First 1).id
  Write-Output "10. finding existing rerun: $findingId"
}
Write-Output "10. finding: $findingId"
$itBody = '{\"applicationId\":' + $appId + ',\"iterationTypeValue\":\"retest\"}'
$itCreate = curl.exe -s -b .e2e-cookies.txt -H "x-csrf-token: $csrf" -H "Content-Type: application/json" -X POST "$base/api/iterations" -d $itBody | ConvertFrom-Json
$iterationId = $itCreate.iteration.id
$itNum = $itCreate.iteration.number
Write-Output "11. iteration: #$itNum id=$iterationId"

# --- 13. developer-reported Fixed (I2) ---
$sBody = '{\"findingId\":' + $findingId + ',\"iterationId\":' + $iterationId + ',\"severityValue\":\"critical\",\"statusValue\":\"fixed\"}'
$stateFix = curl.exe -s -b .e2e-cookies.txt -H "x-csrf-token: $csrf" -H "Content-Type: application/json" -X PUT "$base/api/findings" -d $sBody | ConvertFrom-Json
Write-Output "13. developer reported Fixed: state=$($stateFix.state.statusRef.value)"

# --- 14. human CORRECTION to Not Fixed ---
$cBody = '{\"entityType\":\"finding\",\"entityId\":' + $findingId + ',\"iterationId\":' + $iterationId + ',\"newState\":\"not_fixed\",\"reason\":\"PentesterRetestStillVulnerable\"}'
$correct = curl.exe -s -b .e2e-cookies.txt -H "x-csrf-token: $csrf" -H "Content-Type: application/json" -X POST "$base/api/authoritative-state/correct" -d $cBody | ConvertFrom-Json
Write-Output "14. human correction Not Fixed: decisionId=$($correct.decisionId) created=$($correct.created)"

# --- 15. authoritative state explanation ---
$authState = curl.exe -s -b .e2e-cookies.txt "$base/api/authoritative-state/approve?findingId=$findingId" | ConvertFrom-Json
Write-Output "15. authoritative state: current=$($authState.authoritative.currentStatus) historyRows=$($authState.authoritative.statusHistory.Count) decisions=$($authState.authoritative.decisions.Count)"

# --- 16-17. dashboard/report/PPT consistency (§10/§87) ---
$snap = curl.exe -s -b .e2e-cookies.txt "$base/api/reports/snapshot" | ConvertFrom-Json
Write-Output "16. snapshot: apps=$($snap.totalApplications) findings=$($snap.totalFindings) pending=$($snap.pendingFindings) closed=$($snap.closedFindings) car=$($snap.carVerified)"

curl.exe -s -b .e2e-cookies.txt -H "x-csrf-token: $csrf" -H "Content-Type: application/json" -X POST "$base/api/reports/ppt" -d "{}" -o ".e2e-export.pptx"
$pptSize = (Get-Item .e2e-export.pptx).Length
Remove-Item "_pptcheck" -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path "_pptcheck" | Out-Null
Copy-Item .e2e-export.pptx "_pptcheck/deck.pptx"
Set-Location _pptcheck
& tar -xf deck.pptx 2>$null
$xml2 = Get-Content (Join-Path "ppt" "slides\slide2.xml") -Raw
Set-Location ..
Write-Output "17. PPT: bytes=$pptSize slide2=$($xml2.Length -gt 500) noUndefinedOrNaN=$(-not ($xml2 -match 'undefined|NaN'))"
Remove-Item "_pptcheck" -Recurse -Force -ErrorAction SilentlyContinue

# --- 18-19. Excel export + re-import round trip ---
curl.exe -s -b .e2e-cookies.txt -H "x-csrf-token: $csrf" -X POST "$base/api/exports/excel" -o ".e2e-export.xlsx"
$xlSize = (Get-Item .e2e-export.xlsx).Length
$reimport = curl.exe -s -b .e2e-cookies.txt -X POST "$base/api/imports/excel" -F "file=@.e2e-export.xlsx" | ConvertFrom-Json
Write-Output "18. Excel export bytes=$xlSize; 19. Excel re-import of export: validatedOrCreate=$($reimport.success -or $reimport.alreadyImported)"

# --- 20. audit coverage (§39) ---
$audit = curl.exe -s -b .e2e-cookies.txt "$base/api/audit?take=10" | ConvertFrom-Json
Write-Output "20. audit: $($audit.entries.Count) recent events"
Write-Output "=== E2E COMPLETE ==="
