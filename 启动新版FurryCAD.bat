@echo off
setlocal
title FurryPattern CAD
pushd "%~dp0"
if not "%errorlevel%"=="0" goto failed

where node >nul 2>&1
if not "%errorlevel%"=="0" (
  echo Node.js is missing. Install Node.js 24 and reopen this launcher.
  goto failed
)
where npm.cmd >nul 2>&1
if not "%errorlevel%"=="0" (
  echo npm is missing. Install Node.js with npm and reopen this launcher.
  goto failed
)

set "FPCAD_DATA_DIR=%~dp0.local\workspace"
if not exist "node_modules\@tauri-apps\cli\tauri.js" goto install
if not exist "node_modules\.bin\vite.cmd" goto install
goto build

:install
echo Installing dependencies. The first launch requires network access...
call npm.cmd ci
if not "%errorlevel%"=="0" goto failed

:build
echo Building Rust geometry worker...
call npm.cmd run build:rust
if not "%errorlevel%"=="0" (
  echo Rust build failed. Check Rust 1.90.0, MSVC C++ build tools and Windows SDK.
  goto failed
)
echo Building desktop application...
call npm.cmd run build
if not "%errorlevel%"=="0" goto failed

echo Starting FurryPattern CAD...
call npm.cmd start -- %*
if not "%errorlevel%"=="0" goto failed
popd
exit /b 0

:failed
echo.
echo FurryPattern CAD could not start. See the error above.
pause
popd
exit /b 1
