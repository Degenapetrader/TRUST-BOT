@echo off
echo Starting VIRTUAL Trading Bot Desktop...
echo.
echo 🤖 VIRTUAL Trading Bot Desktop v1.0
echo 📍 Location: %cd%
echo.

REM Check if node_modules exists
if not exist "node_modules" (
    echo ❌ Dependencies not found. Installing...
    call npm install
    echo.
)

REM Start the Electron app
echo 🚀 Launching desktop application...
call npm start

pause 