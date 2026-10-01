"""Excel ciktisi (spec §9) — openpyxl ile.

build_workbook(result) saf fonksiyondur: analiz sonucu sozlugunu alir, bir
openpyxl Workbook dondurur. Sayfalar:
  Katilimcilar, Ham_Veri, Fiksasyonlar, AOI_Metrikleri, AOI_Ozet, Ayarlar

Ham veri Excel'in satir sinirini (1.048.576) asarsa kirpilir ve uyari yazilir;
tam ham veri icin uzun formatli CSV ayrica sunulur (bkz. studies/analysis.py).
"""
from openpyxl import Workbook
from openpyxl.styles import Font

EXCEL_MAX_ROWS = 1_048_576


def _sheet(wb, title, headers, first=False):
    ws = wb.active if first else wb.create_sheet()
    ws.title = title
    ws.append(headers)
    for c in ws[1]:
        c.font = Font(bold=True)
    ws.freeze_panes = "A2"
    return ws


def build_workbook(result):
    wb = Workbook()

    # --- Katilimcilar ---
    ws = _sheet(wb, "Katilimcilar", [
        "oturum_id", "katilimci_kodu", "durum", "baslangic", "bitis",
        "dogrulama_hata_px", "dogrulama_gecti", "ornekleme_hz", "ornek_sayisi",
        "materyal_disi_orani", "dislanma_nedeni",
    ], first=True)
    for s in result.get("sessions", []):
        ws.append([
            s.get("id"), s.get("participant_code"), s.get("status"),
            s.get("started_at"), s.get("finished_at"),
            s.get("validation_error_px"), s.get("validation_passed"),
            s.get("sampling_hz"), s.get("sample_count"),
            s.get("missing_ratio"), s.get("exclusion_reason") or "",
        ])

    # --- Ham_Veri ---
    ws = _sheet(wb, "Ham_Veri", [
        "oturum_id", "katilimci_kodu", "materyal_sira", "materyal_id",
        "t_ms", "x_px", "y_px", "x_norm", "y_norm", "materyal_icinde",
    ])
    rows = result.get("raw_samples", [])
    limit = EXCEL_MAX_ROWS - 2  # baslik + olasi uyari satiri
    for i, r in enumerate(rows):
        if i >= limit:
            ws.append(["... UYARI: Ham veri Excel satir sinirini asti; tam veri icin CSV ciktisini kullanin."])
            break
        ws.append([
            r.get("session_id"), r.get("participant_code"), r.get("material_order"),
            r.get("material_id"), r.get("t"), r.get("x_px"), r.get("y_px"),
            r.get("x_norm"), r.get("y_norm"), r.get("in_material"),
        ])

    # --- Fiksasyonlar ---
    ws = _sheet(wb, "Fiksasyonlar", [
        "oturum_id", "katilimci_kodu", "materyal_sira", "materyal_id",
        "baslangic_ms", "bitis_ms", "sure_ms", "x_norm", "y_norm",
        "ornek_sayisi", "isabet_aoi",
    ])
    for f in result.get("fixations", []):
        ws.append([
            f.get("session_id"), f.get("participant_code"), f.get("material_order"),
            f.get("material_id"), f.get("start_t"), f.get("end_t"), f.get("duration"),
            f.get("x"), f.get("y"), f.get("n_samples"), ", ".join(f.get("aoi_names", [])),
        ])

    # --- AOI_Metrikleri (katilimci x AOI) ---
    ws = _sheet(wb, "AOI_Metrikleri", [
        "oturum_id", "katilimci_kodu", "materyal_sira", "aoi", "toplam_bakma_ms",
        "bakma_orani_%", "ilk_fiksasyon_ms", "fiksasyon_sayisi", "ziyaret_sayisi", "isabet",
    ])
    for m in result.get("aoi_metrics", []):
        ws.append([
            m.get("session_id"), m.get("participant_code"), m.get("material_order"),
            m.get("aoi_name"), m.get("total_dwell_ms"), m.get("dwell_proportion"),
            m.get("time_to_first_fixation_ms"), m.get("fixation_count"),
            m.get("visit_count"), m.get("hit"),
        ])

    # --- AOI_Ozet (grup) ---
    ws = _sheet(wb, "AOI_Ozet", [
        "materyal_sira", "aoi", "katilimci_sayisi", "isabet_orani_%",
        "ort_bakma_ms", "ort_bakma_orani_%", "ort_ilk_fiksasyon_ms",
        "ort_fiksasyon_sayisi", "ort_ziyaret_sayisi",
    ])
    for g in result.get("aoi_summary", []):
        ws.append([
            g.get("material_order"), g.get("aoi_name"), g.get("n_participants"),
            g.get("hit_rate"), g.get("mean_dwell_ms"), g.get("mean_dwell_proportion"),
            g.get("mean_time_to_first_fixation_ms"), g.get("mean_fixation_count"),
            g.get("mean_visit_count"),
        ])

    # --- Ayarlar (yeniden uretilebilirlik, spec §9) ---
    ws = _sheet(wb, "Ayarlar", ["parametre", "deger"])
    meta = result.get("study", {})
    ws.append(["calisma", meta.get("name")])
    ws.append(["katilim_kodu", meta.get("code")])
    ws.append(["analiz_surumu", meta.get("version")])
    ws.append(["olusturulma", meta.get("generated_at")])
    for k, v in (result.get("config") or {}).items():
        ws.append([k, v])

    return wb
