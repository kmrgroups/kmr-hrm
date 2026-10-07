@echo off
cd /d "%~dp0"
python esbee_bridge.py users
echo Open the users_*.csv file in this folder with Excel.
pause
