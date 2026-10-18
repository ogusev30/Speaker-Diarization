"""Aşama 6: kazanan modeli (Model B) tarayıcı için ONNX'e çevirir.

Çalıştır:  .venv/bin/python scripts/onnx_export.py
Çıktı:     web_model/ (fp32, fp16, int8 + labels.json) ve seçilen model web/public/models/ içine kopyalanır.
int8 modelin test parçalarında .pt modelle aynı kişiyi bulma oranı %99'un altındaysa fp16 seçilir.
"""
import json
import shutil
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import torch

KOK = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(KOK / "scripts"))
sys.path.insert(0, str(KOK / "web_export"))
from export_onnx import check_parity, export_model_b  # noqa: E402
from modeller import ecapa_yukle, yukle_b  # noqa: E402
from ortak import oku, yollar  # noqa: E402

torch.set_num_threads(48)


def main():
    Y = yollar(KOK)
    manifest = pd.read_csv(Y["parcalar"] / "manifest.csv")
    test = manifest[manifest.bolum == "test"]
    X_test = np.stack([oku(Y["parcalar"] / p) for p in test.yol]).astype(np.float32)

    ecapa = ecapa_yukle()
    kafa, isimler = yukle_b(KOK / "modeller/model_b_kafa.pt")
    cikti = KOK / "web_model"
    dosyalar = export_model_b(ecapa, kafa, isimler, out_dir=str(cikti), l2_normalize_embedding=True)

    # .pt modelle (SpeechBrain'in kendi encode_batch'i + sınıflandırıcı) karşılaştırma, tüm test parçalarında
    def pt_model(x):
        e = ecapa.encode_batch(x).squeeze(1)
        return torch.softmax(kafa(torch.nn.functional.normalize(e, dim=-1)), -1), e

    uyum = {}
    for tur, yol in dosyalar.items():
        with torch.inference_mode():
            r = check_parity(yol, pt_model, X_test)
        uyum[tur] = r
        print(f"{tur:5} {Path(yol).stat().st_size / 1e6:5.1f} MB   .pt ile aynı kişi: %{100 * r['argmax_agree']:.1f} "
              f"({len(X_test)} test parçası)   embedding benzerliği min {r['min_cos']:.4f}")

    secilen = "int8" if uyum["int8"]["argmax_agree"] >= 0.99 else "fp16"
    print(f"\nSeçilen: {secilen} (int8 uyumu %{100 * uyum['int8']['argmax_agree']:.1f}, eşik %99)")

    etiket = json.loads((cikti / "labels.json").read_text())
    sonuc = json.loads((KOK / "modeller/sonuclar.json").read_text())
    etiket.update(model=Path(dosyalar[secilen]).name, model_adi="Model B: ECAPA + sınıflandırıcı",
                  der=sonuc["Model B"]["der"], int8_uyum=uyum["int8"]["argmax_agree"],
                  l2_normalize_embedding=True)
    (cikti / "labels.json").write_text(json.dumps(etiket, ensure_ascii=False, indent=1))

    hedef = KOK / "web/public/models"
    hedef.mkdir(parents=True, exist_ok=True)
    for eski in hedef.glob("*.onnx"):
        eski.unlink()
    shutil.copy(dosyalar[secilen], hedef)
    shutil.copy(cikti / "labels.json", hedef)
    print(f"-> {hedef}: {Path(dosyalar[secilen]).name}, labels.json")


if __name__ == "__main__":
    main()
