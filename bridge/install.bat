@echo off
cd /d "%~dp0"
python --version >nul 2>&1 || (echo Python is not installed. Install it from python.org first, tick "Add Python to PATH". & pause & exit /b)
python -m pip install --upgrade pyzk
if not exist bridge.ini copy bridge.ini.example bridge.ini
echo.
echo Done. Now open bridge.ini in Notepad and paste the API key, then run 1_test.bat
pause
