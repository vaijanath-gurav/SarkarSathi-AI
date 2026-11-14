# GovTech Assistant - system-tray launcher.
# Starts the local services (Ollama AI, voice STT server, Node server) hidden, shows a tray icon
# with live status, and offers quick actions. Replaces an Electron wrapper to keep RAM low
# (native PowerShell + WinForms only). It NEVER stops services it did not start itself:
# only the processes launched by this tray are stopped on Restart / Quit.
param([switch]$OpenDesk)

# One copy only: a second launch asks the running copy to show its window, then exits.
$script:ShowSignal = New-Object System.Threading.EventWaitHandle($false, 'AutoReset', 'SarkarSathiDeskShow')
$script:Mutex = New-Object System.Threading.Mutex($false, 'SarkarSathiDeskTray')
if (-not $script:Mutex.WaitOne(0)) { [void]$script:ShowSignal.Set(); exit }

Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class DpiAware { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
[void][DpiAware]::SetProcessDPIAware()
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
. (Join-Path $PSScriptRoot 'desk.ps1')

# Alt+Shift+D anywhere: show the desk window, or slide it away if it is in front.
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public class DeskHotkey : NativeWindow, IDisposable {
    [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr h, int id, uint mods, uint vk);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr h, int id);
    public event EventHandler Pressed;
    public bool Ok;
    public DeskHotkey() {
        CreateHandle(new CreateParams());
        Ok = RegisterHotKey(Handle, 1, 0x0001 | 0x0004 | 0x4000, (uint)Keys.D); // Alt+Shift, no repeat
    }
    protected override void WndProc(ref Message m) {
        if (m.Msg == 0x0312 && Pressed != null) Pressed(this, EventArgs.Empty);
        base.WndProc(ref m);
    }
    public void Dispose() { UnregisterHotKey(Handle, 1); DestroyHandle(); }
}
'@
function Toggle-Desk {
    if ($script:Form -and -not $script:Form.IsDisposed -and $script:Form.Visible -and $script:Form.ContainsFocus) { Hide-Desk }
    else { Show-Desk }
}
$script:Hotkey = New-Object DeskHotkey
$script:Hotkey.add_Pressed({ Toggle-Desk })
$script:SignalTimer = New-Object System.Windows.Forms.Timer
$script:SignalTimer.Interval = 300
$script:SignalTimer.add_Tick({ if ($script:ShowSignal.WaitOne(0)) { Show-Desk } })
$script:SignalTimer.Start()

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

$miDesk = $menu.Items.Add('Open SarkarSathi Desk')
$miDesk.add_Click({ Show-Desk })

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
$notify.add_DoubleClick({ Show-Desk })

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 10000
$timer.add_Tick({ Update-Tooltip })

Start-AllServices
if ($OpenDesk) { Show-Desk }
Update-Tooltip
$timer.Start()
Show-Balloon 'GovTech Assistant is starting - AI, voice and server'

[System.Windows.Forms.Application]::Run()
