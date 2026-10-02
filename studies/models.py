import secrets

from django.conf import settings
from django.db import models


def generate_participation_code():
    """Katilim baglantisi icin kisa, benzersiz, okunur bir kod uretir."""
    # Karisik gorunen karakterler (0/O, 1/l/I) cikarildi
    alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(8))


class Study(models.Model):
    """Bir goz izleme calismasi (spec §4 Study)."""

    class Status(models.TextChoices):
        DRAFT = "draft", "Taslak"
        ACTIVE = "active", "Aktif"
        CLOSED = "closed", "Kapali"

    name = models.CharField("Ad", max_length=200)
    description = models.TextField("Aciklama", blank=True)
    teacher = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="studies",
        verbose_name="Ogretmen",
    )
    # Esikler ve algoritma parametreleri (spec §7, §8). Bos birakilirsa
    # uygulama varsayilanlari kullanilir; calisma bazinda degistirilebilir.
    settings = models.JSONField("Ayarlar", default=dict, blank=True)
    participation_code = models.CharField(
        "Katilim kodu",
        max_length=16,
        unique=True,
        default=generate_participation_code,
        help_text="Katilim baglantisinda kullanilan benzersiz kod.",
    )
    status = models.CharField(
        "Durum", max_length=10, choices=Status.choices, default=Status.DRAFT
    )
    created_at = models.DateTimeField("Olusturulma", auto_now_add=True)

    class Meta:
        verbose_name = "Calisma"
        verbose_name_plural = "Calismalar"
        ordering = ["-created_at"]

    def __str__(self):
        return self.name

    @property
    def is_open(self):
        return self.status == self.Status.ACTIVE


class Material(models.Model):
    """Bir calismada gosterilen tek bir materyal gorseli (spec §4 Material)."""

    class Kind(models.TextChoices):
        INFOGRAPHIC = "infographic", "Infografik"
        MINDMAP = "mindmap", "Zihin haritasi"
        VIDEO = "video", "Video"
        OTHER = "other", "Diger"

    class Source(models.TextChoices):
        HUMAN = "human", "Insan tasarimi"
        AI = "ai", "Yapay zeka tasarimi"
        UNSPECIFIED = "unspecified", "Belirtilmemis"

    study = models.ForeignKey(
        Study, on_delete=models.CASCADE, related_name="materials", verbose_name="Calisma"
    )
    order = models.PositiveIntegerField("Sira", default=0)
    # Statik materyaller icin gorsel; video materyaller icin video (RQ2 materyal turu)
    image = models.ImageField("Gorsel", upload_to="materials/", blank=True, null=True)
    video = models.FileField("Video", upload_to="materials/video/", blank=True, null=True)
    # RQ2 faktorleri: materyal turu ve kaynagi
    kind = models.CharField("Tur", max_length=12, choices=Kind.choices, default=Kind.INFOGRAPHIC)
    source = models.CharField("Kaynak", max_length=12, choices=Source.choices, default=Source.UNSPECIFIED)
    # Gorselin ozgun pikselleri; kayit sirasinda otomatik doldurulur.
    natural_width = models.PositiveIntegerField("Ozgun genislik", default=0)
    natural_height = models.PositiveIntegerField("Ozgun yukseklik", default=0)
    created_at = models.DateTimeField("Olusturulma", auto_now_add=True)

    class Meta:
        verbose_name = "Materyal"
        verbose_name_plural = "Materyaller"
        ordering = ["study", "order"]

    def __str__(self):
        return f"{self.study.name} #{self.order}"

    def save(self, *args, **kwargs):
        # Gorsel boyutlarini otomatik doldur (Pillow ImageField ile gelir)
        if self.image and (not self.natural_width or not self.natural_height):
            try:
                self.natural_width = self.image.width
                self.natural_height = self.image.height
            except Exception:
                pass
        super().save(*args, **kwargs)


class Session(models.Model):
    """Bir katilimcinin tek bir oturumu (spec §4 Session)."""

    class Status(models.TextChoices):
        IN_PROGRESS = "in_progress", "Devam ediyor"
        COMPLETED = "completed", "Tamamlandi"
        LOW_QUALITY = "low_quality", "Dusuk kalite"
        ABANDONED = "abandoned", "Yarim birakildi"

    study = models.ForeignKey(
        Study, on_delete=models.CASCADE, related_name="sessions", verbose_name="Calisma"
    )
    participant_code = models.CharField("Katilimci kodu", max_length=32)
    user_agent = models.TextField("Tarayici (UA)", blank=True)
    screen_width = models.PositiveIntegerField("Ekran genisligi", null=True, blank=True)
    screen_height = models.PositiveIntegerField("Ekran yuksekligi", null=True, blank=True)
    viewport_width = models.PositiveIntegerField("Goruntu alani genisligi", null=True, blank=True)
    viewport_height = models.PositiveIntegerField("Goruntu alani yuksekligi", null=True, blank=True)
    device_pixel_ratio = models.FloatField("devicePixelRatio", null=True, blank=True)
    started_at = models.DateTimeField("Baslangic", auto_now_add=True)
    finished_at = models.DateTimeField("Bitis", null=True, blank=True)
    status = models.CharField(
        "Durum", max_length=16, choices=Status.choices, default=Status.IN_PROGRESS
    )
    # Istemci tanisi (gaze motoru, ensemble gorunum agirliklari, surum vb.) — spec disi, hata ayiklama
    client_meta = models.JSONField("Istemci tanisi", default=dict, blank=True)

    class Meta:
        verbose_name = "Oturum"
        verbose_name_plural = "Oturumlar"
        ordering = ["-started_at"]

    def __str__(self):
        return f"{self.participant_code} ({self.study.name})"


