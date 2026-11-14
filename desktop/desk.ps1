# SarkarSathi Desk - native window (pure WinForms, PowerShell 5.1). Dot-source, then call Show-Desk.
# All network calls are async (HttpClient task + 100 ms poll timer); the UI thread never blocks.
# File is ASCII only on purpose (PS 5.1 reads BOM-less files as ANSI); special characters are built from char codes.
# Style "A - Clean light": white window, navy text, indigo accent, rounded corners, status pills, money hero.
# Self-check: set $env:DESK_LAYOUT_CHECK=1 before dot-sourcing; prints LAYOUT OK or one line per clipped/outside control, then exits.

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Net.Http

$script:EM  = [string][char]0x2014
$script:ELL = [string][char]0x2026
$script:DOT = [string][char]0x00B7
$script:Rs  = [string][char]0x20B9

$script:Base = 'http://localhost:3000'
$script:ApiKey = $null
$script:KeyFile = Join-Path $env:APPDATA 'SarkarSathi\desk.json'
$script:Http = New-Object System.Net.Http.HttpClient
$script:Http.Timeout = [TimeSpan]::FromSeconds(180)
$script:Pending = New-Object System.Collections.ArrayList
$script:Form = $null
$script:StatusBusy = $false
$script:CheckMode = ($env:DESK_LAYOUT_CHECK -eq '1')
if (-not ('Desk.Focus' -as [type])) {
    Add-Type -Namespace 'Desk' -Name 'Focus' -MemberDefinition @'
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out int pid);
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr hWnd, int cmd);
'@
}
$script:SignedIn = $false

function Get-Col([string]$Hex) { [System.Drawing.ColorTranslator]::FromHtml($Hex) }
$script:cWhite = Get-Col '#FFFFFF'; $script:cBorder = Get-Col '#D8DCE6'
$script:cText = Get-Col '#1B2A4A'; $script:cMuted = Get-Col '#6B7590'; $script:cDiv = Get-Col '#E6E9F0'
$script:cAccent = Get-Col '#3D5AFE'; $script:cAccentHover = Get-Col '#2F47D6'
$script:cPill = Get-Col '#F1F3F8'; $script:cUp = Get-Col '#1E9E5A'; $script:cDown = Get-Col '#B8BECC'
$script:cErr = Get-Col '#D93025'; $script:cWarn = Get-Col '#B26A00'

function Get-DeskFont([string[]]$Names, [double]$Size) {
    $have = @{}
    try { foreach ($ff in (New-Object System.Drawing.Text.InstalledFontCollection).Families) { $have[$ff.Name] = $true } } catch { }
    foreach ($n in $Names) { if ($have.ContainsKey($n)) { return (New-Object System.Drawing.Font($n, [single]$Size)) } }
    return (New-Object System.Drawing.Font($Names[$Names.Count - 1], [single]$Size))
}
$script:fText = Get-DeskFont @('Segoe UI Variable Text', 'Segoe UI') 9.5
$script:fRow  = Get-DeskFont @('Segoe UI Variable Text', 'Segoe UI') 10
$script:fSmall = Get-DeskFont @('Segoe UI Variable Text', 'Segoe UI') 8.5
$script:fHead = Get-DeskFont @('Segoe UI Variable Display Semib', 'Segoe UI Semibold') 12
$script:fMoney = Get-DeskFont @('Bahnschrift', 'Segoe UI Semibold') 26

$script:Scale = 1.0
try { $gs = [System.Drawing.Graphics]::FromHwnd([IntPtr]::Zero); $script:Scale = $gs.DpiX / 96.0; $gs.Dispose() } catch { }
function Px([double]$n) { return [int][math]::Round($n * $script:Scale) }

