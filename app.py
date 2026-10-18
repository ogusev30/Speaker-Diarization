"""Kim Konuşuyor? — Model Arena (Aşama 5)

İki modeli aynı ses üzerinde yan yana yarıştırır.
Çalıştır:  .venv/bin/python app.py
Aç:        https://student.exposureai.org/lab/proxy/7860/
"""
import html
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

MODEL_ADLARI = {"A": "Model A — Sıfırdan CNN", "B": "Model B — ECAPA (pretrained)"}
RENKLER = ["#7c3aed", "#0d9488", "#f59e0b", "#ef4444", "#3b82f6", "#84cc16"]
SECILMEDI = "— seçilmedi —"

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
        M.update(isimler=isimler, vad=load_silero_vad(),
                 A=tahminci_a(model_a, mel_donusumu()), B=tahminci_b(ecapa_yukle(), kafa),
                 renk=dict(zip(isimler, RENKLER)))
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

def zaman_cizelgesi(baslik, parcalar, sure, alt_yazi=""):
    bloklar = []
    for b, e, kisi, guven in parcalar:
        sol, gen = 100 * b / sure, max(0.3, 100 * (e - b) / sure)
        etiket = f"<b>{html.escape(kisi)}</b><span>%{100 * guven:.0f}</span>" if gen > 6 else ""
        bloklar.append(f'<div class="blok" style="left:{sol:.2f}%;width:{gen:.2f}%;background:{M["renk"][kisi]}" '
                       f'title="{html.escape(kisi)} %{100 * guven:.0f} · {b:.1f}–{e:.1f} sn">{etiket}</div>')
    isaretler = "".join(f'<span style="left:{100 * t / sure:.2f}%">{int(t) // 60}:{int(t) % 60:02d}</span>'
                        for t in np.linspace(0, sure, 5))
    return (f'<div class="cizelge"><div class="cizelge-ust"><span class="model-adi">{baslik}</span>'
            f'<span class="alt">{alt_yazi}</span></div><div class="serit">{"".join(bloklar)}</div>'
            f'<div class="eksen">{isaretler}</div></div>')


def lejant():
    return '<div class="lejant">' + "".join(
        f'<span><i style="background:{M["renk"][k]}"></i>{html.escape(k)}</span>' for k in M["isimler"]) + "</div>"


def su_an_kart(olas):
    """Son konuşma bölgesi için iki modelin olasılıkları."""
    if olas is None:
        return '<div class="kart"><div class="kart-baslik">ŞU AN KONUŞAN</div><p class="soluk">Henüz kayıt yok</p></div>'
    bolumler = []
    for anahtar in ("A", "B"):
        p = olas[anahtar]
        j = int(p.argmax())
        cubuklar = "".join(
            f'<div class="cubuk-satir"><span>{html.escape(k)}</span><div class="cubuk"><div style="width:{100 * v:.0f}%;'
            f'background:{M["renk"][k]}"></div></div><span>%{100 * v:.0f}</span></div>'
            for k, v in sorted(zip(M["isimler"], p), key=lambda t: -t[1]))
        bolumler.append(f'<div class="su-an-model"><div class="soluk">{MODEL_ADLARI[anahtar]}</div>'
                        f'<div class="su-an-isim" style="color:{M["renk"][M["isimler"][j]]}">{html.escape(M["isimler"][j])}</div>'
                        f'<div class="soluk">%{100 * p[j]:.0f} emin</div>{cubuklar}</div>')
    return '<div class="kart"><div class="kart-baslik">ŞU AN KONUŞAN</div>' + "".join(bolumler) + "</div>"


def skor_kart(skor, secili):
    baslik = f"CANLI SKOR · KONUŞAN: {html.escape(secili).upper()}" if secili != SECILMEDI else "CANLI SKOR"
    satirlar = []
    for anahtar, renk in (("A", "#a78bfa"), ("B", "#7c3aed")):
        d, t = skor[anahtar]
        oran = d / t if t else 0
        satirlar.append(f'<div class="cubuk-satir"><span>Model {anahtar}</span><div class="cubuk"><div style="width:{100 * oran:.0f}%;'
                        f'background:{renk}"></div></div><span>{d}/{t}</span></div>')
    aciklama = ("Kaç 2 saniyelik parçada doğru kişiyi buldu" if secili != SECILMEDI
                else "Saymak için yukarıdan şu an kimin konuştuğunu seç")
    return f'<div class="kart"><div class="kart-baslik">{baslik}</div>{"".join(satirlar)}<p class="soluk">{aciklama}</p></div>'


def mesaj(tur, yazi):
    return f'<div class="mesaj {tur}">{html.escape(yazi)}</div>'


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
                  zaman_cizelgesi(MODEL_ADLARI["A"], sonuc["A"], sure) +
                  zaman_cizelgesi(MODEL_ADLARI["B"], sonuc["B"], sure))
    bilgi = mesaj("ok", f"Kayıt {sure:.1f} sn · konuşma {konusma_sn:.1f} sn · {len(bolgeler)} konuşma bölgesi")
    return bilgi, cizelgeler, su_an_kart(olas_son), skor_kart(skor, secili), skor


