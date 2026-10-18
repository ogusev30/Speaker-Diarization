"""Sıra Kimde? Model Arena (Aşama 5)

İki modeli aynı ses üzerinde yan yana yarıştırır.
Çalıştır:  .venv/bin/python app.py
Aç:        https://student.exposureai.org/lab/proxy/7860/
"""
import html
import json
import subprocess
import sys
import threading
from pathlib import Path

import gradio as gr
import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent / "scripts"))
from modeller import (KAYDIRMA, PENCERE, diarize, ecapa_yukle, konusma_bolgeleri, mel_donusumu,  # noqa: E402
                      pencereler, tahminci_a, tahminci_b, yukle_a, yukle_b)
from ortak import SR  # noqa: E402

torch.set_num_threads(48)

MODEL_ADLARI = {"A": "Model A: Sıfırdan CNN", "B": "Model B: ECAPA (pretrained)"}
SECILMEDI = "Seçilmedi"
ESIK = 0.6  # bunun altındaki güvenle bulunan parçalar kesikli çizilir ("emin değil")

# Okey renkleri: her kişinin kendi rengi, yazı rengi ve şekli. Renkler sadece kişileri gösterir.
KISI_STILI = {
    "cem": ("#E3242B", "#FFFFFF", "kare"),
    "elif": ("#FFC21A", "#111111", "ucgen"),
    "onur": ("#1F4FD8", "#FFFFFF", "daire"),
    "zehra": ("#141414", "#FFFFFF", "karo"),
}
YEDEK_STILLER = [("#0E9F6E", "#FFFFFF", "kare"), ("#F26B1D", "#111111", "ucgen")]

# Notebook'ta 20 sahte sohbette ölçülen DER (Aşama 4)
try:
    _sonuc = json.loads((Path(__file__).resolve().parent / "modeller/sonuclar.json").read_text())
    DER = {"A": _sonuc["Model A"]["der"], "B": _sonuc["Model B"]["der"]}
except (OSError, KeyError, ValueError):
    DER = {}

# ---------- Modeller arka planda yüklenir, arayüz hemen açılır ----------
M = {}
hazir = threading.Event()
yukleme_hatasi = []


def modelleri_yukle():
    try:
        from silero_vad import load_silero_vad
        model_a, isimler = yukle_a("modeller/model_a.pt")
        kafa, isimler_b = yukle_b("modeller/model_b_kafa.pt")
        assert isimler == isimler_b, "İki modelin kişi listesi farklı"
        yedek = iter(YEDEK_STILLER)
        M.update(isimler=isimler, vad=load_silero_vad(),
                 A=tahminci_a(model_a, mel_donusumu()), B=tahminci_b(ecapa_yukle(), kafa),
                 stil={k: KISI_STILI.get(k) or next(yedek) for k in isimler})
    except Exception as e:  # arayüzde gösterilir
        yukleme_hatasi.append(f"{type(e).__name__}: {e}")
    hazir.set()


threading.Thread(target=modelleri_yukle, daemon=True).start()


# ---------- Ses işleme ----------

def ses_oku(yol):
    """Her formattaki sesi eğitimdeki gibi 16 kHz mono float32'ye çevirir (seviye eşitleme pencere başına)."""
    ham = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(yol), "-vn", "-ac", "1", "-ar", str(SR),
                          "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(ham, dtype=np.float32).copy()


class Kaydeden:
    """Tahmin fonksiyonunu sarar, son pencere olasılıklarını saklar (skor ve 'şu an konuşan' için)."""

    def __init__(self, fn):
        self.fn, self.son = fn, None

    def __call__(self, w):
        self.son = self.fn(w).numpy()
        return torch.from_numpy(self.son)


def konusma_orani(bolgeler, bas, bit):
    ortak = sum(max(0.0, min(bit, e) - max(bas, b)) for b, e in bolgeler)
    return ortak / (bit - bas)


# ---------- HTML parçaları ----------

