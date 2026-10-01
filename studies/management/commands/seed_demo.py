"""Gelistirme icin hazir bir ogretmen hesabi ve aktif demo calisma olusturur.

    .venv\\Scripts\\python.exe manage.py seed_demo

Tekrar calistirilabilir (varsa yeniden olusturmaz). Yalnizca GELISTIRME icindir;
uretim ortaminda kullanmayin ve varsayilan sifreyi degistirin.
"""
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.files import File
from django.core.management.base import BaseCommand

from studies.models import Material, Study

User = get_user_model()

DEV_USER = "ogretmen"
DEV_PASS = "ogretmen1234"  # yalnizca yerel gelistirme


class Command(BaseCommand):
    help = "Gelistirme icin ogretmen hesabi + aktif demo calisma olusturur."

    def handle(self, *args, **options):
        teacher, created = User.objects.get_or_create(
            username=DEV_USER,
            defaults={"is_staff": True, "is_superuser": True, "email": ""},
        )
        if created:
            teacher.set_password(DEV_PASS)
            teacher.save()
            self.stdout.write(self.style.SUCCESS(
                f"Ogretmen olusturuldu: {DEV_USER} / {DEV_PASS} (lutfen degistirin)"))
        else:
            self.stdout.write(f"Ogretmen zaten var: {DEV_USER}")

        study, created = Study.objects.get_or_create(
            name="Demo Calisma",
            teacher=teacher,
            defaults={
                "description": "Ornek materyalli demo (tek gorsel).",
                "status": Study.Status.ACTIVE,
            },
        )
        if created:
            self.stdout.write(self.style.SUCCESS(f"Demo calisma olusturuldu."))
        else:
            # Her ihtimale karsi aktif yap
            if study.status != Study.Status.ACTIVE:
                study.status = Study.Status.ACTIVE
                study.save(update_fields=["status"])
            self.stdout.write("Demo calisma zaten var.")

        if not study.materials.exists():
            sample = (
                Path(__file__).resolve().parents[2]
                / "static" / "experiment"  # studies/static yok; experiment statiginden al
            )
            # Ornek materyal experiment uygulamasinin statiginde
            sample_png = (
                Path(__file__).resolve().parents[3]
                / "experiment" / "static" / "experiment" / "materials" / "ornek_materyal.png"
            )
            if sample_png.exists():
                with sample_png.open("rb") as fh:
                    m = Material(study=study, order=1)
                    m.image.save("ornek_materyal.png", File(fh), save=True)
                self.stdout.write(self.style.SUCCESS(
                    f"Materyal eklendi: {m.natural_width}x{m.natural_height}"))
            else:
                self.stdout.write(self.style.WARNING(
                    f"Ornek gorsel bulunamadi: {sample_png}"))
        else:
            self.stdout.write("Materyal zaten var.")

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("HAZIR."))
        self.stdout.write(f"  Admin:   http://localhost:8000/admin/  ({DEV_USER} / {DEV_PASS})")
        self.stdout.write(f"  Katilim: http://localhost:8000/dene/{study.participation_code}/")
