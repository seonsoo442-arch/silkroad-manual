@echo off
rem ============================================================
rem  SILKROAD manual - stop local admin (5174) + preview (5173)
rem  NOTE: keep this file ASCII-only (see the start file).
rem ============================================================
setlocal
set FOUND=
rem 1) server windows opened by the start file (closes the window too)
for %%t in ("SILKROAD admin (5174)" "SILKROAD preview (5173)") do (
  taskkill /fi "WINDOWTITLE eq %%~t*" /t /f >nul 2>nul && set FOUND=1
)
rem 2) anything else still listening on the ports (e.g. started with npm run)
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":5173 .*LISTENING" /c:":5174 .*LISTENING"') do (
  taskkill /pid %%p /t /f >nul 2>nul && set FOUND=1
)
if defined FOUND (
  echo Stopped the admin / preview servers.
) else (
  echo No server was running.
)
if /i not "%~1"=="nopause" ping -n 4 127.0.0.1 >nul
exit /b 0
