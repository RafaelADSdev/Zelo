@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Instale o Node.js 22 ou superior para iniciar.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm.cmd ci --ignore-scripts --no-audit --no-fund
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node --input-type=module -e "try{try{process.loadEnvFile('.env')}catch{}const r=await fetch('http://127.0.0.1:'+(process.env.PORT||4173)+'/api/health',{signal:AbortSignal.timeout(2000)});const s=await r.json();process.exit(s.app==='wappy'?0:1)}catch{process.exit(1)}"
if not errorlevel 1 (
  echo Zelo ja esta rodando. Abra o painel no endereco configurado.
  pause
  exit /b 0
)
echo O endereco do painel sera mostrado abaixo.
node "%~dp0server.mjs"
pause
