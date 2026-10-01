import io
import json
import tempfile

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse

from .models import AOI, CalibrationResult, GazeSample, Material, Session, Study

User = get_user_model()

MEDIA = tempfile.mkdtemp()


def _png_bytes(w=120, h=80, color=(30, 78, 121)):
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, format="PNG")
    return buf.getvalue()


def _upload(name="m.png", w=120, h=80):
    return SimpleUploadedFile(name, _png_bytes(w, h), content_type="image/png")


class ModelTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user("ogretmen", password="x")

    def test_katilim_kodu_otomatik_ve_benzersiz(self):
        s1 = Study.objects.create(name="A", teacher=self.teacher)
        s2 = Study.objects.create(name="B", teacher=self.teacher)
        self.assertTrue(s1.participation_code)
        self.assertNotEqual(s1.participation_code, s2.participation_code)

    @override_settings(MEDIA_ROOT=MEDIA)
    def test_materyal_boyutu_otomatik_dolar(self):
        study = Study.objects.create(name="A", teacher=self.teacher)
        m = Material.objects.create(study=study, order=1, image=_upload(w=200, h=150))
        self.assertEqual(m.natural_width, 200)
        self.assertEqual(m.natural_height, 150)


class ApiTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user("ogretmen", password="x")
        self.study = Study.objects.create(
            name="Test", teacher=self.teacher, status=Study.Status.ACTIVE
        )
        with override_settings(MEDIA_ROOT=MEDIA):
            self.material = Material.objects.create(
                study=self.study, order=1, image=_upload()
            )

    def _post(self, url, body):
        return self.client.post(url, data=json.dumps(body), content_type="application/json")

    def test_baslat_gecerli_kod(self):
        url = reverse("studies:session_start")
        r = self._post(url, {"study_code": self.study.participation_code,
                             "device": {"viewport_width": 1366, "device_pixel_ratio": 1}})
        self.assertEqual(r.status_code, 200)
        sid = r.json()["session_id"]
        s = Session.objects.get(pk=sid)
        self.assertEqual(s.viewport_width, 1366)
        self.assertEqual(s.status, Session.Status.IN_PROGRESS)

    def test_baslat_gecersiz_kod_404(self):
        r = self._post(reverse("studies:session_start"), {"study_code": "yok"})
        self.assertEqual(r.status_code, 404)

    def test_baslat_pasif_calisma_403(self):
        self.study.status = Study.Status.DRAFT
        self.study.save()
        r = self._post(reverse("studies:session_start"),
                       {"study_code": self.study.participation_code})
        self.assertEqual(r.status_code, 403)

    def test_veri_kaydi_ve_gecersiz_materyal_atlanir(self):
        session = Session.objects.create(study=self.study, participant_code="k1")
        url = reverse("studies:session_data", args=[session.id])
        body = {
            "calibrations": [{"attempt_no": 1, "avg_error_px": 50, "avg_error_norm": 0.04,
                              "precision": 80, "passed": True}],
            "samples": [
                {"material_id": self.material.id, "t": 100, "x_px": 10, "y_px": 20,
                 "x_norm": 0.1, "y_norm": 0.2, "in_material": True},
                {"material_id": 99999, "t": 200, "x_px": 0, "y_px": 0},  # gecersiz -> atlanir
            ],
        }
        r = self._post(url, body)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["saved_samples"], 1)
        self.assertEqual(r.json()["skipped"], 1)
        self.assertEqual(GazeSample.objects.filter(session=session).count(), 1)
        self.assertEqual(CalibrationResult.objects.filter(session=session).count(), 1)

    def test_veri_tamamlanmis_oturuma_eklenmez_409(self):
        session = Session.objects.create(
            study=self.study, participant_code="k2", status=Session.Status.COMPLETED
        )
        url = reverse("studies:session_data", args=[session.id])
        r = self._post(url, {"samples": [{"material_id": self.material.id, "t": 1,
                                          "x_px": 1, "y_px": 1}]})
        self.assertEqual(r.status_code, 409)

    def test_bitir(self):
        session = Session.objects.create(study=self.study, participant_code="k3")
        url = reverse("studies:session_finish", args=[session.id])
        r = self._post(url, {"status": "completed"})
        self.assertEqual(r.status_code, 200)
        session.refresh_from_db()
        self.assertEqual(session.status, Session.Status.COMPLETED)
        self.assertIsNotNone(session.finished_at)


