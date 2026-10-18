"""Tüm scriptlerin ortak ayarları ve yardımcı fonksiyonları.

Ses seviyesi eşitleme (seviye_esitle) eğitimde, Gradio'da ve web uygulamasında
aynı şekilde yapılmalı: her 2 saniyelik parça kendi RMS'ine göre -20 dBFS'e getirilir.
"""
import re
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf

KOK = Path(__file__).resolve().parent.parent

SR = 16000          # örnekleme hızı (Hz)
PARCA_SN = 2.0      # modelin göreceği parça uzunluğu (saniye)
HEDEF_DBFS = -20.0  # her parçanın RMS seviyesi

# Brief'teki kayıt planı: oturum -> cihaz ve train/validation/test bölümü
CIHAZ = {1: "telefon", 2: "laptop", 3: "laptop", 4: "telefon"}
BOLUM = {1: "train", 2: "train", 4: "val", 3: "test"}

SES_UZANTILARI = {".wav", ".m4a", ".mp3", ".flac", ".ogg", ".webm", ".aac", ".3gp", ".opus", ".mp4"}


def yollar(kok=KOK):
    kok = Path(kok)
    veri = kok / "veri"
    return {
        "dataset": kok / "dataset",
        "oda_sesi": kok / "oda_sesi",
        "wav16k": veri / "wav16k",          # 16 kHz mono WAV'a çevrilmiş ham kayıtlar
        "oda16k": veri / "wav16k" / "_oda_sesi",
        "temiz": veri / "temiz",            # sessizliği atılmış, sadece konuşma
        "parcalar": veri / "parcalar",      # 2 saniyelik parçalar (train/val/test)
        "sohbetler": veri / "sahte_sohbetler",
        "kontrol": veri / "kontrol",
    }


def ses_dosyalari(klasor):
    klasor = Path(klasor)
    if not klasor.is_dir():
        return []
    return sorted(p for p in klasor.iterdir() if p.is_file() and p.suffix.lower() in SES_UZANTILARI)


def oturum_no(dosya):
    """'oturum2_laptop.wav' -> 2. Eşleşmezse None."""
    m = re.match(r"oturum(\d+)", Path(dosya).stem.lower())
    return int(m.group(1)) if m else None


def sure_olc(yol):
    """Her formatta (m4a dahil) süreyi saniye olarak ölçer."""
    cikti = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(yol)],
        capture_output=True, text=True,
    ).stdout.strip()
    try:
        return float(cikti)
    except ValueError:
        return 0.0


def dk_sn(saniye):
    saniye = int(round(saniye))
    return f"{saniye // 60}:{saniye % 60:02d}"


def oku(yol):
    x, sr = sf.read(str(yol), dtype="float32", always_2d=True)
    assert sr == SR, f"{yol} {sr} Hz, {SR} Hz bekleniyordu"
    return x.mean(axis=1)


def yaz(yol, x):
    yol = Path(yol)
    yol.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(yol), np.clip(x, -1, 1), SR, subtype="PCM_16")


def seviye_esitle(x, hedef_dbfs=HEDEF_DBFS):
    """RMS'i hedef seviyeye getirir, sonra [-1, 1]'e kırpar (web_export/labels.json ile aynı)."""
    x = np.asarray(x, dtype=np.float32)
    if x.size == 0:
        return x
    rms = float(np.sqrt(np.mean(x ** 2)))
    if rms < 1e-6:
        return x
    return np.clip(x * (10 ** (hedef_dbfs / 20) / rms), -1, 1).astype(np.float32)


def tablo_yazdir(basliklar, satirlar):
    satirlar = [[str(h) for h in s] for s in satirlar]
    genislik = [max(len(str(b)), *(len(s[i]) for s in satirlar)) if satirlar else len(str(b))
                for i, b in enumerate(basliklar)]
    print(" | ".join(str(b).ljust(g) for b, g in zip(basliklar, genislik)))
    print("-+-".join("-" * g for g in genislik))
    for s in satirlar:
        print(" | ".join(h.ljust(g) for h, g in zip(s, genislik)))
