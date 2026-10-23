"use client";
// Taklit oyunu: rastgele bir taş çekilir, oyuncu o kişi gibi konuşur. Puan, modelin o kişiye verdiği
// ortalama olasılık (konuşmanın her 2 sn'lik penceresi için). Kişi başı en iyi puan bu cihazda saklanır.
import { useEffect, useRef, useState } from "react";
import { ESIK, SR, pencereler } from "../lib/konusmaci";
import { pencereleriCalistir } from "../lib/model";
import { Sayac, Sekil, isimYaz, kimde, kime, renk, sekilAdi, yuzde } from "./ortak";

const KAYIT_SN = 4;
const REKOR_ANAHTAR = "sira-kimde-taklit-rekor";

function rekorOku() {
  try { return JSON.parse(localStorage.getItem(REKOR_ANAHTAR)) ?? {}; } catch { return {}; }
}
function rekorYaz(r) {
  try { localStorage.setItem(REKOR_ANAHTAR, JSON.stringify(r)); } catch { /* gizli pencere: sadece bu oturumda kalır */ }
}

// Mikrofon sesi -> 16 kHz mono. Tarayıcı kendi hızında kaydeder, sonra yeniden örneklenir.
async function kaydet(sn, seviye) {
  const akis = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const ctx = new AudioContext();
  try {
    const kaynak = ctx.createMediaStreamSource(akis);
    const isle = ctx.createScriptProcessor(4096, 1, 1);
    const parcalar = [];
    const hedef = Math.round(sn * ctx.sampleRate);
    let toplam = 0;
    await new Promise((bitti) => {
      isle.onaudioprocess = (e) => {
        const x = e.inputBuffer.getChannelData(0);
        parcalar.push(new Float32Array(x));
        toplam += x.length;
        let s = 0;
        for (let i = 0; i < x.length; i++) s += x[i] * x[i];
        seviye(Math.max(0, Math.min(1, (10 * Math.log10(s / x.length + 1e-10) + 60) / 50)), Math.min(1, toplam / hedef));
        if (toplam >= hedef) bitti();
      };
      kaynak.connect(isle);
      isle.connect(ctx.destination);
    });
    kaynak.disconnect();
    isle.disconnect();
    const ham = new Float32Array(toplam);
    let o = 0;
    for (const p of parcalar) { ham.set(p, o); o += p.length; }
    const off = new OfflineAudioContext(1, Math.ceil((toplam * SR) / ctx.sampleRate), SR);
    const tampon = off.createBuffer(1, toplam, ctx.sampleRate);
    tampon.copyToChannel(ham, 0);
    const k = off.createBufferSource();
    k.buffer = tampon;
    k.connect(off.destination);
    k.start();
    return (await off.startRendering()).getChannelData(0);
  } finally {
    akis.getTracks().forEach((t) => t.stop());
    ctx.close();
  }
}

// Baştaki ve sondaki sessizliği at (20 ms'lik karelerin enerjisine göre). Sessiz pencere -20 dBFS'e
// yükseltilince gürültü konuşma gibi görünür, puanı bozardı.
function sessizligiKes(x) {
  const K = SR / 50;
  const enerji = [];
  for (let i = 0; i + K <= x.length; i += K) {
    let s = 0;
    for (let j = i; j < i + K; j++) s += x[j] * x[j];
    enerji.push(Math.sqrt(s / K));
  }
  const tepe = Math.max(...enerji, 0);
  if (tepe < 0.01) return null; // mikrofondan ses gelmedi
  const sinir = tepe * 0.12;
  const ilk = enerji.findIndex((e) => e > sinir);
  const son = enerji.length - 1 - [...enerji].reverse().findIndex((e) => e > sinir);
  return x.subarray(ilk * K, (son + 1) * K);
}

