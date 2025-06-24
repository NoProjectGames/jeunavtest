@echo off
REM Lancer le serveur Node.js
start cmd /k "cd /d %~dp0server && npm install && node index.js"

REM Lancer le front React
start cmd /k "cd /d %~dp0client && npm install && npm start"

exit 