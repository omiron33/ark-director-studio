# Registers "Ark Director Studio" to start at logon in the signed-in desktop session, so its Grok and
# Blender windows open where you can see them. Run once from PowerShell in the repo folder.
$repo = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force -Path (Join-Path $repo 'data') | Out-Null
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$repo\scripts\start.cmd`"" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'Ark Director Studio' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "Registered. Start it now with: Start-ScheduledTask -TaskName 'Ark Director Studio'"
