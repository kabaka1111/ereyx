@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Устанавливаю зависимости...
  npm install
)
npm run dev
