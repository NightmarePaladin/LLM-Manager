<#
.SYNOPSIS
  LLM-Manager monitoring agent installer for Windows 10/11 and Windows Server.

.DESCRIPTION
  Installs the agent into C:\ProgramData\LLM-Manager-Agent (own Python venv), writes
  agent.env (readable only by SYSTEM and Administrators), and registers a scheduled
  task that starts at boot as SYSTEM and restarts on failure. Safe to re-run: it
  updates the agent and settings.

  Run it from an elevated (Administrator) PowerShell. The dashboard generates the command.
  Settings come from environment variables:
    LLM_MANAGER_API_URL, LLM_MANAGER_SERVER_ID, LLM_MANAGER_TOKEN   (required)
    LLM_MANAGER_OLLAMA_URL   optional, e.g. http://127.0.0.1:11434
    LLM_MANAGER_AGENT_BASE   where to download agent files (URL or local directory)

  On Windows the agent reports CPU, RAM, disk and network. GPU and temperature
  sensors are Linux-only for now and show as unavailable.

.PARAMETER DryRun
  Print the steps instead of changing anything.
.PARAMETER InstallDir
  Override the install directory (testing).
.PARAMETER SkipTask
  Do not register or start the scheduled task (testing).
#>
[CmdletBinding()]
param(
  [switch]$DryRun,
  [string]$InstallDir = (Join-Path $env:ProgramData 'LLM-Manager-Agent'),
  [switch]$SkipTask,
  [switch]$SourceOnly
)

$ErrorActionPreference = 'Stop'
$TaskName = 'LLM-Manager Agent'
$MinPython = [version]'3.8'
$DefaultBase = 'https://raw.githubusercontent.com/NightmarePaladin/LLM-Manager/main/agent'
$SafeRe = '^[A-Za-z0-9:/._~-]+$'
$UuidRe = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
$TokenRe = '^lmt_[A-Za-z0-9_-]{43}$'

function Say([string]$m) { Write-Host $m }
function Fail([string]$m) { throw "ERROR: $m" }

# Runs a state-changing step, or just prints it in dry-run mode.
function Step([string]$Description, [scriptblock]$Action) {
  if ($DryRun) { Say "+ $Description" } else { & $Action }
}

function Test-Inputs {
  $api = $env:LLM_MANAGER_API_URL; $sid = $env:LLM_MANAGER_SERVER_ID
  $tok = $env:LLM_MANAGER_TOKEN; $oll = $env:LLM_MANAGER_OLLAMA_URL
  if (-not $api) { Fail 'LLM_MANAGER_API_URL is not set (copy the command from the server''s page in the dashboard)' }
  if (-not $sid) { Fail 'LLM_MANAGER_SERVER_ID is not set' }
  if (-not $tok) { Fail 'LLM_MANAGER_TOKEN is not set' }
  if ($api -notmatch $SafeRe) { Fail 'LLM_MANAGER_API_URL contains unexpected characters' }
  if ($api -notmatch '^(https://|http://localhost|http://127\.0\.0\.1)') { Fail 'LLM_MANAGER_API_URL must start with https:// (http:// is only allowed for localhost)' }
  if ($sid -notmatch $UuidRe) { Fail 'LLM_MANAGER_SERVER_ID is not a valid server id' }
  if ($tok -notmatch $TokenRe) { Fail 'LLM_MANAGER_TOKEN does not look like an agent token (lmt_...)' }
  if (("$api$sid$tok") -match 'your-production-domain|paste_token_here|00000000-0000-0000-0000-000000000000') {
    Fail 'the settings still contain example placeholders; use the command from the dashboard'
  }
  if ($oll) {
    if ($oll -notmatch $SafeRe) { Fail 'LLM_MANAGER_OLLAMA_URL contains unexpected characters' }
    if ($oll -notmatch '^https?://') { Fail 'LLM_MANAGER_OLLAMA_URL must start with http:// or https://' }
  }
}

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Returns the path of a usable python.exe (>= 3.8 with venv), or $null.
function Find-Python {
  $candidates = @()
  foreach ($name in 'python', 'python3') {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source -notmatch 'WindowsApps') { $candidates += $cmd.Source }  # skip the Store stub
  }
  $launcher = Get-Command py -ErrorAction SilentlyContinue
  if ($launcher) {
    $p = & $launcher.Source -3 -c 'import sys; print(sys.executable)' 2>$null
    if ($LASTEXITCODE -eq 0 -and $p) { $candidates += $p.Trim() }
  }
  foreach ($root in "$env:ProgramFiles\Python3*", "$env:LOCALAPPDATA\Programs\Python\Python3*") {
    $candidates += (Get-ChildItem $root -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending |
      ForEach-Object { Join-Path $_.FullName 'python.exe' } | Where-Object { Test-Path $_ })
  }
  foreach ($exe in ($candidates | Select-Object -Unique)) {
    try {
      $v = & $exe -c 'import sys, venv, ensurepip; print("%d.%d" % sys.version_info[:2])' 2>$null
      if ($LASTEXITCODE -eq 0 -and [version]$v -ge $MinPython) { return $exe }
    } catch { }
  }
  return $null
}

