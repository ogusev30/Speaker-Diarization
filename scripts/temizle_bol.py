"""Aşama 2, adım 3–6: sessizliği atar, 2 saniyelik parçalara böler, seviyeyi eşitler
ve parçaları oturuma göre train / val / test klasörlerine koyar.

veri/temiz/<kişi>/<kayıt>.wav                    sadece konuşma (sahte sohbetler bunu kullanır)
veri/parcalar/<bölüm>/<kişi>/<kayıt>_0000.wav    2 saniyelik, seviyesi eşitlenmiş parçalar
veri/parcalar/manifest.csv                       her parçanın kişisi, oturumu, cihazı, bölümü

Altın kural: bölüm oturuma göre seçilir, yani bir kaydın tüm parçaları aynı bölüme düşer.
"""
import argparse
import csv
import shutil

import numpy as np
import torch
from silero_vad import get_speech_timestamps, load_silero_vad

from ortak import BOLUM, CIHAZ, KOK, PARCA_SN, SR, oku, oturum_no, seviye_esitle, yaz, yollar

MANIFEST_ALANLARI = ["yol", "kisi", "oturum", "cihaz", "bolum", "kayit", "aug"]


def konusmayi_al(x, vad):
    """Silero VAD ile konuşma bölgelerini bulur ve uç uca ekler."""
    bolgeler = get_speech_timestamps(torch.from_numpy(x), vad, sampling_rate=SR)
    if not bolgeler:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate([x[b["start"]:b["end"]] for b in bolgeler])


def main(kok=KOK):
    y = yollar(kok)
    vad = load_silero_vad()
    parca_ornek = int(PARCA_SN * SR)

    # Eski çıktıyı sil ki yeniden çalıştırınca eski parçalar karışmasın
    for d in (y["temiz"], y["parcalar"]):
        if d.exists():
            shutil.rmtree(d)

    satirlar = []
    for kisi_dir in sorted(p for p in y["wav16k"].iterdir() if p.is_dir() and not p.name.startswith("_")):
        kisi = kisi_dir.name
        for wav in sorted(kisi_dir.glob("*.wav")):
            n = oturum_no(wav)
            if n not in BOLUM:
                print(f"  atlandı (planda olmayan oturum): {kisi}/{wav.name}")
                continue
            ham = oku(wav)
            konusma = konusmayi_al(ham, vad)
            yaz(y["temiz"] / kisi / wav.name, seviye_esitle(konusma))

            bolum = BOLUM[n]
            adet = len(konusma) // parca_ornek  # sondaki 2 saniyeden kısa kısım atılır
            for i in range(adet):
                parca = seviye_esitle(konusma[i * parca_ornek:(i + 1) * parca_ornek])
                yol = y["parcalar"] / bolum / kisi / f"{wav.stem}_{i:04d}.wav"
                yaz(yol, parca)
                satirlar.append({"yol": str(yol.relative_to(y["parcalar"])), "kisi": kisi, "oturum": n,
                                 "cihaz": CIHAZ[n], "bolum": bolum, "kayit": f"{kisi}/{wav.stem}", "aug": "temiz"})
            print(f"  {kisi}/{wav.name}: {len(ham) / SR:6.1f} sn kayıt -> {len(konusma) / SR:6.1f} sn konuşma "
                  f"-> {adet} parça ({bolum})")

    # Altın kural kontrolü: hiçbir kayıt iki bölümde birden olmamalı
    kayit_bolum = {}
    for s in satirlar:
        kayit_bolum.setdefault(s["kayit"], set()).add(s["bolum"])
    sizan = [k for k, b in kayit_bolum.items() if len(b) > 1]
    assert not sizan, f"Aynı kayıt birden fazla bölümde: {sizan}"

    y["parcalar"].mkdir(parents=True, exist_ok=True)
    with open(y["parcalar"] / "manifest.csv", "w", newline="") as f:
        w = csv.DictWriter(f, MANIFEST_ALANLARI)
        w.writeheader()
        w.writerows(satirlar)
    print(f"  toplam {len(satirlar)} parça -> {y['parcalar'] / 'manifest.csv'}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--kok", default=KOK)
    main(ap.parse_args().kok)
