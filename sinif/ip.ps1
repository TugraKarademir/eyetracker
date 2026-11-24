# Ogretmen bilgisayarinin IPv4 adreslerini listeler (dongu ve 169.254 hari\u00e7).
# Kullanim: powershell -ExecutionPolicy Bypass -File sinif\ip.ps1
$adresler = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*' }
if (-not $adresler) {
    Write-Host 'IPv4 adresi bulunamadi. Ag baglantisini kontrol edin.' -ForegroundColor Red
    exit 1
}
$adresler | Sort-Object InterfaceAlias |
    Select-Object @{n='Adres';e={$_.IPAddress}}, @{n='Baglanti';e={$_.InterfaceAlias}} |
    Format-Table -AutoSize
Write-Host 'Ogrencilerle ayni agdaki adresi secin (genellikle Wi-Fi ya da Ethernet), sonra:'
Write-Host '  powershell -ExecutionPolicy Bypass -File sinif\sertifika.ps1 -IP <adres>'
