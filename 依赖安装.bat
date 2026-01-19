@echo off
chcp 65001 > nul
cd /d "%~dp0"
npm install express ws cors tiny-pinyin
pause