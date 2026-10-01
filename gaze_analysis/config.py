"""Analiz parametreleri ve varsayilanlar (spec §7, §8).

Tum esikler calisma ayarlarindan degistirilebilir; burasi varsayilanlari tutar.
Degerler pilot veriyle yeniden ayarlanmalidir (spec §7).

Koordinatlar materyale gore 0-1 normalize. Dagilim esigi ve cekirdek genisligi
"materyal GENISLIGININ" orani olarak tanimlidir; y ekseni en-boy oranina gore
olceklenir (bkz. fixation.detect_fixations, en_boy = yukseklik/genislik).
"""
from dataclasses import asdict, dataclass


@dataclass
class AnalysisConfig:
    # --- Fiksasyon (I-DT, spec §8.2) ---
    min_fixation_ms: int = 100          # minimum fiksasyon suresi
    dispersion_threshold: float = 0.05  # materyal genisliginin orani (normalize)
    median_filter_window: int = 3       # hareketli medyan penceresi (<=1 kapali)

    # --- AOI (spec §8.4) ---
    aoi_buffer: float = 0.0             # AOI kenar tampon payi (genislik orani)

    # --- Isi haritasi (spec §8.3, Faz 5) ---
    heatmap_sigma: float = 0.04         # Gauss cekirdek genisligi (genislik orani)

    # --- Kalite esikleri (spec §7) ---
    max_validation_error_ratio: float = 0.10   # goruntu alani genisliginin %10'u
    max_missing_ratio: float = 0.30            # materyal basina kayip veri siniri
    min_valid_material_ratio: float = 0.50     # oturum basina gecerli materyal siniri

    def to_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, d):
        """Bilinen alanlari alir, bilinmeyenleri yok sayar (calisma ayarlarindan)."""
        if not d:
            return cls()
        fields = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in d.items() if k in fields})


# Uygulama surumu (Excel "Ayarlar" sayfasi ve AnalysisRun icin, spec §9)
ANALYSIS_VERSION = "0.4.0-faz4"
