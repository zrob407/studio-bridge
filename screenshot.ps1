param(
	[string]$TitleLike = "",
	[int]$MaxWidth = 1280,
	[string]$OutPath,
	[switch]$FocusOnly
)

$ErrorActionPreference = "Stop"

trap {
	Write-Output "ERROR $($_.Exception.Message)"
	exit 1
}

Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class StudioWin {
	[StructLayout(LayoutKind.Sequential)]
	public struct RECT { public int Left, Top, Right, Bottom; }

	[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr handle, out RECT rect);
	[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
	[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command);
	[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr handle);
	[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@

[void][StudioWin]::SetProcessDPIAware()

$candidates = @(Get-Process -Name RobloxStudioBeta -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })

if ($candidates.Count -eq 0) {
	Write-Output "ERROR no Roblox Studio window found"
	exit 1
}

$target = $null

if ($TitleLike -ne "") {
	$target = $candidates | Where-Object { $_.MainWindowTitle -like "*$TitleLike*" } | Select-Object -First 1
}

if ($null -eq $target) {
	$target = $candidates | Select-Object -First 1
}

$handle = $target.MainWindowHandle

if ([StudioWin]::IsIconic($handle)) {
	[void][StudioWin]::ShowWindow($handle, 9)
}

[void][StudioWin]::SetForegroundWindow($handle)
Start-Sleep -Milliseconds 500

if ($FocusOnly) {
	Write-Output "OK focused $($target.MainWindowTitle)"
	exit 0
}

$rect = New-Object StudioWin+RECT
[void][StudioWin]::GetWindowRect($handle, [ref]$rect)

$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top

if ($width -le 0 -or $height -le 0) {
	Write-Output "ERROR window has no size"
	exit 1
}

$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
$graphics.Dispose()

$final = $bitmap

if ($MaxWidth -gt 0 -and $width -gt $MaxWidth) {
	$scaledHeight = [int]($height * $MaxWidth / $width)
	$final = New-Object System.Drawing.Bitmap $MaxWidth, $scaledHeight
	$scaler = [System.Drawing.Graphics]::FromImage($final)
	$scaler.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
	$scaler.DrawImage($bitmap, 0, 0, $MaxWidth, $scaledHeight)
	$scaler.Dispose()
}

$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
$parameters = New-Object System.Drawing.Imaging.EncoderParameters 1
$parameters.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 82L
$final.Save($OutPath, $codec, $parameters)

Write-Output "OK $($final.Width) $($final.Height) $($target.MainWindowTitle)"
