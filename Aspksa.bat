@echo off
setlocal
cd /d "%~dp0"
set "PORT=4173"
where py >nul 2>nul
if not errorlevel 1 (
  start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:%PORT%/"
  py -3 -m http.server %PORT% --bind 127.0.0.1
  goto :eof
)
where python >nul 2>nul
if not errorlevel 1 (
  start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:%PORT%/"
  python -m http.server %PORT% --bind 127.0.0.1
  goto :eof
)
echo Python 3 is not installed.
echo Install it from https://www.python.org/downloads/ and run Aspksa.bat again.
pause
