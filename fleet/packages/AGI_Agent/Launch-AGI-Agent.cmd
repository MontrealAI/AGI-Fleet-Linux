@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  start "" "https://nodejs.org/en/download"
  echo Install Node.js 24 LTS, then open Launch-AGI-Agent.cmd again.
  pause
  exit /b 1
)
node src/launch.mjs
if errorlevel 1 pause
