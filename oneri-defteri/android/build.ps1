# Öneri Defteri — Gradle'sız APK derleme betiği
# Kullanım:  powershell -ExecutionPolicy Bypass -File build.ps1
# Gereken araçlar: $Tools\jdk (JDK 17) ve $Tools\sdk (build-tools;34.0.0 + platforms;android-34)
param([string]$Tools = "$env:USERPROFILE\android-build-tools")
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$app  = Join-Path $here "app"
$out  = Join-Path $here "build"
$jdk  = Get-ChildItem "$Tools\jdk" -Directory | Select-Object -First 1
$bt   = "$Tools\sdk\build-tools\34.0.0"
$jar  = "$Tools\sdk\platforms\android-34\android.jar"
$env:JAVA_HOME = $jdk.FullName
$env:Path = "$($jdk.FullName)\bin;$bt;$env:Path"

function Run($exe, [string[]]$a) { & $exe @a; if ($LASTEXITCODE -ne 0) { throw "$exe başarısız ($LASTEXITCODE)" } }

if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force "$out\gen", "$out\classes", "$out\dex" | Out-Null

Write-Host "1/6 Kaynaklar derleniyor"
Run "$bt\aapt2.exe" @("compile", "--dir", "$app\res", "-o", "$out\res.zip")

Write-Host "2/6 Kaynaklar bağlanıyor"
Run "$bt\aapt2.exe" @("link", "-I", $jar, "--manifest", "$app\AndroidManifest.xml", "-A", "$app\assets",
  "--java", "$out\gen", "--min-sdk-version", "24", "--target-sdk-version", "34",
  "--version-code", "1", "--version-name", "1.0", "-o", "$out\unsigned.apk", "$out\res.zip")

Write-Host "3/6 Java derleniyor"
$src = @(Get-ChildItem -Recurse "$app\src", "$out\gen" -Filter *.java | ForEach-Object FullName)
Run "javac" (@("-source", "1.8", "-target", "1.8", "-bootclasspath", $jar, "-encoding", "UTF-8", "-nowarn", "-Xlint:-options", "-d", "$out\classes") + $src)

Write-Host "4/6 DEX üretiliyor"
$classes = @(Get-ChildItem -Recurse "$out\classes" -Filter *.class | ForEach-Object FullName)
Run "$bt\d8.bat" (@("--release", "--min-api", "24", "--lib", $jar, "--output", "$out\dex") + $classes)

Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open("$out\unsigned.apk", "Update")
[void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, "$out\dex\classes.dex", "classes.dex")
$zip.Dispose()

Write-Host "5/6 Hizalanıyor"
Run "$bt\zipalign.exe" @("-f", "-p", "4", "$out\unsigned.apk", "$out\aligned.apk")

Write-Host "6/6 İmzalanıyor"
$ks = Join-Path $here "imza\oneri.keystore"
$pwFile = Join-Path $here "imza\sifre.txt"
if (-not (Test-Path $ks)) {
  New-Item -ItemType Directory -Force (Split-Path $ks) | Out-Null
  $pw = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
  Set-Content -Path $pwFile -Value $pw -Encoding ascii -NoNewline
  Run "keytool" @("-genkeypair", "-keystore", $ks, "-alias", "oneri", "-keyalg", "RSA", "-keysize", "2048",
    "-validity", "10000", "-storepass", $pw, "-keypass", $pw, "-dname", "CN=Oneri Defteri")
}
$pw = (Get-Content $pwFile -Raw).Trim()
$apk = Join-Path $here "OneriDefteri.apk"
Run "$bt\apksigner.bat" @("sign", "--ks", $ks, "--ks-key-alias", "oneri", "--ks-pass", "pass:$pw", "--key-pass", "pass:$pw",
  "--out", $apk, "$out\aligned.apk")
Run "$bt\apksigner.bat" @("verify", $apk)
Write-Host "Hazır: $apk"