# ---------------------------------------------------------------- HTTP helper
function Invoke-Api {
    param([string]$Method, [string]$Path, $Body = $null, [scriptblock]$Done = $null, $Ctx = $null,
          [string]$Key = $null, [switch]$NoKey, [switch]$Raw401)
    $task = $null
    try {
        $req = New-Object System.Net.Http.HttpRequestMessage((New-Object System.Net.Http.HttpMethod($Method)), ($script:Base + $Path))
        if (-not $NoKey) {
            $k = $Key; if (-not $k) { $k = $script:ApiKey }
            if ($k) { [void]$req.Headers.Add('X-Api-Key', $k) }
        }
        if ($null -ne $Body) {
            $json = ConvertTo-Json -InputObject $Body -Depth 6 -Compress
            $req.Content = New-Object System.Net.Http.StringContent($json, [System.Text.Encoding]::UTF8, 'application/json')
        }
        $task = $script:Http.SendAsync($req)
    } catch { $task = $null }
    [void]$script:Pending.Add(@{ Task = $task; Done = $Done; Ctx = $Ctx; Raw401 = [bool]$Raw401 })
}

function Update-Pending {
    foreach ($p in @($script:Pending)) {
        $t = $p.Task
        if ($null -ne $t -and -not $t.IsCompleted) { continue }
        [void]$script:Pending.Remove($p)
        $res = [pscustomobject]@{ Status = 0; Text = ''; Json = $null; Err = $null }
        if ($null -eq $t) { $res.Err = 'request could not be built' }
        elseif ($t.IsFaulted -or $t.IsCanceled) {
            $res.Err = 'unreachable'
            if ($t.IsFaulted -and $t.Exception) { $res.Err = $t.Exception.GetBaseException().Message }
        } else {
            try {
                $resp = $t.Result
                $res.Status = [int]$resp.StatusCode
                $res.Text = $resp.Content.ReadAsStringAsync().Result
                try { $res.Json = ConvertFrom-Json -InputObject $res.Text } catch { }
            } catch { $res.Err = $_.Exception.Message }
        }
        if ($script:Form -and -not $script:Form.IsDisposed) {
            if ($res.Status -eq 0) {
                $msg = "Server not running $($script:EM) start it from the tray (Restart services)"
                $script:lblSrv.Text = $msg
                if (-not $script:SignedIn) { $script:lblKeyMsg.Text = "Server not running $($script:EM) start it from the tray" }
            } else { $script:lblSrv.Text = '' }
        }
        if ($res.Status -eq 401 -and -not $p.Raw401 -and $script:SignedIn) {
            Sign-Out 'Key not accepted'
            continue
        }
        if ($p.Done) {
            try { & $p.Done $res $p.Ctx } catch { if ($script:lblSrv) { $script:lblSrv.Text = "Error: $($_.Exception.Message)" } }
        }
    }
}

# ---------------------------------------------------------------- small UI factories
function New-Lbl([string]$Text, [int]$X, [int]$Y, $Fore, $Font) {
    $l = New-Object System.Windows.Forms.Label
    $l.AutoSize = $true; $l.UseMnemonic = $false
    $l.Font = $Font; $l.ForeColor = $Fore; $l.BackColor = [System.Drawing.Color]::Transparent
    $l.Text = $Text
    $l.Location = New-Object System.Drawing.Point($X, $Y)
    $l.Size = $l.PreferredSize
    return $l
}
function Set-LblText($Lbl, [string]$Text) {
    $Lbl.Text = $Text
    $Lbl.Size = $Lbl.PreferredSize
}
function New-FlatBtn([string]$Text, $Fore, $Font, [int]$X, [int]$Y) {
    $b = New-Object System.Windows.Forms.Button
    $b.FlatStyle = 'Flat'; $b.UseVisualStyleBackColor = $false; $b.Cursor = 'Hand'
    $b.FlatAppearance.BorderSize = 0; $b.FlatAppearance.MouseOverBackColor = $script:cPill; $b.FlatAppearance.MouseDownBackColor = $script:cDiv
    $b.BackColor = $script:cWhite; $b.ForeColor = $Fore; $b.Font = $Font; $b.Text = $Text; $b.UseMnemonic = $false
    $m = [System.Windows.Forms.TextRenderer]::MeasureText($Text, $Font)
    $b.Size = New-Object System.Drawing.Size(($m.Width + (Px 22)), ($m.Height + (Px 12)))
    $b.Location = New-Object System.Drawing.Point($X, $Y)
    return $b
}
function New-Panel([int]$X, [int]$Y, [int]$W, [int]$H, $Back) {
    $p = New-Object System.Windows.Forms.Panel
    $p.Location = New-Object System.Drawing.Point($X, $Y); $p.Size = New-Object System.Drawing.Size($W, $H); $p.BackColor = $Back
    return $p
}
function Get-Prop($Obj, [string]$Name) {
    if ($null -eq $Obj) { return $null }
    $pr = $Obj.PSObject.Properties[$Name]
    if ($pr) { return $pr.Value }
    return $null
}
function Get-RoundPath([int]$W, [int]$H, [int]$R) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = [math]::Max(2, $R * 2)
    $p.AddArc(0, 0, $d, $d, 180, 90)
    $p.AddArc($W - $d, 0, $d, $d, 270, 90)
    $p.AddArc($W - $d, $H - $d, $d, $d, 0, 90)
    $p.AddArc(0, $H - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}
