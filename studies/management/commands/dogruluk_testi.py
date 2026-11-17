"""8 noktali bilinen-hedef dogruluk testi (spec §12, PILOT.md).

    .venv\\Scripts\\python.exe manage.py dogruluk_testi kur     # calisma + 9 ekran
    .venv\\Scripts\\python.exe manage.py dogruluk_testi rapor   # oturum basina hata
    ... dogruluk_testi kur --iki-kamera / rapor --iki-kamera    # Faz 12: ust+alt kamera

Gercek calismadan AYRI bir calisma olusturur (veri ve Latin kare sirasi karismaz).
Sira sabit: 0 = talimat ekrani, 1..8 = her ekranda TEK hedef (EIGHT_POINT_TARGETS).
Katilimci noktaya ~2 sn bakar, sonra "Devam".

Iki kamerada her ornek dort tahminciyi birden tasir (GazeSample.alt); rapor ayni
oturumda ESLESTIRILMIS karsilastirma verir (ust / alt / gec fuzyon / erken fuzyon).
"""
import io
import statistics

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand, CommandError

from gaze_analysis.accuracy import EIGHT_POINT_TARGETS, display_width_px, summarize, target_error
from studies.models import AOI, GazeSample, Material, Study

STUDY_NAME = "Doğruluk Testi (tek nokta)"
DUAL_STUDY_NAME = "Doğruluk Testi (iki kamera)"
ESTIMATORS = [("a", "Ust kamera"), ("b", "Alt kamera"), ("late", "Gec fuzyon"), ("early", "Erken fuzyon")]
OLD_STUDY_NAME = "Doğruluk Testi (8 nokta)"  # ilk surum (tek ekranda 8 nokta) -> kapatilir
IMG_W, IMG_H = 1920, 1080
AOI_HALF = 0.04  # hedef AOI'si: merkez etrafinda +-%4 genislik (yalniz panelde gorunur)


def _font(size, bold=False):
    from PIL import ImageFont
    for name in (("arialbd.ttf" if bold else "arial.ttf"), "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _png(img):
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _render_instructions_png():
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (IMG_W, IMG_H), "white")
    d = ImageDraw.Draw(img)
    lines = [
        ("Doğruluk testi", _font(56, bold=True)),
        ("", None),
        ("Şimdi ekranda sırayla 8 kırmızı nokta göreceksiniz (her ekranda bir tane).", _font(38)),
        ("Her noktanın ortasındaki siyah noktaya yaklaşık 2 saniye bakın,", _font(38)),
        ("sonra \"Devam\" düğmesine basın.", _font(38)),
        ("", None),
        ("Başınızı oynatmayın.  Hazır olduğunuzda \"Devam\" düğmesine basın.", _font(38)),
    ]
    y = IMG_H / 2 - 190
    for text, f in lines:
        if text:
            d.text((IMG_W / 2, y), text, fill="#1a2733", font=f, anchor="mm")
        y += 62
    return _png(img)


def _render_target_png(x, y):
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (IMG_W, IMG_H), "white")
    d = ImageDraw.Draw(img)
    cx, cy, r = x * IMG_W, y * IMG_H, 22
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill="#d32f2f")
    d.ellipse([cx - 5, cy - 5, cx + 5, cy + 5], fill="black")
    return _png(img)


