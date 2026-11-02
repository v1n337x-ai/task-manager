# Copy a PST that Outlook holds open: Volume Shadow Copy Service (VSS) via DiskShadow.
# This bypasses the running lock and is the same technique backup tools use.
$ErrorActionPreference = "Stop"
$src = "C:\Users\VineetSanjeevKhalkho\Documents\Outlook Files\backup.pst"
$srcName = Split-Path $src -Leaf
$dest = "C:\Users\VineetSanjeevKhalkho\Documents\PT Tracker\task-manager\storage\pst\backup.pst"
$scriptText = @"
set verbose on
begin backup
add volume "C:\" alias pstShadow
create
expose %pstShadow% P:
end backup
"@
Set-Content -Path "$env:TEMP\pst-shadow.dsh" -Value $scriptText -Encoding ASCII
Write-Output "script written"