def sekil(ad, boy=18):
    """Kişinin şekli: renk görmeyen biri de kişileri ayırt edebilsin diye."""
    s, h = boy, 1.5
    govde = {
        "kare": f'<rect x="{h}" y="{h}" width="{s - 3}" height="{s - 3}"/>',
        "ucgen": f'<polygon points="{s / 2},{h} {s - h},{s - h} {h},{s - h}"/>',
        "daire": f'<circle cx="{s / 2}" cy="{s / 2}" r="{s / 2 - h}"/>',
        "karo": f'<polygon points="{s / 2},{h} {s - h},{s / 2} {s / 2},{s - h} {h},{s / 2}"/>',
    }[ad]
    return (f'<svg class="sekil" width="{s}" height="{s}" viewBox="0 0 {s} {s}" aria-hidden="true" fill="none" '
            f'stroke="currentColor" stroke-width="3">{govde}</svg>')


def ad(kisi):
    return html.escape(kisi.capitalize())


def renk_stili(kisi):
    c, on, _ = M["stil"][kisi]
    return f"--c:{c};--on:{on};"


def der_yazisi(anahtar):
    return f"DER %{100 * DER[anahtar]:.1f}".replace(".", ",") if anahtar in DER else ""


def sure_yazisi(t):
    return f"{int(t) // 60}:{int(t) % 60:02d}"


def zaman_cizelgesi(anahtar, parcalar, sure):
    taslar = []
    for b, e, kisi, guven in parcalar:
        sol, gen = 100 * b / sure, max(0.4, 100 * (e - b) / sure)
        emin_degil = " emin-degil" if guven < ESIK else ""
        icerik = (f'<b>{ad(kisi)}</b><span class="alt-satir"><span>%{100 * guven:.0f}</span>'
                  f'{sekil(M["stil"][kisi][2], 14)}</span>') if gen > 7 else ""
        taslar.append(f'<div class="tas{emin_degil}" style="left:{sol:.2f}%;width:calc({gen:.2f}% - 3px);'
                      f'{renk_stili(kisi)}" title="{ad(kisi)} %{100 * guven:.0f}, '
                      f'{b:.1f} - {e:.1f} sn">{icerik}</div>')
    isaretler = "".join(f'<span style="left:{100 * t / sure:.2f}%">{sure_yazisi(t)}</span>'
                        for t in np.linspace(0, sure, 5)[:-1])
    return (f'<section class="istaka-kart"><h3><span>{MODEL_ADLARI[anahtar]}</span>'
            f'<span class="der">{der_yazisi(anahtar)}</span></h3>'
            f'<div class="istaka"><div class="taslar">{"".join(taslar)}</div>'
            f'<div class="eksen">{isaretler}</div></div></section>')


def lejant():
    oyuncular = "".join(f'<span class="oyuncu" style="{renk_stili(k)}">{ad(k)}{sekil(M["stil"][k][2])}</span>'
                        for k in M["isimler"])
    return (f'<section class="pano"><div class="lejant">{oyuncular}<span class="oyuncu emin-degil">%60 altı</span></div>'
            '<p class="not">Kesikli taş: model %60\'tan az emin. DER, 20 deneme sohbetinde yanıldığı sürenin oranı, düşük olan daha iyi.</p></section>')


