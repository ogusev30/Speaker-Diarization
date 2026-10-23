"use client";
// Örnek sohbet: kayıtlı bir sohbet çalar, model aynı anda dinler. Üst ıstaka gerçekte konuşanı (RTTM),
// alt ıstaka modelin dediğini gösterir; aradaki şerit modelin yanıldığı yerleri. DER ses çaldıkça hesaplanır.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ESIK, dilimler, pencereler } from "../lib/konusmaci";
import { adres, pencereleriCalistir } from "../lib/model";
import { derHesapla, tahminParcalari, wavOku } from "../lib/ornek";
import { Sekil, isimYaz, renk, sekilAdi, sure, yuzde } from "./ortak";

const yuzde1 = (x) => `%${(100 * x).toFixed(1).replace(".", ",")}`;
const sn1 = (x) => `${x.toFixed(1).replace(".", ",")} sn`;
const HATA_ADI = { kacan: "Kaçırdı", fazla: "Fazladan", yanlis: "Yanlış kişi" };

export default function OrnekSohbet({ model, bilgi }) {
  const isimler = bilgi.labels;
  const [liste, setListe] = useState(null);
  const [hata, setHata] = useState("");
  const [secili, setSecili] = useState(0);
  const [durum, setDurum] = useState("bos"); // bos | yukleniyor | caliyor | durdu | bitti
  const [t, setT] = useState(0);
  const [hazir, setHazir] = useState(0); // kesinleşen 0,5 sn'lik dilim sayısı
  const [genislik, setGenislik] = useState(0);

  const ses = useRef(null); // <audio>
  const dilim = useRef([]);
  const calisma = useRef(0); // sohbet değişince eski hesap kendini durdursun
  const kutu = useRef(null);
  const onbellek = useRef({});

  useEffect(() => {
    fetch(adres("/ornek/sohbetler.json"))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`sohbetler.json (${r.status})`))))
      .then(setListe)
      .catch((e) => setHata(String(e.message ?? e)));
    return () => { calisma.current++; ses.current?.pause(); };
  }, []);

  useLayoutEffect(() => {
    const olc = () => kutu.current && setGenislik(kutu.current.clientWidth);
    olc();
    window.addEventListener("resize", olc);
    return () => window.removeEventListener("resize", olc);
  }, [liste]);

  // Çalarken oynatma çizgisi her karede ilerlesin
  useEffect(() => {
    if (durum !== "caliyor") return;
    let id;
    const adim = () => {
      if (ses.current) setT(ses.current.currentTime);
      id = requestAnimationFrame(adim);
    };
    id = requestAnimationFrame(adim);
    return () => cancelAnimationFrame(id);
  }, [durum]);

  const sohbet = liste?.[secili];
  const pikselHesapla = (toplam) => Math.max(genislik < 600 ? 22 : 16, (genislik - 4) / toplam);

  // Oynatma çizgisi görünür kalsın (telefonda ıstaka kayar)
  useEffect(() => {
    const k = kutu.current;
    if (!k || !sohbet || durum !== "caliyor") return;
    const px = pikselHesapla(sohbet.sure);
    if (sohbet.sure * px <= k.clientWidth) return; // masaüstünde sohbetin tamamı sığıyor
    const x = t * px;
    if (x > k.scrollLeft + k.clientWidth * 0.7 || x < k.scrollLeft) k.scrollLeft = x - k.clientWidth * 0.3;
  });

  async function baslat(i = secili) {
    const s = liste[i];
    const no = ++calisma.current;
    ses.current?.pause();
    setSecili(i);
    setDurum("yukleniyor");
    setT(0);
    setHazir(0);
    dilim.current = [];
    try {
      if (!onbellek.current[s.ad]) {
        const r = await fetch(adres(s.dosya));
        if (!r.ok) throw new Error(`${s.dosya} indirilemedi (${r.status})`);
        const buf = await r.arrayBuffer();
        onbellek.current[s.ad] = { x: wavOku(buf), url: URL.createObjectURL(new Blob([buf], { type: "audio/wav" })) };
      }
      if (no !== calisma.current) return;
      const { x, url } = onbellek.current[s.ad];
      ses.current.src = url;
      ses.current.currentTime = 0;
      await ses.current.play();
      setDurum("caliyor");
      // Model sesin tamamını sırayla dinler; her 8 pencerede kesinleşen dilimler gösterilir
      const { veri, n } = pencereler(x);
      await pencereleriCalistir(model, veri, n, (k, olas) => {
        if (no !== calisma.current) throw new Error("iptal");
        dilim.current = dilimler(olas, k, isimler.length, x.length);
        setHazir(k === n ? dilim.current.length : k);
      });
    } catch (e) {
      if (no !== calisma.current) return;
      console.error(e);
      setHata(String(e.message ?? e));
      setDurum("bos");
    }
  }

  function duraklat() {
    ses.current?.pause();
    setDurum("durdu");
  }
  async function devam() {
    await ses.current?.play();
    setDurum("caliyor");
  }

  if (hata) {
    return (
      <section className="ornek">
        <div className="notice error" role="alert">
          <h3>Örnek sohbet açılamadı</h3>
          <p>{hata}</p>
        </div>
      </section>
    );
  }
  if (!liste) return <section className="ornek"><div className="ornek-bas"><h2>Örnek sohbet</h2><span className="istaka-meta">Yükleniyor</span></div></section>;

  // ---------- Görünüm ----------
  const toplam = sohbet.sure;
  const dilimSn = 0.5;
  const hazirSn = hazir >= dilim.current.length && hazir > 0 ? toplam : hazir * dilimSn;
  const goster = Math.min(t, hazirSn); // modelin cevabı bu saniyeye kadar açık
  const tahmin = tahminParcalari(dilim.current, hazir, sohbet.konusma)
    .filter((p) => p.bas < goster)
    .map((p) => ({ ...p, bit: Math.min(p.bit, goster), guven: p.g.reduce((a, b) => a + b, 0) / p.g.length }));
  const gercek = sohbet.gercek.map(([bas, bit, ad]) => ({ bas, bit, kisi: isimler.indexOf(ad) }));
  const sonuc = derHesapla(gercek, tahmin, goster);

  const px = pikselHesapla(toplam);
  const iz = toplam * px;
  const simdiGercek = gercek.find((g) => g.bas <= t && t < g.bit);
  const simdiTahmin = tahmin.find((g) => g.bas <= goster && goster <= g.bit + 0.05);
  const isaretler = [];
  for (let s = 0; s <= toplam; s += 10) isaretler.push(s);

  const tas = (p, i, model) => {
    const ad = isimler[p.kisi];
    const emin = !model || p.guven >= ESIK;
    const baslik = model
      ? `Model: ${isimYaz(ad)} ${yuzde(p.guven)}, ${sure(p.bas)} - ${sure(p.bit)}`
      : `Gerçekte: ${isimYaz(ad)}, ${sure(p.bas)} - ${sure(p.bit)}`;
    return (
      <div key={i} className={`tile ince${emin ? "" : " az-emin"}${!model && p.bas > t ? " sonra" : ""}`}
           style={{ left: p.bas * px, width: Math.max(8, (p.bit - p.bas) * px - 3), ...renk(ad) }} title={baslik} aria-label={baslik}>
        <span className="blok"><Sekil ad={sekilAdi(isimler, p.kisi)} boy={16} /><span className="nm">{isimYaz(ad)}</span></span>
        {model && <span className="pc">{yuzde(p.guven)}</span>}
      </div>
    );
  };

  return (
    <section className="ornek" aria-labelledby="ornek-h">
      <div className="ornek-bas">
        <h2 id="ornek-h">Örnek sohbet</h2>
        <div className="sohbet-sec" role="group" aria-label="Sohbet seç">
          {liste.map((s, i) => (
            <button key={s.ad} className="kucuk" aria-pressed={i === secili} onClick={() => baslat(i)}>
              {i + 1}
            </button>
          ))}
        </div>
        <span className="istaka-meta num">{sure(t)} / {sure(toplam)}</span>
        {durum === "caliyor" ? <button className="kucuk" onClick={duraklat}>Duraklat</button>
          : durum === "durdu" ? <button className="kucuk" onClick={devam}>Devam</button>
          : <button className="kucuk koyu" onClick={() => baslat()} disabled={durum === "yukleniyor"}>{durum === "bitti" ? "Baştan çal" : durum === "yukleniyor" ? "Açılıyor" : "Çal"}</button>}
      </div>
      <audio ref={ses} onEnded={() => setDurum("bitti")} preload="none" />

      <p className="ornek-aciklama">
        Cem, Elif, Onur ve Zehra&apos;nın test kayıtlarından kurulmuş 1 dakikalık bir sohbet. Model bu kayıtları eğitimde hiç görmedi.
        Ses çaldıkça model dinler; üstte gerçekte konuşan, altta modelin dediği dizilir.
      </p>

      <div className="karsi" ref={kutu} tabIndex={0} aria-label="Gerçek ve model, zaman çizelgesi">
        <div className="karsi-ic" style={{ width: Math.max(iz, genislik) }}>
          <div className="kulvar">
            <span className="kulvar-adi">Gerçekte</span>
            {gercek.map((p, i) => tas(p, i, false))}
          </div>
          <div className="hata-serit" aria-label="Modelin yanıldığı yerler">
            {sonuc.hatalar.map((h, i) => (
              <i key={i} className={h.tur} style={{ left: h.bas * px, width: Math.max(2, (h.bit - h.bas) * px) }}
                 title={`${HATA_ADI[h.tur]}: ${sure(h.bas)} - ${sure(h.bit)}`} />
            ))}
          </div>
          <div className="kulvar">
            <span className="kulvar-adi">Model</span>
            {tahmin.map((p, i) => tas(p, i, true))}
          </div>
          <div className="lip ince-lip">
            {isaretler.map((s) => <span key={s} className="tick" style={{ left: s * px }}>{sure(s)}</span>)}
          </div>
          {durum !== "bos" && <div className="oynatma" style={{ left: t * px }} aria-hidden="true" />}
        </div>
      </div>

      <div className="ornek-alt">
        <div className="simdi" aria-live="polite">
          <div className="simdi-kutu" style={simdiGercek ? renk(isimler[simdiGercek.kisi]) : {}} data-bos={!simdiGercek}>
            <small>Gerçekte</small>
            <b>{simdiGercek ? isimYaz(isimler[simdiGercek.kisi]) : "Sessizlik"}</b>
          </div>
          <div className="simdi-kutu" style={simdiTahmin ? renk(isimler[simdiTahmin.kisi]) : {}} data-bos={!simdiTahmin}>
            <small>Model</small>
            <b>{simdiTahmin ? isimYaz(isimler[simdiTahmin.kisi]) : durum === "caliyor" && goster < t - 0.5 ? "Hesaplıyor" : "Sessizlik"}</b>
            {simdiTahmin && <span className="num">{yuzde(simdiTahmin.guven)}</span>}
          </div>
        </div>

        <div className="der-kart">
          <div className="der"><b className="num">{sonuc.der === null ? "…" : yuzde1(sonuc.der)}</b><span>DER</span></div>
          <div>
            <h3>{durum === "bitti" ? "Bu sohbette DER" : "Bu sohbette, şu ana kadar"}</h3>
            <dl className="der-parca num">
              <div><dt><i className="sw yanlis" />Yanlış kişi</dt><dd>{sn1(sonuc.yanlis)}</dd></div>
              <div><dt><i className="sw kacan" />Kaçırdı</dt><dd>{sn1(sonuc.kacan)}</dd></div>
              <div><dt><i className="sw fazla" />Fazladan</dt><dd>{sn1(sonuc.fazla)}</dd></div>
              <div><dt>Gerçek konuşma</dt><dd>{sn1(sonuc.konusma)}</dd></div>
            </dl>
            <p>20 deneme sohbetinin tamamında DER {yuzde1(bilgi.der)}. Model her zaman en olası kişiyi söyler; %60&apos;ın altındaki taşlar kesik çizgiyle çizilir.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