function Set-Round($Ctl, [int]$R) {
    $path = Get-RoundPath $Ctl.Width $Ctl.Height $R
    $old = $Ctl.Region
    $Ctl.Region = New-Object System.Drawing.Region($path)
    if ($old) { $old.Dispose() }
    $path.Dispose()
}
function New-DeskIcon {
    $bmp = New-Object System.Drawing.Bitmap(32, 32)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'; $g.Clear($script:cWhite)
    $pen = New-Object System.Drawing.Pen($script:cAccent, 2.5)
    $pts = @()
    for ($i = 0; $i -lt 6; $i++) {
        $a = [math]::PI / 3 * $i + [math]::PI / 6
        $pts += New-Object System.Drawing.PointF([single](16 + 12 * [math]::Cos($a)), [single](16 + 12 * [math]::Sin($a)))
    }
    $g.DrawPolygon($pen, [System.Drawing.PointF[]]$pts)
    $g.Dispose(); $pen.Dispose()
    return [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
}

# ---------------------------------------------------------------- sign-in / sign-out / mode
function Set-Mode([string]$Mode) {
    $main = ($Mode -eq 'main')
    $script:SignedIn = $main
    $script:pSignin.Visible = -not $main
    $script:pA.Visible = $main
    if ($main) { Start-StatusPoll } else { Stop-StatusPoll }
}

function Sign-Out([string]$Msg) {
    try { if (Test-Path $script:KeyFile) { Remove-Item $script:KeyFile -Force } } catch { }
    $script:ApiKey = $null
    $script:txtKey.Text = ''; $script:lblKeyMsg.Text = $Msg
    Set-Mode 'signin'
}

function Enter-Main {
    Set-Mode 'main'
    Invoke-Api GET '/api/whoami' -Done {
        param($r, $c)
        if ($r.Status -eq 200 -and $r.Json) { Set-LblText $script:lblCsc "SarkarSathi $($script:DOT) $([string]$r.Json.name)" }
    }
    Refresh-Usage
}

function Try-SignIn {
    $k = $script:txtKey.Text.Trim()
    if (-not $k) { $script:lblKeyMsg.Text = 'Enter your CSC key'; return }
    $script:lblKeyMsg.Text = ''
    $script:btnSignIn.Enabled = $false
    Invoke-Api GET '/api/whoami' -Key $k -Raw401 -Ctx $k -Done {
        param($r, $key)
        $script:btnSignIn.Enabled = $true
        if ($r.Status -eq 200) {
            try {
                $dir = Split-Path $script:KeyFile
                if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
                [System.IO.File]::WriteAllText($script:KeyFile, (ConvertTo-Json -InputObject @{ key = $key }), (New-Object System.Text.UTF8Encoding($false)))
            } catch { }
            $script:ApiKey = $key
            $script:txtKey.Text = ''
            Enter-Main
        } elseif ($r.Status -eq 401) { $script:lblKeyMsg.Text = 'Key not accepted' }
        elseif ($r.Status -eq 0) { }
        else { $script:lblKeyMsg.Text = "Server answered $($r.Status)" }
    }
}

# ---------------------------------------------------------------- account usage + status
function Set-ValueRight($Lbl, [string]$Text, $Fore) {
    $Lbl.ForeColor = $Fore
    Set-LblText $Lbl $Text
    $Lbl.Left = $script:PW - $script:Pad - $Lbl.Width
}

function Apply-Usage($j) {
    if ($null -eq $j) { return }
    $rates = Get-Prop $j 'rates'
    $today = Get-Prop $j 'today'
    $ta = Get-Prop $j 'todayAmount'; if ($null -eq $ta) { $ta = 0 }
    $ma = Get-Prop $j 'monthAmount'; if ($null -eq $ma) { $ma = 0 }
    Set-LblText $script:lblHero "$($script:Rs)$ta"
    Set-LblText $script:lblSub "today $($script:DOT) $($script:Rs)$ma this month"
    foreach ($k in $script:RowKeys) {
        $v = Get-Prop $today $k; if ($null -eq $v) { $v = 0 }
        $rate = Get-Prop $rates $k; if ($null -eq $rate) { $rate = 0 }
        if ([double]$rate -gt 0) {
            Set-ValueRight $script:RowVals[$k] "$v $($script:DOT) $($script:Rs)$([int]([double]$v * [double]$rate))" $script:cText
        } else {
            Set-ValueRight $script:RowVals[$k] "$v $($script:DOT) included" $script:cMuted
        }
    }
    $rd = Get-Prop $rates 'document'; if ($null -eq $rd) { $rd = 2 }
    $rf = Get-Prop $rates 'fill'; if ($null -eq $rf) { $rf = 10 }
    Set-LblText $script:lblFoot "$($script:Rs)$rd per document verified $($script:DOT) $($script:Rs)$rf per application filled $($script:DOT) other actions included"
}

function Apply-Status($j) {
    foreach ($pair in @(@('Server', 'server'), @('AI', 'ai'), @('Voice', 'voice'))) {
        $up = $false
        if ($null -ne $j) { $up = [bool](Get-Prop $j $pair[1]) }
        if ($up) { $script:Dots[$pair[0]].BackColor = $script:cUp } else { $script:Dots[$pair[0]].BackColor = $script:cDown }
    }
}

function Refresh-Usage {
    Invoke-Api GET '/api/my-usage' -Done {
        param($r, $c)
        if ($r.Status -ne 200 -or -not $r.Json) { return }
        Apply-Usage $r.Json
    }
}

function Poll-Status {
    if ($script:StatusBusy -or -not $script:SignedIn) { return }
    $script:StatusBusy = $true
    Invoke-Api GET '/api/status' -Done {
        param($r, $c)
        $script:StatusBusy = $false
        if ($r.Status -eq 200 -and $r.Json) { Apply-Status $r.Json } else { Apply-Status $null }
    }
}
function Start-StatusPoll {
    if ($script:StatusTimer) { $script:StatusTimer.Start() }
    Poll-Status
}
function Stop-StatusPoll { if ($script:StatusTimer) { $script:StatusTimer.Stop() } }

# ---------------------------------------------------------------- slide animation
function Start-Slide([string]$Mode) {
    $script:SlideMode = $Mode
    $script:SlideTimer.Start()
}
function Hide-Desk {
    if (-not $script:Form -or $script:Form.IsDisposed -or -not $script:Form.Visible) { return }
    Start-Slide 'out'
}

# ---------------------------------------------------------------- layout self-check
function Get-AllControls($Parent) {
    foreach ($c in $Parent.Controls) { $c; Get-AllControls $c }
}
function Test-DeskLayout {
    $problems = @()
    foreach ($c in @(Get-AllControls $script:Form)) {
        $name = "$($c.GetType().Name) '$($c.Text)'"
        if ($c -is [System.Windows.Forms.Label] -and $c.Text) {
            $ps = $c.PreferredSize
            if ($ps.Width -gt $c.Width -or $ps.Height -gt $c.Height) {
                $problems += "$name text needs $($ps.Width)x$($ps.Height) but is $($c.Width)x$($c.Height)"
            }
        }
        if ($c -is [System.Windows.Forms.Button] -and $c.Text) {
            $m = [System.Windows.Forms.TextRenderer]::MeasureText($c.Text, $c.Font)
            if ($m.Width + 8 -gt $c.Width -or $m.Height + 4 -gt $c.Height) {
                $problems += "$name text needs $($m.Width)x$($m.Height) but is $($c.Width)x$($c.Height)"
            }
        }
        $p = $c.Parent
        if ($p) {
            $cs = $p.ClientSize
            if ($c.Left -lt 0 -or $c.Top -lt 0 -or $c.Right -gt $cs.Width -or $c.Bottom -gt $cs.Height) {
                $problems += "$name at $($c.Left),$($c.Top)-$($c.Right),$($c.Bottom) is outside its parent ($($cs.Width)x$($cs.Height))"
            }
        }
    }
    return $problems
}

function Invoke-DeskLayoutCheck {
    if (-not $script:Form -or $script:Form.IsDisposed) { Build-Desk }
    $sample = [pscustomobject]@{
        todayAmount = 74; monthAmount = 1240
        today = [pscustomobject]@{ document = 12; fill = 5; names = 7; validation = 5; voice = 9; convert = 2 }
        month = [pscustomobject]@{ document = 100 }
        rates = [pscustomobject]@{ document = 2; fill = 10; names = 0; validation = 0; voice = 0; convert = 0 }
    }
    Set-Mode 'main'
    Set-LblText $script:lblCsc "SarkarSathi $($script:DOT) Sample CSC Centre, Haveli"
    Apply-Usage $sample
    Apply-Status ([pscustomobject]@{ server = $true; ai = $true; voice = $false })
    $script:lblSrv.Text = "Server not running $($script:EM) start it from the tray (Restart services)"
    $out = @(Test-DeskLayout)
    Set-Mode 'signin'
    $script:lblKeyMsg.Text = "Server not running $($script:EM) start it from the tray"
    $out += @(Test-DeskLayout | ForEach-Object { "[signin] $_" })
    $out = @($out | Select-Object -Unique)
    if ($out.Count -eq 0) { Write-Host "LAYOUT OK (window $($script:Form.Width)x$($script:Form.Height))" } else { $out | ForEach-Object { Write-Host $_ } }
    return $out.Count
}

# ---------------------------------------------------------------- build the form
function Build-Desk {
    $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $W = [int][math]::Max(720, [math]::Floor($wa.Width * 0.40))
    $Pad = Px 20
    $script:Pad = $Pad
    $script:PW = $W

    $f = New-Object System.Windows.Forms.Form
    $script:Form = $f
    $f.AutoScaleMode = 'None'; $f.FormBorderStyle = 'None'; $f.ShowInTaskbar = $true; $f.Text = 'SarkarSathi Desk'; $f.TopMost = $false
    $f.StartPosition = 'Manual'; $f.ClientSize = New-Object System.Drawing.Size($W, (Px 400))
    $f.BackColor = $script:cWhite; $f.ForeColor = $script:cText; $f.Font = $script:fText; $f.KeyPreview = $true
    try { $f.Icon = New-DeskIcon } catch { }
    $f.add_KeyDown({ param($s, $e) if ($e.KeyCode -eq 'Escape') { Hide-Desk; $e.Handled = $true } })
    $f.add_Resize({ if ($script:Form.Width -gt 0) { Set-Round $script:Form 12; $script:Form.Invalidate() } })
    $script:AwayTimer = New-Object System.Windows.Forms.Timer
    $script:AwayTimer.Interval = 300
    $script:AwayTimer.add_Tick({
        $script:AwayTimer.Stop()
        if (-not $script:Form -or $script:Form.ContainsFocus) { return }
        Hide-Desk
    })
    $f.add_Deactivate({ $script:AwayTimer.Start() })

    $borderPaint = {
        param($s, $e)
        $e.Graphics.SmoothingMode = 'AntiAlias'
        $fw = $script:Form.Width; $fh = $script:Form.Height
        $path = Get-RoundPath ($fw - 1) ($fh - 1) 12
        $pen = New-Object System.Drawing.Pen($script:cBorder, 1)
        $e.Graphics.TranslateTransform(-$s.Left, -$s.Top)
        $e.Graphics.DrawPath($pen, $path)
        $pen.Dispose(); $path.Dispose()
    }

    $script:pA = New-Panel 0 0 $W 100 $script:cWhite
    $script:pSignin = New-Panel 0 0 $W 100 $script:cWhite
    $script:pA.add_Paint($borderPaint); $script:pSignin.add_Paint($borderPaint)

    # ---- tracker: header row (name left, status pills right)
    $y = Px 18
    $script:lblCsc = New-Lbl "SarkarSathi" $Pad $y $script:cMuted $script:fText
    $script:Dots = @{}
    $pills = @()
    $gap = Px 6; $dotSz = Px 8
    foreach ($nm in @('Server', 'AI', 'Voice')) {
        $tl = New-Lbl $nm 0 0 $script:cText $script:fSmall
        $pw = (Px 10) + $dotSz + (Px 6) + $tl.Width + (Px 12)
        $ph = $tl.Height + (Px 8)
        $pill = New-Panel 0 0 $pw $ph $script:cPill
        $dot = New-Panel (Px 10) ([int](($ph - $dotSz) / 2)) $dotSz $dotSz $script:cDown
        $dp = New-Object System.Drawing.Drawing2D.GraphicsPath; $dp.AddEllipse(0, 0, $dotSz, $dotSz)
        $dot.Region = New-Object System.Drawing.Region($dp); $dp.Dispose()
        $tl.Location = New-Object System.Drawing.Point(((Px 10) + $dotSz + (Px 6)), [int](($ph - $tl.Height) / 2))
        $pill.Controls.AddRange(@($dot, $tl))
        Set-Round $pill ([int]($ph / 2))
        $script:Dots[$nm] = $dot
        $pills += $pill
    }
    $pillH = $pills[0].Height
    $hdrH = [math]::Max($script:lblCsc.Height, $pillH)
    $px = $W - $Pad
    for ($i = $pills.Count - 1; $i -ge 0; $i--) {
        $px -= $pills[$i].Width
        $pills[$i].Location = New-Object System.Drawing.Point($px, ($y + [int](($hdrH - $pillH) / 2)))
        $px -= $gap
    }
    $script:lblCsc.Top = $y + [int](($hdrH - $script:lblCsc.Height) / 2)
    $script:pA.Controls.Add($script:lblCsc)
    foreach ($p in $pills) { $script:pA.Controls.Add($p) }
    $y += $hdrH + (Px 14)

    # ---- hero money + server message (right of hero)
    $script:lblHero = New-Lbl "$($script:Rs)0" $Pad $y $script:cAccent $script:fMoney
    $script:pA.Controls.Add($script:lblHero)
    $msgH = (New-Lbl 'Ag' 0 0 $script:cText $script:fText).Height + 4
    $msgX = [int]($W / 3)
    $script:lblSrv = New-Object System.Windows.Forms.Label
    $script:lblSrv.AutoSize = $false; $script:lblSrv.UseMnemonic = $false; $script:lblSrv.TextAlign = 'MiddleRight'
    $script:lblSrv.Font = $script:fText; $script:lblSrv.ForeColor = $script:cWarn; $script:lblSrv.BackColor = [System.Drawing.Color]::Transparent
    $script:lblSrv.Size = New-Object System.Drawing.Size(($W - $Pad - $msgX), $msgH)
    $script:lblSrv.Location = New-Object System.Drawing.Point($msgX, ($y + [int](($script:lblHero.Height - $msgH) / 2)))
    $script:pA.Controls.Add($script:lblSrv)
    $y += $script:lblHero.Height

    $script:lblSub = New-Lbl "today $($script:DOT) $($script:Rs)0 this month" $Pad $y $script:cMuted $script:fText
    $script:pA.Controls.Add($script:lblSub)
    $y += $script:lblSub.Height + (Px 14)

    # ---- rows
    $script:RowKeys = @('document', 'fill', 'names', 'validation', 'voice', 'convert')
    $labels = @{ document = 'Documents checked'; fill = 'Forms filled'; names = 'Name checks'; validation = 'Validations'; voice = 'Voice entries'; convert = 'Conversions' }
    $script:RowVals = @{}
    foreach ($k in $script:RowKeys) {
        $script:pA.Controls.Add((New-Panel $Pad $y ($W - 2 * $Pad) 1 $script:cDiv))
        $y += 1
        $rl = New-Lbl $labels[$k] $Pad ($y + (Px 7)) $script:cText $script:fRow
        $rv = New-Lbl "0 $($script:DOT) included" 0 ($y + (Px 7)) $script:cMuted $script:fRow
        $rv.Left = $W - $Pad - $rv.Width
        $script:pA.Controls.AddRange(@($rl, $rv))
        $script:RowVals[$k] = $rv
        $y += $rl.Height + (Px 14)
    }

    # ---- footer
    $script:pA.Controls.Add((New-Panel $Pad $y ($W - 2 * $Pad) 1 $script:cDiv))
    $y += 1 + (Px 8)
    $script:btnRefresh = New-FlatBtn 'Refresh' $script:cAccent $script:fSmall 0 $y
    $script:btnRefresh.Left = $W - $Pad - $script:btnRefresh.Width
    $script:btnRefresh.add_Click({ Refresh-Usage })
    $script:btnOut = New-FlatBtn 'Sign out' $script:cMuted $script:fSmall 0 $y
    $script:btnOut.Left = $script:btnRefresh.Left - $script:btnOut.Width
    $script:btnOut.add_Click({ Sign-Out '' })
    $script:lblFoot = New-Lbl "$($script:Rs)2 per document verified $($script:DOT) $($script:Rs)10 per application filled $($script:DOT) other actions included" $Pad $y $script:cMuted $script:fSmall
    $footH = [math]::Max($script:lblFoot.Height, $script:btnRefresh.Height)
    $script:lblFoot.Top = $y + [int](($footH - $script:lblFoot.Height) / 2)
    $script:pA.Controls.AddRange(@($script:lblFoot, $script:btnOut, $script:btnRefresh))
    $y += $footH + (Px 16)
    $H = $y
    $script:H = $H; $script:W = $W
    $f.Size = New-Object System.Drawing.Size($W, $H)
    $script:pA.Size = New-Object System.Drawing.Size($W, $H)
    $script:pSignin.Size = New-Object System.Drawing.Size($W, $H)

    # ---- sign-in panel (content centred vertically)
    $bw = Px 360
    $bx = [int](($W - $bw) / 2)
    $head = New-Lbl 'Sign in with your CSC key' 0 0 $script:cText $script:fHead
    $script:txtKey = New-Object System.Windows.Forms.TextBox
    $script:txtKey.UseSystemPasswordChar = $true; $script:txtKey.Font = $script:fRow
    $script:txtKey.BorderStyle = 'FixedSingle'; $script:txtKey.BackColor = $script:cWhite; $script:txtKey.ForeColor = $script:cText
    $script:txtKey.Width = $bw
    $script:txtKey.add_KeyDown({ param($s, $e) if ($e.KeyCode -eq 'Enter') { $e.SuppressKeyPress = $true; Try-SignIn } })
    $btnH = Px 38
    $script:btnSignIn = New-Object System.Windows.Forms.Button
    $script:btnSignIn.Text = 'Sign in'; $script:btnSignIn.FlatStyle = 'Flat'; $script:btnSignIn.UseVisualStyleBackColor = $false
    $script:btnSignIn.FlatAppearance.BorderSize = 0; $script:btnSignIn.FlatAppearance.MouseOverBackColor = $script:cAccentHover
    $script:btnSignIn.BackColor = $script:cAccent; $script:btnSignIn.ForeColor = $script:cWhite; $script:btnSignIn.Font = $script:fRow; $script:btnSignIn.Cursor = 'Hand'
    $script:btnSignIn.Size = New-Object System.Drawing.Size($bw, $btnH)
    $script:btnSignIn.add_Click({ Try-SignIn })
    $script:lblKeyMsg = New-Object System.Windows.Forms.Label
    $script:lblKeyMsg.AutoSize = $false; $script:lblKeyMsg.UseMnemonic = $false; $script:lblKeyMsg.TextAlign = 'MiddleCenter'
    $script:lblKeyMsg.Font = $script:fText; $script:lblKeyMsg.ForeColor = $script:cErr; $script:lblKeyMsg.BackColor = [System.Drawing.Color]::Transparent
    $script:lblKeyMsg.Size = New-Object System.Drawing.Size(($W - 2 * $Pad), $msgH)
    $g1 = Px 14; $g2 = Px 12
    $total = $head.Height + $g1 + $script:txtKey.Height + $g2 + $btnH + $g2 + $msgH
    $sy = [int](($H - $total) / 2)
    $head.Location = New-Object System.Drawing.Point([int](($W - $head.Width) / 2), $sy); $sy += $head.Height + $g1
    $script:txtKey.Location = New-Object System.Drawing.Point($bx, $sy); $sy += $script:txtKey.Height + $g2
    $script:btnSignIn.Location = New-Object System.Drawing.Point($bx, $sy); $sy += $btnH + $g2
    $script:lblKeyMsg.Location = New-Object System.Drawing.Point($Pad, $sy)
    $script:pSignin.Controls.AddRange(@($head, $script:txtKey, $script:btnSignIn, $script:lblKeyMsg))

    $f.Controls.AddRange(@($script:pSignin, $script:pA))
    Set-Round $f 12

    # timers
    $script:PollTimer = New-Object System.Windows.Forms.Timer
    $script:PollTimer.Interval = 100
    $script:PollTimer.add_Tick({ Update-Pending })
    $script:StatusTimer = New-Object System.Windows.Forms.Timer
    $script:StatusTimer.Interval = 5000
    $script:StatusTimer.add_Tick({ Poll-Status })
    $script:SlideTimer = New-Object System.Windows.Forms.Timer
    $script:SlideTimer.Interval = 15
    $script:SlideTimer.add_Tick({
        $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
        $f = $script:Form
        $step = [int][math]::Ceiling($f.Height / 13)
        $target = $wa.Bottom - $f.Height
        if ($script:SlideMode -eq 'in') {
            $f.Top = [math]::Max($target, $f.Top - $step)
            if ($f.Top -le $target) { $script:SlideTimer.Stop() }
        } else {
            $f.Top = $f.Top + $step
            if ($f.Top -ge $wa.Bottom) {
                $script:SlideTimer.Stop(); $f.Hide(); Stop-StatusPoll
                if ($global:DeskExitOnHide) { [System.Windows.Forms.Application]::Exit() }
            }
        }
    })

    if ($script:CheckMode) { return }
    $script:PollTimer.Start()
    Set-Mode 'signin'
    $key = $null
    try { if (Test-Path $script:KeyFile) { $key = [string](ConvertFrom-Json -InputObject (Get-Content $script:KeyFile -Raw)).key } } catch { }
    if ($key) {
        $script:ApiKey = $key
        Enter-Main
    }
}

function Show-Desk {
    if (-not $script:Form -or $script:Form.IsDisposed) { Build-Desk }
    $f = $script:Form
    if ($f.Visible) { $f.Activate(); return }
    $wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $f.Left = $wa.Left + [int](($wa.Width - $f.Width) / 2)
    $f.Top = $wa.Bottom
    $f.Show(); [void][Desk.Focus]::ShowWindow($f.Handle, 5); $f.Activate()
    if ($script:SignedIn) { Refresh-Usage; Start-StatusPoll }
    Start-Slide 'in'
}

if ($script:CheckMode) {
    $n = Invoke-DeskLayoutCheck
    exit ([int](@($n)[-1] -gt 0))
}
