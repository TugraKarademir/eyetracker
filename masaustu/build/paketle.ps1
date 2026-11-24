# DersNabzı masaüstü paketleme (Windows x64).
# 1) PyInstaller: server.py + kayit.py + yonetim.py + static/ -> masaustu/build-py/dist/dersnabzi-sunucu/
# 2) electron-builder: NSIS kurulum dosyası -> masaustu/dist/
# Gerekenler: Python + PyInstaller 6 veya üstü (python -m pip install "pyinstaller>=6"; _internal/ düzeni), masaustu/ içinde npm install.
# Çalıştırma (depo kökünden ya da herhangi bir yerden):  powershell -ExecutionPolicy Bypass -File masaustu/build/paketle.ps1
$ErrorActionPreference = "Stop"
$masaustu = Split-Path -Parent $PSScriptRoot
$depo = Split-Path -Parent $masaustu
$pyCikti = Join-Path $masaustu "build-py"

Write-Host "== 1/2 PyInstaller: dersnabzi-sunucu"
Push-Location $depo
try {
    python -m PyInstaller --noconfirm --clean `
        --distpath (Join-Path $pyCikti "dist") `
        --workpath (Join-Path $pyCikti "work") `
        (Join-Path $PSScriptRoot "sunucu.spec")
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller başarısız (kod $LASTEXITCODE)" }
} finally { Pop-Location }

$exe = Join-Path $pyCikti "dist\dersnabzi-sunucu\dersnabzi-sunucu.exe"
if (-not (Test-Path $exe)) { throw "PyInstaller çıktısı yok: $exe" }
if (-not (Test-Path (Join-Path $pyCikti "dist\dersnabzi-sunucu\_internal\static\student.html"))) { throw "static/ pakete girmemiş" }

Write-Host "== 2/2 electron-builder: NSIS"
Push-Location $masaustu
try {
    npx electron-builder --win nsis --x64 --config electron-builder.yml
    if ($LASTEXITCODE -ne 0) { throw "electron-builder başarısız (kod $LASTEXITCODE)" }
} finally { Pop-Location }

Get-ChildItem (Join-Path $masaustu "dist") -Filter *.exe | ForEach-Object {
    Write-Host ("Kurulum dosyası: {0} ({1:N1} MB)" -f $_.FullName, ($_.Length / 1MB))
}
