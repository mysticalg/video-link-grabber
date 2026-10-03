@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0Setup.ps1"
set "setupExit=%errorlevel%"
echo.
if not "%setupExit%"=="0" echo Setup failed. Read the message above before trying again.
pause
exit /b %setupExit%
