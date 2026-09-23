@echo off
chcp 65001 >nul
title my-opencode-qols installer
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
if errorlevel 1 (
  echo.
  echo Install failed. See the messages above.
) else (
  echo.
  echo Done. Restart OpenCode Desktop to load the plugins.
)
pause
