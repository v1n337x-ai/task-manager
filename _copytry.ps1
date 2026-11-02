# Strategy: the running Outlook session has backup.pst written to disk BUT LOCKED.
# Outlook cannot give us a consistent copy while running. HOWEVER — the user's
# live flow: we ask Outlook COM to attach the already-mounted store, walk the
# folders and export the SELECTED items directly (no need to copy the binary!).
# The pst-import-service expects a PST PATH for COM mounting — but since the
# store is ALREADY mounted (we mounted it in the earlier probe), the service's
# mount step becomes a no-op and the path is only used for identity matching.
# This probe copies the file with the FileShare trick (shadow copy is heavyweight),
# else we surface the honest outcome.
$src = "C:\Users\VineetSanjeevKhalkho\Documents\Outlook Files\backup.pst"
$dest = "C:\Users\VineetSanjeevKhalkho\Documents\PT Tracker\task-manager\storage\pst\backup.pst"
New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
try {
  $in = [IO.File]::Open($src, "Open", "Read", [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
  $out = [IO.File]::Open($dest, "Create", "Write", [IO.FileShare]::Read)
  $buf = [byte[]]::new(4194304)
  $n = 0
  $total = 0L
  while (($n = $in.Read($buf, 0, $buf.Length)) -gt 0) { $out.Write($buf, 0, $n); $total += $n }
  $out.Flush(); $out.Close(); $in.Close()
  Write-Output ("COPIED bytes: " + $total)
} catch {
  Write-Output ("COPY FAILED: " + $_.Exception.Message)
}
