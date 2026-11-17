@echo off
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo Ilk kurulum yapiliyor...
  py -3.12 -m venv .venv || py -m venv .venv
  .venv\Scripts\python.exe -m pip install -r requirements.txt
)
if not exist .env copy .env.example .env >nul
start "" .venv\Scripts\pythonw.exe uygulama.py %*
