"use client";
// Sadece gerçek zamanlı VAD: paketin ana girişi dosyadan VAD'ı ve tam ONNX Runtime'ı da getirirdi
import { MicVAD } from "@ricky0123/vad-web/dist/real-time-vad";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { SR } from "../lib/konusmaci";
import { adres, konusmayiTani, modelYukle } from "../lib/model";

const SN_PIKSEL = 56; // zaman çizelgesinde 1 saniye
const SEKILLER = { cem: "square", elif: "triangle", onur: "circle", zehra: "diamond" };
const YEDEK_SEKILLER = ["square", "triangle", "circle", "diamond"];

const yuzde = (x) => "%" + Math.round(x * 100);
const sure = (sn) => `${Math.floor(sn / 60)}:${String(Math.floor(sn % 60)).padStart(2, "0")}`;
const isimYaz = (id) => id.charAt(0).toLocaleUpperCase("tr") + id.slice(1);
const renk = (id) => ({ "--c": `var(--${id}, #6B6B6B)`, "--on": `var(--${id}-on, #FFFFFF)` });

// Gürültü azaltma, yankı engelleme ve otomatik seviye kapalı: eğitim kayıtlarında bunlar yoktu.
const mikrofonAc = () => navigator.mediaDevices.getUserMedia({
  audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
});

function Sekil({ ad, boy = 22 }) {
  const s = boy, h = 1.5;
  const govde = {
    square: <rect x={h} y={h} width={s - 3} height={s - 3} />,
    triangle: <polygon points={`${s / 2},${h} ${s - h},${s - h} ${h},${s - h}`} />,
    circle: <circle cx={s / 2} cy={s / 2} r={s / 2 - h} />,
    diamond: <polygon points={`${s / 2},${h} ${s - h},${s / 2} ${s / 2},${s - h} ${h},${s / 2}`} />,
  }[ad];
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="3">
      {govde}
    </svg>
  );
}

function BilinmeyenSekil({ boy = 22 }) {
  return (
    <svg width={boy} height={boy} viewBox="0 0 22 22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="3">
      <rect x="1.5" y="1.5" width="19" height="19" strokeDasharray="4 3" />
      <path d="M8 8.5a3 3 0 1 1 4 2.8c-.7.3-1 .8-1 1.5V14M11 16.5v1.5" />
    </svg>
  );
}

