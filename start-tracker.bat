@echo off
cd /d "%~dp0"
echo Starting Application Tracker...
echo Opening http://localhost:4174 in your browser.
start "" powershell -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:4174'"
npm start
pause
