# pst-export.ps1 -- Outlook COM worker (metadata / export passes)
param(
  [Parameter(Mandatory = $true)][string]$Mode,
  [Parameter(Mandatory = $true)][string]$PstPath,
  [Parameter(Mandatory = $true)][string]$OutPath,
  [string]$SelectionPath = "",
  [string]$TempDir = ""
)

$ErrorActionPreference = "Stop"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

try { $outlook = [Runtime.InteropServices.Marshal]::GetActiveObject("Outlook.Application") } catch { $outlook = New-Object -ComObject Outlook.Application }
$ns = $outlook.Session

# Mount only if this exact file is not already attached to the session.
$target = $null
foreach ($store in $ns.Stores) { if ($store.FilePath -ieq $PstPath) { $target = $store } }
if (-not $target) {
  $ns.AddStore($PstPath)
  Start-Sleep -Seconds 3
  foreach ($store in $ns.Stores) { if ($store.FilePath -ieq $PstPath) { $target = $store } }
}
if (-not $target) { Write-Output '{"error":"pst store could not be mounted (is Outlook installed?)"}'; exit 2 }
$root = $target.GetRootFolder()

$PR_MSG_ID = "http://schemas.microsoft.com/mapi/proptag/0x1035001F"
$PR_IN_REPLY = "http://schemas.microsoft.com/mapi/proptag/0x1042001F"

function Norm([string]$s) {
  if ($null -eq $s) { return "" }
  return (($s.ToLower()) -replace '[^a-z0-9]', '')
}

function ResolveSmtp($addrEntry) {
  if ($null -eq $addrEntry) { return "" }
  try { $u = $addrEntry.GetExchangeUser(); if ($u -and $u.PrimarySmtpAddress) { return $u.PrimarySmtpAddress.ToLower() } } catch {}
  $a = ""
  try { $a = $addrEntry.Address } catch {}
  if ($a -like "/o=*") { return "" }
  if ($a -like "smtp:*") { return $a.Substring(5).ToLower() }
  return $a.ToLower()
}

function RecipLine($item, $kind) {
  $out = @()
  foreach ($r in $item.Recipients) {
    if ($r.Type -ne $kind) { continue }
    $smtp = ResolveSmtp $r.AddressEntry
    if (-not $smtp) { $smtp = ($r.Address -replace '^smtp:', '').ToLower() }
    $out += ($r.Name + " <" + $smtp + ">")
  }
  return ($out -join ", ")
}

$selection = $null
if ($SelectionPath -ne "") { $selection = (Get-Content -Raw $SelectionPath | ConvertFrom-Json) }
$selSet = @{}
if ($null -ne $selection) { foreach ($k in $selection.keys) { $selSet[$k] = $true } }
$doExport = ($Mode -eq "export")

function ProcessFolder($folder) {
  foreach ($item in $folder.Items) {
    if ($item.Class -ne 43) { continue } # olMail only
    $msgId = ""
    try { $msgId = $item.PropertyAccessor.GetProperty($PR_MSG_ID) } catch {}
    $inReply = ""
    try { $inReply = $item.PropertyAccessor.GetProperty($PR_IN_REPLY) } catch {}
    $sent = ""
    try { $sent = $item.ReceivedTime.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ") } catch {}
    $fromName = ""
    $fromMail = ""
    try { $fromName = $item.SenderName } catch {}
    try { $se = $item.Sender; if ($se) { $eu = $se.GetExchangeUser(); if ($eu -and $eu.PrimarySmtpAddress) { $fromMail = $eu.PrimarySmtpAddress.ToLower() } } } catch {}
    if (-not $fromMail) { try { $fromMail = ($item.SenderEmailAddress -replace '^smtp:', '').ToLower() } catch {} }
    $subject = $item.Subject
    $bodyText = $item.Body
    $key = Norm $subject

    if (-not $doExport) {
      $script:metaList += @{ subject = $subject; sentAt = $sent; fromMail = $fromMail; fromName = $fromName; messageId = $msgId; inReplyTo = $inReply; bodyLength = ($bodyText | Measure-Object -Character).Characters.Count }
      continue
    }
    if ($selSet.Count -gt 0 -and -not $selSet.ContainsKey($key)) { continue }

    $boundary = "----pstmime" + [Guid]::NewGuid().ToString("N")
    $crlf = "`r`n"
    $msg = "Message-ID: " + $msgId + $crlf
    if ($inReply -ne "") { $msg += "In-Reply-To: " + $inReply + $crlf }
    $msg += "From: " + $fromName + " <" + $fromMail + ">" + $crlf
    $msg += "To: " + (RecipLine $item 1) + $crlf
    $cc = (RecipLine $item 2)
    if ($cc -ne "") { $msg += "Cc: " + $cc + $crlf }
    $msg += "Subject: " + $subject + $crlf
    $msg += "Date: " + $sent + $crlf
    $msg += "MIME-Version: 1.0" + $crlf
    if ($item.Attachments.Count -gt 0) {
      # Attachments are skipped in the .pst fast-path (warning recorded by the
      # caller) — Outlook's per-item SaveAsFile made the walk 6s/item (3.5h).
      $msg += "X-Pst-Import-Note: " + $item.Attachments.Count + " attachment(s) present in the original pst item" + $crlf
    }
    $msg += "Content-Type: text/plain; charset=utf-8" + $crlf + "Content-Transfer-Encoding: 8bit" + $crlf + $crlf
    $msg += $bodyText + $crlf
    $fname = Join-Path $script:tempDir ("m" + $script:extracted + ".eml")
    [IO.File]::WriteAllText($fname, $msg, $utf8NoBom)
    $script:exportIndex += @{ subjectKey = $key; eml = $fname }
    $script:extracted++
  }
  foreach ($sub in $folder.Folders) { ProcessFolder $sub }
}

$script:metaList = @()
$script:exportIndex = @()
$script:extracted = 0
$script:tempDir = $TempDir
foreach ($sub in $root.Folders) { ProcessFolder $sub }

if ($doExport) {
  @{ count = $script:extracted; files = $script:exportIndex } | ConvertTo-Json -Depth 3 -Compress | Set-Content -Encoding UTF8 $OutPath
} else {
  @{ total = $script:metaList.Count; messages = $script:metaList } | ConvertTo-Json -Depth 4 -Compress | Set-Content -Encoding UTF8 $OutPath
}

foreach ($store in $ns.Stores) {
  if ($store.FilePath -ieq $PstPath) {
    try { $ns.RemoveStore($root) } catch { try { $root.Delete() } catch {} }
  }
}
Write-Output ("DONE mode=" + $Mode + " extracted=" + $script:extracted + " metaCount=" + $script:metaList.Count)
