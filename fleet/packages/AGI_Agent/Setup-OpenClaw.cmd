@echo off
cd /d "%~dp0"
node scripts\setup-openclaw.mjs %*
if errorlevel 1 pause
