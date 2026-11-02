# pst-export.ps1 — Outlook COM worker for .pst ingestion (Windows + Outlook present).
# Usage: powershell -File pst-export.ps1 -Mode metadata|export -PstPath <path> -OutPath <path> [-SelectionPath <json>] [-TempDir <dir>]
param(
  [Parameter(Mandatory = $true)][string]$Mode,
  [Parameter(Mandatory = $true)][string]$PstPath,
  [Parameter(Mandatory = $true)][string]$OutPath,
  [string]$SelectionPath = "",
  [string]$TempDir = ""
)

$ErrorActionPreference = "Stop"

try { $outlook = [Runtime.InteropServices.Marshal]::GetActiveObject("Outlook.Application") } catch { $outlook = New-Object -ComObject Outlook.Application }
$ns = $null
foreach ($s in $outlook.Session.Stores) {
  if ($s.FilePath -ieq $PstPath) { $ns = $outlook.Session; break }
}
if (-not $ns) {
  $ns = $outlook.Session
  $ns.AddStore($PstPath)
  Start-Sleep -Seconds 2
}
$target = $null
foreach ($s in $ns.Stores) { if ($s.FilePath -ieq $PstPath) { $target = $s } }
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

function ItemToMeta($item) {
  $msgId = ""
  try { $msgId = $item.PropertyAccessor.GetProperty($PR_MSG_ID) } catch {}
  $inReply = ""
  try { $inReply = $item.PropertyAccessor.GetProperty($PR_IN_REPLY) } catch {}
  $sent = ""
  try { $sent = $item.ReceivedTime.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ") } catch {}
  $fromName = ""
  $fromMail = ""
  try { $fromName = $item.SenderName } catch {}
  try { $se = $item.Sender.GetExchangeUser(); if ($se -and $se.PrimarySmtpAddress) { $fromMail = $se.PrimarySmtpAddress.ToLower() } } catch {}
  if (-not $fromMail) { try { $fromMail = ($item.SenderEmailAddress -replace '^smtp:', '').ToLower() } catch {} }
  return @{
    subject = $item.Subject; sentAt = $sent
    fromName = $fromName; fromEmail = $fromMail
    to = (RecipLine $item 1); cc = (RecipLine $item 2)
    messageId = $msgId; inReplyTo = $inReply
    bodyText = $item.Body; attachments = $item.Attachments.Count
    normalizedKey = (Norm $item.Subject)
  }
}

$meta = @()
$extracted = 0

$selection = $null
if ($SelectionPath -ne "") {
  $selection = (Get-Content -Raw $SelectionPath | ConvertFrom-Json)
}
$selSet = @{}
if ($null -ne $selection) { foreach ($k in $selection.keys) { $selSet[$k] = $true } }
$doExport = ($Mode -eq "export")

function WalkExport($folder) {
  $i = 0
  foreach ($item in $folder.Items) {
    $i++
    if ($item.Class -ne 43) { continue } # olMail only
    $meta = ItemToMeta $item
    if (-not $doExport) { $script:metaList += $meta; continue }
    if ($selSet.Count -gt 0 -and -not ($selSet.ContainsKey($meta.normalizedKey))) { continue }
    $boundary = "----pstmime" + [Guid]::NewGuid().ToString("N")
    $crlf = "`r`n"
    $msg = "Message-ID: " + $meta.messageId + $crlf
    if ($meta.inReplyTo -ne "") { $msg += "In-Reply-To: " + $meta.inReplyTo + $crlf }
    $msg += "From: " + $meta.fromName + " <" + $meta.fromEmail + ">" + $crlf
    $msg += "To: " + $meta.to + $crlf
    if ($meta.cc -ne "") { $msg += "Cc: " $meta.cc + $crlf }
    $msg += "Subject: " + $meta.subject + $crlf
    $msg += "Date: " + $meta.sentAt + $crlf
    $msg += "MIME-Version: 1.0" + $crlf
    if ($item.Attachments.Count -gt 0) {
      $msg += "Content-Type: multipart/mixed; boundary=""" + $boundary + """" + $crlf + $crlf
      $msg += "--" + $boundary + $crlf
      $msg += "Content-Type: text/plain; charset=utf-8" + $crlf + $crlf
      $msg += $meta.bodyText + $crlf
      $an = 0
      foreach ($att in $item.Attachments) {
        $an++
        if ($att.Size -gt 20971520) { continue }
        $apath = Join-Path $script:tempDir ("psta" + $extracted + "_" + $an + ".bin")
        try { $att.SaveAsFile($apath) } catch { continue }
        $bytes = [IO.File]::ReadAllBytes($apath)
        $b64 = [Convert]::ToBase64String($bytes)
        $msg += "--" + $boundary + $crlf
        $msg += "Content-Type: application/octet-stream; name=""" + $att.FileName + """" + $crlf
        $msg += "Content-Disposition: attachment; filename=""" + $att.FileName + """" + $crlf
        $msg += "Content-Transfer-Encoding: base64" + $crlf + $crlf
        for ($off = 0; $off -lt $b64.Length; $off += 76) { $msg += $b64.Substring($off, [Math]::Min(76, $b64.Length - $off)) + $crlf }
        Remove-Item $apath -ErrorAction SilentlyContinue
      }
      $msg += "--" + $boundary + "--" + $crlf
    } else {
      $msg += "Content-Type: text/plain; charset=utf-8" + $crlf + $crlf
      $msg += $meta.bodyText + $crlf
    }
    $fname = Join-Path $script:tempDir ("msg" + $extracted + ".eml")
    [IO.File]::WriteAllText($fname, $msg, [Text.Encoding]::UTF8)
    $script:exportIndex += @{ subjectKey = $meta.normalizedKey; eml = $fname }
    $script:extracted++
  }
  foreach ($sub in $folder.Folders) { WalkExport $sub }
}

$script:metaList = @()
$script:exportIndex = @()
foreach ($sub in $root.Folders) {
  if ($doExport) { WalkExport $sub } else { WalkExport $sub }
}

if ($doExport) {
  @{ count = $script:exported; files = $script:exportIndex } | ConvertTo-Json -Depth 3 | Set-Content -Encoding UTF8 $OutPath
} else {
  @{ total = $script:metaList.Count; messages = $script:metaList } | ConvertTo-Json -Depth 4 -Compress | Set-Content -Encoding UTF8 $OutPath
}

# Unmount the PST again (leave the profile clean)
foreach ($store in $ns.Stores) {
  if ($store.FilePath -ieq $PstPath) {
    try { $ns.RemoveStore($root) } catch { try { $root.Delete() } catch {} }
  }
}
Write-Output ("DONE mode=" + $Mode + " extracted=" + $script:exported + " metaCount=" + $script:metaList.Count)
