# Re-mount the PST through Outlook COM and copy it FROM INSIDE Outlook's own
# session: Outlook's CopyTo is a no-go for the root, but the item space is
# readable. Simplest robust route: mount + read via COM (no file copy needed),
# importing DIRECTLY via COM-to-.eml export for the selected subjects.
$ErrorActionPreference = "Stop"
try { $outlook = [Runtime.InteropServices.Marshal]::GetActiveObject("Outlook.Application") } catch { $outlook = New-Object -ComObject Outlook.Application }
$ns = $outlook.Session
Write-Output ("mounting: C:\Users\VineetSanjeevKhalkho\Documents\Outlook Files\backup.pst")
$ns.AddStore("C:\Users\VineetSanjeevKhalkho\Documents\Outlook Files\backup.pst")
Start-Sleep -Seconds 4
$target = $null
foreach ($store in $ns.Stores) { if ($store.FilePath -like "*backup.pst") { $target = $store } }
if ($target) {
  $root = $target.GetRootFolder()
  $c = 0
  foreach ($sub in $root.Folders) { $c += $sub.Items.Count }
  Write-Output ("MOUNTED OK - folders " + $root.Folders.Count + " - items " + $c)
  $metaOut = "C:\Users\VineetSanjeevKhalkho\Documents\PT Tracker\task-manager\storage\pst\meta-probe.json"
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $list = New-Object "System.Collections.Generic.List[object]"
  foreach ($folder in $root.Folders) {
    foreach ($item in $folder.Items) {
      if ($item.Class -ne 43) { continue }
      $msgId = ""
      try { $msgId = $item.PropertyAccessor.GetProperty("http://schemas.microsoft.com/mapi/proptag/0x1035001F") } catch {}
      $sent = ""
      try { $sent = $item.ReceivedTime.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ") } catch {}
      $from = ""
      try { $se = $item.Sender; if ($se) { $eu = $se.GetExchangeUser(); if ($eu) { $from = $eu.PrimarySmtpAddress } }; if (-not $from) { $from = ($item.SenderEmailAddress -replace '^smtp:','').ToLower() } } catch {}
      $list.Add(@{ subject = $item.Subject; sentAt = $sent; from = $from; msgId = $msgId })
    }
  }
  $sw.Stop()
  $list | ConvertTo-Json -Depth 3 -Compress | Set-Content -Encoding UTF8 $metaOut
  Write-Output ("EXTRACTED " + $list.Count + " message summaries in " + [int]$sw.Elapsed.TotalSeconds + "s -> " + $metaOut)
} else {
  Write-Output "MOUNT FAILED"
}