export default function Uygulama() {
  const [asama, setAsama] = useState("yukleniyor"); // yukleniyor | hazir | dinliyor | modelhata
  const [uyari, setUyari] = useState(null); // null | "mikhata" | "konusmayok"
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

  const model = useRef(null);
  const vad = useRef(null);
  const t0 = useRef(null);
  const sonBit = useRef(0);
  const kuyruk = useRef(Promise.resolve());
  const buDinlemede = useRef(0);
  const sonSeviye = useRef(0);
  const raf = useRef(null);

  const zaman = () => (performance.now() - t0.current) / 1000;
  const isimler = bilgi?.labels ?? [];
  const sekil = (k) => SEKILLER[isimler[k]] ?? YEDEK_SEKILLER[k % YEDEK_SEKILLER.length];

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
        setTaslar((t) => [...t, ...r.taslar]);
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
    setSeviye(Math.max(0, Math.min(1, (db + 60) / 50)));
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
          onSpeechRealStart: () => setBekleyen(Math.max(sonBit.current, zaman())),
          onVADMisfire: () => setBekleyen(null),
          onSpeechEnd: isle,
          onFrameProcessed: (_p, kare) => seviyeGuncelle(kare),
        });
      }
      if (t0.current === null) t0.current = performance.now();
      buDinlemede.current = 0;
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
    if (buDinlemede.current === 0) setUyari("konusmayok");
  }

  // Konuşma sürerken "Dinleniyor..." taşı büyüsün
  useEffect(() => {
    if (bekleyen === null) return;
    const id = setInterval(() => setSimdi(zaman()), 200);
    return () => clearInterval(id);
  }, [bekleyen]);

  // ---------- Zaman çizelgesi her zaman en sona kaysın ----------
  useLayoutEffect(() => {
    const olc = () => raf.current && setRafGenislik(raf.current.clientWidth);
    olc();
    window.addEventListener("resize", olc);
    return () => window.removeEventListener("resize", olc);
  }, [asama]);
  useEffect(() => {
    if (raf.current) raf.current.scrollLeft = raf.current.scrollWidth;
  }, [taslar.length, bekleyen, simdi]);

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
    if (uyari === "konusmayok") {
      return (
        <div className="notice" role="alert">
          <h3>Konuşma bulunamadı</h3>
          <p>Mikrofon ses aldı ama içinde konuşma yoktu. Biraz daha yakından ve yüksek sesle tekrar dene.</p>
        </div>
      );
    }
    if (!son) {
      return (
        <div className="bigtile empty">
          <div className="who">Henüz kimse</div>
          <div className="meta">Başlat&apos;a bas ve konuş. Konuşman bitince adın burada çıkar.</div>
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
            <div className="meta">Model <b className="num">{yuzde(son.guven)}</b> emin</div>
          </div>
        ) : (
          <div key={yeniKey} className="bigtile unknown flip">
            <span className="shape"><BilinmeyenSekil boy={40} /></span>
            <div className="who">Tanıyamadım</div>
            <div className="meta">En yakın {isimYaz(kisi)}, ama sadece <b className="num">{yuzde(son.guven)}</b>. Bu dört kişiden biri değilsen normal.</div>
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

  const bitis = Math.max(sonBit.current, bekleyen !== null ? simdi : 0);
  const izGenislik = Math.max(bitis * SN_PIKSEL + 80, rafGenislik);
  const isaretler = [];
  for (let s = 0; s * SN_PIKSEL < izGenislik; s += 5) isaretler.push(s);
  const dinliyor = asama === "dinliyor";
  const sonSure = taslar.length ? taslar[taslar.length - 1].bit : 0;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <svg width="40" height="46" viewBox="0 0 40 46" aria-hidden="true">
            <rect x="6" y="5" width="32" height="40" fill="#111" />
            <rect x="2" y="1" width="32" height="40" fill="#E3242B" stroke="#111" strokeWidth="3" />
            <rect x="10" y="9" width="16" height="16" fill="#FBF6E9" stroke="#111" strokeWidth="3" />
            <rect x="8" y="31" width="20" height="4" fill="#111" />
          </svg>
          <div>
            <h1>Sıra Kimde?</h1>
            <p>Konuş, seni tanıyayım.</p>
          </div>
        </div>
        <div className="status" role="status" aria-live="polite" data-tone={durumYazisi[1]}>
          <i /><span>{durumYazisi[0]}</span>
        </div>
      </header>

      <div className="grid">
        <div className="col">
          <section className="board stage" aria-labelledby="stage-h">
            <h2 id="stage-h">Son konuşan</h2>
            <div>{sahne()}</div>
          </section>
          <div>
            <button className="mic" data-live={String(dinliyor)} disabled={asama === "yukleniyor" || asama === "modelhata"}
                    onClick={dinliyor ? durdur : baslat}>
              <svg width="34" height="40" viewBox="0 0 34 40" aria-hidden="true">
                <rect x="10" y="2" width="14" height="22" fill="none" stroke="currentColor" strokeWidth="4" />
                <path d="M4 16v4c0 7 6 11 13 11s13-4 13-11v-4" fill="none" stroke="currentColor" strokeWidth="4" />
                <path d="M17 31v7M9 38h16" stroke="currentColor" strokeWidth="4" />
              </svg>
              <span>{asama === "yukleniyor" ? "Bekle" : dinliyor ? "Durdur" : "Başlat"}</span>
              <span className="level" aria-hidden="true">
                {[0.6, 0.85, 1, 0.75, 0.95, 0.7, 0.55].map((k, i) => <i key={i} style={{ height: `${6 + seviye * 28 * k}px` }} />)}
              </span>
            </button>
            <p className="mic-hint">
              {asama === "yukleniyor" ? "Model inince düğme açılır."
                : dinliyor ? "Dinliyorum. Konuşman bitince taş gelir."
                : uyari === "mikhata" || asama === "modelhata" ? "" : "Mikrofon izni istenecek."}
            </p>
          </div>
        </div>

        <div className="col">
          <section className="board rack-board" aria-labelledby="rack-h">
            <h2 id="rack-h">Zaman çizelgesi <span>{taslar.length ? `${taslar.length} taş, ${sure(sonSure)}` : ""}</span></h2>
            <div className="rack" ref={raf} tabIndex={0} aria-label="Konuşmaların zaman çizelgesi">
              <div className="track" style={{ width: izGenislik }}>
                <div className="lip" />
                {isaretler.map((s) => <span key={s} className="tick" style={{ left: s * SN_PIKSEL }}>{sure(s)}</span>)}
                {!taslar.length && bekleyen === null && (
                  <p className="rack-empty">Henüz taş yok. Her konuşma bittiğinde buraya, konuşanın renginde bir taş dizilir.</p>
                )}
                {taslar.map((t, k) => {
                  const kisi = isimler[t.kisi];
                  const konum = { left: t.bas * SN_PIKSEL, width: Math.max(18, (t.bit - t.bas) * SN_PIKSEL - 6) };
                  const dus = k === taslar.length - 1 ? " drop" : "";
                  const baslik = `${t.tanindi ? isimYaz(kisi) : "Tanıyamadım"} ${yuzde(t.guven)}, ${sure(t.bas)} - ${sure(t.bit)}`;
                  return t.tanindi ? (
                    <div key={`${k}-${yeniKey}`} className={`tile${dus}`} style={{ ...konum, ...renk(kisi) }} title={baslik}>
                      <span className="nm">{isimYaz(kisi)}</span>
                      <span className="row"><span className="pc">{yuzde(t.guven)}</span><Sekil ad={sekil(t.kisi)} boy={18} /></span>
                    </div>
                  ) : (
                    <div key={`${k}-${yeniKey}`} className={`tile unknown${dus}`} style={konum} title={baslik}>
                      <span className="nm">Tanıyamadım</span>
                      <span className="row"><span className="pc">{yuzde(t.guven)}</span><BilinmeyenSekil boy={18} /></span>
                    </div>
                  );
                })}
                {bekleyen !== null && (
                  <div className="tile pending" style={{ left: bekleyen * SN_PIKSEL, width: Math.max(60, (simdi - bekleyen) * SN_PIKSEL - 6) }}>
                    Dinleniyor...
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="board" aria-labelledby="players-h">
            <h2 id="players-h">Tanıdığı sesler</h2>
            <div className="players">
              {isimler.map((id, k) => (
                <div key={id} className="player" style={renk(id)}><span>{isimYaz(id)}</span><Sekil ad={sekil(k)} boy={20} /></div>
              ))}
              <div className="player unknown"><span>Tanıyamadım</span><BilinmeyenSekil boy={20} /></div>
            </div>
            <p className="legend-note">Model sadece bu {isimler.length || "dört"} kişiyi tanır. Emin olma oranı %60&apos;ın altına düşerse isim yerine &quot;Tanıyamadım&quot; yazar; yabancı biri konuştuğunda da bunu görürsün.</p>
          </section>

          <section className="board" aria-labelledby="model-h">
            <div className="model">
              <div className="der"><b className="num">{bilgi ? `%${(100 * bilgi.der).toFixed(1).replace(".", ",")}` : "…"}</b><span>DER</span></div>
              <div>
                <h3 id="model-h">{bilgi?.model_adi ?? "Model B: ECAPA + sınıflandırıcı"}</h3>
                <p>DER, 20 deneme sohbetinde konuşma süresinin yüzde kaçında yanıldığını gösterir. Düşük olan daha iyi. Model telefonunda ya da bilgisayarında çalışır, sesin hiçbir yere gönderilmez.</p>
                {hiz !== null && <p className="hiz">Bu cihazda bir pencere: {Math.round(hiz)} ms</p>}
              </div>
            </div>
          </section>
        </div>
      </div>

      <p className="foot">Her konuşma bittiğinde sonuç gelir: ses 2 saniyelik parçalarla, yarım saniye kaydırılarak dinlenir. En iyi sonuç için mikrofona bir kol mesafesinden konuş.</p>
    </div>
  );
}
