@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if not errorlevel 1 (
  node --env-file-if-exists=.env server/index.mjs
) else (
  if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
    "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" --env-file-if-exists=.env server/index.mjs
  ) else (
    echo Install Node.js 24.14 or newer, then run this file again.
  )
)
pause