def su_an_kart(olas):
    """Son konuşma bölgesi için iki modelin olasılıkları."""
    if olas is None:
        return ('<section class="pano"><h2>Şu an konuşan</h2>'
                '<div class="buyuk-tas bos"><div class="kim">Henüz kimse</div>'
                '<p>Kayıt bitince iki modelin tahmini burada çıkar.</p></div></section>')
    bolumler = []
    for anahtar in ("A", "B"):
        p = olas[anahtar]
        j = int(p.argmax())
        kisi = M["isimler"][j]
        satirlar = "".join(
            f'<div class="puan" style="{renk_stili(k)}"><span class="etiket">{sekil(M["stil"][k][2], 14)}{ad(k)}</span>'
            f'<span class="cubuk"><i style="width:{100 * v:.0f}%"></i></span><span class="yuzde">%{100 * v:.0f}</span></div>'
            for k, v in sorted(zip(M["isimler"], p), key=lambda t: -t[1]))
        emin_degil = " emin-degil" if p[j] < ESIK else ""
        bolumler.append(
            f'<div class="model-tahmin"><div class="model-adi">{MODEL_ADLARI[anahtar]}</div>'
            f'<div class="buyuk-tas{emin_degil}" style="{renk_stili(kisi)}">{sekil(M["stil"][kisi][2], 30)}'
            f'<div class="kim">{ad(kisi)}</div><p>%{100 * p[j]:.0f} emin</p></div>'
            f'<div class="puanlar">{satirlar}</div></div>')
    return '<section class="pano"><h2>Şu an konuşan</h2>' + "".join(bolumler) + "</section>"


def skor_kart(skor, secili):
    baslik = f"Canlı skor: {ad(secili)}" if secili != SECILMEDI else "Canlı skor"
    satirlar = []
    for anahtar in ("A", "B"):
        d, t = skor[anahtar]
        oran = d / t if t else 0
        satirlar.append(f'<div class="puan notr"><span class="etiket">Model {anahtar}</span><span class="cubuk">'
                        f'<i style="width:{100 * oran:.0f}%"></i></span><span class="yuzde">{d}/{t}</span></div>')
    aciklama = ("Kaç 2 saniyelik parçada doğru kişiyi buldu." if secili != SECILMEDI
                else "Saymak için soldan şu an kimin konuştuğunu seç.")
    return f'<section class="pano"><h2>{baslik}</h2><div class="puanlar">{"".join(satirlar)}</div><p class="not">{aciklama}</p></section>'


def mesaj(tur, yazi):
    return f'<div class="mesaj {tur}" role="status">{html.escape(yazi)}</div>'


# ---------- Ana işlem ----------

