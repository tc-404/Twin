@echo off
setlocal EnableExtensions
title sssx-spjx Build
cd /d "%~dp0"
if errorlevel 1 goto FAIL_CD

echo ========================================
echo   sssx-spjx Build
echo ========================================
echo.
echo Folder: %CD%
echo.

where node >nul 2>&1
if errorlevel 1 goto FAIL_NODE

where npm >nul 2>&1
if errorlevel 1 goto FAIL_NPM

echo Node:
node -v
echo npm:
call npm.cmd -v
echo.

rem Read version from package.json (used in the zip file name)
for /f "usebackq delims=" %%v in (`node -p "require('./package.json').version"`) do set "VER=%%v"
if not defined VER set "VER=0.0.0"
echo Version: %VER%
echo.

if exist node_modules goto DO_BUILD

echo [1/3] npm install ...
call npm.cmd install
if errorlevel 1 goto FAIL_INSTALL
echo.

:DO_BUILD
echo [2/3] npm run build ...
call npm.cmd run build
if errorlevel 1 goto FAIL_BUILD
echo.

if not exist "sssx-plugin-spjx\index.mjs" goto FAIL_NOOUT

echo [3/3] Packaging zip ...
if not exist dist mkdir dist

rem Keep the sssx-plugin-spjx/ folder as the zip root entry.
rem The importer resolves the plugin root either way (plugin.importer.ts:256);
rem one wrapper folder avoids files scattering on extract.
powershell -NoProfile -Command "Compress-Archive -Path 'sssx-plugin-spjx' -DestinationPath 'dist\sssx-plugin-spjx-v%VER%.zip' -Force"
if errorlevel 1 goto FAIL_ZIP

echo.
echo ========================================
echo   Build OK
echo   Folder : %CD%\sssx-plugin-spjx\
echo   Zip    : %CD%\dist\sssx-plugin-spjx-v%VER%.zip
echo ========================================
echo.
goto END_OK

:FAIL_CD
echo [ERROR] Cannot enter script folder.
goto END_FAIL

:FAIL_NODE
echo [ERROR] Node.js not found.
echo Install: https://nodejs.org/
goto END_FAIL

:FAIL_NPM
echo [ERROR] npm not found.
goto END_FAIL

:FAIL_INSTALL
echo [ERROR] npm install failed.
goto END_FAIL

:FAIL_BUILD
echo.
echo [ERROR] Build failed.
goto END_FAIL

:FAIL_NOOUT
echo.
echo [ERROR] Build finished but sssx-plugin-spjx\index.mjs not found.
goto END_FAIL

:FAIL_ZIP
echo.
echo [ERROR] Zip failed (PowerShell Compress-Archive).
goto END_FAIL

:END_OK
echo Press any key to close...
pause >nul
exit /b 0

:END_FAIL
echo.
echo Press any key to close...
pause >nul
exit /b 1
