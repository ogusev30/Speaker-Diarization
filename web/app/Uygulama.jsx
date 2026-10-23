"use client";
// Sadece gerçek zamanlı VAD: paketin ana girişi dosyadan VAD'ı ve tam ONNX Runtime'ı da getirirdi
import { MicVAD } from "@ricky0123/vad-web/dist/real-time-vad";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ESIK, SR } from "../lib/konusmaci";
import { adres, konusmayiTani, modelYukle } from "../lib/model";
import Menu, { MODLAR } from "./Menu";
import OrnekSohbet from "./OrnekSohbet";
import { BilinmeyenSekil, Sayac, Sekil, isimYaz, renk, sekilAdi, sure, yuzde } from "./ortak";
import SesHaritasi from "./SesHaritasi";
import SohbetRaporu from "./SohbetRaporu";
import TaklitOyunu from "./TaklitOyunu";

const SN_PIKSEL = 64; // ıstakada 1 saniye (telefonda daha sık: daha çok taş görünsün)

// Gürültü azaltma, yankı engelleme ve otomatik seviye kapalı: eğitim kayıtlarında bunlar yoktu.
const mikrofonAc = () => navigator.mediaDevices.getUserMedia({
  audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
});

// Emin olma çubuğu: %60 eşiğinin neresinde olduğunu gösterir
function GuvenCubugu({ deger }) {
  return (
    <div className="guven" aria-hidden="true">
      <i style={{ width: `${Math.round(deger * 100)}%` }} />
      <span className="esik" style={{ left: `${ESIK * 100}%` }}>eşik {yuzde(ESIK)}</span>
    </div>
  );
}