function Install-Python {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Fail "Python $MinPython or newer is required and winget is not available to install it. Install Python from https://www.python.org/downloads/ (tick 'Add python.exe to PATH') and run this command again."
  }
  Say 'Installing Python 3.12 with winget...'
  & winget install --id Python.Python.3.12 -e --silent --scope machine --accept-package-agreements --accept-source-agreements | Out-Null
  # winget returns before PATH changes reach this session; Find-Python also checks the install folders.
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

# Fetch-AgentFile <name> <destination>: downloads from the base URL, or copies from a local directory.
function Get-AgentFile([string]$Name, [string]$Destination, [string]$Base) {
  if ($DryRun) { Say "+ fetch $Base/$Name -> $Destination"; return }
  if ($Base -match '^https?://') {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    try { Invoke-WebRequest -Uri "$Base/$Name" -OutFile $Destination -UseBasicParsing }
    catch { Fail "could not download $Base/$Name ($($_.Exception.Message))" }
  } else {
    Copy-Item -LiteralPath (Join-Path $Base $Name) -Destination $Destination -Force
  }
}

# Sets KEY=VALUE in the env file: replaces an existing line, keeps every other line.
function Set-ConfigValue([string]$Path, [string]$Key, [string]$Value) {
  $lines = @()
  if (Test-Path $Path) { $lines = @(Get-Content -LiteralPath $Path -Encoding UTF8 | Where-Object { $_ -notmatch ('^' + [regex]::Escape($Key) + '=') }) }
  $lines += "$Key=$Value"
  # UTF-8 without a BOM so the agent (and any other reader) sees plain text.
  [IO.File]::WriteAllLines($Path, [string[]]$lines, (New-Object Text.UTF8Encoding($false)))
}

function Write-AgentConfig([string]$Path) {
  if ($DryRun) {
    $o = if ($env:LLM_MANAGER_OLLAMA_URL) { ', LLM_MANAGER_OLLAMA_URL' } else { '' }
    Say "+ write $Path (SYSTEM and Administrators only): LLM_MANAGER_API_URL, LLM_MANAGER_SERVER_ID, LLM_MANAGER_TOKEN=<hidden>$o"
    return
  }
  if (-not (Test-Path $Path)) { New-Item -ItemType File -Path $Path -Force | Out-Null }
  # Lock the file down BEFORE the token is written into it.
  $grants = @('*S-1-5-18:(F)', '*S-1-5-32-544:(F)')   # SYSTEM, Administrators
  if ($SkipTask) { $grants += "$($env:USERDOMAIN)\$($env:USERNAME):(F)" }   # testing only: a non-elevated shell must still reach its own file
  & icacls $Path /inheritance:r /grant:r @grants | Out-Null
  Set-ConfigValue $Path 'LLM_MANAGER_API_URL' $env:LLM_MANAGER_API_URL
  Set-ConfigValue $Path 'LLM_MANAGER_SERVER_ID' $env:LLM_MANAGER_SERVER_ID
  Set-ConfigValue $Path 'LLM_MANAGER_TOKEN' $env:LLM_MANAGER_TOKEN
  if ($env:LLM_MANAGER_OLLAMA_URL) { Set-ConfigValue $Path 'LLM_MANAGER_OLLAMA_URL' $env:LLM_MANAGER_OLLAMA_URL }
}

