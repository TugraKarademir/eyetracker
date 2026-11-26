"""Harf Avcısı — iPad / tablet için yerel HTTPS sunucusu.

iPad'de Safari kamerayı yalnızca https:// sayfalarda açar. Bu betik oyunu
bilgisayarınızdan aynı Wi-Fi'deki iPad'e https ile sunar (kendinden imzalı
sertifika; ilk açılışta Safari'de "Ayrıntıları Göster → web sitesini ziyaret et").

Kullanım:  py sunucu.py        (varsayılan port 8443)
           py sunucu.py 9000
"""
import datetime
import functools
import http.server
import ipaddress
import os
import shutil
import socket
import ssl
import subprocess
import sys

KLASOR = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8443
SERT_KLASOR = os.path.join(KLASOR, ".sertifika")
SERT = os.path.join(SERT_KLASOR, "sertifika.pem")
ANAHTAR = os.path.join(SERT_KLASOR, "anahtar.pem")


def yerel_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # paket gönderilmez, yalnızca arayüz seçilir
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def sertifika_uret(ip):
    os.makedirs(SERT_KLASOR, exist_ok=True)
    try:
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.x509.oid import NameOID

        anahtar = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        ad = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Harf Avcisi yerel")])
        simdi = datetime.datetime.now(datetime.timezone.utc)
        sert = (
            x509.CertificateBuilder()
            .subject_name(ad).issuer_name(ad)
            .public_key(anahtar.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(simdi - datetime.timedelta(days=1))
            .not_valid_after(simdi + datetime.timedelta(days=825))
            .add_extension(x509.SubjectAlternativeName([
                x509.DNSName("localhost"),
                x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
                x509.IPAddress(ipaddress.ip_address(ip)),
            ]), critical=False)
            .sign(anahtar, hashes.SHA256())
        )
        with open(ANAHTAR, "wb") as f:
            f.write(anahtar.private_bytes(serialization.Encoding.PEM,
                                          serialization.PrivateFormat.TraditionalOpenSSL,
                                          serialization.NoEncryption()))
        with open(SERT, "wb") as f:
            f.write(sert.public_bytes(serialization.Encoding.PEM))
        return
    except ImportError:
        pass
    openssl = shutil.which("openssl") or r"C:\Program Files\Git\usr\bin\openssl.exe"
    if not os.path.exists(openssl) and not shutil.which("openssl"):
        sys.exit("Sertifika üretilemedi: 'py -m pip install cryptography' çalıştırın.")
    subprocess.run([openssl, "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "825",
                    "-keyout", ANAHTAR, "-out", SERT, "-subj", "/CN=Harf Avcisi yerel",
                    "-addext", f"subjectAltName=DNS:localhost,IP:127.0.0.1,IP:{ip}"], check=True)


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    ip = yerel_ip()
    ip_dosya = os.path.join(SERT_KLASOR, "ip.txt")
    eski_ip = open(ip_dosya).read().strip() if os.path.exists(ip_dosya) else None
    if not (os.path.exists(SERT) and os.path.exists(ANAHTAR)) or eski_ip != ip:
        sertifika_uret(ip)
        with open(ip_dosya, "w") as f:
            f.write(ip)

    class Isleyici(http.server.SimpleHTTPRequestHandler):
        # tablet eski dosyaları önbellekten göstermesin: her açılışta güncel sürüm
        def end_headers(self):
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            super().end_headers()

    isleyici = functools.partial(Isleyici, directory=KLASOR)
    sunucu = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), isleyici)
    bag = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    bag.load_cert_chain(SERT, ANAHTAR)
    sunucu.socket = bag.wrap_socket(sunucu.socket, server_side=True)

    print("=" * 60)
    print(" Harf Avcısı çalışıyor")
    print(f"  Bu bilgisayarda : https://localhost:{PORT}")
    print(f"  iPad / tablette : https://{ip}:{PORT}")
    print("  (iPad aynı Wi-Fi'de olmalı. Safari uyarı verirse:")
    print("   'Ayrıntıları Göster' > 'bu web sitesini ziyaret et')")
    print("  Durdurmak için Ctrl+C")
    print("=" * 60)
    try:
        sunucu.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
