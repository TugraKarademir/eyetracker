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
        # Yerel (vendor) jsPsych + WebGazer (offline; CDN degil)
        self.assertIn("experiment/vendor/jspsych.js", html)
        self.assertIn("experiment/vendor/extension-webgazer.js", html)
        self.assertNotIn("cdn.jsdelivr", html)  # internet bagimliligi olmamali
        # WebGazer, jsPsych eklentisinden ONCE yuklenmeli
        pos_webgazer = html.find("vendor/webgazer.js")
        pos_ext = html.find("vendor/extension-webgazer.js")
        self.assertNotEqual(pos_webgazer, -1)
        self.assertLess(pos_webgazer, pos_ext)

    def test_materyal_ve_deney_scripti_bagli(self):
        html = self.client.get(self.url, SERVER_NAME="localhost").content.decode()
        self.assertIn("experiment/js/experiment.js", html)
        self.assertIn("material-data", html)
        self.assertIn("ornek_materyal.png", html)

    def test_arayuz_turkce(self):
        html = self.client.get(self.url, SERVER_NAME="localhost").content.decode()
        self.assertIn('lang="tr"', html)