class CalibrationResult(models.Model):
    """Bir oturumun kalibrasyon/dogrulama sonucu (spec §4 CalibrationResult)."""

    session = models.ForeignKey(
        Session, on_delete=models.CASCADE, related_name="calibrations", verbose_name="Oturum"
    )
    attempt_no = models.PositiveIntegerField("Deneme no", default=1)
    avg_error_px = models.FloatField("Ortalama hata (px)", null=True, blank=True)
    avg_error_norm = models.FloatField("Ortalama hata (normalize)", null=True, blank=True)
    precision = models.FloatField("Kesinlik", null=True, blank=True)
    passed = models.BooleanField("Gecti", default=False)

    class Meta:
        verbose_name = "Kalibrasyon sonucu"
        verbose_name_plural = "Kalibrasyon sonuclari"
        ordering = ["session", "attempt_no"]


class GazeSample(models.Model):
    """Tek bir ham bakis ornegi (spec §4 GazeSample).

    Tum analizler normalize koordinatlarla yapilir; px degerler referans icin saklanir.
    """

    session = models.ForeignKey(
        Session, on_delete=models.CASCADE, related_name="samples", verbose_name="Oturum"
    )
    material = models.ForeignKey(
        Material, on_delete=models.CASCADE, related_name="samples", verbose_name="Materyal"
    )
    t = models.IntegerField("t (ms)", help_text="Materyal baslangicindan itibaren ms")
    x_px = models.IntegerField("x (px)")
    y_px = models.IntegerField("y (px)")
    x_norm = models.FloatField("x (normalize)", null=True, blank=True)
    y_norm = models.FloatField("y (normalize)", null=True, blank=True)
    in_material = models.BooleanField("Materyal icinde", default=False)

    class Meta:
        verbose_name = "Bakis ornegi"
        verbose_name_plural = "Bakis ornekleri"
        indexes = [
            models.Index(fields=["session", "material"]),
        ]


class AOI(models.Model):
    """Bir materyal uzerindeki ilgi alani (spec §4 AOI).

    Koordinatlar materyale gore 0-1 normalize saklanir; boylece farkli
    ekran boyutlarinda tutarli kalir.
      - rect  : coords = {"x": .., "y": .., "w": .., "h": ..}
      - polygon: coords = {"points": [[x, y], ...]}
    """

    class Shape(models.TextChoices):
        RECT = "rect", "Dikdortgen"
        POLYGON = "polygon", "Cokgen"

    material = models.ForeignKey(
        Material, on_delete=models.CASCADE, related_name="aois", verbose_name="Materyal"
    )
    name = models.CharField("Ad", max_length=100)
    shape = models.CharField("Sekil", max_length=10, choices=Shape.choices, default=Shape.RECT)
    coords = models.JSONField("Koordinatlar (normalize 0-1)", default=dict)
    color = models.CharField("Renk", max_length=9, default="#e53935")
    # RQ2: bu AOI materyalin "ilgili" (hedef icerik) bolgesi mi, yoksa ilgisiz mi?
    is_relevant = models.BooleanField("Ilgili AOI", default=True)
    created_at = models.DateTimeField("Olusturulma", auto_now_add=True)

    class Meta:
        verbose_name = "Ilgi alani (AOI)"
        verbose_name_plural = "Ilgi alanlari (AOI)"
        ordering = ["material", "id"]

    def __str__(self):
        return f"{self.name} ({self.material})"

    def bounding_box(self):
        """AOI'nin normalize sinirlayici kutusunu (x0, y0, x1, y1) dondurur."""
        if self.shape == self.Shape.RECT:
            c = self.coords or {}
            x, y = float(c.get("x", 0)), float(c.get("y", 0))
            w, h = float(c.get("w", 0)), float(c.get("h", 0))
            return (x, y, x + w, y + h)
        pts = (self.coords or {}).get("points") or []
        if not pts:
            return (0.0, 0.0, 0.0, 0.0)
        xs = [float(p[0]) for p in pts]
        ys = [float(p[1]) for p in pts]
        return (min(xs), min(ys), max(xs), max(ys))
