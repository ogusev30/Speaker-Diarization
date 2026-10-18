"""Aşama 2'nin tamamını sırayla çalıştırır ve kontrol noktası raporunu verir.

Çalıştır:  .venv/bin/python scripts/asama2.py

Rapor: kişi başı train / val / test parça sayıları, her kişiden bir parçanın
spektrogramı (veri/kontrol/spektrogramlar.png) ve bir sahte sohbetin doğru cevabı.
"""
import argparse
import csv
from collections import Counter

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import torch  # noqa: E402
import torchaudio  # noqa: E402

import augment  # noqa: E402
import format_cevir  # noqa: E402
import sahte_sohbet  # noqa: E402
import temizle_bol  # noqa: E402
from ortak import KOK, SR, oku, tablo_yazdir, yollar  # noqa: E402


def rapor(kok):
    y = yollar(kok)
    with open(y["parcalar"] / "manifest.csv") as f:
        satirlar = list(csv.DictReader(f))
    temiz = Counter((s["kisi"], s["bolum"]) for s in satirlar if s["aug"] == "temiz")
    aug = Counter(s["kisi"] for s in satirlar if s["bolum"] == "train")
    kisiler = sorted({s["kisi"] for s in satirlar})

    print("\nPARÇA SAYILARI (2 saniyelik)\n")
    tablo_yazdir(["kişi", "train", "train + aug", "val", "test"],
                 [[k, temiz[k, "train"], aug[k], temiz[k, "val"], temiz[k, "test"]] for k in kisiler])

    # Her kişiden bir train parçasının log-mel spektrogramı
    mel = torchaudio.transforms.MelSpectrogram(sample_rate=SR, n_fft=400, hop_length=160, n_mels=80)
    fig, eksenler = plt.subplots(1, len(kisiler), figsize=(3.2 * len(kisiler), 3), squeeze=False)
    for ax, kisi in zip(eksenler[0], kisiler):
        ornek = next(s for s in satirlar if s["kisi"] == kisi and s["aug"] == "temiz" and s["bolum"] == "train")
        x = torch.from_numpy(oku(y["parcalar"] / ornek["yol"]))
        S = torch.log(mel(x) + 1e-6).numpy()
        ax.imshow(S, origin="lower", aspect="auto", cmap="magma", extent=[0, 2, 0, 80])
        ax.set_title(kisi)
        ax.set_xlabel("zaman (sn)")
    eksenler[0][0].set_ylabel("mel frekans bandı")
    fig.tight_layout()
    y["kontrol"].mkdir(parents=True, exist_ok=True)
    fig.savefig(y["kontrol"] / "spektrogramlar.png", dpi=110)
    print(f"\nSpektrogramlar: {y['kontrol'] / 'spektrogramlar.png'}")

    ilk = y["sohbetler"] / "sohbet_01.rttm"
    print(f"\nSahte sohbet doğru cevabı ({ilk.name}), sohbet_01.wav'ı dinleyerek kontrol et:")
    for satir in open(ilk):
        p = satir.split()
        bas, sure = float(p[3]), float(p[4])
        print(f"  {p[7]:<12} {bas:6.1f} – {bas + sure:5.1f} sn")


def main(kok=KOK):
    adimlar = [("1/4 Format çevirme (WAV, 16 kHz, mono)", format_cevir.main),
               ("2/4 Sessizliği atma, parçalara bölme, seviye eşitleme", temizle_bol.main),
               ("3/4 Augmentation", augment.main),
               ("4/4 Sahte sohbetler", sahte_sohbet.main)]
    for baslik, fn in adimlar:
        print(f"\n== {baslik}")
        fn(kok)
    rapor(kok)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--kok", default=KOK)
    main(ap.parse_args().kok)