def isle(ses_yolu, secili, skor):
    skor = {k: list(v) for k, v in (skor or {"A": [0, 0], "B": [0, 0]}).items()}
    bos = (mesaj("bilgi", "Mikrofona konuş ya da bir ses dosyası yükle."), "", su_an_kart(None), skor_kart(skor, secili), skor)
    if not ses_yolu:
        return bos
    if not hazir.is_set():
        hazir.wait()
    if yukleme_hatasi:
        return (mesaj("hata", "Modeller yüklenemedi: " + yukleme_hatasi[0]),) + bos[1:]
    try:
        x = ses_oku(ses_yolu)
    except Exception:
        return (mesaj("hata", "Ses dosyası okunamadı. Başka bir dosya ya da kayıt dene."),) + bos[1:]
    sure = len(x) / SR
    if sure < 0.5:
        return (mesaj("hata", "Kayıt çok kısa. Biraz daha uzun konuş."),) + bos[1:]

    bolgeler = konusma_bolgeleri(x, M["vad"])
    if not bolgeler:
        return (mesaj("hata", "Konuşma bulunamadı, biraz daha yüksek sesle tekrar dene."),) + bos[1:]

    sonuc, olas_son = {}, {}
    son_b, son_e = bolgeler[-1]
    for anahtar in ("A", "B"):
        fn = Kaydeden(M[anahtar])
        sonuc[anahtar] = diarize(x, fn, M["vad"], M["isimler"])
        W = fn.son                                         # [pencere, kişi], pencere i: i*0,5 sn'de başlar
        baslar = np.arange(len(W)) * KAYDIRMA / SR
        ortusen = (baslar < son_e) & (baslar + PENCERE / SR > son_b)
        olas_son[anahtar] = W[ortusen].mean(0) if ortusen.any() else W[-1]

        if secili != SECILMEDI:                            # canlı skor: üst üste binmeyen 2 sn'lik parçalar
            hedef = M["isimler"].index(secili)
            for i in range(0, len(W), PENCERE // KAYDIRMA):
                if konusma_orani(bolgeler, baslar[i], baslar[i] + PENCERE / SR) >= 0.5:
                    skor[anahtar][1] += 1
                    skor[anahtar][0] += int(W[i].argmax() == hedef)

    konusma_sn = sum(e - b for b, e in bolgeler)
    cizelgeler = (lejant() +
                  zaman_cizelgesi("A", sonuc["A"], sure) +
                  zaman_cizelgesi("B", sonuc["B"], sure))
    bilgi = mesaj("ok", f"Kayıt {sure:.1f} sn, konuşma {konusma_sn:.1f} sn, {len(bolgeler)} konuşma bölgesi")
    return bilgi, cizelgeler, su_an_kart(olas_son), skor_kart(skor, secili), skor


def skoru_sifirla(secili):
    skor = {"A": [0, 0], "B": [0, 0]}
    return skor_kart(skor, secili), skor


# ---------- Arayüz ----------

# Neo-brutalist okey masası: çuha yeşili zemin, fildişi panolar, kalın siyah çizgi, sert gölge, köşesiz.
CUHA, FILDISI, KAGIT, MUREKKEP, AHSAP, AHSAP_KOYU = "#0E7A47", "#FBF6E9", "#F1EAD6", "#111111", "#8A4B1F", "#5E3112"


def _tek_tema(**degerler):
    """Aynı değeri açık ve koyu temaya birlikte verir: arena tek görünümle çalışır."""
    hepsi = {}
    for k, v in degerler.items():
        hepsi[k] = v
        if hasattr(gr.themes.Base(), k + "_dark"):
            hepsi[k + "_dark"] = v
    return hepsi


TEMA = gr.themes.Base(
    radius_size=gr.themes.sizes.radius_none,
    font=[gr.themes.GoogleFont("Archivo"), "system-ui", "sans-serif"],
).set(**_tek_tema(
    body_background_fill=CUHA,
    body_text_color=MUREKKEP,
    body_text_color_subdued="#3B3830",
    background_fill_primary=FILDISI,
    background_fill_secondary=KAGIT,
    border_color_primary=MUREKKEP,
    color_accent=MUREKKEP,
    color_accent_soft=KAGIT,
    block_background_fill=FILDISI,
    block_border_color=MUREKKEP,
    block_border_width="3px",
    block_shadow=f"6px 6px 0 {MUREKKEP}",
    block_label_background_fill=MUREKKEP,
    block_label_text_color=FILDISI,
    block_label_border_width="0px",
    block_title_text_color=MUREKKEP,
    block_title_text_weight="800",
    input_background_fill=FILDISI,
    input_border_color=MUREKKEP,
    input_border_width="3px",
    input_shadow="none",
    input_shadow_focus=f"0 0 0 3px #FFC21A",
    button_primary_background_fill=MUREKKEP,
    button_primary_background_fill_hover="#2A2A2A",
    button_primary_text_color=FILDISI,
    button_primary_border_color=MUREKKEP,
    button_secondary_background_fill=FILDISI,
    button_secondary_background_fill_hover="#FFFFFF",
    button_secondary_text_color=MUREKKEP,
    button_secondary_border_color=MUREKKEP,
    button_border_width="3px",
    button_primary_shadow=f"4px 4px 0 {MUREKKEP}",
    button_secondary_shadow=f"4px 4px 0 {MUREKKEP}",
    button_primary_shadow_active=f"1px 1px 0 {MUREKKEP}",
    button_secondary_shadow_active=f"1px 1px 0 {MUREKKEP}",
))

CSS = f"""
.gradio-container {{ max-width: 1240px !important; }}
footer {{ display: none !important; }}
::selection {{ background: #FFC21A; color: {MUREKKEP}; }}
button {{ font-weight: 800 !important; text-transform: uppercase; letter-spacing: .02em; }}
button:active {{ transform: translate(3px, 3px); }}

.baslik {{ display: flex; align-items: center; gap: 14px; color: {FILDISI}; padding: 4px 0 6px; }}
.baslik h1 {{ font-size: clamp(1.7rem, 4.5vw, 2.6rem); line-height: 1; font-weight: 900; font-stretch: 72%;
             text-transform: uppercase; margin: 0; color: {FILDISI}; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }}
.baslik h1 small {{ font-size: .5em; font-stretch: 100%; font-weight: 800; white-space: nowrap;
                   background: {FILDISI}; color: {MUREKKEP}; border: 3px solid {MUREKKEP}; padding: 2px 8px; }}
.baslik p {{ margin: 6px 0 0; font-size: 15px; color: {FILDISI}; }}

.mesaj {{ border: 3px solid {MUREKKEP}; padding: 10px 14px; font-weight: 700; font-size: 15px; background: {FILDISI}; }}
.mesaj.ok {{ background: {FILDISI}; }}
.mesaj.bilgi {{ background: {KAGIT}; border-style: dashed; }}
.mesaj.hata {{ background: {MUREKKEP}; color: {FILDISI}; }}
#mik-hata {{ display: none; }}

.buyuk-tas *, .tas *, .oyuncu *, .mesaj.hata *, .baslik * {{ color: inherit !important; }}
.baslik h1 small {{ color: {MUREKKEP} !important; }}
.pano, .istaka-kart {{ background: {FILDISI}; border: 3px solid {MUREKKEP}; box-shadow: 6px 6px 0 {MUREKKEP};
                       padding: 16px; margin-bottom: 18px; }}
.pano h2, .istaka-kart h3 {{ font-size: 1.2rem; line-height: 1.1; font-weight: 900; font-stretch: 80%; text-transform: uppercase;
                             margin: 0 0 12px; display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }}
.not {{ font-size: 14px; color: #3B3830; margin: 10px 0 0; }}

.model-tahmin + .model-tahmin {{ margin-top: 18px; padding-top: 16px; border-top: 3px solid {MUREKKEP}; }}
.model-adi {{ font-weight: 800; font-size: 14px; margin-bottom: 8px; }}
.buyuk-tas {{ position: relative; background: var(--c, {KAGIT}); color: var(--on, {MUREKKEP}); border: 4px solid {MUREKKEP};
              box-shadow: 5px 5px 0 {MUREKKEP}; padding: 12px 14px; }}
.buyuk-tas .sekil {{ position: absolute; top: 12px; right: 12px; }}
.buyuk-tas .kim {{ font-size: clamp(2.4rem, 6vw, 3.6rem); line-height: .9; font-weight: 900; font-stretch: 62%;
                   text-transform: uppercase; padding-right: 40px; }}
.buyuk-tas p {{ margin: 8px 0 0; font-weight: 700; font-size: 15px; }}
.buyuk-tas.bos {{ background: {KAGIT}; border-style: dashed; box-shadow: none; }}
.buyuk-tas.bos .kim {{ font-size: 2rem; color: #3B3830; }}
.buyuk-tas.emin-degil, .tas.emin-degil {{ background: {KAGIT}; color: {MUREKKEP}; border-style: dashed; }}

.puanlar {{ display: grid; gap: 7px; margin-top: 14px; }}
.puan {{ display: grid; grid-template-columns: 84px 1fr 52px; gap: 10px; align-items: center; font-weight: 700; font-size: 14px; }}
.puan .etiket {{ display: flex; align-items: center; gap: 7px; }}
.puan .cubuk {{ height: 16px; border: 2px solid {MUREKKEP}; background: {FILDISI}; position: relative; }}
.puan .cubuk i {{ position: absolute; inset: 0 auto 0 0; background: var(--c); }}
.puan.notr .cubuk i {{ background: {MUREKKEP}; }}
.puan .yuzde {{ text-align: right; font-variant-numeric: tabular-nums; }}

.lejant {{ display: flex; flex-wrap: wrap; gap: 8px; }}
.oyuncu {{ display: inline-flex; align-items: center; gap: 8px; background: var(--c); color: var(--on); border: 3px solid {MUREKKEP};
           padding: 4px 10px; font-weight: 900; font-stretch: 72%; text-transform: uppercase; font-size: 1.05rem; }}
.oyuncu.emin-degil {{ background: {KAGIT}; color: {MUREKKEP}; border-style: dashed; font-size: .9rem; }}

.istaka-kart {{ padding: 16px 0 0; }}
.istaka-kart h3 {{ padding: 0 16px; }}
.istaka-kart .der {{ font-size: 1rem; background: #FFC21A; border: 3px solid {MUREKKEP}; padding: 2px 8px; font-stretch: 90%;
                     font-variant-numeric: tabular-nums; }}
.istaka {{ background: {AHSAP}; border-top: 3px solid {MUREKKEP}; }}
.taslar {{ position: relative; height: 92px; margin: 0 10px; }}
.tas {{ position: absolute; top: 12px; bottom: 10px; background: var(--c); color: var(--on); border: 3px solid {MUREKKEP};
        box-shadow: 3px 3px 0 {MUREKKEP}; padding: 5px 7px; overflow: hidden; display: flex; flex-direction: column;
        justify-content: space-between; box-sizing: border-box; }}
.tas b {{ font-size: 1.1rem; line-height: 1; font-weight: 900; font-stretch: 62%; text-transform: uppercase; white-space: nowrap; }}
.tas .alt-satir {{ display: flex; justify-content: space-between; align-items: flex-end; font-weight: 800;
                   font-variant-numeric: tabular-nums; font-size: .95rem; }}
.eksen {{ position: relative; height: 26px; background: {AHSAP_KOYU}; border-top: 3px solid {MUREKKEP}; margin: 0; }}
.eksen span {{ position: absolute; top: 0; height: 100%; padding: 4px 0 0 5px; border-left: 2px solid {FILDISI}; color: {FILDISI};
               font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; margin-left: 10px; }}
"""

# Mikrofonda gürültü azaltma, yankı engelleme ve otomatik seviye kapalı (eğitim kayıtlarında yoktu).
# İzin reddedilirse arayüzde hata mesajı gösterilir. Sayfa dili Türkçe: büyük harfte "Elif" ELİF olur.
FAVICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='3' y='1' "
           "width='26' height='30' fill='%23111'/%3E%3Crect x='1' y='0' width='25' height='29' fill='%23E3242B' "
           "stroke='%23111' stroke-width='2'/%3E%3Crect x='8' y='7' width='11' height='11' fill='%23FBF6E9' "
           "stroke='%23111' stroke-width='2'/%3E%3Crect x='6' y='22' width='15' height='3' fill='%23111'/%3E%3C/svg%3E")
