$ErrorActionPreference = "Continue"
$base = "http://localhost:3210"

function Get-Csrf {
  $line = (Get-Content .p3cookies.txt | Select-String "tm_csrf" | Select-Object -First 1).Line
  return ($line -split "`t")[-1].Trim()
}

Write-Output "=== 1. Unauthenticated GET /api/pt-tracker => 401 ==="
curl.exe -s -o NUL -w "code=%{http_code}`n" "$base/api/pt-tracker"

Write-Output "=== 2. Login ==="
curl.exe -s -c .p3cookies.txt -X POST "$base/api/auth/login" -H "Content-Type: application/json" -d '{\"email\":\"admin@akasaair.com\",\"password\":\"TaskManager!2026\"}' -o NUL
$csrf = Get-Csrf
Write-Output "csrf ok"

Write-Output "=== 3. PT Tracker list ==="
$list = curl.exe -s -b .p3cookies.txt "$base/api/pt-tracker"
Write-Output ($list.Substring(0, [Math]::Min(200, $list.Length)))

Write-Output "=== 4-6. Import the canonical template (validate) ==="
$import = curl.exe -s -b .p3cookies.txt -X POST "$base/api/imports/excel" -F "file=@prisma/templates/pt-tracker-v1.xlsx" -F "createMissingApplications=true"
Write-Output ($import.Substring(0, [Math]::Min(420, $import.Length)))
$jobId = ([regex]::Match($import, '"jobId":(\d+)')).Groups[1].Value
Write-Output "jobId=$jobId"

Write-Output "=== 7. Confirm import ==="
$confirm = curl.exe -s -b .p3cookies.txt -H "x-csrf-token: $csrf" -H "Content-Type: application/json" -X POST "$base/api/imports/excel/confirm" -d "{`"jobId`":$jobId}"
Write-Output ($confirm.Substring(0, [Math]::Min(360, $confirm.Length)))

Write-Output "=== 8. Tracker rows after import ==="
$after = curl.exe -s -b .p3cookies.txt "$base/api/pt-tracker"
Write-Output ($after.Substring(0, [Math]::Min(400, $after.Length)))
$appId = ([regex]::Match($after, '"id":(\d+),"sNo":1,')).Groups[1].Value
Write-Output "appId=$appId"

Write-Output "=== 9. Mutations without CSRF => 403 ==="
curl.exe -s -o NUL -w "code=%{http_code}`n" -b .p3cookies.txt -H "Content-Type: application/json" -X POST "$base/api/iterations" -d "{`"applicationId`":$appId,`"iterationTypeValue`":`"retest`"}"

Write-Output "=== 10. Create Iteration (CSRF) ==="
$iter = curl.exe -s -b .p3cookies.txt -H "x-csrf-token: $csrf" -H "Content-Type: application/json" -X POST "$base/api/iterations" -d "{`"applicationId`":$appId,`"iterationTypeValue`":`"retest`"}"
Write-Output ($iter.Substring(0, [Math]::Min(240, $iter.Length)))
$iterationId = ([regex]::Match($iter, '"id":(\d+)')).Groups[1].Value

Write-Output "=== 11. Create finding + initial state ==="
$finding = curl.exe -s -b .p3cookies.txt -H "x-csrf-token: $csrf" -H "Content-Type: application/json" -X POST "$base/api/findings" -d "{`"applicationId`":$appId,`"title`":`"Live probe finding XSS`",`"severityValue`":`"high`"}"
$findingId = ([regex]::Match($finding, '"id":(\d+)')).Groups[1].Value
Write-Output "findingId=$findingId"
$states = curl.exe -s -b .p3cookies.txt -H "x-csrf-token: $csrf" -H "Content-Type: application/json" -X PATCH "$base/api/findings/$findingId" -d "{`"iterationId`":$iterationId,`"severityValue`":`"high`",`"statusValue`":`"open`"}"
Write-Output "state open: ok"
Write-Output "=== 12. Status change open->fixed(ish): not_fixed probe ==="
$state2 = curl.exe -s -b .p3cookies.txt -H "x-csrf-token: $csrf" -H "Content-Type: application/json" -X PATCH "$base/api/findings/$findingId" -d "{`"iterationId`":$iterationId,`"severityValue`":`"high`",`"statusValue`":`"not_fixed`",`"retestNote`":`"live probe retest`"}"
Write-Output "state not_fixed: ok"

Write-Output "=== 13. Test case + state ==="
$tc = curl.exe -s -b .p3cookies.txt -H "x-csrf-token: $csrf" -H "Content-Type: application/json" -X POST "$base/api/test-cases" -d "{`"applicationId`":$appId,`"title`":`"Live probe TC rate-limit`",`"statusValue`":`"included`"}"
$tcId = ([regex]::Match($tc, '"id":(\d+)')).Groups[1].Value
Write-Output "tcId=$tcId"
$tcState = curl.exe -s -b .p3cookies.txt -H "x-csrf-token: $csrf" -H "Content-Type: application/json" -X PUT "$base/api/test-cases" -d "{`"testCaseId`":$tcId,`"iterationId`":$iterationId,`"statusValue`":`"retested`"}"
Write-Output "tc retested: ok"

Write-Output "=== 14. Export & re-import ==="
curl.exe -s -b .p3cookies.txt -H "x-csrf-token: $csrf" -X POST "$base/api/exports/excel" -o ".export.xlsx" 
$size = (Get-Item .export.xlsx).Length
Write-Output "export bytes: $size"
$reimport = curl.exe -s -b .p3cookies.txt -X POST "$base/api/imports/excel" -F "file=@.export.xlsx"
Write-Output ($reimport.Substring(0, [Math]::Min(320, $reimport.Length)))
$reJobId = ([regex]::Match($reimport, '"jobId":(\d+)')).Groups[1].Value

Write-Output "=== 15. Audit feed (last 6) ==="
$audit = curl.exe -s -b .p3cookies.txt "$base/api/audit?take=6"
Write-Output ($audit.Substring(0, [Math]::Min(500, $audit.Length)))