function Register-AgentTask([string]$Python, [string]$Script, [string]$Config, [string]$Log) {
  Step "register scheduled task '$TaskName' (at startup, as SYSTEM, restart on failure)" {
    $action = New-ScheduledTaskAction -Execute $Python -Argument "`"$Script`" --config `"$Config`" --log-file `"$Log`"" -WorkingDirectory (Split-Path $Script)
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
      -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) `
      -MultipleInstances IgnoreNew -StartWhenAvailable
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
      -Description 'Reports CPU, RAM, disk and network readings to LLM-Manager every 30 seconds.' | Out-Null
    Start-ScheduledTask -TaskName $TaskName
  }
}

function Invoke-Install {
  Say 'LLM-Manager agent installer (Windows)'
  Test-Inputs
  if (-not $DryRun -and -not $SkipTask -and -not (Test-Admin)) {
    Fail 'please run this in PowerShell as Administrator (right-click PowerShell, Run as administrator)'
  }

  $base = if ($env:LLM_MANAGER_AGENT_BASE) { $env:LLM_MANAGER_AGENT_BASE.TrimEnd('/', '\') } else { $DefaultBase }
  $api = $env:LLM_MANAGER_API_URL

  if ($DryRun) { Say "+ check $api answers" }
  else {
    try {
      $probe = Invoke-RestMethod -Uri $api -TimeoutSec 10 -UseBasicParsing
      if ($probe.ok) { Say 'Dashboard reachable.' } else { throw 'unexpected response' }
    } catch { Write-Warning "could not reach $api (wrong URL, or no internet from this machine?). Continuing; the agent will keep retrying." }
  }

  $python = Find-Python
  if ($python) { Say "Using existing Python: $python" }
  elseif ($DryRun) { Say '+ winget install Python.Python.3.12'; $python = 'python' }
  else {
    Install-Python
    $python = Find-Python
    if (-not $python) { Fail "Python $MinPython or newer was not found after installing. Open a new Administrator PowerShell and run the command again." }
  }

  $venv = Join-Path $InstallDir 'venv'
  $venvPython = Join-Path $venv 'Scripts\python.exe'
  $agentPy = Join-Path $InstallDir 'llm_manager_agent.py'
  $reqs = Join-Path $InstallDir 'requirements.txt'
  $config = Join-Path $InstallDir 'agent.env'
  $log = Join-Path $InstallDir 'agent.log'

  Step "create $InstallDir" { New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null }
  Step "create venv $venv" { & $python -m venv $venv; if ($LASTEXITCODE -ne 0) { Fail 'creating the Python virtual environment failed' } }

  Get-AgentFile 'llm_manager_agent.py' $agentPy $base
  Get-AgentFile 'requirements.txt' $reqs $base
  if (-not $DryRun) {
    if (-not (Select-String -Path $agentPy -Pattern '^AGENT_VERSION' -Quiet)) { Fail 'downloaded agent file looks wrong (is the download URL correct?)' }
    $ver = (Select-String -Path $agentPy -Pattern '^AGENT_VERSION\s*=\s*"([^"]+)"').Matches[0].Groups[1].Value
    Say "Agent $ver"
  }
  Step 'pip install -r requirements.txt' {
    & $venvPython -m pip install --disable-pip-version-check -q -r $reqs
    if ($LASTEXITCODE -ne 0) { Fail 'installing psutil failed' }
  }

  Write-AgentConfig $config

  if ($SkipTask) { Say 'Skipping the scheduled task (-SkipTask).' }
  else { Register-AgentTask $venvPython $agentPy $config $log }

  if (-not $DryRun -and -not $SkipTask) {
    Say 'Waiting for the first report...'
    Start-Sleep -Seconds 12
    $failed = $null
    if (Test-Path $log) { $failed = Select-String -Path $log -Pattern 'report failed|invalid configuration|missing configuration' | Select-Object -Last 2 }
    $state = (Get-ScheduledTask -TaskName $TaskName).State
    if ($failed) {
      Write-Warning "the agent started but reported a problem:`n$($failed.Line -join "`n")"
      Write-Warning 'check the token and server id, then run the command from the dashboard again.'
    } elseif ($state -eq 'Running') {
      Say 'Agent is running and reporting. The server should show Online in the dashboard within a minute.'
    } else {
      Write-Warning "the scheduled task state is '$state'. Check $log"
      exit 1
    }
  }
  Say "Done. Log: $log. To remove: Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false; Remove-Item -Recurse -Force '$InstallDir'"
}

if (-not $SourceOnly) { Invoke-Install }
