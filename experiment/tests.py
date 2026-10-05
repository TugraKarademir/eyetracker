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


from django.test import TestCase as _TC
from experiment.views import williams_square, _order_materials


class LatinSquareTests(_TC):
    def test_williams_gecerli_latin_kare(self):
        n = 6
        rows = williams_square(n)
        self.assertEqual(len(rows), n)  # cift n -> n satir
        # Her satir 0..n-1 permutasyonu
        for r in rows:
            self.assertEqual(sorted(r), list(range(n)))
        # Her KONUMDA her kosul tam bir kez (Latin kare ozelligi)
        for col in range(n):
            self.assertEqual(sorted(rows[i][col] for i in range(n)), list(range(n)))

    def test_order_materials_latin_deterministik_ve_dengeli(self):
        mats = [{"id": i} for i in range(1, 7)]  # 6 materyal
        # Ardisik 6 katilimci -> her materyal her konumda bir kez
        first_positions = []
        for seq in range(6):
            o = _order_materials(mats, "latin", seq)
            self.assertEqual(len(o), 6)
            first_positions.append(o[0]["id"])
        self.assertEqual(sorted(first_positions), [1, 2, 3, 4, 5, 6])  # ilk konum dengeli

    def test_order_materials_fixed(self):
        mats = [{"id": 1}, {"id": 2}, {"id": 3}]
        self.assertEqual([m["id"] for m in _order_materials(mats, "fixed", 0)], [1, 2, 3])
