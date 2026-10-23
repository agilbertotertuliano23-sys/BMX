@echo off
rem BMX - agente pessoal de saude. Sobe o servidor e abre http://localhost:8740
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 server.py
) else (
  python server.py
)
pause