def skoru_sifirla(secili):
    skor = {"A": [0, 0], "B": [0, 0]}
    return skor_kart(skor, secili), skor


# ---------- Arayüz ----------

CSS = """
.gradio-container { max-width: 1200px !important; }
#baslik h1 { margin-bottom: 0; }
.kart { border: 1px solid var(--border-color-primary); border-radius: 12px; padding: 14px 16px; margin-bottom: 12px;
        background: var(--block-background-fill); }
.kart-baslik { font-size: 11px; letter-spacing: .08em; color: var(--body-text-color-subdued); font-weight: 600; margin-bottom: 8px; }
.soluk { color: var(--body-text-color-subdued); font-size: 13px; margin: 4px 0; }
.su-an-model { margin-bottom: 14px; }
.su-an-isim { font-size: 30px; font-weight: 800; line-height: 1.1; }
.cubuk-satir { display: grid; grid-template-columns: 70px 1fr 44px; gap: 8px; align-items: center; font-size: 13px; margin: 4px 0; }
.cubuk-satir span:last-child { text-align: right; font-variant-numeric: tabular-nums; }
.cubuk { height: 6px; background: var(--border-color-primary); border-radius: 3px; overflow: hidden; }
.cubuk div { height: 100%; border-radius: 3px; }
.cizelge { margin: 10px 0 18px; }
.cizelge-ust { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 6px; }
.model-adi { font-weight: 700; }
.serit { position: relative; height: 46px; background: var(--background-fill-secondary); border-radius: 8px; }
.blok { position: absolute; top: 0; bottom: 0; border-radius: 6px; color: #fff; padding: 4px 6px; overflow: hidden;
        font-size: 12px; line-height: 1.25; display: flex; flex-direction: column; box-sizing: border-box; border: 1px solid rgba(255,255,255,.6); }
.blok span { opacity: .9; font-size: 11px; }
.eksen { position: relative; height: 18px; font-size: 11px; color: var(--body-text-color-subdued); }
.eksen span { position: absolute; transform: translateX(-50%); top: 2px; }
.eksen span:first-child { transform: none; } .eksen span:last-child { transform: translateX(-100%); }
.lejant { display: flex; gap: 16px; flex-wrap: wrap; font-size: 13px; margin-bottom: 4px; }
.lejant i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; }
.mesaj { padding: 10px 14px; border-radius: 8px; font-size: 14px; }
.mesaj.ok { background: #dcfce7; color: #166534; }
.mesaj.hata { background: #fee2e2; color: #991b1b; }
.mesaj.bilgi { background: #fef3c7; color: #92400e; }
#mik-hata { display: none; }
"""

# Mikrofonda gürültü azaltma, yankı engelleme ve otomatik seviye kapalı (eğitim kayıtlarında yoktu).
# İzin reddedilirse arayüzde hata mesajı gösterilir.
HEAD = """
<script>
(() => {
  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) return;
  const orijinal = md.getUserMedia.bind(md);
  const kutu = (goster) => { const d = document.getElementById("mik-hata"); if (d) d.style.display = goster ? "block" : "none"; };
  md.getUserMedia = async (c) => {
    if (c && c.audio) {
      const a = typeof c.audio === "object" ? c.audio : {};
      c = { ...c, audio: { ...a, echoCancellation: false, noiseSuppression: false, autoGainControl: false } };
    }
    try { const s = await orijinal(c); kutu(false); return s; }
    catch (e) { kutu(true); throw e; }
  };
})();
</script>
"""

with gr.Blocks(title="Kim Konuşuyor? — Model Arena") as demo:
    skor_durumu = gr.State({"A": [0, 0], "B": [0, 0]})
    gr.Markdown("# Kim Konuşuyor? — Model Arena\nKonuş ya da bir kayıt yükle, iki model kimin konuştuğunu tahmin etsin.",
                elem_id="baslik")
    durum = gr.HTML(mesaj("bilgi", "Modeller yükleniyor..."))
    gr.HTML('<div id="mik-hata" class="mesaj hata">Mikrofona erişilemedi. Lütfen tarayıcıda mikrofon izni ver ve sayfayı yenile.</div>')

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
                gr.Dropdown(choices=[SECILMEDI] + M["isimler"], value=SECILMEDI),
                skor_kart({"A": [0, 0], "B": [0, 0]}, SECILMEDI), gr.Timer(active=False))

    zamanlayici.tick(hazir_mi, outputs=[durum, secili, skor_html, zamanlayici])
    ciktilar = [bilgi, cizelgeler, su_an, skor_html, skor_durumu]
    ses.change(isle, [ses, secili, skor_durumu], ciktilar)  # kayıt bitince / dosya yüklenince otomatik
    calistir.click(isle, [ses, secili, skor_durumu], ciktilar)
    sifirla.click(skoru_sifirla, [secili], [skor_html, skor_durumu])
    secili.change(lambda s, sk: skor_kart(sk, s), [secili, skor_durumu], [skor_html])

if __name__ == "__main__":
    print("Model Arena: https://student.exposureai.org/lab/proxy/7860/")
    demo.launch(server_name="127.0.0.1", server_port=7860, root_path="/lab/proxy/7860", css=CSS, head=HEAD)
