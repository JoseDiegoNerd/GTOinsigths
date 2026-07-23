@echo off
cd /d "%~dp0"
title GTO Insights Local

echo Iniciando GTO Insights local...
echo.
echo Esta janela precisa ficar aberta enquanto voce usa o app.
echo.

set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"

echo Limpando logs anteriores...
del server-start.out.log server-start.err.log 2>nul

echo.
echo Links do app:
echo - http://127.0.0.1:5173/
echo - http://localhost:3000/
echo.
echo Se aparecer erro abaixo, me envie o texto.
echo.

"%NODE_EXE%" scripts\serve-public.mjs 1>>server-start.out.log 2>>server-start.err.log

echo.
echo O servidor encerrou.
echo.
if exist server-start.err.log (
  echo Erros:
  type server-start.err.log
)
echo.
pause
