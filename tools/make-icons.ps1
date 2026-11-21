# icon\icon.jpg からアプリアイコン (180 / 192 / 512 px PNG) を作ります
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path (Split-Path -Parent $root) 'icon\icon.jpg'
if (-not (Test-Path $src)) { $src = Join-Path $root 'icon.jpg' }
if (-not (Test-Path $src)) { Write-Host "icon.jpg が見つかりません: music-player\icon\icon.jpg に置いてください" -ForegroundColor Yellow; return }
$img = [System.Drawing.Image]::FromFile($src)
$s = [Math]::Min($img.Width, $img.Height)
$sx = [int](($img.Width - $s) / 2); $sy = [int](($img.Height - $s) / 2)
foreach ($size in 180, 192, 512) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, $size, $size), (New-Object System.Drawing.Rectangle $sx, $sy, $s, $s), [System.Drawing.GraphicsUnit]::Pixel)
  $out = Join-Path $root "icons\icon-$size.png"
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Host "作成: $out" -ForegroundColor Green
}
$img.Dispose()
Write-Host "アップロード（公開）し直したあと、iPhone でホーム画面に追加し直すと反映されます。"
