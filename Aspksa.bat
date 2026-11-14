@echo off
setlocal DisableDelayedExpansion
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Tracktor.ps1"
set "TRACKTOR_EXIT=%ERRORLEVEL%"
if "%TRACKTOR_EXIT%"=="0" exit /b 0
echo.
echo TRACKTOR could not start. See data\launcher.log.
pause
exit /b %TRACKTOR_EXIT%
