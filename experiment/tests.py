from django.test import TestCase
from django.urls import reverse


class RunExperimentPageTests(TestCase):
    """Faz 1 katilimci sayfasinin dogru kurulduğunu dogrular."""

    def setUp(self):
        self.url = reverse("experiment:run")

    def test_sayfa_200_doner(self):
        resp = self.client.get(self.url, SERVER_NAME="localhost")
        self.assertEqual(resp.status_code, 200)

    def test_jspsych_ve_webgazer_yuklu(self):
        html = self.client.get(self.url, SERVER_NAME="localhost").content.decode()
        # jsPsych cekirdek + eklentiler tarayici build'i olmali (CJS degil)
        self.assertIn("jspsych@8/dist/index.browser.min.js", html)
        self.assertIn("extension-webgazer@1/dist/index.browser.min.js", html)
        # WebGazer surumu 2.1.0'a sabit (v3 MediaPipe asset 404 sorunu) ve
        # jsPsych eklentisinden ONCE yuklenmeli
        pos_webgazer = html.find("webgazer@2.1.0/dist/webgazer.js")
        pos_ext = html.find("extension-webgazer@1")
        self.assertNotEqual(pos_webgazer, -1, "webgazer 2.1.0 sabit surumu bulunmali")
        self.assertLess(pos_webgazer, pos_ext)

    def test_materyal_ve_deney_scripti_bagli(self):
        html = self.client.get(self.url, SERVER_NAME="localhost").content.decode()
        self.assertIn("experiment/js/experiment.js", html)
        self.assertIn("material-data", html)
        self.assertIn("ornek_materyal.png", html)

    def test_arayuz_turkce(self):
        html = self.client.get(self.url, SERVER_NAME="localhost").content.decode()
        self.assertIn('lang="tr"', html)
