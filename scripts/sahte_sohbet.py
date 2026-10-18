"""Aşama 2: DER ölçmek için doğru cevabı bilinen sahte sohbetler oluşturur.

- Sadece test oturumlarının (oturum 3) konuşmasından 2–6 saniyelik sıralar alınır
- Art arda iki sıra aynı kişiden olmaz, aralara 0,3–1 saniye oda sesi girer
- 1 dakikalık 20 sohbet: veri/sahte_sohbetler/sohbet_01.wav + sohbet_01.rttm
"""
import argparse

import numpy as np

from ortak import BOLUM, KOK, SR, oku, oturum_no, seviye_esitle, yaz, yollar

TOHUM = 7
SOHBET_SAYISI = 20
SOHBET_SN = 60.0
SIRA_SN = (2.0, 6.0)
ARA_SN = (0.3, 1.0)
ODA_SESI_DBFS = -55.0  # konuşmalar -20 dBFS, aralardaki oda sesi ondan çok daha sessiz


def rttm_satiri(sohbet, bas, sure, kisi):
    return f"SPEAKER {sohbet} 1 {bas:.3f} {sure:.3f} <NA> <NA> {kisi} <NA> <NA>\n"


def main(kok=KOK):
    y = yollar(kok)
    rng = np.random.default_rng(TOHUM)

    test = {}
    for kisi_dir in sorted(p for p in y["temiz"].iterdir() if p.is_dir()):
        parcalar = [oku(w) for w in sorted(kisi_dir.glob("*.wav")) if BOLUM.get(oturum_no(w)) == "test"]
        parcalar = [p for p in parcalar if len(p) >= SIRA_SN[0] * SR]
        if parcalar:
            test[kisi_dir.name] = np.concatenate(parcalar)
    if len(test) < 2:
        raise SystemExit("Sahte sohbet için en az 2 kişinin test oturumu lazım.")

    oda_dosyalari = sorted(y["oda16k"].glob("*laptop*.wav")) or sorted(y["oda16k"].glob("*.wav"))
    oda = np.concatenate([oku(p) for p in oda_dosyalari]) if oda_dosyalari else None

    def ara_sesi(uzunluk):
        if oda is None or len(oda) < uzunluk:
            return np.zeros(uzunluk, dtype=np.float32)
        bas = rng.integers(0, len(oda) - uzunluk + 1)
        return seviye_esitle(oda[bas:bas + uzunluk], ODA_SESI_DBFS)

    y["sohbetler"].mkdir(parents=True, exist_ok=True)
    kisiler = sorted(test)
    hepsi = open(y["sohbetler"] / "hepsi.rttm", "w")
    toplam_ornek = int(SOHBET_SN * SR)

    for i in range(1, SOHBET_SAYISI + 1):
        ad = f"sohbet_{i:02d}"
        ses, rttm, t, onceki = [], [], 0, None
        while True:
            kalan = toplam_ornek - t
            if kalan < SIRA_SN[0] * SR:
                break
            kisi = rng.choice([k for k in kisiler if k != onceki])
            uzunluk = min(int(rng.uniform(*SIRA_SN) * SR), len(test[kisi]), kalan)
            bas = rng.integers(0, len(test[kisi]) - uzunluk + 1)
            ses.append(seviye_esitle(test[kisi][bas:bas + uzunluk]))
            rttm.append(rttm_satiri(ad, t / SR, uzunluk / SR, kisi))
            t += uzunluk
            onceki = kisi
            ara = min(int(rng.uniform(*ARA_SN) * SR), toplam_ornek - t)
            ses.append(ara_sesi(ara))
            t += ara
        if t < toplam_ornek:
            ses.append(ara_sesi(toplam_ornek - t))

        yaz(y["sohbetler"] / f"{ad}.wav", np.concatenate(ses))
        with open(y["sohbetler"] / f"{ad}.rttm", "w") as f:
            f.writelines(rttm)
        hepsi.writelines(rttm)
    hepsi.close()
    print(f"  {SOHBET_SAYISI} sahte sohbet ({len(kisiler)} kişi) -> {y['sohbetler']}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--kok", default=KOK)
    main(ap.parse_args().kok)