export default function Uygulama() {
  const [asama, setAsama] = useState("yukleniyor"); // yukleniyor | hazir | dinliyor | modelhata
  const [uyari, setUyari] = useState(null); // null | "mikhata" | "konusmayok" | "sesyok"
  const [hataMesaji, setHataMesaji] = useState("");
  const [yukleme, setYukleme] = useState({ inen: 0, toplam: 0 });
  const [bilgi, setBilgi] = useState(null);
  const [taslar, setTaslar] = useState([]);
  const [bekleyen, setBekleyen] = useState(null); // konuşma sürerken başladığı saniye
  const [hesapliyor, setHesapliyor] = useState(0);
  const [simdi, setSimdi] = useState(0);
  const [seviye, setSeviye] = useState(0);
  const [hiz, setHiz] = useState(null); // bir pencere kaç ms
  const [yeniKey, setYeniKey] = useState(0);
  const [rafGenislik, setRafGenislik] = useState(0);
  const [mod, setModDurum] = useState("canli"); // canli | ornek | harita | oyun | rapor (Menu.jsx)
  const [sahneModu, setSahneModu] = useState(false); // projektör: tam ekran, dev isim ve ıstaka

  const model = useRef(null);
  const vad = useRef(null);
  const t0 = useRef(null);
  const sonBit = useRef(0);
  const kuyruk = useRef(Promise.resolve());
  const buDinlemede = useRef(0);
  const sonSeviye = useRef(0);
  const tepe = useRef(0); // bu dinlemedeki en yüksek mikrofon seviyesi
  const dinlemeBas = useRef(0);
  const raf = useRef(null);
  const grup = useRef(0); // her konuşmanın taşları aynı grupta: sadece son grup düşer
  const tusla = useRef(null);

  const zaman = () => (performance.now() - t0.current) / 1000;
  const isimler = bilgi?.labels ?? [];
  const sekil = (k) => sekilAdi(isimler, k);

  // ---------- Model: ilk açılışta iner ----------
  useEffect(() => {
    let iptal = false;
    modelYukle((inen, toplam) => !iptal && setYukleme({ inen, toplam }))
      .then((m) => {
        if (iptal) return;
        model.current = m;
        setBilgi(m.bilgi);
        setAsama("hazir");
      })
      .catch((e) => {
        console.error(e);
        if (iptal) return;
        setHataMesaji(String(e?.message ?? e));
        setAsama("modelhata");
      });
    return () => {
      iptal = true;
      vad.current?.destroy();
    };
  }, []);

  // ---------- Bir konuşma bitti: modele ver, taşları ekle ----------
  const isle = useCallback((ses) => {
    const bas = Math.max(sonBit.current, zaman() - ses.length / SR);
    sonBit.current = bas + ses.length / SR;
    buDinlemede.current += 1;
    setBekleyen(null);
    setHesapliyor((n) => n + 1);
    kuyruk.current = kuyruk.current
      .then(async () => {
        const r = await konusmayiTani(model.current, ses, bas);
        const g = ++grup.current;
        setTaslar((t) => [...t, ...r.taslar.map((x) => ({ ...x, grup: g }))]);
        setHiz(r.msPencere);
        setYeniKey((k) => k + 1);
      })
      .catch((e) => console.error(e))
      .finally(() => setHesapliyor((n) => n - 1));
  }, []);

  const seviyeGuncelle = useCallback((kare) => {
    const t = performance.now();
    if (t - sonSeviye.current < 90) return;
    sonSeviye.current = t;
    let s = 0;
    for (let i = 0; i < kare.length; i++) s += kare[i] * kare[i];
    const db = 10 * Math.log10(s / kare.length + 1e-10);
    const sv = Math.max(0, Math.min(1, (db + 60) / 50));
    tepe.current = Math.max(tepe.current, sv);
    setSeviye(sv);
  }, []);

  // ---------- Mikrofon ----------
  async function baslat() {
    setUyari(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Bu tarayıcı mikrofonu desteklemiyor");
      if (!vad.current) {
        vad.current = await MicVAD.new({
          model: "v6",
          baseAssetPath: adres("/vad/"),
          onnxWASMBasePath: adres("/ort/"),
          getStream: mikrofonAc,
          resumeStream: mikrofonAc,
          startOnLoad: false,
          // Durdur'a basınca süren konuşma atılmasın (varsayılan: atılır; konuşma bitti sayılması 1,4 sn sessizlik bekler)
          submitUserSpeechOnPause: true,
          minSpeechMs: 250, // kısa bir bağırış da sayılsın (varsayılan 400)
          onSpeechRealStart: () => setBekleyen(Math.max(sonBit.current, zaman())),
          onVADMisfire: () => setBekleyen(null),
          onSpeechEnd: isle,
          onFrameProcessed: (_p, kare) => seviyeGuncelle(kare),
        });
      }
      if (t0.current === null) t0.current = performance.now();
      buDinlemede.current = 0;
      tepe.current = 0;
      dinlemeBas.current = zaman();
      setSimdi(zaman());
      await vad.current.start();
      if (vad.current.errored) throw new Error(vad.current.errored);
      setAsama("dinliyor");
    } catch (e) {
      console.error(e);
      try { await vad.current?.destroy(); } catch { /* zaten kapalı */ }
      vad.current = null;
      setUyari("mikhata");
      setAsama("hazir");
    }
  }

  async function durdur() {
    await vad.current?.pause();
    setAsama("hazir");
    setBekleyen(null);
    setSeviye(0);
    // Seviye çubukları hiç oynamadıysa sorun mikrofonda, oynadıysa seste konuşma yoktu
    if (buDinlemede.current === 0) setUyari(tepe.current < 0.25 ? "sesyok" : "konusmayok");
  }

  function temizle() {
    setTaslar([]);
    setBekleyen(null);
    setUyari(null);
    sonBit.current = 0;
    t0.current = asama === "dinliyor" ? performance.now() : null;
    dinlemeBas.current = 0;
  }

  // ---------- Mod: adres çubuğundaki #ornek / #harita ----------
  useEffect(() => {
    const oku = () => {
      const h = window.location.hash.slice(1);
      setModDurum(MODLAR.some((m) => m.id === h) ? h : "canli");
    };
    oku();
    window.addEventListener("hashchange", oku);
    return () => window.removeEventListener("hashchange", oku);
  }, []);
  function setMod(m) {
    history.replaceState(null, "", m === "canli" ? window.location.pathname : `#${m}`);
    setModDurum(m);
    window.scrollTo(0, 0);
  }
  // Örnek sohbet çalarken ve oyunda mikrofon kapansın (oyun mikrofonu kendisi açar)
  useEffect(() => {
    if ((mod === "ornek" || mod === "oyun") && vad.current && asama === "dinliyor") durdur();
    if (mod !== "canli") setSahneModu(false);
  }, [mod]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Sahne modu: F tuşu ya da menü. Tam ekrandan Esc ile çıkınca o da kapanır ----------
  function sahneAc(ac = true) {
    if (ac && mod !== "canli") setMod("canli");
    setSahneModu(ac);
    try {
      if (ac && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
      if (!ac && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    } catch { /* tam ekran yoksa (iPhone) sadece görünüm değişir */ }
  }
  useEffect(() => {
    const cik = () => { if (!document.fullscreenElement) setSahneModu(false); };
    document.addEventListener("fullscreenchange", cik);
    return () => document.removeEventListener("fullscreenchange", cik);
  }, []);

  // Boşluk tuşu: başlat / durdur (odak bir düğmedeyse tarayıcı zaten tıklar). F: sahne modu
  tusla.current = (kod) => {
    if (kod === "KeyF") { if (mod === "canli" || sahneModu) sahneAc(!sahneModu); return; }
    if (mod !== "canli" && mod !== "harita") return;
    if (asama === "dinliyor") durdur();
    else if (asama === "hazir") baslat();
  };
  useEffect(() => {
    const bas = (e) => {
      if ((e.code !== "Space" && e.code !== "KeyF") || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest?.("input, textarea, [contenteditable]")) return;
      if (e.code === "Space" && e.target.closest?.("button")) return;
      e.preventDefault();
      tusla.current(e.code);
    };
    window.addEventListener("keydown", bas);
    return () => window.removeEventListener("keydown", bas);
  }, []);

  // Dinlerken saat işlesin, konuşma sürerken "Dinleniyor" taşı büyüsün
  useEffect(() => {
    if (asama !== "dinliyor") return;
    const id = setInterval(() => setSimdi(zaman()), 200);
    return () => clearInterval(id);
  }, [asama]);

  // ---------- Zaman çizelgesi her zaman en sona kaysın ----------
  useLayoutEffect(() => {
    const olc = () => raf.current && setRafGenislik(raf.current.clientWidth);
    olc();
    window.addEventListener("resize", olc);
    return () => window.removeEventListener("resize", olc);
  }, [asama]);
  useEffect(() => {
    if (raf.current) raf.current.scrollLeft = raf.current.scrollWidth;
  }, [taslar.length, bekleyen, bekleyen !== null ? simdi : 0]);

  // ---------- Görünüm ----------
  const son = taslar[taslar.length - 1];
  const durumYazisi = asama === "yukleniyor" ? ["Model yükleniyor", "busy"]
    : asama === "modelhata" ? ["Model yüklenemedi", ""]
    : asama !== "dinliyor" ? [uyari === "mikhata" ? "Mikrofon kapalı" : "Hazır", ""]
    : hesapliyor ? ["Hesaplanıyor", "busy"]
    : bekleyen !== null ? ["Konuşma duyuluyor", "live"]
    : ["Dinliyor", "live"];

  function sahne() {
    if (asama === "yukleniyor") {
      const mb = yukleme.inen / 1e6, top = yukleme.toplam / 1e6 || 22;
      return (
        <div className="notice">
          <h3>Model yükleniyor</h3>
          <p>İlk açılışta model telefonuna ya da bilgisayarına iner. Bir sonraki açılışta beklemezsin.</p>
          <div className="progress" role="progressbar" aria-label="Model indiriliyor" aria-valuemin={0}
               aria-valuemax={Number(top.toFixed(1))} aria-valuenow={Number(mb.toFixed(1))}>
            <i style={{ width: `${Math.min(100, (100 * mb) / top)}%` }} />
          </div>
          <div className="progress-meta num"><span>{mb.toFixed(1).replace(".", ",")} MB</span><span>{Math.round(top)} MB</span></div>
        </div>
      );
    }
    if (asama === "modelhata") {
      return (
        <div className="notice error" role="alert">
          <h3>Model yüklenemedi</h3>
          <p>İnternet bağlantını kontrol edip sayfayı yenile. ({hataMesaji})</p>
          <button className="mic btn-tekrar" onClick={() => window.location.reload()}>Sayfayı yenile</button>
        </div>
      );
    }
    if (uyari === "mikhata") {
      return (
        <div className="notice error" role="alert">
          <h3>Mikrofona erişilemedi</h3>
          <p>Lütfen izin ver. Adres çubuğundaki kilit simgesine dokun, mikrofonu &quot;İzin ver&quot; yap, sonra tekrar dene.</p>
          <button className="mic btn-tekrar" onClick={baslat}>Tekrar dene</button>
        </div>
      );
    }
    if (uyari === "sesyok") {
      return (
        <div className="notice" role="alert">
          <h3>Mikrofondan ses gelmedi</h3>
          <p>Seviye çubukları hiç oynamadı. Tarayıcının doğru mikrofonu kullandığına bak, sonra tekrar dene.</p>
          <button className="mic btn-tekrar" onClick={baslat}>Tekrar dene</button>
        </div>
      );
    }
    if (uyari === "konusmayok") {
      return (
        <div className="notice" role="alert">
          <h3>Konuşma bulunamadı</h3>
          <p>Ses geldi ama konuşmaya benzemedi. Bir kol mesafesinden, normal sesle 2-3 saniyelik bir cümle kur. Bağırınca ses bozulur.</p>
          <button className="mic btn-tekrar" onClick={baslat}>Tekrar dene</button>
        </div>
      );
    }
    if (!son) {
      return (
        <div className="bigtile empty">
          <div className="who">{asama === "dinliyor" ? "Dinliyorum" : "Henüz kimse"}</div>
          <div className="meta">{asama === "dinliyor" ? "Konuş. Sustuğunda adın burada çıkar." : "Başlat'a bas ve konuş. Konuşman bitince adın burada çıkar."}</div>
        </div>
      );
    }
    const kisi = isimler[son.kisi];
    const sira = son.p.map((_, i) => i).sort((a, b) => son.p[b] - son.p[a]);
    return (
      <>
        {son.tanindi ? (
          <div key={yeniKey} className="bigtile flip" style={renk(kisi)}>
            <span className="shape"><Sekil ad={sekil(son.kisi)} boy={40} /></span>
            <div className="who">{isimYaz(kisi)}</div>
            <div className="meta">Model <b className="num"><Sayac deger={son.guven} /></b> emin</div>
            <GuvenCubugu deger={son.guven} />
          </div>
        ) : (
          <div key={yeniKey} className="bigtile unknown flip">
            <span className="shape"><BilinmeyenSekil boy={40} /></span>
            <div className="who">Tanıyamadım</div>
            <div className="meta">En yakın {isimYaz(kisi)}, ama sadece <b className="num"><Sayac deger={son.guven} /></b>. Eşiğin altında kaldı. Bu dört kişiden biri değilsen normal.</div>
            <GuvenCubugu deger={son.guven} />
          </div>
        )}
        <div className="scores" aria-label="Kişilerin puanı">
          {sira.map((i) => (
            <div key={i} className={`score ${i === son.kisi && son.tanindi ? "lead" : ""}`} style={renk(isimler[i])}>
              <span className="lbl"><Sekil ad={sekil(i)} boy={16} />{isimYaz(isimler[i])}</span>
              <span className="bar"><i style={{ width: `${Math.round(son.p[i] * 100)}%` }} /></span>
              <span className="pct">{yuzde(son.p[i])}</span>
            </div>
          ))}
        </div>
      </>
    );
  }

  const px = rafGenislik && rafGenislik < 600 ? 40 : SN_PIKSEL;
  const bitis = Math.max(sonBit.current, bekleyen !== null ? simdi : 0);
  const izGenislik = Math.max(bitis * px + 96, rafGenislik);
  const isaretler = [];
  for (let s = 0; s * px < izGenislik; s += 5) isaretler.push(s);
  const dinliyor = asama === "dinliyor";
  const sonSure = taslar.length ? taslar[taslar.length - 1].bit : 0;
  const sonGrup = taslar.length ? taslar[taslar.length - 1].grup : 0;
  // Kim ne kadar konuştu (saniye); son eleman "Tanıyamadım"
  const konusmaSuresi = new Array(isimler.length + 1).fill(0);
  for (const t of taslar) konusmaSuresi[t.tanindi ? t.kisi : isimler.length] += t.bit - t.bas;
  const toplamKonusma = konusmaSuresi.reduce((a, b) => a + b, 0);
  const pay = (sn) => (toplamKonusma ? sn / toplamKonusma : 0);
  const sonKisi = son?.tanindi ? son.kisi : -1;
  const kaydir = (t) => raf.current?.scrollTo({ left: Math.max(0, t.bas * px - 24) });
  const ipucu = asama === "yukleniyor" ? "Model inince düğme açılır."
    : dinliyor ? "Dinliyorum. Sustuğunda taş gelir."
    : uyari === "mikhata" || asama === "modelhata" ? "" : "Mikrofon izni istenecek. Bir kol mesafesinden konuş.";

  return (
    <div className={`app${sahneModu ? " sahne" : ""}`}>
      <header className="top">
        <div className="top-sol">
        <Menu mod={mod} setMod={setMod} sahneAc={sahneAc} />
        <div className="brand">
          <svg width="40" height="48" viewBox="0 0 40 48" aria-hidden="true">
            <rect x="7" y="7" width="31" height="39" fill="#111" />
            <rect x="2" y="2" width="31" height="39" fill="#FBF6E9" stroke="#111" strokeWidth="3" />
            <rect x="9" y="9" width="17" height="17" fill="#111" />
            <rect x="9" y="31" width="17" height="4" fill="#111" />
          </svg>
          <div>
            <h1>Sıra Kimde?</h1>
            <p>{MODLAR.find((m) => m.id === mod).ad}</p>
          </div>
        </div>
        </div>
        <div className="status" role="status" aria-live="polite" data-tone={durumYazisi[1]}>
          <i /><span>{durumYazisi[0]}</span>
        </div>
      </header>

      {mod === "ornek" || mod === "oyun" || mod === "rapor" ? (
        <main className="grid tek">
          {!bilgi ? <section className="board">{sahne()}</section>
            : mod === "ornek" ? <OrnekSohbet model={model.current} bilgi={bilgi} />
            : mod === "oyun" ? <TaklitOyunu model={model.current} bilgi={bilgi} />
            : <SohbetRaporu bilgi={bilgi} taslar={taslar} canliyaGit={() => setMod("canli")} />}
        </main>
      ) : (
      <main className="grid">
        {mod === "harita" && bilgi ? <SesHaritasi bilgi={bilgi} taslar={taslar} /> : (
        <section className="istaka" aria-labelledby="rack-h">
          <div className="istaka-bas">
            <h2 id="rack-h">Istaka</h2>
            <span className="istaka-meta num">{taslar.length ? `${taslar.length} taş, ${sure(sonSure)}` : "Boş"}</span>
            {taslar.length > 1 && !dinliyor && !sahneModu && <button className="kucuk" onClick={() => setMod("rapor")}>Rapor</button>}
            {sahneModu
              ? <button className="kucuk koyu" onClick={() => sahneAc(false)}>Sahneden çık</button>
              : <button className="kucuk" onClick={temizle} disabled={!taslar.length || hesapliyor > 0}>Temizle</button>}
          </div>
          {taslar.length > 0 && (
            <div className="serit" role="group" aria-label="Bütün konuşma, baştan sona">
              {taslar.map((t) => {
                const kisi = isimler[t.kisi];
                const ad = t.tanindi ? isimYaz(kisi) : "Tanıyamadım";
                return (
                  <button key={`${t.grup}-${t.bas}`} className={t.tanindi ? "" : "unknown"}
                          style={{ left: `${(100 * t.bas) / sonSure}%`, width: `${(100 * (t.bit - t.bas)) / sonSure}%`, ...(t.tanindi ? renk(kisi) : {}) }}
                          onClick={() => kaydir(t)} title={`${ad} ${yuzde(t.guven)}, ${sure(t.bas)}`}
                          aria-label={`${ad} ${yuzde(t.guven)}, ${sure(t.bas)} - ${sure(t.bit)}. Taşa git`} />
                );
              })}
            </div>
          )}
          <div className="rack" ref={raf} tabIndex={0} aria-label="Konuşmaların zaman çizelgesi">
            <div className="track" style={{ width: izGenislik }}>
              <div className="lip" />
              {isaretler.map((s) => <span key={s} className="tick" style={{ left: s * px }}>{sure(s)}</span>)}
              {!taslar.length && bekleyen === null && (
                <p className="rack-empty">Her konuşma bitince buraya, konuşanın renginde bir taş dizilir.</p>
              )}
              {taslar.map((t) => {
                const kisi = isimler[t.kisi];
                const konum = { left: t.bas * px, width: Math.max(30, (t.bit - t.bas) * px - 6) };
                const dus = t.grup === sonGrup ? " drop" : "";
                const baslik = `${t.tanindi ? isimYaz(kisi) : "Tanıyamadım"} ${yuzde(t.guven)}, ${sure(t.bas)} - ${sure(t.bit)}`;
                return (
                  <div key={`${t.grup}-${t.bas}`} className={`tile${t.tanindi ? "" : " unknown"}${dus}`}
                       style={t.tanindi ? { ...konum, ...renk(kisi) } : konum} title={baslik} aria-label={baslik}>
                    <span className="blok">
                      {t.tanindi ? <Sekil ad={sekil(t.kisi)} boy={18} /> : <BilinmeyenSekil boy={18} />}
                      <span className="nm">{t.tanindi ? isimYaz(kisi) : "Tanıyamadım"}</span>
                    </span>
                    <span className="pc">{yuzde(t.guven)}</span>
                  </div>
                );
              })}
              {bekleyen !== null && (
                <div className="tile pending" style={{ left: bekleyen * px, width: Math.max(104, (simdi - bekleyen) * px - 6) }}>
                  Dinleniyor
                </div>
              )}
            </div>
          </div>
        </section>
        )}

        <section className="board stage" aria-labelledby="stage-h">
          <h2 id="stage-h">Son konuşan</h2>
          <div>{sahne()}</div>
        </section>

        <div className="control">
          <button className="mic" data-live={String(dinliyor)} data-duyuyor={String(bekleyen !== null)} disabled={asama === "yukleniyor" || asama === "modelhata"}
                  onClick={dinliyor ? durdur : baslat}>
            <svg width="34" height="40" viewBox="0 0 34 40" aria-hidden="true">
              <rect x="10" y="2" width="14" height="22" fill="none" stroke="currentColor" strokeWidth="4" />
              <path d="M4 16v4c0 7 6 11 13 11s13-4 13-11v-4" fill="none" stroke="currentColor" strokeWidth="4" />
              <path d="M17 31v7M9 38h16" stroke="currentColor" strokeWidth="4" />
            </svg>
            <span>{asama === "yukleniyor" ? "Bekle" : dinliyor ? "Durdur" : "Başlat"}</span>
            {dinliyor && <span className="gecen num" aria-hidden="true">{sure(Math.max(0, simdi - dinlemeBas.current))}</span>}
            <span className="level" aria-hidden="true">
              {[0.6, 0.85, 1, 0.75, 0.95].map((k, i) => <i key={i} style={{ transform: `scaleY(${0.15 + seviye * 0.85 * k})` }} />)}
            </span>
          </button>
          {ipucu && <p className="mic-hint">{ipucu}</p>}
          {(asama === "hazir" || dinliyor) && <p className="kbd-hint">Kısayol: <kbd>Boşluk</kbd> başlat/durdur, <kbd>F</kbd> sahne modu</p>}
        </div>

        <section className="board sesler" aria-labelledby="players-h">
          <h2 id="players-h">Tanıdığı sesler <span>ne kadar konuştu</span></h2>
          <div className="players">
            {isimler.map((id, k) => (
              <div key={id} className={`player${k === sonKisi ? " sirada" : ""}`} style={renk(id)}>
                <span className="blok"><Sekil ad={sekil(k)} boy={18} />{isimYaz(id)}{k === sonKisi && <em className="son-etiket">Son</em>}</span>
                <span className="sn num">{sure(konusmaSuresi[k])}{toplamKonusma > 0 && <small>{yuzde(pay(konusmaSuresi[k]))}</small>}</span>
                <span className="pay" aria-hidden="true"><i style={{ width: `${100 * pay(konusmaSuresi[k])}%` }} /></span>
              </div>
            ))}
            <div className="player unknown">
              <span className="blok"><BilinmeyenSekil boy={18} />Tanıyamadım</span>
              <span className="sn num">{sure(konusmaSuresi[isimler.length])}{toplamKonusma > 0 && <small>{yuzde(pay(konusmaSuresi[isimler.length]))}</small>}</span>
              <span className="pay" aria-hidden="true"><i style={{ width: `${100 * pay(konusmaSuresi[isimler.length])}%` }} /></span>
            </div>
          </div>
          <p className="legend-note">Sadece bu {isimler.length || "dört"} kişiyi tanır. Emin olma %60&apos;ın altındaysa isim yerine &quot;Tanıyamadım&quot; yazar.</p>
        </section>

        <section className="model" aria-labelledby="model-h">
          <div className="der"><b className="num">{bilgi ? `%${(100 * bilgi.der).toFixed(1).replace(".", ",")}` : "…"}</b><span>DER</span></div>
          <div>
            <h3 id="model-h">{bilgi?.model_adi ?? "Model B: ECAPA + sınıflandırıcı"}</h3>
            <p>DER: 20 deneme sohbetinde konuşma süresinin yüzde kaçında yanıldığı. Düşük olan iyi. Ses 2 saniyelik parçalarla dinlenir ve cihazından çıkmaz.{hiz !== null && <> Bu cihazda bir parça <span className="num">{Math.round(hiz)} ms</span> sürüyor.</>}</p>
          </div>
        </section>
      </main>
      )}
    </div>
  );
}