export default function TaklitOyunu({ model, bilgi }) {
  const isimler = bilgi.labels;
  const [hedef, setHedef] = useState(null); // çekilen taşın sırası
  const [durum, setDurum] = useState("hazir"); // hazir | kayit | hesap | sonuc | kisa | sessiz | mikhata
  const [seviye, setSeviye] = useState(0);
  const [ilerleme, setIlerleme] = useState(0);
  const [sonuc, setSonuc] = useState(null); // { p: [kişi], yeniRekor }
  const [rekor, setRekor] = useState({});
  const calisiyor = useRef(false);

  useEffect(() => {
    setRekor(rekorOku());
    setHedef(Math.floor(Math.random() * isimler.length));
  }, [isimler.length]);

  function tasCek() {
    // Aynı kişi art arda çıkmasın
    setHedef((h) => (h + 1 + Math.floor(Math.random() * (isimler.length - 1))) % isimler.length);
    setSonuc(null);
    setDurum("hazir");
  }

  async function oyna() {
    if (calisiyor.current || hedef === null) return;
    calisiyor.current = true;
    setSonuc(null);
    setDurum("kayit");
    try {
      let ses;
      try {
        ses = await kaydet(KAYIT_SN, (sv, k) => { setSeviye(sv); setIlerleme(k); });
      } catch (e) {
        console.error(e);
        setDurum("mikhata");
        return;
      }
      setSeviye(0);
      const konusma = sessizligiKes(ses);
      if (!konusma) { setDurum("sessiz"); return; }
      if (konusma.length < SR) { setDurum("kisa"); return; }
      setDurum("hesap");
      const { veri, n } = pencereler(konusma);
      const { olas } = await pencereleriCalistir(model, veri, n);
      const p = isimler.map((_, k) => {
        let t = 0;
        for (let i = 0; i < n; i++) t += olas[i * isimler.length + k];
        return t / n;
      });
      const ad = isimler[hedef];
      const eski = rekor[ad] ?? 0;
      // Ekranda %0 görünen puan rekor sayılmasın
      const yeniRekor = Math.round(p[hedef] * 100) > Math.round(eski * 100);
      if (yeniRekor) {
        const r = { ...rekor, [ad]: p[hedef] };
        setRekor(r);
        rekorYaz(r);
      }
      setSonuc({ p, yeniRekor, eski });
      setDurum("sonuc");
    } finally {
      calisiyor.current = false;
    }
  }

  // Boşluk tuşu: konuş
  const tus = useRef(null);
  tus.current = () => { if (durum !== "kayit" && durum !== "hesap") oyna(); };
  useEffect(() => {
    const bas = (e) => {
      if (e.code !== "Space" || e.repeat || e.target.closest?.("button, input, textarea, [contenteditable]")) return;
      e.preventDefault();
      tus.current();
    };
    window.addEventListener("keydown", bas);
    return () => window.removeEventListener("keydown", bas);
  }, []);

  if (hedef === null) return null;
  const ad = isimler[hedef];
  const mesgul = durum === "kayit" || durum === "hesap";
  const kazanan = sonuc ? sonuc.p.indexOf(Math.max(...sonuc.p)) : -1;
  const puan = sonuc?.p[hedef] ?? 0;
  const sira = sonuc ? sonuc.p.map((_, i) => i).sort((a, b) => sonuc.p[b] - sonuc.p[a]) : [];

  function yorum() {
    if (puan >= ESIK) return `Model seni ${isimYaz(ad)} sandı. Eşiği geçtin.`;
    if (kazanan === hedef) return `En çok ${kime(ad)} benzetti ama eşiğin (${yuzde(ESIK)}) altında kaldın.`;
    return `Model seni daha çok ${kime(isimler[kazanan])} benzetti.`;
  }

  return (
    <section className="oyun" aria-labelledby="oyun-h">
      <div className="ornek-bas">
        <h2 id="oyun-h">Taklit oyunu</h2>
        <span className="istaka-meta">Çekilen kişi gibi {KAYIT_SN} saniye konuş</span>
        <button className="kucuk" onClick={tasCek} disabled={mesgul}>Yeni taş çek</button>
      </div>

      <div className="oyun-ic">
        <div key={hedef} className="bigtile flip oyun-tas" style={renk(ad)}>
          <span className="shape"><Sekil ad={sekilAdi(isimler, hedef)} boy={40} /></span>
          <small>Çekilen taş</small>
          <div className="who">Sıra {kimde(ad)}</div>
          <div className="meta">
            {rekor[ad] ? <>Bu cihazdaki en iyi {isimYaz(ad)} taklidi: <b className="num">{yuzde(rekor[ad])}</b></> : <>Henüz kimse {isimYaz(ad)} taklidi yapmadı.</>}
          </div>
        </div>

        <div className="oyun-sag">
          <button className="mic" data-live={String(durum === "kayit")} disabled={mesgul} onClick={oyna}>
            <svg width="34" height="40" viewBox="0 0 34 40" aria-hidden="true">
              <rect x="10" y="2" width="14" height="22" fill="none" stroke="currentColor" strokeWidth="4" />
              <path d="M4 16v4c0 7 6 11 13 11s13-4 13-11v-4" fill="none" stroke="currentColor" strokeWidth="4" />
              <path d="M17 31v7M9 38h16" stroke="currentColor" strokeWidth="4" />
            </svg>
            <span>{durum === "kayit" ? "Konuş" : durum === "hesap" ? "Hesaplanıyor" : sonuc ? "Tekrar dene" : `${isimYaz(ad)} gibi konuş`}</span>
            <span className="level" aria-hidden="true">
              {[0.6, 0.85, 1, 0.75, 0.95].map((k, i) => <i key={i} style={{ transform: `scaleY(${0.15 + seviye * 0.85 * k})` }} />)}
            </span>
          </button>
          <div className="oyun-sure" aria-hidden="true"><i style={{ width: `${(durum === "kayit" ? ilerleme : 0) * 100}%` }} /></div>

          {durum === "mikhata" && (
            <div className="notice error" role="alert"><h3>Mikrofona erişilemedi</h3><p>Adres çubuğundaki kilit simgesinden mikrofona izin ver, sonra tekrar dene.</p></div>
          )}
          {durum === "sessiz" && (
            <div className="notice" role="alert"><h3>Ses gelmedi</h3><p>Mikrofon sessizdi. Tarayıcının doğru mikrofonu kullandığına bak.</p></div>
          )}
          {durum === "kisa" && (
            <div className="notice" role="alert"><h3>Çok kısa</h3><p>Model en az 1 saniyelik konuşma ister. Bir cümle kur, {KAYIT_SN} saniye boyunca konuşmaya devam et.</p></div>
          )}
          {durum === "sonuc" && sonuc && (
            <div className="oyun-sonuc" role="status">
              <div className="oyun-puan" style={renk(ad)} data-gecti={puan >= ESIK}>
                <small>{isimYaz(ad)} puanın</small>
                <b className="num"><Sayac deger={puan} /></b>
                {sonuc.yeniRekor && <em>Yeni rekor</em>}
              </div>
              <p className="oyun-yorum">{yorum()}</p>
              <div className="scores" aria-label="Modelin dört kişiye verdiği puan">
                {sira.map((i) => (
                  <div key={i} className={`score ${i === hedef ? "lead" : ""}`} style={renk(isimler[i])}>
                    <span className="lbl"><Sekil ad={sekilAdi(isimler, i)} boy={16} />{isimYaz(isimler[i])}</span>
                    <span className="bar"><i style={{ width: `${Math.round(sonuc.p[i] * 100)}%` }} /></span>
                    <span className="pct">{yuzde(sonuc.p[i])}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {durum === "hazir" && (
            <p className="oyun-ipucu">Düğmeye bas, {isimYaz(ad)} gibi konuş. Model sesini 2 saniyelik parçalarla dinler; {kime(ad)} verdiği yüzdelerin ortalaması puanın olur.</p>
          )}
        </div>
      </div>
    </section>
  );
}
