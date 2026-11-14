@echo off
title Twin
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Twin needs Node.js. Opening nodejs.org: install the LTS version, then double-click START again.
  start "" https://nodejs.org
  pause
  exit /b 1
)
node scripts\start.mjs
if errorlevel 1 pause