class Command(BaseCommand):
    help = "8 noktali dogruluk testi: 'kur' (calisma olusturur) veya 'rapor' (hata hesaplar)."

    def add_arguments(self, parser):
        parser.add_argument("islem", choices=["kur", "rapor"])
        parser.add_argument("--ogretmen", default="ogretmen", help="Calismanin sahibi (kur)")
        parser.add_argument("--iki-kamera", action="store_true",
                            help="Ust+alt kamera fuzyon testi (ayri calisma)")

    def handle(self, *args, **opts):
        dual = opts["iki_kamera"]
        if opts["islem"] == "kur":
            self._kur(opts["ogretmen"], dual)
        else:
            self._rapor(dual)

    # ------------------------------------------------------------------ kur
    def _kur(self, username, dual):
        User = get_user_model()
        try:
            teacher = User.objects.get(username=username)
        except User.DoesNotExist:
            raise CommandError(f"Kullanici yok: {username}")

        closed = Study.objects.filter(name=OLD_STUDY_NAME).exclude(status=Study.Status.CLOSED)
        if closed.update(status=Study.Status.CLOSED):
            self.stdout.write(f"Eski tasarim kapatildi: {OLD_STUDY_NAME} (verisi korunuyor)")

        name = DUAL_STUDY_NAME if dual else STUDY_NAME
        study, _ = Study.objects.get_or_create(
            name=name, teacher=teacher,
            defaults={"description": "Bilinen-hedef doğruluk testi (spec §12), her ekranda tek nokta. "
                                     + ("Üst+alt iki kamera, dört tahminci eşli. " if dual else "")
                                     + "Gerçek veriye katılmaz."},
        )
        study.status = Study.Status.ACTIVE
        study.settings = {**(study.settings or {}),
                          "gaze_engine": "mediapipe", "leppink": False, "order_scheme": "fixed",
                          "dual_camera": dual}
        study.save()

        if not study.materials.exists():
            m = Material(study=study, order=0, kind=Material.Kind.OTHER)
            m.image.save("dogruluk_talimat.png", ContentFile(_render_instructions_png()), save=True)
            for i, (tname, x, y) in enumerate(EIGHT_POINT_TARGETS, start=1):
                m = Material(study=study, order=i, kind=Material.Kind.OTHER)
                m.image.save(f"dogruluk_hedef{i}.png", ContentFile(_render_target_png(x, y)), save=True)
                AOI.objects.create(
                    material=m, name=tname, shape="rect", color="#d32f2f",
                    coords={"x": round(x - AOI_HALF, 4),
                            "y": round(y - AOI_HALF * IMG_W / IMG_H, 4),
                            "w": round(2 * AOI_HALF, 4),
                            "h": round(2 * AOI_HALF * IMG_W / IMG_H, 4)})
            self.stdout.write(self.style.SUCCESS(f"Calisma olusturuldu: {name} (talimat + 8 tek-nokta ekrani)."))
        else:
            self.stdout.write(f"Calisma zaten var: {name} (materyaller korunuyor).")

        flag = " --iki-kamera" if dual else ""
        self.stdout.write(f"  Katilim: http://localhost:8000/dene/{study.participation_code}/")
        self.stdout.write(f"  Sonuc:   .venv\\Scripts\\python.exe manage.py dogruluk_testi rapor{flag}")

    # ---------------------------------------------------------------- rapor
    def _rapor(self, dual):
        study = Study.objects.filter(name=DUAL_STUDY_NAME if dual else STUDY_NAME).first()
        if not study:
            raise CommandError("Once 'dogruluk_testi kur" + (" --iki-kamera" if dual else "") + "' calistirin.")
        targets = {m.order: m for m in study.materials.filter(order__gte=1, order__lte=8)}
        if len(targets) != 8:
            raise CommandError("Calismada 8 hedef ekrani yok.")

        sessions = list(study.sessions.order_by("started_at"))
        if not sessions:
            self.stdout.write("Henuz oturum yok.")
            return

        overall = []
        paired = {k: [] for k, _ in ESTIMATORS}   # oturum basina ortalama hata (px), eslesik
        for sess in sessions:
            self.stdout.write("")
            self.stdout.write(self.style.MIGRATE_HEADING(
                f"Oturum {sess.id} ({sess.participant_code}) — {sess.started_at.astimezone():%Y-%m-%d %H:%M}, "
                f"ekran {sess.viewport_width}x{sess.viewport_height}, durum {sess.status}"))
            cams = (sess.client_meta or {}).get("cameras")
            if cams:
                self.stdout.write(f"  Kameralar: ust = {cams.get('a')}, alt = {cams.get('b')}")
            by_mat = {}
            for s in GazeSample.objects.filter(session=sess, material__in=targets.values()) \
                    .values("material_id", "t", "x_px", "x_norm", "y_norm", "alt"):
                by_mat.setdefault(s["material_id"], []).append(s)
            if not by_mat:
                self.stdout.write("  Bu oturumda hedef ekranlari icin veri yok.")
                continue

            w_px = display_width_px([s for v in by_mat.values() for s in v])
            vw = sess.viewport_width or None
            if not w_px:
                self.stdout.write("  Materyal genisligi hesaplanamadi.")
                continue

            def px(e):
                return f"{e * w_px:.0f} px"

            def aspect_of(m):
                return (m.natural_height / m.natural_width) if m.natural_width else IMG_H / IMG_W

            self.stdout.write(f"  Materyal ekranda ~{w_px:.0f} px genislikte gosterildi.")
            self.stdout.write(f"  {'Hedef':<9}{'ornek':>6}{'hata':>9}{'yatay':>8}{'dikey':>8}{'yayilim':>9}")
            rows = []
            for i, (name, tx, ty) in enumerate(EIGHT_POINT_TARGETS, start=1):
                m = targets[i]
                r = target_error(by_mat.get(m.id, []), tx, ty, aspect_of(m))
                rows.append(r)
                if r["error"] is None:
                    self.stdout.write(f"  {name:<9}{r['n']:>6}   -- yetersiz veri (cok hizli gecildi?) --")
                    continue
                self.stdout.write(f"  {name:<9}{r['n']:>6}{px(r['error']):>9}{r['dx'] * w_px:>+8.0f}"
                                  f"{r['dy'] * w_px:>+8.0f}{px(r['precision']):>9}")
            s = summarize(rows)
            if s["mean_error"] is None:
                continue
            pct = f" ({s['mean_error'] * w_px / vw * 100:.1f}% ekran gen.)" if vw else ""
            self.stdout.write(
                f"  ORTALAMA hata {px(s['mean_error'])}{pct}, medyan {px(s['median_error'])}; "
                f"yatay {px(s['mean_abs_dx'])}, dikey {px(s['mean_abs_dy'])}; "
                f"yayilim {px(s['mean_precision'])}; {s['n_hit']}/8 hedef.")
            overall.append(s["mean_error"] * w_px)

            # --- iki kamera: ayni ornekler, dort tahminci (kayma duzeltmesiz) ---
            if any(x.get("alt") for v in by_mat.values() for x in v):
                self.stdout.write("  Esli karsilastirma (ayni oturum, ayni kalibrasyon; kayma duzeltmesiz):")
                self.stdout.write(f"    {'Tahminci':<14}{'hata':>9}{'yatay':>9}{'dikey':>9}{'yayilim':>9}{'hedef':>7}")
                for key, label in ESTIMATORS:
                    est_rows = []
                    for i, (name, tx, ty) in enumerate(EIGHT_POINT_TARGETS, start=1):
                        m = targets[i]
                        alt_samples = [
                            {"t": x["t"], "x_norm": x["alt"][key][0], "y_norm": x["alt"][key][1]}
                            for x in by_mat.get(m.id, []) if x.get("alt") and x["alt"].get(key)
                        ]
                        est_rows.append(target_error(alt_samples, tx, ty, aspect_of(m)))
                    es = summarize(est_rows)
                    if es["mean_error"] is None:
                        self.stdout.write(f"    {label:<14}   -- veri yok --")
                        continue
                    self.stdout.write(
                        f"    {label:<14}{px(es['mean_error']):>9}{px(es['mean_abs_dx']):>9}"
                        f"{px(es['mean_abs_dy']):>9}{px(es['mean_precision']):>9}{es['n_hit']:>5}/8")
                    if es["n_hit"] == 8:
                        paired[key].append(es["mean_error"] * w_px)

        self.stdout.write("")
        self.stdout.write("  hata = bakis merkezinin hedefe uzakligi (dogruluk); yatay/dikey = yon "
                          "(sag+/asagi+); yayilim = orneklerin titremesi (kesinlik).")
        if len(overall) > 1:
            self.stdout.write(self.style.SUCCESS(
                f"TUM OTURUMLAR: ortalama hata {statistics.mean(overall):.0f} px "
                f"(n={len(overall)}, SS {statistics.stdev(overall):.0f} px)"))
        if any(paired.values()):
            self.stdout.write(self.style.SUCCESS("TUM OTURUMLAR — tahminci basina ortalama hata (8/8 hedefli oturumlar):"))
            for key, label in ESTIMATORS:
                v = paired[key]
                if v:
                    sd = f", SS {statistics.stdev(v):.0f}" if len(v) > 1 else ""
                    self.stdout.write(f"    {label:<14}{statistics.mean(v):6.0f} px (n={len(v)}{sd})")
