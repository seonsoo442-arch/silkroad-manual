@echo off
setlocal
cd /d "%~dp0"

set "LOG=%~dp0hwp2hwpx_log.txt"
echo ==== hwp2hwpx 시작 %DATE% %TIME% ==== > "%LOG%"
echo 작업 폴더: %~dp0 >> "%LOG%"

where powershell >> "%LOG%" 2>&1
if errorlevel 1 (
    echo [오류] powershell.exe 를 찾을 수 없습니다. >> "%LOG%"
    echo [오류] powershell.exe 를 찾을 수 없습니다.
    pause
    exit /b 1
)

echo 변환을 시작합니다. 한/글 창이 자동으로 열리고 닫힙니다.
echo 로그: %LOG%
echo.

powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0hwp2hwpx.ps1" %* 2>&1 | powershell -NoProfile -Command "$input | Tee-Object -FilePath '%LOG%' -Append"

echo.
echo ==== 종료 (ERRORLEVEL=%ERRORLEVEL%) ====
echo ==== 종료 %DATE% %TIME% ERRORLEVEL=%ERRORLEVEL% ==== >> "%LOG%"
echo 로그 파일: %LOG%
echo.
echo 창을 닫으려면 아무 키나 누르세요...
pause > nul