HEAD = f"""
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&display=swap">
<link rel="icon" type="image/svg+xml" href="{FAVICON}">
<style>
/* Gradio'nun css parametresi @container kurallarını atıyor, bu yüzden burada: dar taşta önce isim, sonra yüzde gizlenir */
.tas {{ container-type: inline-size; }}
@container (max-width: 50px) {{ .tas b, .tas .sekil {{ display: none !important; }} .tas {{ justify-content: flex-end; }} }}
@container (max-width: 27px) {{ .tas > * {{ display: none !important; }} }}
</style>
<script>
document.documentElement.lang = "tr";
(() => {{
  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) return;
  const orijinal = md.getUserMedia.bind(md);
  const kutu = (goster) => {{ const d = document.getElementById("mik-hata"); if (d) d.style.display = goster ? "block" : "none"; }};
  md.getUserMedia = async (c) => {{
    if (c && c.audio) {{
      const a = typeof c.audio === "object" ? c.audio : {{}};
      c = {{ ...c, audio: {{ ...a, echoCancellation: false, noiseSuppression: false, autoGainControl: false }} }};
    }}
    try {{ const s = await orijinal(c); kutu(false); return s; }}
    catch (e) {{ kutu(true); throw e; }}
  }};
}})();
</script>
"""

LOGO = """<svg width="40" height="46" viewBox="0 0 40 46" aria-hidden="true">
<rect x="6" y="5" width="32" height="40" fill="#111"/><rect x="2" y="1" width="32" height="40" fill="#E3242B" stroke="#111" stroke-width="3"/>
<rect x="10" y="9" width="16" height="16" fill="#FBF6E9" stroke="#111" stroke-width="3"/><rect x="8" y="31" width="20" height="4" fill="#111"/></svg>"""

