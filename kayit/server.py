"""Ses kayıt sayfası (Aşama 1).

Çalıştır:  .venv/bin/python kayit/server.py
Aç:        https://student.exposureai.org/lab/proxy/8010/

Laptop oturumları (2 ve 3) mikrofondan kaydedilir; telefon oturumları (1 ve 4)
telefonda kaydedilip buradan yüklenir. Dosyalar dataset/<kişi>/oturumN_cihaz.uzantı
olarak kaydedilir.
"""
import os
import re
import sys
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Form, HTTPException, UploadFile
from fastapi.responses import HTMLResponse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from ortak import CIHAZ, KOK, SES_UZANTILARI, ses_dosyalari, sure_olc, yollar  # noqa: E402

KOK = Path(os.environ.get("KAYIT_KOK", KOK))  # test için başka klasör verilebilir

PORT = 8010
TR = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")
Y = yollar(KOK)
app = FastAPI()


def isim_temizle(isim):
    isim = isim.strip().translate(TR).lower()
    return re.sub(r"[^a-z0-9_]+", "_", isim).strip("_")


def hedef_yol(kisi, oturum, uzanti):
    if oturum in ("oda_telefon", "oda_laptop"):
        return Y["oda_sesi"] / f"ofis_{oturum[4:]}{uzanti}"
    if oturum not in ("1", "2", "3", "4"):
        raise HTTPException(400, "Geçersiz oturum")
    kisi = isim_temizle(kisi)
    if not kisi:
        raise HTTPException(400, "Önce kişinin adını yaz")
    n = int(oturum)
    return Y["dataset"] / kisi / f"oturum{n}_{CIHAZ[n]}{uzanti}"


@app.get("/", response_class=HTMLResponse)
def sayfa():
    return (Path(__file__).parent / "index.html").read_text(encoding="utf-8")


@app.get("/durum")
def durum():
    kisiler = {}
    if Y["dataset"].is_dir():
        for d in sorted(p for p in Y["dataset"].iterdir() if p.is_dir()):
            kisiler[d.name] = [{"dosya": f.name, "sure": round(sure_olc(f), 1)} for f in ses_dosyalari(d)]
    oda = [{"dosya": f.name, "sure": round(sure_olc(f), 1)} for f in ses_dosyalari(Y["oda_sesi"])]
    return {"kisiler": kisiler, "oda_sesi": oda}


@app.post("/kaydet")
async def kaydet(dosya: UploadFile, oturum: str = Form(...), kisi: str = Form(""), uzerine_yaz: str = Form("0")):
    uzanti = Path(dosya.filename or "kayit.wav").suffix.lower() or ".wav"
    if uzanti not in SES_UZANTILARI:
        raise HTTPException(400, f"Desteklenmeyen dosya türü: {uzanti}")
    hedef = hedef_yol(kisi, oturum, uzanti)

    # Aynı oturumun farklı uzantılı eski dosyası da "var" sayılır
    eskiler = [p for p in hedef.parent.glob(hedef.stem + ".*") if p.suffix.lower() in SES_UZANTILARI]
    if eskiler and uzerine_yaz != "1":
        raise HTTPException(409, f"{eskiler[0].relative_to(KOK)} zaten var")
    for p in eskiler:
        p.unlink()

    hedef.parent.mkdir(parents=True, exist_ok=True)
    hedef.write_bytes(await dosya.read())
    sure = sure_olc(hedef)
    if sure < 1:
        hedef.unlink()
        raise HTTPException(400, "Dosya okunamadı ya da boş")
    return {"yol": str(hedef.relative_to(KOK)), "sure": round(sure, 1)}


if __name__ == "__main__":
    print(f"Kayıt sayfası: https://student.exposureai.org/lab/proxy/{PORT}/")
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
