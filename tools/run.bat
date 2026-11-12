@echo off
setlocal
set "LOG=%~dp0hwp2hwpx_log.txt"
echo ==== start %DATE% %TIME% ==== > "%LOG%"
echo Converting HWP to HWPX. Hancom windows will open and close automatically.
echo Log: %LOG%
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0hwp2hwpx.ps1" %* >> "%LOG%" 2>&1
type "%LOG%"
echo.
echo ==== finished ====
pause
