"""Aşama 2, adım 7: her train parçasının 3 değiştirilmiş kopyasını diske yazar.

  _gurultu  oda sesi eklenmiş (SNR 5–20 dB)
  _yanki    yapay oda yankısı eklenmiş (RT60 0,2–0,7 sn)
  _seviye   ses seviyesi değiştirilmiş (-12 ile +6 dB arası)

Hızlandırma/yavaşlatma yok: sesin perdesini değiştirir, kişi başka biri gibi duyulur.
İki model de bu kopyalarla eğitilir; kopyalar manifest.csv'ye "aug" sütunuyla eklenir.
"""
import argparse
import csv

import numpy as np
from scipy.signal import fftconvolve

from ortak import KOK, SR, oku, seviye_esitle, yaz, yollar
from temizle_bol import MANIFEST_ALANLARI

TOHUM = 42


def oda_sesi_ekle(x, gurultuler, rng):
    g = gurultuler[rng.integers(len(gurultuler))]
    if len(g) < len(x):
        g = np.tile(g, len(x) // len(g) + 1)
    bas = rng.integers(0, len(g) - len(x) + 1)
    g = g[bas:bas + len(x)]
    snr = rng.uniform(5, 20)
    rms_x = np.sqrt(np.mean(x ** 2))
    rms_g = np.sqrt(np.mean(g ** 2)) + 1e-9
    return seviye_esitle(x + g * (rms_x / rms_g) / 10 ** (snr / 20))


def yanki_ekle(x, rng):
    rt60 = rng.uniform(0.2, 0.7)
    t = np.arange(int(rt60 * SR)) / SR
    rir = rng.standard_normal(len(t)) * np.exp(-6.9 * t / rt60)  # 60 dB'lik üstel sönüm
    rir[0] = 1.0  # doğrudan gelen ses
    rir /= np.sqrt(np.sum(rir ** 2))
    return seviye_esitle(fftconvolve(x, rir)[:len(x)])


def seviye_degistir(x, rng):
    db = rng.choice([rng.uniform(-12, -3), rng.uniform(3, 6)])
    y = x * 10 ** (db / 20)
    tepe = np.abs(y).max()
    return (y * 0.99 / tepe if tepe > 0.99 else y).astype(np.float32)


def main(kok=KOK):
    y = yollar(kok)
    rng = np.random.default_rng(TOHUM)
    gurultuler = [oku(p) for p in sorted(y["oda16k"].glob("*.wav"))]
    if not gurultuler:
        raise SystemExit("oda_sesi/ boş: augmentation için oda sesi kaydı lazım.")

    manifest = y["parcalar"] / "manifest.csv"
    with open(manifest) as f:
        satirlar = [s for s in csv.DictReader(f) if s["aug"] == "temiz"]  # yeniden çalıştırmaya dayanıklı

    yeni = []
    for s in satirlar:
        if s["bolum"] != "train":
            continue
        kaynak = y["parcalar"] / s["yol"]
        x = oku(kaynak)
        for ad, fn in (("gurultu", lambda v: oda_sesi_ekle(v, gurultuler, rng)),
                       ("yanki", lambda v: yanki_ekle(v, rng)),
                       ("seviye", lambda v: seviye_degistir(v, rng))):
            hedef = kaynak.with_name(f"{kaynak.stem}_{ad}.wav")
            yaz(hedef, fn(x))
            yeni.append({**s, "yol": str(hedef.relative_to(y["parcalar"])), "aug": ad})

    with open(manifest, "w", newline="") as f:
        w = csv.DictWriter(f, MANIFEST_ALANLARI)
        w.writeheader()
        w.writerows(satirlar + yeni)
    print(f"  {len(yeni) // 3} train parçası x 3 kopya = {len(yeni)} yeni parça")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--kok", default=KOK)
    main(ap.parse_args().kok)
