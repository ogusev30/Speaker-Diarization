"""İki modelin tanımı ve diarization (kim ne zaman konuştu) adımı.

Notebook (training.ipynb), Gradio uygulaması (app.py) ve ONNX export aynı kodu kullanır.
"""
import os
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import torchaudio

from ortak import KOK, PARCA_SN, SR, seviye_esitle

PENCERE = int(PARCA_SN * SR)   # 32000 örnek = 2 sn
KAYDIRMA = SR // 2             # 0,5 sn
ECAPA_KLASOR = KOK / "pretrained_models" / "spkrec-ecapa-voxceleb"


# ---------- Model A: sıfırdan CNN ----------

def mel_donusumu():
    """Ses -> mel spektrogram. export_onnx.export_model_a bununla aynı adımı tarayıcıya taşır."""
    return torchaudio.transforms.MelSpectrogram(sample_rate=SR, n_fft=400, hop_length=160, n_mels=80)


def log_mel(mel, wav):
    """wav [B, 32000] -> [B, 1, 80, 201]"""
    return torch.log(mel(wav) + 1e-6).unsqueeze(1)


def blok(c_in, c_out):
    return nn.Sequential(nn.Conv2d(c_in, c_out, 3, padding=1), nn.BatchNorm2d(c_out), nn.ReLU(), nn.MaxPool2d(2))


def model_a_yap(n_kisi, kanallar=(16, 32, 64, 128, 128)):
    """İlk 5 eleman blok (canlı panel bunları çizer); sınıflandırıcı ayrı bir Sequential'a sarılmaz."""
    c = (1, *kanallar)
    return nn.Sequential(*[blok(c[i], c[i + 1]) for i in range(5)],
                         nn.AdaptiveAvgPool2d(1), nn.Flatten(), nn.Dropout(0.3), nn.Linear(c[-1], n_kisi))


# ---------- Model B: donuk ECAPA + küçük sınıflandırıcı ----------

def ecapa_yukle():
    # speechbrain 1.0.3 repo adından indiremiyor: yerel klasörden yükle (ses_adaptoru/inside_view.py'deki gibi)
    from speechbrain.inference.speaker import EncoderClassifier
    src = str(ECAPA_KLASOR)
    if not ECAPA_KLASOR.exists():
        from huggingface_hub import snapshot_download
        src = snapshot_download("speechbrain/spkrec-ecapa-voxceleb", local_dir=src)
    ecapa = EncoderClassifier.from_hparams(source=src, savedir=os.path.expanduser("~/.cache/ecapa_sb"),
                                           overrides={"pretrained_path": src}, run_opts={"device": "cpu"})
    ecapa.eval()
    for p in ecapa.mods.parameters():
        p.requires_grad = False
    return ecapa


@torch.inference_mode()
def embedding_cikar(ecapa, wav, batch=64):
    """wav [N, 32000] -> [N, 192] (ham, normalize edilmemiş ECAPA embedding'i)"""
    return torch.cat([ecapa.encode_batch(wav[i:i + batch]).squeeze(1) for i in range(0, len(wav), batch)])


def model_b_kafa_yap(n_kisi):
    """L2 normalize edilmiş 192 sayı -> kişiler. export_model_b(..., l2_normalize_embedding=True) ile uyumlu."""
    return nn.Linear(192, n_kisi)


# ---------- Tahmin fonksiyonları: [N, 32000] seviyesi eşitlenmiş pencere -> [N, kişi] olasılık ----------

def tahminci_a(model, mel):
    @torch.inference_mode()
    def f(wav):
        model.eval()
        return torch.softmax(model(log_mel(mel, wav)), -1)
    return f


def tahminci_b(ecapa, kafa):
    @torch.inference_mode()
    def f(wav):
        kafa.eval()
        return torch.softmax(kafa(F.normalize(embedding_cikar(ecapa, wav), dim=-1)), -1)
    return f


# ---------- Diarization: VAD + 2 sn pencere, 0,5 sn kaydırma ----------

