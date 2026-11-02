# Outlook COM gives us the items even though the FILE is byte-locked:
# the store is already mounted in the live session. Probe again to prove
# access through COM (items = the source of truth for ingestion).
$ErrorActionPreference = "Stop"
try { $outlook = [Runtime.InteropServices.Marshal]::GetActiveObject("Outlook.Application") } catch { $outlook = New-Object -ComObject Outlook.Application }
$ns = $outlook.Session
$target = $null
foreach ($store in $ns.Stores) { if ($store.FilePath -like "*backup.pst") { $target = $store } }
if (-not $target) { Write-Output "NOT MOUNTED"; exit 1 }
$root = $target.GetRootFolder()
$c = 0
foreach ($sub in $root.Folders) { $c += $sub.Items.Count }
Write-Output ("COM read OK - root folders: " + $root.Folders.Count + " - items: " + $c)
