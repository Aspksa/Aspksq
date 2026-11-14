@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if not errorlevel 1 (
  py -3 server.py --open-browser
  if errorlevel 1 pause
  goto :eof
)
where python >nul 2>nul
if not errorlevel 1 (
  python server.py --open-browser
  if errorlevel 1 pause
  goto :eof
)
echo Python 3.9 or newer is required.
echo Install it from https://www.python.org/downloads/ and enable Add Python to PATH.
pause
