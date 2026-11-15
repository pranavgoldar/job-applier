@echo off
setlocal
cd /d "%~dp0"
title Career OS
where node >nul 2>nul
if errorlevel 1 goto missing_node
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)"
if errorlevel 1 goto old_node
if not exist "src\server.mjs" goto missing_files
echo Starting Career OS.
echo Open http://127.0.0.1:4173 in your browser once the server is ready.
echo Keep this window open while using the app. Press Ctrl+C to stop.
echo.
node "src\server.mjs"
pause
exit /b
:missing_node
echo Node.js was not found. Install Node.js 24 or newer, then reopen this file.
pause
exit /b 1
:old_node
echo Node.js 24 or newer is required.
node --version
pause
exit /b 1
:missing_files
echo App files are missing. Extract the entire source ZIP before opening this launcher.
echo This file must be beside package.json and the src folder.
pause
exit /b 1
