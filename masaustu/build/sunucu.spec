# -*- mode: python ; coding: utf-8 -*-
# DersNabzı sunucusu için PyInstaller tanımı (tek KLASÖR: dersnabzi-sunucu/).
# Çalıştırma: masaustu/build/paketle.ps1 (ya da depo kökünden: python -m PyInstaller masaustu/build/sunucu.spec)
# Paket yalnız kodu ve static/ klasörünü içerir; veri ASLA pakete girmez (DERSNABZI_DATA zorunlu).
import os

DEPO = os.path.abspath(os.path.join(SPECPATH, "..", ".."))

a = Analysis(
    [os.path.join(DEPO, "server.py")],
    pathex=[DEPO],
    binaries=[],
    datas=[(os.path.join(DEPO, "static"), "static")],
    hiddenimports=["kayit", "yonetim"],
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="dersnabzi-sunucu",
    debug=False,
    strip=False,
    upx=False,
    console=True,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="dersnabzi-sunucu",
)
