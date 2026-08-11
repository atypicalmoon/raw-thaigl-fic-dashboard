@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 scripts\build_cp_report_data.py
  if errorlevel 1 goto failed
  goto success
)
where python >nul 2>nul
if %errorlevel%==0 (
  python scripts\build_cp_report_data.py
  if errorlevel 1 goto failed
  goto success
)
echo Python 3 was not found. Please install Python 3 and run this file again.
goto failed
:success
echo.
echo Update finished. You can close this window.
goto end
:failed
echo.
echo Update failed. No report files were refreshed.
:end
pause
