@echo off
cd /d "%~dp0"
title KMR HRM bridge - leave this window open
python esbee_bridge.py run
pause
