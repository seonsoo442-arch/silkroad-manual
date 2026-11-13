@echo off
rem ============================================================
rem  SILKROAD manual - start local admin (5174) + preview (5173)
rem  Double-click to run. Each server opens in its own window;
rem  close those windows (or run the stop file) to shut down.
rem  NOTE: keep this file ASCII-only. cmd.exe reads .bat files
rem  in the ANSI code page, so UTF-8 Korean text breaks parsing.
rem ============================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing packages for the first run. Please wait...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

call :start 5174 "SILKROAD admin (5174)" tools\admin.mjs
call :start 5173 "SILKROAD preview (5173)" tools\serve.mjs

rem wait until the admin server answers (max ~10 s)
for /l %%i in (1,1,20) do (
  netstat -ano | findstr /r /c:":5174 .*LISTENING" >nul && goto ready
  ping -n 2 127.0.0.1 >nul
)
echo [ERROR] The admin server did not start. Check the "SILKROAD admin (5174)" window.
pause
exit /b 1

:ready
echo.
echo  Admin page : http://127.0.0.1:5174
echo  Preview    : http://127.0.0.1:5173
echo.
if /i not "%~1"=="nobrowser" start "" "http://127.0.0.1:5174/"
exit /b 0

rem ---- start one server unless its port is already in use ----
:start
netstat -ano | findstr /r /c:":%~1 .*LISTENING" >nul
if not errorlevel 1 (
  echo Port %~1 is already running - skipped.
  exit /b 0
)
start "%~2" /min cmd /k node %~3
exit /b 0
