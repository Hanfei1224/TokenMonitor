@echo off
title OpenCode Monitor
cd /d "%~dp0"
if not exist "src\scripts\dev-app.cjs" (
  echo ERROR: cannot find src\scripts\dev-app.cjs
  echo dir=%CD%
  echo script=%~f0
  pause
  exit /b 1
)
cd src

where node >nul 2>&1
if errorlevel 1 (
  set "PATH=%PATH%;%LOCALAPPDATA%\Programs\DevTools\nodejs-24.15.0\node-v24.15.0-win-x64;%LOCALAPPDATA%\Programs\nodejs;%ProgramFiles%\nodejs"
)

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: node.exe not found. Add Node.js to PATH.
  pause
  exit /b 1
)

echo Starting OpenCode Monitor...
echo Log file: %~dp0startup.log
echo This window stays open. Press any key after it finishes.
echo.
node scripts\dev-app.cjs
echo.
echo Exit code %ERRORLEVEL%
echo Log file: %~dp0startup.log
pause