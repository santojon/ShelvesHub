# installer/Windows/install.ps1

Write-Output "Instalando Shelves Loader no Windows..."

# Diretório de instalação
$installPath = "C:\Program Files\Shelves-Loader"
New-Item -Path $installPath -ItemType Directory -Force | Out-Null

# Copiar loader
Copy-Item -Path "loader.exe" -Destination "$installPath\loader.exe"
Write-Output "Loader copiado para: $installPath."

# Task Scheduler
$action = New-ScheduledTaskAction -Execute "$installPath\loader.exe"
$trigger = New-ScheduledTaskTrigger -AtStartup
Register-ScheduledTask -TaskName "ShelvesLoader" -Action $action -Trigger $trigger | Out-Null
Write-Output "Task Scheduler configurado."

Write-Output "Instalação concluída!"