@echo off
rem Starts Ark Director Studio (built client + server) in this desktop session.
cd /d "%~dp0\.."
if not exist dist\index.html call npm run build
npx tsx server\index.ts >> data\studio.log 2>&1
