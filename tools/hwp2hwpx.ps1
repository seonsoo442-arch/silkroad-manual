# hwp2hwpx.ps1 - Batch convert HWP -> HWPX using the installed Hancom Office (COM).
#
# NOTE: This file is intentionally ASCII-only. Windows PowerShell 5.1 reads .ps1
# as the ANSI code page (CP949 here), so UTF-8 Korean text would corrupt and
# break parsing. Folder names are discovered at runtime instead of hard-coded.

param(
    [string]$Src = "",
    [string]$Dst = "",
    [switch]$Force
)

function Log($m) { Write-Output $m }

Log "---- hwp2hwpx start ----"
Log ("PowerShell : " + $PSVersionTable.PSVersion)

$root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
Log ("Project root : " + $root)

# Source = the subfolder holding .hwp files; Dest = the subfolder holding .hwpx files
if ([string]::IsNullOrEmpty($Src)) {
    $c = @(Get-ChildItem -LiteralPath $root -Directory |
           Where-Object { @(Get-ChildItem -LiteralPath $_.FullName -Filter *.hwp -File).Count -gt 0 })
    if ($c.Count -eq 1) { $Src = $c[0].FullName }
    elseif ($c.Count -gt 1) { $Src = ($c | Sort-Object { @(Get-ChildItem -LiteralPath $_.FullName -Filter *.hwp -File).Count } -Descending)[0].FullName }
}
if ([string]::IsNullOrEmpty($Dst)) {
    $d = @(Get-ChildItem -LiteralPath $root -Directory |
           Where-Object { @(Get-ChildItem -LiteralPath $_.FullName -Filter *.hwpx -File).Count -gt 0 })
    if ($d.Count -ge 1) { $Dst = ($d | Sort-Object { @(Get-ChildItem -LiteralPath $_.FullName -Filter *.hwpx -File).Count } -Descending)[0].FullName }
}

Log ("Source folder : " + $Src)
Log ("Dest   folder : " + $Dst)

if ([string]::IsNullOrEmpty($Src) -or -not (Test-Path -LiteralPath $Src)) { Log "[ERROR] source folder not found"; exit 1 }
if ([string]::IsNullOrEmpty($Dst)) { Log "[ERROR] destination folder not found"; exit 1 }
if (-not (Test-Path -LiteralPath $Dst)) { New-Item -ItemType Directory -Path $Dst -Force | Out-Null }

$files = @(Get-ChildItem -LiteralPath $Src -Filter *.hwp -File | Sort-Object Name)
Log ("Files to process : " + $files.Count)
if ($files.Count -eq 0) { Log "nothing to do"; exit 0 }

Log "Creating Hancom COM object ..."
$hwp = $null
try {
    $hwp = New-Object -ComObject HWPFrame.HwpObject
    Log "COM object OK"
} catch {
    Log ("[ERROR] cannot create HWPFrame.HwpObject : " + $_.Exception.Message)
    exit 1
}

try { $hwp.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule") | Out-Null; Log "security module registered" }
catch { Log "[WARN] security module not registered - approve the access dialog if it appears" }

try { $hwp.XHwpWindows.Item(0).Visible = $false } catch { }

$ok = 0; $skip = 0; $fail = 0; $failed = @()
$i = 0; $first = $true

foreach ($f in $files) {
    $i++
    $out = Join-Path $Dst ($f.BaseName + ".hwpx")
    $tag = "[" + $i + "/" + $files.Count + "] " + $f.Name

    if ((Test-Path -LiteralPath $out) -and -not $Force) { Log ($tag + "  SKIP (exists)"); $skip++; continue }

    try {
        if (-not $first) { try { $hwp.Clear(1) | Out-Null } catch { } }
        $first = $false

        if (-not $hwp.Open($f.FullName, "HWP", "forceopen:true")) { throw "Open returned false" }
        if (-not $hwp.SaveAs($out, "HWPX", "")) { throw "SaveAs returned false" }
        if (-not (Test-Path -LiteralPath $out)) { throw "output file missing after SaveAs" }

        $kb = [math]::Round((Get-Item -LiteralPath $out).Length / 1KB)
        Log ($tag + "  OK -> " + $f.BaseName + ".hwpx (" + $kb + " KB)")
        $ok++
    } catch {
        Log ($tag + "  FAIL : " + $_.Exception.Message)
        $fail++; $failed += $f.Name
    }
}

try { $hwp.Clear(1) | Out-Null } catch { }
try { $hwp.Quit() } catch { }
try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($hwp) | Out-Null } catch { }

Log ""
Log ("==== RESULT : ok=" + $ok + " skip=" + $skip + " fail=" + $fail + " ====")
if ($fail -gt 0) { Log "failed files:"; $failed | ForEach-Object { Log ("  - " + $_) } }
Log "---- done ----"
