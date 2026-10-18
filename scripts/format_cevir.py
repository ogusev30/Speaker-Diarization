"""Aşama 2, adım 2: tüm kayıtları aynı formata çevirir (WAV, 16 kHz, mono).

dataset/<kişi>/oturumN_cihaz.*  ->  veri/wav16k/<kişi>/oturumN_cihaz.wav
oda_sesi/*                      ->  veri/wav16k/_oda_sesi/*.wav
"""
import argparse
import subprocess

from ortak import KOK, SR, oturum_no, ses_dosyalari, yollar


def cevir(kaynak, hedef):
    hedef.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y", "-i", str(kaynak),
         "-ac", "1", "-ar", str(SR), "-sample_fmt", "s16", str(hedef)],
        check=True,
    )


def main(kok=KOK):
    y = yollar(kok)
    sayi = 0
    for kisi_dir in sorted(p for p in y["dataset"].iterdir() if p.is_dir()):
        for dosya in ses_dosyalari(kisi_dir):
            if oturum_no(dosya) is None:
                print(f"  atlandı (adı oturumN_ ile başlamıyor): {kisi_dir.name}/{dosya.name}")
                continue
            cevir(dosya, y["wav16k"] / kisi_dir.name / (dosya.stem + ".wav"))
            sayi += 1
    for dosya in ses_dosyalari(y["oda_sesi"]):
        cevir(dosya, y["oda16k"] / (dosya.stem + ".wav"))
        sayi += 1
    print(f"  {sayi} dosya 16 kHz mono WAV'a çevrildi -> {y['wav16k']}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--kok", default=KOK)
    main(ap.parse_args().kok)
