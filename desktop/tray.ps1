# GovTech Assistant - system-tray launcher.
# Starts the local services (Ollama AI, voice STT server, Node server) hidden, shows a tray icon
# with live status, and offers quick actions. Replaces an Electron wrapper to keep RAM low
# (native PowerShell + WinForms only). It NEVER stops services it did not start itself:
# only the processes launched by this tray are stopped on Restart / Quit.

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$script:Started = New-Object System.Collections.ArrayList

function Test-Port([int]$Port) {
    $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return [bool]$c
}

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Application
$notify.Visible = $true

function Show-Balloon([string]$Text) {
    $notify.BalloonTipTitle = 'GovTech Assistant'
    $notify.BalloonTipText = $Text
    $notify.ShowBalloonTip(3000)
}

function Start-Svc([string]$Name, [int]$Port, [string]$Exe, [string]$ArgLine) {
    if (Test-Port $Port) { return }
    try {
        $p = Start-Process -FilePath $Exe -ArgumentList $ArgLine -WorkingDirectory $Repo -WindowStyle Hidden -PassThru -ErrorAction Stop
        if ($p) { [void]$script:Started.Add($p) }
    } catch {
        Show-Balloon "Could not start $Name"
    }
}

function Start-AllServices {
    Start-Svc 'AI'     11434 'ollama' 'serve'
    Start-Svc 'Voice'  5005  'python' 'stt/server.py'
    Start-Svc 'Server' 3000  'node'   'src/server.js'
}

function Stop-OwnServices {
    foreach ($p in $script:Started) {
        Stop-Process -Id $p.Id -ErrorAction SilentlyContinue
    }
    $script:Started.Clear()
}

function Get-Mark([int]$Port) { if (Test-Port $Port) { 'ok' } else { '--' } }

function Update-Tooltip {
    $t = "GovTech Assistant  AI:$(Get-Mark 11434) Voice:$(Get-Mark 5005) Server:$(Get-Mark 3000)"
    if ($t.Length -gt 63) { $t = $t.Substring(0, 63) }
    $notify.Text = $t
}

function Get-State([int]$Port) { if (Test-Port $Port) { 'running' } else { 'stopped' } }

function Open-Demo { Start-Process 'http://localhost:3000/portal-ews.html' }

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$miStatus = $menu.Items.Add('Status')
$miStatus.add_Click({
    Show-Balloon ("AI: {0} / Voice: {1} / Server: {2}" -f (Get-State 11434), (Get-State 5005), (Get-State 3000))
})

$miDemo = $menu.Items.Add('Open demo form')
$miDemo.add_Click({ Open-Demo })

$miKeys = $menu.Items.Add('Keyboard shortcuts')
$miKeys.add_Click({
    try {
        Start-Process chrome 'chrome://extensions/shortcuts' -ErrorAction Stop
    } catch {
        Show-Balloon 'Open chrome://extensions/shortcuts in Chrome'
    }
})

$miRestart = $menu.Items.Add('Restart services')
$miRestart.add_Click({
    Stop-OwnServices
    Start-Sleep -Seconds 2
    Start-AllServices
    Update-Tooltip
})

[void]$menu.Items.Add('-')

$miQuit = $menu.Items.Add('Quit')
$miQuit.add_Click({
    Stop-OwnServices
    $timer.Stop()
    $notify.Visible = $false
    $notify.Dispose()
    [System.Windows.Forms.Application]::Exit()
})

$notify.ContextMenuStrip = $menu
$notify.add_DoubleClick({ Open-Demo })

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 10000
$timer.add_Tick({ Update-Tooltip })

Start-AllServices
Update-Tooltip
$timer.Start()
Show-Balloon 'GovTech Assistant is starting - AI, voice and server'

[System.Windows.Forms.Application]::Run()
