"""Otomatik 'dikkat ceken bolgeler' raporu (spec §8.5).

AOI'ler grup duzeyinde bakma oranina ve ilk fiksasyon suresine gore siralanir:
en cok dikkat ceken ve gozden kacan AOI'ler. Rapor sabit bir sinirlilik notuyla
baslar.
"""

# Spec §8.5: raporun basinda sabit sinirlilik notu
LIMITATION_NOTE = (
    "Web kamerasi tabanli goz izleme BOLGE DUZEYINDE yorumlanmalidir. "
    "Sonuclar kelime/satir duzeyinde kesinlik tasimaz; AOI ve sicak bolgeler "
    "yaklasik dikkat dagilimini gosterir."
)


def rank_aois(rows):
    """Bir materyalin grup AOI ozeti satirlarindan siralama uretir.

    rows: [{"aoi_name","hit_rate","mean_dwell_proportion",
            "mean_time_to_first_fixation_ms", ...}]
    donus: {"most_attention":[...], "overlooked":[...], "earliest_seen":[...]}
    """
    valid = [r for r in rows if r.get("n_participants", 0) > 0]

    most = sorted(valid, key=lambda r: (r.get("mean_dwell_proportion", 0),
                                        r.get("hit_rate", 0)), reverse=True)
    overlooked = sorted(valid, key=lambda r: (r.get("mean_dwell_proportion", 0),
                                              r.get("hit_rate", 0)))

    seen = [r for r in valid if r.get("mean_time_to_first_fixation_ms") is not None]
    earliest = sorted(seen, key=lambda r: r["mean_time_to_first_fixation_ms"])

    return {
        "most_attention": most,
        "overlooked": overlooked,
        "earliest_seen": earliest,
    }
