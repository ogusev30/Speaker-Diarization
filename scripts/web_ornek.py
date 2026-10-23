"""Web uygulamasının menüdeki iki modu için veri hazırlar.

1) Örnek sohbet: 4 sahte sohbetin WAV'ı + doğru cevaplar (RTTM) + Silero VAD konuşma bölgeleri
   -> web/public/ornek/sohbet_XX.wav, web/public/ornek/sohbetler.json
   VAD bölgeleri Python'daki DER ölçümüyle (modeller.diarize) aynı olsun diye burada bir kez hesaplanır.
2) Ses haritası: tarayıcıdaki int8 modelin embedding'leri (temiz parçalar) -> LDA ile 2 boyut
   -> web/public/models/harita.json

Çalıştır: .venv/bin/python scripts/web_ornek.py
"""
import csv
import json
import shutil

import numpy as np
import onnxruntime as ort
import soundfile as sf
import torch
from silero_vad import get_speech_timestamps, load_silero_vad
from sklearn.discriminant_analysis import LinearDiscriminantAnalysis

from ortak import KOK, SR, yollar

Y = yollar()
WEB = KOK / "web" / "public"
ONNX = WEB / "models" / "model_b.int8.onnx"
ISIMLER = json.loads((WEB / "models" / "labels.json").read_text())["labels"]
N_SOHBET = 4
NOKTA_KISI = 70  # haritada kişi başına gösterilen parça


def rttm_oku(yol):
    out = []
    for satir in yol.read_text().splitlines():
        s = satir.split()
        bas, sure = float(s[3]), float(s[4])
        out.append([round(bas, 3), round(bas + sure, 3), s[7]])
    return out


def sohbetler():
    hedef = WEB / "ornek"
    hedef.mkdir(exist_ok=True)
    vad = load_silero_vad()
    liste = []
    for wav in sorted(Y["sohbetler"].glob("sohbet_*.wav")):
        gercek = rttm_oku(wav.with_suffix(".rttm"))
        if {k for *_, k in gercek} != set(ISIMLER):  # dört kişinin de konuştuğu sohbetler
            continue
        x, sr = sf.read(wav, dtype="float32")
        assert sr == SR
        ts = get_speech_timestamps(torch.from_numpy(x), vad, sampling_rate=SR, return_seconds=True)
        shutil.copy(wav, hedef / wav.name)
        liste.append({
            "ad": wav.stem, "dosya": f"/ornek/{wav.name}", "sure": round(len(x) / SR, 3),
            "gercek": gercek, "konusma": [[t["start"], t["end"]] for t in ts],
        })
        if len(liste) == N_SOHBET:
            break
    (hedef / "sohbetler.json").write_text(json.dumps(liste, ensure_ascii=False))
    print("sohbetler:", [s["ad"] for s in liste])


def harita():
    with open(Y["parcalar"] / "manifest.csv") as f:
        satirlar = [s for s in csv.DictReader(f) if s["aug"] == "temiz"]
    oturum = ort.InferenceSession(str(ONNX))
    emb = []
    for i in range(0, len(satirlar), 64):
        w = np.stack([sf.read(Y["parcalar"] / s["yol"], dtype="float32")[0] for s in satirlar[i:i + 64]])
        emb.append(oturum.run(["embedding"], {"waveform": w})[0])
    e = np.concatenate(emb)
    e /= np.linalg.norm(e, axis=1, keepdims=True)
    y = np.array([ISIMLER.index(s["kisi"]) for s in satirlar])
    bolum = np.array([s["bolum"] for s in satirlar])

    tr = bolum == "train"
    lda = LinearDiscriminantAnalysis(n_components=3).fit(e[tr], y[tr])
    ort_ = lda.xbar_
    # 1. eksen sadece kadın/erkek sesini ayırıyor (Cem ile Onur üst üste düşüyordu); 2. ve 3. eksen dört kişiyi de ayırıyor
    eksen = lda.scalings_[:, 1:3].T  # tarayıcıda: (e - ort) @ eksen.T
    xy = (e - ort_) @ eksen.T
    olcek = np.abs(xy).max()
    xy /= olcek

    # 192 boyutta kişinin merkezi (train) ve train dışı parçaların merkeze tipik benzerliği
    merkez = np.stack([e[tr & (y == k)].mean(0) for k in range(len(ISIMLER))])
    merkez /= np.linalg.norm(merkez, axis=1, keepdims=True)
    tipik = [float(np.median(e[~tr & (y == k)] @ merkez[k])) for k in range(len(ISIMLER))]

    rng = np.random.default_rng(0)
    noktalar = []
    for k in range(len(ISIMLER)):
        idx = rng.choice(np.where(y == k)[0], NOKTA_KISI, replace=False)
        noktalar += [[k, round(float(xy[i, 0]), 4), round(float(xy[i, 1]), 4)] for i in idx]

    r = lambda a: np.round(a, 6).tolist()
    (WEB / "models" / "harita.json").write_text(json.dumps({
        "labels": ISIMLER, "ort": r(ort_), "eksen": r(eksen / olcek), "merkez": r(merkez),
        "tipik": [round(t, 4) for t in tipik], "noktalar": noktalar,
    }))
    print("harita: tipik benzerlik", dict(zip(ISIMLER, np.round(tipik, 3))))


if __name__ == "__main__":
    sohbetler()
    harita()
