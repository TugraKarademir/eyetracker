# DersNabzi sinif testi: yerel CA + sunucu sertifikasi uretir (Windows PowerShell 5.1 uyumlu).
# Kullanim: powershell -ExecutionPolicy Bypass -File sinif\sertifika.ps1 -IP 192.168.1.50 [-Force]
param(
    [Parameter(Mandatory = $true)][string]$IP,
    [switch]$Force
)
$ErrorActionPreference = 'Stop'

# IPv4 bicim dogrulama
$okt = $IP.Split('.')
$gecerli = ($okt.Count -eq 4)
if ($gecerli) {
    foreach ($o in $okt) {
        if ($o -notmatch '^\d{1,3}$' -or [int]$o -gt 255) { $gecerli = $false }
    }
}
if (-not $gecerli) { throw "Gecersiz IPv4 adresi: '$IP' (ornek: 192.168.1.50)" }

# openssl bul
$aday = @('C:\Program Files\Git\usr\bin\openssl.exe', 'C:\Program Files\Git\mingw64\bin\openssl.exe')
$openssl = $null
foreach ($a in $aday) { if (Test-Path -LiteralPath $a) { $openssl = $a; break } }
if (-not $openssl) {
    $k = Get-Command openssl -ErrorAction SilentlyContinue
    if ($k) { $openssl = $k.Source }
}
if (-not $openssl) { throw 'openssl bulunamadi. Git for Windows kurun (https://git-scm.com) ya da openssl''i PATH''e ekleyin.' }

$klasor = $PSScriptRoot
$caAnahtar = Join-Path $klasor 'ca-anahtar.pem'
$caSert    = Join-Path $klasor 'ca.pem'
$anahtar   = Join-Path $klasor 'anahtar.pem'
$sertifika = Join-Path $klasor 'sertifika.pem'
$dagitim   = Join-Path $klasor 'DersNabzi-sertifika.crt'
$csr       = Join-Path $klasor 'istek.tmp'
$ext       = Join-Path $klasor 'uzanti.tmp'
$cnf       = Join-Path $klasor 'openssl.tmp'
$srl       = Join-Path $klasor 'ca.srl'

$varolan = @($caAnahtar, $caSert, $anahtar, $sertifika, $dagitim) | Where-Object { Test-Path -LiteralPath $_ }
if ($varolan -and -not $Force) {
    Write-Host 'Su dosyalar zaten var ve uzerine yazilacak:' -ForegroundColor Yellow
    $varolan | ForEach-Object { Write-Host "  $_" }
    $cevap = Read-Host 'Devam edilsin mi? (e/H)'
    if ($cevap -notmatch '^[eEyY]') { Write-Host 'Iptal edildi.'; exit 1 }
}

function Calistir {
    param([string[]]$Arguman)
    & $openssl @Arguman
    if ($LASTEXITCODE -ne 0) { throw "openssl hata verdi (kod $LASTEXITCODE): $($Arguman -join ' ')" }
}

try {
    # Kendi yapilandirma dosyamiz (Git'in openssl.cnf yoluna bagimli kalmayalim)
    Set-Content -LiteralPath $cnf -Encoding ASCII -Value @'
[req]
distinguished_name = dn
prompt = no
[dn]
CN = DersNabzi
[v3_ca]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
'@

    # 1) Yerel CA (lab bilgisayarlarina bu kurulur)
    Calistir @('genrsa', '-out', $caAnahtar, '2048')
    Calistir @('req', '-x509', '-new', '-config', $cnf, '-extensions', 'v3_ca', '-key', $caAnahtar,
               '-sha256', '-days', '365', '-subj', '/CN=DersNabzi sinif testi CA', '-out', $caSert)

    # 2) Sunucu anahtari ve istegi
    Calistir @('genrsa', '-out', $anahtar, '2048')
    Calistir @('req', '-new', '-config', $cnf, '-key', $anahtar, '-subj', '/CN=DersNabzi sinif testi', '-out', $csr)

    # 3) Sunucu sertifikasi: CA ile imzali, yaprak (CA:FALSE), SAN = IP + 127.0.0.1 + localhost
    Set-Content -LiteralPath $ext -Encoding ASCII -Value @"
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = IP:$IP,IP:127.0.0.1,DNS:localhost
authorityKeyIdentifier = keyid
subjectKeyIdentifier = hash
"@
    Calistir @('x509', '-req', '-in', $csr, '-CA', $caSert, '-CAkey', $caAnahtar, '-CAcreateserial',
               '-sha256', '-days', '365', '-extfile', $ext, '-out', $sertifika)

    # 4) Lab'a dagitilacak dosya = CA sertifikasi
    Copy-Item -LiteralPath $caSert -Destination $dagitim -Force
}
finally {
    foreach ($t in @($csr, $ext, $cnf)) { if (Test-Path -LiteralPath $t) { Remove-Item -LiteralPath $t -Force } }
}

Write-Host ''
Write-Host 'Tamam. Uretilenler (klasor: ' $klasor ')' -ForegroundColor Green
Write-Host '  sertifika.pem, anahtar.pem            -> sunucu (bu bilgisayarda kalir)'
Write-Host '  DersNabzi-sertifika.crt               -> her lab bilgisayarina kopyalanacak (yerel CA)'
Write-Host '  ca-anahtar.pem                        -> gizli, kimseye verilmez'
Write-Host ''
Write-Host "Sertifika bu IP'ler icin gecerli: $IP, 127.0.0.1, localhost (365 gun)"
Write-Host 'Bu bilgisayarin IPv4 adresleri:'
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*' } |
    ForEach-Object { Write-Host ('  {0}  ({1})' -f $_.IPAddress, $_.InterfaceAlias) }
Write-Host ''
Write-Host 'Sonraki adimlar:'
Write-Host '  1) Sunucu: cd E:\eyetracker; python server.py --port 8030 --https-port 8443 --cert sinif\sertifika.pem --key sinif\anahtar.pem'
Write-Host '  2) Lab PC: certutil -user -addstore Root DersNabzi-sertifika.crt'
Write-Host "  3) Ogrenci adresi: https://${IP}:8443/student.html"
Write-Host 'Ag IP''si degisirse bu betik yeni IP ile yeniden calistirilir ve crt lab''a yeniden kurulur.'
