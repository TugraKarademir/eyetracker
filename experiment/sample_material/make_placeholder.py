"""
Faz 1 icin ornek materyal gorseli uretir.

Bu script yalnizca placeholder PNG'yi YENIDEN uretmek icin gereklidir ve
Pillow'a ihtiyac duyar (requirements.txt'e dahil DEGILDIR):

    .venv\\Scripts\\python.exe -m pip install Pillow
    .venv\\Scripts\\python.exe experiment\\sample_material\\make_placeholder.py

Uretilen gorsel 1200x800'dur ve ileride AOI testleri icin kullanilabilecek
belirgin bolgeler icerir: Baslik, Grafik, Metin 1, Metin 2.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 800
OUT = Path(__file__).resolve().parents[1] / "static" / "experiment" / "materials" / "ornek_materyal.png"


def font(size):
    try:
        return ImageFont.truetype("arial.ttf", size)
    except OSError:
        return ImageFont.load_default(size)


def main():
    img = Image.new("RGB", (W, H), "#ffffff")
    d = ImageDraw.Draw(img)

    # Baslik serisi
    d.rectangle([40, 40, W - 40, 150], fill="#1f4e79")
    d.text((70, 75), "Fotosentez Nasil Calisir?", font=font(44), fill="#ffffff")

    # Grafik bolgesi (sol)
    d.rectangle([40, 190, 560, 620], outline="#1f4e79", width=3)
    d.text((60, 205), "Grafik", font=font(28), fill="#1f4e79")
    # basit sutun grafigi
    bars = [120, 220, 180, 300, 260]
    bx = 90
    for i, b in enumerate(bars):
        d.rectangle([bx, 580 - b, bx + 60, 580], fill="#4f9d69")
        bx += 90

    # Metin 1 (sag ust)
    d.rectangle([600, 190, W - 40, 400], outline="#999999", width=2)
    d.text((620, 205), "Metin 1", font=font(28), fill="#333333")
    lines1 = [
        "Bitkiler isik enerjisini kimyasal",
        "enerjiye cevirir. Bu surecte",
        "karbondioksit ve su kullanilir.",
    ]
    ty = 250
    for ln in lines1:
        d.text((620, ty), ln, font=font(24), fill="#333333")
        ty += 40

    # Metin 2 (sag alt)
    d.rectangle([600, 420, W - 40, 620], outline="#999999", width=2)
    d.text((620, 435), "Metin 2", font=font(28), fill="#333333")
    lines2 = [
        "Olusan glukoz bitkinin",
        "buyumesi icin kullanilir;",
        "yan urun olarak oksijen aciga cikar.",
    ]
    ty = 480
    for ln in lines2:
        d.text((620, ty), ln, font=font(24), fill="#333333")
        ty += 40

    # Alt bilgi serisi
    d.text((40, 720), "Ornek ogretim materyali - goz izleme prototipi", font=font(22), fill="#777777")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT)
    print(f"Yazildi: {OUT}  ({W}x{H})")


if __name__ == "__main__":
    main()