def pencereler(x):
    """Ses -> 0,5 sn arayla başlayan 2 sn'lik, seviyesi eşitlenmiş pencereler. Kısa ses sessizlikle doldurulur."""
    if len(x) < PENCERE:
        x = np.pad(x, (0, PENCERE - len(x)))
    baslar = list(range(0, len(x) - PENCERE + 1, KAYDIRMA))
    return np.stack([seviye_esitle(x[b:b + PENCERE]) for b in baslar]), len(x)


def konusma_bolgeleri(x, vad):
    from silero_vad import get_speech_timestamps
    ts = get_speech_timestamps(torch.from_numpy(np.ascontiguousarray(x, dtype=np.float32)), vad,
                               sampling_rate=SR, return_seconds=True)
    return [(t["start"], t["end"]) for t in ts]


def diarize(x, tahmin_fn, vad, isimler):
    """Kim ne zaman konuştu: [(başlangıç sn, bitiş sn, isim, güven)]

    Her 0,5 sn'lik dilimin olasılığı, o dilimin üstüne düşen pencerelerin ortalaması.
    Konuşma olmayan yerler (VAD) boş kalır.
    """
    bolgeler = konusma_bolgeleri(x, vad)
    if not bolgeler:
        return []
    w, n = pencereler(x)
    olas = tahmin_fn(torch.from_numpy(w)).numpy()                    # [pencere, kişi]
    adim = PENCERE // KAYDIRMA                                        # bir pencere 4 dilimi kapsar
    n_dilim = int(np.ceil(n / KAYDIRMA))
    toplam = np.zeros((n_dilim, olas.shape[1]))
    sayi = np.zeros(n_dilim)
    for i, p in enumerate(olas):
        toplam[i:i + adim] += p
        sayi[i:i + adim] += 1
    sayi[sayi == 0] = 1
    dilim = toplam / sayi[:, None]
    # Pencerelerin kapsamadığı son dilimler varsa son pencereyi kullan
    son = len(olas) - 1 + adim
    if son < n_dilim:
        dilim[son:] = olas[-1]

    parcalar = []
    for bas, bit in bolgeler:
        t = bas
        while t < bit:
            k = min(int(t / (KAYDIRMA / SR)), n_dilim - 1)
            sinir = min(bit, (k + 1) * KAYDIRMA / SR)
            j = int(dilim[k].argmax())
            if parcalar and parcalar[-1][2] == isimler[j] and abs(parcalar[-1][1] - t) < 1e-6:
                p = parcalar[-1]
                parcalar[-1] = (p[0], sinir, p[2], p[3] + [dilim[k, j]])
            else:
                parcalar.append((t, sinir, isimler[j], [dilim[k, j]]))
            t = sinir
    return [(b, e, k, float(np.mean(g))) for b, e, k, g in parcalar]


def kaydet_a(yol, model, isimler):
    Path(yol).parent.mkdir(parents=True, exist_ok=True)
    torch.save({"state_dict": model.state_dict(), "isimler": list(isimler),
                "mel": dict(sample_rate=SR, n_fft=400, hop_length=160, n_mels=80)}, yol)


def yukle_a(yol):
    d = torch.load(yol, map_location="cpu")
    m = model_a_yap(len(d["isimler"]))
    m.load_state_dict(d["state_dict"])
    return m.eval(), d["isimler"]


def kaydet_b(yol, kafa, isimler):
    Path(yol).parent.mkdir(parents=True, exist_ok=True)
    torch.save({"state_dict": kafa.state_dict(), "isimler": list(isimler), "l2_normalize_embedding": True,
                "ecapa": "speechbrain/spkrec-ecapa-voxceleb"}, yol)


def yukle_b(yol):
    d = torch.load(yol, map_location="cpu")
    k = model_b_kafa_yap(len(d["isimler"]))
    k.load_state_dict(d["state_dict"])
    return k.eval(), d["isimler"]