class RunStudyViewTests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user("ogretmen", password="x")
        self.study = Study.objects.create(
            name="Gorsel Calisma", teacher=self.teacher, status=Study.Status.ACTIVE
        )
        with override_settings(MEDIA_ROOT=MEDIA):
            Material.objects.create(study=self.study, order=1, image=_upload())

    def test_bilinen_kod_200(self):
        url = reverse("experiment:run_study", args=[self.study.participation_code])
        r = self.client.get(url, SERVER_NAME="localhost")
        self.assertEqual(r.status_code, 200)
        html = r.content.decode()
        self.assertIn("study-data", html)
        self.assertIn("materials-data", html)
        self.assertIn("study.js", html)

    def test_bilinmeyen_kod_404(self):
        url = reverse("experiment:run_study", args=["bilinmeyen"])
        r = self.client.get(url, SERVER_NAME="localhost")
        self.assertEqual(r.status_code, 404)


class AOITests(TestCase):
    def setUp(self):
        self.teacher = User.objects.create_user("ogretmen", password="x", is_superuser=True, is_staff=True)
        self.other = User.objects.create_user("baska", password="x")
        self.study = Study.objects.create(name="A", teacher=self.teacher, status=Study.Status.ACTIVE)
        with override_settings(MEDIA_ROOT=MEDIA):
            self.material = Material.objects.create(study=self.study, order=1, image=_upload())

    def _post(self, url, body):
        return self.client.post(url, data=json.dumps(body), content_type="application/json")

    def test_editor_login_gerektirir(self):
        url = reverse("studies:aoi_editor", args=[self.material.id])
        r = self.client.get(url)
        self.assertEqual(r.status_code, 302)  # admin/login'e yonlendirir

    def test_editor_sahip_200(self):
        self.client.force_login(self.teacher)
        url = reverse("studies:aoi_editor", args=[self.material.id])
        r = self.client.get(url, SERVER_NAME="localhost")
        self.assertEqual(r.status_code, 200)
        self.assertIn("aoi_editor.js", r.content.decode())

    def test_aoi_kaydet_ve_cakisma_uyarisi(self):
        self.client.force_login(self.teacher)
        url = reverse("studies:aoi_save", args=[self.material.id])
        body = {"aois": [
            {"name": "Baslik", "shape": "rect", "color": "#e53935",
             "coords": {"x": 0.0, "y": 0.0, "w": 0.5, "h": 0.5}},
            {"name": "Grafik", "shape": "rect", "color": "#1e88e5",
             "coords": {"x": 0.3, "y": 0.3, "w": 0.5, "h": 0.5}},  # cakisir
        ]}
        r = self._post(url, body)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["saved"], 2)
        self.assertEqual(len(r.json()["warnings"]), 1)
        self.assertEqual(AOI.objects.filter(material=self.material).count(), 2)

    def test_aoi_kaydet_replace_eder(self):
        self.client.force_login(self.teacher)
        AOI.objects.create(material=self.material, name="eski", shape="rect",
                           coords={"x": 0, "y": 0, "w": 0.1, "h": 0.1})
        url = reverse("studies:aoi_save", args=[self.material.id])
        r = self._post(url, {"aois": [
            {"name": "yeni", "shape": "rect", "coords": {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2}}]})
        self.assertEqual(r.status_code, 200)
        names = list(AOI.objects.filter(material=self.material).values_list("name", flat=True))
        self.assertEqual(names, ["yeni"])

    def test_aoi_yetkisiz_kullanici_403(self):
        self.client.force_login(self.other)
        url = reverse("studies:aoi_save", args=[self.material.id])
        r = self._post(url, {"aois": []})
        self.assertEqual(r.status_code, 403)
