"""Aşama 1 kontrol noktası: her kişinin oturumlarını ve toplam kayıt süresini gösterir.

Çalıştır:  .venv/bin/python scripts/kontrol.py
"""
import argparse
import statistics

from ortak import CIHAZ, KOK, dk_sn, oturum_no, ses_dosyalari, sure_olc, tablo_yazdir, yollar

MIN_TOPLAM_SN = 8 * 60
OTURUM_MIN_SN, OTURUM_MAX_SN = 90, 200


def main(kok=KOK):
    y = yollar(kok)
    sorun_var = False

    kisiler = sorted(p for p in y["dataset"].iterdir() if p.is_dir()) if y["dataset"].is_dir() else []
    if not kisiler:
        print(f"'{y['dataset']}' içinde kişi klasörü yok. Kayıtları dataset/<isim>/ altına koy.")
        return False

    satirlar, toplamlar, uyarilar = [], {}, []
    for kisi_dir in kisiler:
        kisi = kisi_dir.name
        oturumlar = {}
        for dosya in ses_dosyalari(kisi_dir):
            n = oturum_no(dosya)
            if n is None:
                uyarilar.append(f"{kisi}/{dosya.name}: adı 'oturumN_cihaz' şeklinde değil, sayılmadı")
                continue
            sure = sure_olc(dosya)
            oturumlar.setdefault(n, []).append((dosya, sure))
            if CIHAZ.get(n) and CIHAZ[n] not in dosya.stem.lower():
                uyarilar.append(f"{kisi}/{dosya.name}: oturum {n} {CIHAZ[n]} ile kaydedilmeliydi")
            if sure < 1:
                uyarilar.append(f"{kisi}/{dosya.name}: okunamadı ya da boş")

        hucreler, toplam = [], 0.0
        for n in (1, 2, 3, 4):
            s = sum(sure for _, sure in oturumlar.get(n, []))
            toplam += s
            if not s:
                hucreler.append("YOK")
            else:
                isaret = "" if OTURUM_MIN_SN <= s <= OTURUM_MAX_SN else " !"
                hucreler.append(dk_sn(s) + isaret)
        fazla = sorted(set(oturumlar) - {1, 2, 3, 4})
        for n in fazla:
            uyarilar.append(f"{kisi}: oturum{n} planda yok, kullanılmayacak")

        cihazlar = {CIHAZ[n] for n in oturumlar if n in CIHAZ}
        durum = []
        if any(n not in oturumlar for n in (1, 2, 3, 4)):
            durum.append("eksik oturum")
        if toplam < MIN_TOPLAM_SN:
            durum.append("8 dk altında")
        if cihazlar != {"telefon", "laptop"}:
            durum.append("tek cihaz")
        sorun_var |= bool(durum)
        toplamlar[kisi] = toplam
        satirlar.append([kisi, *hucreler, dk_sn(toplam), ", ".join(durum) or "tamam"])

    print("\nKİŞİ BAŞI KAYITLAR (dk:sn)\n")
    tablo_yazdir(["kişi", "oturum1 (tel)", "oturum2 (lap)", "oturum3 (lap)", "oturum4 (tel)", "toplam", "durum"], satirlar)
    print("\n'!' = oturum 1,5–3,3 dakika aralığının dışında (hedef 2–2,5 dk)")

    if len(kisiler) < 4:
        print(f"\nUYARI: {len(kisiler)} kişi var, en az 4 kişi gerekli.")
        sorun_var = True

    orta = statistics.median(toplamlar.values())
    for kisi, t in toplamlar.items():
        if orta and abs(t - orta) / orta > 0.25:
            uyarilar.append(f"{kisi}: toplam süre ({dk_sn(t)}) ortancadan ({dk_sn(orta)}) %25'ten fazla farklı")

    print("\nODA SESİ")
    oda = ses_dosyalari(y["oda_sesi"])
    for dosya in oda:
        print(f"  {dosya.name}: {dk_sn(sure_olc(dosya))}")
    for cihaz in ("telefon", "laptop"):
        if not any(cihaz in d.stem.lower() for d in oda):
            print(f"  EKSİK: {cihaz} ile oda sesi (oda_sesi/ofis_{cihaz}.*)")
            sorun_var = True

    if uyarilar:
        print("\nUYARILAR")
        for u in uyarilar:
            print("  - " + u)

    print("\nSONUÇ: " + ("düzeltilmesi gereken şeyler var." if sorun_var else "Aşama 1 tamam, Aşama 2'ye geçebilirsin."))
    return not sorun_var


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--kok", default=KOK, help="proje klasörü (test için)")
    main(ap.parse_args().kok)
