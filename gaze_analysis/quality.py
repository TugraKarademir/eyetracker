"""Veri kalitesi ve dislama kurallari (spec §7).

Tum esikler AnalysisConfig'ten gelir ve calisma ayarlarindan degistirilebilir.
Dislanan veri SILINMEZ; yalnizca analize (grup metrikleri, isi haritasi)
alinmaz (spec §7).
"""


def material_quality(total_samples, out_of_material, config):
    """Tek bir (oturum, materyal) icin kayip veri orani ve dislama karari."""
    missing_ratio = (out_of_material / total_samples) if total_samples else 1.0
    excluded = missing_ratio > config.max_missing_ratio
    return {
        "total_samples": total_samples,
        "missing_ratio": round(missing_ratio, 3),
        "excluded": excluded,
        "reason": "Kayip veri %{:.0f} > %{:.0f}".format(
            missing_ratio * 100, config.max_missing_ratio * 100
        ) if excluded else "",
    }


def session_quality(validation_error_px, viewport_width, material_flags, config):
    """Oturum kalitesi: dogrulama hatasi + gecerli materyal orani.

    material_flags: [bool]  (her denenen materyal icin: gecerli mi = dislanmadi mi)
    donus: {validation_ok, valid_material_ratio, excluded, reasons[]}
    """
    reasons = []

    validation_ok = None
    if validation_error_px is not None and viewport_width:
        threshold = config.max_validation_error_ratio * viewport_width
        validation_ok = validation_error_px <= threshold
        if not validation_ok:
            reasons.append(
                "Dogrulama hatasi yuksek ({:.0f}px > %{:.0f} genislik)".format(
                    validation_error_px, config.max_validation_error_ratio * 100
                )
            )

    attempted = len(material_flags)
    valid = sum(1 for f in material_flags if f)
    valid_ratio = (valid / attempted) if attempted else 0.0

    excluded = False
    if attempted and valid_ratio < config.min_valid_material_ratio:
        excluded = True
        reasons.append(
            "Gecerli materyal orani dusuk (%{:.0f} < %{:.0f})".format(
                valid_ratio * 100, config.min_valid_material_ratio * 100
            )
        )

    return {
        "validation_ok": validation_ok,
        "valid_material_ratio": round(valid_ratio, 3),
        "excluded": excluded,
        "reasons": reasons,
    }
