@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title StudyFlow 4.0 - تشغيل النظام
color 0B
cd /d "%~dp0"

echo ========================================================
echo               StudyFlow 4.0 - تشغيل النظام
echo ========================================================
echo.

set "NODE_DIR="
if exist "%USERPROFILE%\Downloads\node-v22.23.3-win-x64\node-v22.23.3-win-x64\node.exe" (
    set "NODE_DIR=%USERPROFILE%\Downloads\node-v22.23.3-win-x64\node-v22.23.3-win-x64"
) else if exist "%USERPROFILE%\Downloads\node-v22.23.3-win-x64\node.exe" (
    set "NODE_DIR=%USERPROFILE%\Downloads\node-v22.23.3-win-x64"
) else if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE_DIR=C:\Program Files\nodejs"
)

if defined NODE_DIR (
    set "PATH=%NODE_DIR%;!PATH!"
    echo [OK] Using Node.js at: !NODE_DIR!
)

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found!
    echo Please make sure Node.js 22 is extracted in Downloads.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm not found!
    pause
    exit /b 1
)

if not exist "server\.env" (
    if exist "server\.env.example" (
        copy "server\.env.example" "server\.env" >nul
        echo [OK] Created server\.env from .env.example
    )
)

if not exist "node_modules\concurrently\package.json" (
    echo [INFO] Installing root dependencies...
    call npm install
)

if not exist "server\node_modules\express\package.json" (
    echo [INFO] Installing server dependencies...
    call npm --prefix server install
)

if not exist "client\node_modules\vite\package.json" (
    echo [INFO] Installing client dependencies...
    call npm --prefix client install
)

if not exist "server\node_modules\better-sqlite3\build\Release\better_sqlite3.node" (
    echo [INFO] Downloading prebuilt SQLite binary...
    cd server\node_modules\better-sqlite3
    call npx prebuild-install
    cd ..\..\..
)

echo.
echo ========================================================
echo  [OK] StudyFlow is starting!
echo  - Frontend: http://localhost:5173
echo  - Backend:  http://localhost:4000
echo  Keep this window open while using the application.
echo ========================================================
echo.

start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:5173"

call npm run dev

pause
exit /b 0