with gr.Blocks(title="Sıra Kimde? Model Arena") as demo:
    skor_durumu = gr.State({"A": [0, 0], "B": [0, 0]})
    gr.HTML(f'<header class="baslik">{LOGO}<div><h1>Sıra Kimde? <small>Model Arena</small></h1>'
            '<p>Konuş ya da bir kayıt yükle, iki model kimin konuştuğunu tahmin etsin.</p></div></header>')
    durum = gr.HTML(mesaj("bilgi", "Modeller yükleniyor..."))
    gr.HTML('<div id="mik-hata" class="mesaj hata" role="alert">Mikrofona erişilemedi. Lütfen tarayıcıda mikrofon izni ver ve sayfayı yenile.</div>')

    with gr.Row():
        with gr.Column(scale=3):
            ses = gr.Audio(sources=["microphone", "upload"], type="filepath", label="Kayıt", editable=False)
            with gr.Row():
                secili = gr.Dropdown([SECILMEDI], value=SECILMEDI, label="Şu an kim konuşuyor? (canlı skor için)", scale=3)
                calistir = gr.Button("Tekrar analiz et", variant="secondary", scale=1)
            bilgi = gr.HTML()
            cizelgeler = gr.HTML()
        with gr.Column(scale=2):
            su_an = gr.HTML(su_an_kart(None))
            skor_html = gr.HTML()
            sifirla = gr.Button("Skoru sıfırla", size="sm")

    zamanlayici = gr.Timer(0.5)

    def hazir_mi():
        if not hazir.is_set():
            return gr.update(), gr.update(), gr.update(), gr.Timer(active=True)
        if yukleme_hatasi:
            return mesaj("hata", "Modeller yüklenemedi: " + yukleme_hatasi[0]), gr.update(), gr.update(), gr.Timer(active=False)
        return (mesaj("ok", "Modeller hazır. Mikrofona konuş ya da bir ses dosyası yükle."),
                gr.Dropdown(choices=[SECILMEDI] + [(k.capitalize(), k) for k in M["isimler"]], value=SECILMEDI),
                skor_kart({"A": [0, 0], "B": [0, 0]}, SECILMEDI), gr.Timer(active=False))

    zamanlayici.tick(hazir_mi, outputs=[durum, secili, skor_html, zamanlayici])
    ciktilar = [bilgi, cizelgeler, su_an, skor_html, skor_durumu]
    ses.change(isle, [ses, secili, skor_durumu], ciktilar)  # kayıt bitince / dosya yüklenince otomatik
    calistir.click(isle, [ses, secili, skor_durumu], ciktilar)
    sifirla.click(skoru_sifirla, [secili], [skor_html, skor_durumu])
    secili.change(lambda s, sk: skor_kart(sk, s), [secili, skor_durumu], [skor_html])

if __name__ == "__main__":
    print("Model Arena: https://student.exposureai.org/lab/proxy/7860/")
    demo.launch(server_name="127.0.0.1", server_port=7860, root_path="/lab/proxy/7860",
                theme=TEMA, css=CSS, head=HEAD)
