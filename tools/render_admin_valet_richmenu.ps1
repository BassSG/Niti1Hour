param(
  [string]$OutputPath = (Join-Path $PSScriptRoot '..\..\output\lineoa-valet-workflow-20260923\admin-valet-richmenu.png')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Get-Color([string]$Hex, [int]$Alpha = 255) {
  $color = [System.Drawing.ColorTranslator]::FromHtml($Hex)
  return [System.Drawing.Color]::FromArgb($Alpha, $color.R, $color.G, $color.B)
}

function New-RoundedPath([float]$X, [float]$Y, [float]$Width, [float]$Height, [float]$Radius) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $Radius * 2
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function Draw-RoundedRect($Graphics, [float]$X, [float]$Y, [float]$Width, [float]$Height, [float]$Radius, $Fill, $Stroke = $null, [float]$StrokeWidth = 1) {
  $path = New-RoundedPath $X $Y $Width $Height $Radius
  $brush = [System.Drawing.SolidBrush]::new($Fill)
  $Graphics.FillPath($brush, $path)
  if ($Stroke) {
    $pen = [System.Drawing.Pen]::new($Stroke, $StrokeWidth)
    $Graphics.DrawPath($pen, $path)
    $pen.Dispose()
  }
  $brush.Dispose()
  $path.Dispose()
}

function Draw-Text($Graphics, [string]$Text, [float]$X, [float]$Y, [float]$Width, [float]$Height, [float]$Size, [string]$Color, [bool]$Bold = $false, [string]$Align = 'Near') {
  $style = if ($Bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
  $font = [System.Drawing.Font]::new('Leelawadee UI', $Size, $style, [System.Drawing.GraphicsUnit]::Pixel)
  $brush = [System.Drawing.SolidBrush]::new((Get-Color $Color))
  $format = [System.Drawing.StringFormat]::new()
  $format.Alignment = if ($Align -eq 'Center') { [System.Drawing.StringAlignment]::Center } elseif ($Align -eq 'Far') { [System.Drawing.StringAlignment]::Far } else { [System.Drawing.StringAlignment]::Near }
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $format.Trimming = [System.Drawing.StringTrimming]::EllipsisCharacter
  $format.FormatFlags = [System.Drawing.StringFormatFlags]::NoWrap
  $Graphics.DrawString($Text, $font, $brush, [System.Drawing.RectangleF]::new($X, $Y, $Width, $Height), $format)
  $format.Dispose(); $brush.Dispose(); $font.Dispose()
}

function Draw-StatusIcon($Graphics, [string]$Kind, [int]$X, [int]$Y, [string]$Accent) {
  $pen = [System.Drawing.Pen]::new((Get-Color $Accent), 9)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $lightPen = [System.Drawing.Pen]::new((Get-Color $Accent 92), 5)
  $lightPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $lightPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  if ($Kind -eq 'washer' -or $Kind -eq 'dryer') {
    Draw-RoundedRect $Graphics $X $Y 132 150 24 (Get-Color '#FFFFFF' 96) (Get-Color $Accent 170) 5
    $Graphics.DrawLine($lightPen, $X + 22, $Y + 32, $X + 110, $Y + 32)
    $Graphics.FillEllipse([System.Drawing.SolidBrush]::new((Get-Color $Accent)), $X + 22, $Y + 18, 9, 9)
    $Graphics.FillEllipse([System.Drawing.SolidBrush]::new((Get-Color $Accent 140)), $X + 40, $Y + 18, 9, 9)
    $Graphics.DrawEllipse($pen, $X + 26, $Y + 52, 80, 80)
    $Graphics.DrawEllipse($lightPen, $X + 39, $Y + 65, 54, 54)
    if ($Kind -eq 'dryer') {
      $Graphics.DrawArc($lightPen, $X + 42, $Y + 69, 50, 44, 205, 130)
      $Graphics.DrawArc($lightPen, $X + 48, $Y + 78, 38, 32, 205, 130)
    }
  } elseif ($Kind -eq 'fold') {
    Draw-RoundedRect $Graphics $X ($Y + 20) 132 112 20 (Get-Color '#FFFFFF' 96) (Get-Color $Accent 170) 5
    $Graphics.DrawLine($pen, $X + 28, $Y + 52, $X + 104, $Y + 52)
    $Graphics.DrawLine($pen, $X + 22, $Y + 79, $X + 110, $Y + 79)
    $Graphics.DrawLine($pen, $X + 32, $Y + 106, $X + 100, $Y + 106)
  } else {
    $Graphics.DrawEllipse($pen, $X + 12, $Y + 16, 112, 112)
    $Graphics.DrawLine($pen, $X + 39, $Y + 73, $X + 61, $Y + 95)
    $Graphics.DrawLine($pen, $X + 61, $Y + 95, $X + 101, $Y + 48)
  }
  $lightPen.Dispose(); $pen.Dispose()
}

function Draw-MenuTile($Graphics, [int]$Index, [string]$Eyebrow, [string]$Title, [string]$Description, [string]$Accent, [string]$Tint, [string]$Kind, [int]$X, [int]$Y) {
  $tileWidth = 1205; $tileHeight = 340
  Draw-RoundedRect $Graphics ($X + 4) ($Y + 10) $tileWidth $tileHeight 34 (Get-Color '#020811' 62)
  Draw-RoundedRect $Graphics $X $Y $tileWidth $tileHeight 34 (Get-Color $Tint) (Get-Color '#FFFFFF' 210) 2
  Draw-RoundedRect $Graphics ($X + 18) ($Y + 20) 12 ($tileHeight - 40) 6 (Get-Color $Accent)
  $badge = New-Object System.Drawing.RectangleF(($X + 58), ($Y + 77), 108, 108)
  $badgeBrush = [System.Drawing.SolidBrush]::new((Get-Color $Accent))
  $Graphics.FillEllipse($badgeBrush, $badge)
  $badgeBrush.Dispose()
  Draw-Text $Graphics ('0' + $Index) ($X + 58) ($Y + 77) 108 108 35 '#FFFFFF' $true 'Center'
  Draw-Text $Graphics $Eyebrow ($X + 210) ($Y + 40) 760 42 25 $Accent $true
  Draw-Text $Graphics $Title ($X + 210) ($Y + 91) 760 88 56 '#122234' $true
  Draw-Text $Graphics $Description ($X + 210) ($Y + 197) 780 62 27 '#596879' $false
  Draw-StatusIcon $Graphics $Kind ($X + 1025) ($Y + 91) $Accent
}

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = [System.IO.Path]::GetDirectoryName($resolvedOutput)
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$bitmap = [System.Drawing.Bitmap]::new(2500, 1686, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$graphics.Clear((Get-Color '#0A1522'))

$background = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
  [System.Drawing.Rectangle]::new(0, 0, 2500, 1686),
  (Get-Color '#0A1522'), (Get-Color '#24384A'), 35
)
$graphics.FillRectangle($background, 0, 0, 2500, 1686)
$background.Dispose()

# Quiet decorative rings keep the background premium without reducing label contrast.
$ringPen = [System.Drawing.Pen]::new((Get-Color '#E7C99D' 24), 3)
$graphics.DrawEllipse($ringPen, 2030, -260, 700, 700)
$graphics.DrawEllipse($ringPen, 2100, -190, 560, 560)
$graphics.DrawEllipse($ringPen, -230, 1300, 440, 440)
$ringPen.Dispose()

Draw-RoundedRect $graphics 20 20 2460 220 34 (Get-Color '#F7F4ED') (Get-Color '#D6B783') 3
Draw-RoundedRect $graphics 58 58 126 126 28 (Get-Color '#142536')
Draw-Text $graphics 'N' 58 54 126 126 74 '#E7C99D' $true 'Center'
Draw-Text $graphics 'NITI  LAUNDRY  ·  สาขา 2' 220 43 1250 42 25 '#697788' $true
Draw-Text $graphics 'ซัก  ·  อบ  ·  พับ' 220 83 1370 86 63 '#142536' $true
Draw-Text $graphics 'ADMIN OPERATIONS  /  คิวงานและสถานะเครื่อง' 224 174 1420 38 25 '#697788' $false
Draw-RoundedRect $graphics 1880 77 520 94 28 (Get-Color '#142536')
Draw-Text $graphics 'ศูนย์ปฏิบัติการ  ·  ADMIN' 1900 89 480 68 29 '#F7F4ED' $true 'Center'

Draw-MenuTile $graphics 1 'WASH  ·  QUEUE' 'รอเริ่มซัก' 'ชำระแล้ว  ·  เลือกเครื่องซักที่ว่าง' '#3978C5' '#F1F6FC' 'washer' 30 260
Draw-MenuTile $graphics 2 'WASH  ·  LIVE' 'กำลังซัก' 'Bubble แยกรายการ  ·  เห็นเลขเครื่อง' '#2368B7' '#E9F2FC' 'washer' 1265 260
Draw-MenuTile $graphics 3 'DRY  ·  QUEUE' 'รอเริ่มอบ' 'ซักเสร็จแล้ว  ·  เลือกเครื่องอบที่ว่าง' '#B7791F' '#FBF5E9' 'dryer' 30 620
Draw-MenuTile $graphics 4 'DRY  ·  LIVE' 'กำลังอบ' 'Bubble แยกรายการ  ·  เห็นเลขเครื่อง' '#D97706' '#FFF3E5' 'dryer' 1265 620
Draw-MenuTile $graphics 5 'FOLD  ·  NEXT' 'รอพับ' 'นำผ้าออกจากเครื่อง  ·  รอพับและตรวจ' '#7656A7' '#F4F0F8' 'fold' 30 980
Draw-MenuTile $graphics 6 'READY  ·  PICKUP' 'พร้อมรับ' 'พับและตรวจแล้ว  ·  รอลูกค้ามารับ' '#25806E' '#EDF7F3' 'ready' 1265 980

Draw-RoundedRect $graphics 30 1340 1205 346 34 (Get-Color '#E9663B') (Get-Color '#F6B16E') 2
Draw-Text $graphics 'เปิดศูนย์จัดการซัก–อบ–พับ' 70 1390 1125 92 43 '#FFFFFF' $true 'Center'
Draw-Text $graphics 'เว็บแอดมิน  ·  จัดการคิวและเครื่อง' 70 1502 1125 54 27 '#FFF4EA' $false 'Center'
Draw-RoundedRect $graphics 1265 1340 1205 346 34 (Get-Color '#F7F4ED') (Get-Color '#D6B783') 2
Draw-Text $graphics 'กลับเมนูร้านหลัก' 1305 1390 1125 92 43 '#142536' $true 'Center'
Draw-Text $graphics 'สลับกลับ Rich Menu แอดมินเดิม' 1305 1502 1125 54 27 '#697788' $false 'Center'

$bitmap.Save($resolvedOutput, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose(); $bitmap.Dispose()
Get-Item -LiteralPath $resolvedOutput | Select-Object FullName, Length
