@echo off
cd /d "%~dp0"
echo Iniciando GTO Insights...
echo.
echo Links locais:
echo - http://127.0.0.1:5173/
echo - http://localhost:3000/
echo.
echo IMPORTANTE: deixe esta janela aberta enquanto estiver usando o app.
echo.
if exist "C:\Program Files\nodejs\node.exe" (
  "C:\Program Files\nodejs\node.exe" scripts\serve-public.mjs
) else (
  node scripts\serve-public.mjs
)
pause
