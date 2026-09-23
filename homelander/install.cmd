@echo off
chcp 65001 >nul
title homelander installer
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if errorlevel 1 (
  echo.
  echo Install failed. See the messages above.
) else (
  echo.
  echo Done. Restart OpenCode Desktop to load the plugin.
)
pause
