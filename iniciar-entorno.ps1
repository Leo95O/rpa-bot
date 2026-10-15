# iniciar-entorno.ps1 — Levanta el entorno de desarrollo del bot RPA sin bloquear la consola.
# Uso: powershell -ExecutionPolicy Bypass -File .\iniciar-entorno.ps1

$ErrorActionPreference = 'Continue'

# 1. Chrome limpio para automatización (CDP :9222). Mata previos y levanta uno nuevo en paralelo.
taskkill /F /IM chrome.exe /T 2>$null | Out-Null
Start-Process -FilePath "C:\Program Files\Google\Chrome\Application\chrome.exe" -ArgumentList @(
  '--remote-debugging-port=9222',
  '--user-data-dir=C:\chrome-temp',
  '--remote-allow-origins=*',
  'http://localhost:9002/#!/escritorio'
)
Write-Output '[OK] Chrome CDP lanzado (puerto 9222).'

# 2. Frontend (grunt :9002) en una consola nueva, también sin bloquear.
Start-Process -FilePath 'cmd.exe' -ArgumentList @(
  '/c', 'start', '"logisticaview-frontend"',
  'cmd', '/k', 'C:\Practicas\RESTAURANT_PROYECT\logisticaview\scripts\start-dev.bat'
)
Write-Output '[OK] Consola del frontend abierta.'
Write-Output 'Siguiente paso: iniciar sesión (admin / seven26$) y correr npm run test:suite'
