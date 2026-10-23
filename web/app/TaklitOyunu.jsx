"use client";
// Taklit oyunu: bir taş çekilir ("Sıra Onur'da"), oyuncu o kişi gibi konuşur.
// Puan: modelin o kişiye verdiği olasılık (bir konuşmanın bütün taşları, süreyle ağırlıklı). Rekorlar sadece bu cihazda.
import { useEffect, useMemo, useState } from "react";
import { Sekil, isimYaz, renk, sekilAdi, yuzde } from "./ortak";

const ANAHTAR = "sira-kimde-rekor";
const rekorOku = () => {
  try { return JSON.parse(localStorage.getItem(ANAHTAR)) ?? {}; } catch { return {}; }
};
const rekorYaz = (r) => {
  try { localStorage.setItem(ANAHTAR, JSON.stringify(r)); } catch { /* gizli pencere: rekor tutulmaz */ }
};

export default function TaklitOyunu({ bilgi, taslar, dinliyor }) {
  const isimler = bilgi.labels;
  const [hedef, setHedef] = useState(null); // çekilen kişinin sırası
  const [basGrup, setBasGrup] = useState(0); // tur başlarken son taşın grubu: sonraki konuşmalar bu turun denemeleri
  const [rekor, setRekor] = useState({});
  const [yeniRekor, setYeniRekor] = useState(0); // rekoru kıran denemenin numarası
  useEffect(() => setRekor(rekorOku()), []);

  const sonGrup = taslar.length ? taslar[taslar.length - 1].grup : 0;

  function cek() {
    let k;
    do k = Math.floor(Math.random() * isimler.length); while (isimler.length > 1 && k === hedef);
    setHedef(k);
    setBasGrup(sonGrup);
    setYeniRekor(0);
  }

  // Her konuşma (grup) bir deneme
  const denemeler = useMemo(() => {
    if (hedef === null) return [];
    const gruplar = new Map();
    for (const t of taslar) {
      if (t.grup <= basGrup) continue;
      if (!gruplar.has(t.grup)) gruplar.set(t.grup, []);
      gruplar.get(t.grup).push(t);
    }
    return [...gruplar.values()].map((ts) => {
      const sn = ts.reduce((a, t) => a + t.bit - t.bas, 0) || 1;
      const p = isimler.map((_, k) => ts.reduce((a, t) => a + t.p[k] * (t.bit - t.bas), 0) / sn);
      let sandi = 0;
      p.forEach((v, k) => { if (v > p[sandi]) sandi = k; });
      return { puan: p[hedef], p, sandi };
    });
  }, [taslar, hedef, basGrup, isimler]);

  useEffect(() => {
    const son = denemeler[denemeler.length - 1];
    if (!son) return;
    const r = rekorOku();
    const id = isimler[hedef];
    if (son.puan > (r[id] ?? 0)) {
      r[id] = son.puan;
      rekorYaz(r);
      setRekor(r);
      setYeniRekor(denemeler.length);
    }
  }, [denemeler.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const son = denemeler[denemeler.length - 1];
  const hedefId = hedef !== null ? isimler[hedef] : null;
  const sira = son ? son.p.map((_, i) => i).sort((a, b) => son.p[b] - son.p[a]) : [];

  return (
    <section className="oyun" aria-labelledby="oyun-h">
      <div className="ornek-bas">
        <h2 id="oyun-h">Taklit oyunu</h2>
        <span className="istaka-meta num">{hedef === null ? "Taş çekilmedi" : `${denemeler.length} deneme`}</span>
        <button className="kucuk koyu" onClick={cek}>
          {hedef === null ? "Taş çek" : "Yeni taş"}
        </button>
      </div>
      <div className="oyun-ic">
        <div className="oyun-sol">
          {hedef === null ? (
            <div className="notice">
              <h3>Bir taş çek</h3>
              <p>Taştan dört kişiden biri çıkar. Başlat&apos;a bas ve onun gibi konuş: sesini, hızını, vurgusunu taklit et. Modelin o kişiye verdiği yüzde senin puanın olur.</p>
            </div>
          ) : (
            <div key={`${hedef}-${basGrup}`} className="bigtile flip" style={renk(hedefId)}>
              <span className="shape"><Sekil ad={sekilAdi(isimler, hedef)} boy={40} /></span>
              <small className="cekilen">Sıra kimde?</small>
              <div className="who">{isimYaz(hedefId)}</div>
              <div className="meta">{dinliyor ? "Dinliyorum. Onun gibi konuş, sonra sus." : `Başlat'a bas, ${isimYaz(hedefId)} gibi bir iki cümle söyle.`}</div>
            </div>
          )}

          <h3 className="benzer-h">Rekorlar <span>bu cihazda</span></h3>
          <div className="players rekorlar">
            {isimler.map((id, k) => (
              <div key={id} className={`player${k === hedef ? " sirada" : ""}`} style={renk(id)}>
                <span className="blok"><Sekil ad={sekilAdi(isimler, k)} boy={18} />{isimYaz(id)}</span>
                <span className="sn num">{rekor[id] !== undefined ? yuzde(rekor[id]) : "Yok"}</span>
                <span className="pay" aria-hidden="true"><i style={{ width: `${100 * (rekor[id] ?? 0)}%` }} /></span>
              </div>
            ))}
          </div>
        </div>

        <div className="oyun-sag">
          {!son ? (
            <div className="puan-bos">
              <small>Puan</small>
              <b>{hedef === null ? "?" : "..."}</b>
              <p>{hedef === null ? "Önce taş çek." : "Konuşman bitince puanın burada çıkar."}</p>
            </div>
          ) : (
            <>
              <div key={denemeler.length} className="puan flip" style={renk(hedefId)}>
                <small>{denemeler.length}. deneme{yeniRekor === denemeler.length && <em>Yeni rekor</em>}</small>
                <b className="num">{yuzde(son.puan)}</b>
                <p>
                  {son.sandi === hedef
                    ? `Model seni ${isimYaz(hedefId)} sandı.`
                    : `Model seni daha çok ${isimYaz(isimler[son.sandi])} sandı (${yuzde(son.p[son.sandi])}).`}
                </p>
              </div>
              <div className="scores" aria-label="Bu denemede kişilerin puanı">
                {sira.map((i) => (
                  <div key={i} className={`score ${i === hedef ? "lead" : ""}`} style={renk(isimler[i])}>
                    <span className="lbl"><Sekil ad={sekilAdi(isimler, i)} boy={16} />{isimYaz(isimler[i])}</span>
                    <span className="bar"><i style={{ width: `${Math.round(son.p[i] * 100)}%` }} /></span>
                    <span className="pct">{yuzde(son.p[i])}</span>
                  </div>
                ))}
              </div>
              {denemeler.length > 1 && (
                <ol className="denemeler num" aria-label="Bu turdaki denemeler">
                  {denemeler.map((d, i) => (
                    <li key={i} data-iyi={d.puan === Math.max(...denemeler.map((x) => x.puan))}>
                      <span>{i + 1}.</span><b>{yuzde(d.puan)}</b>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
          <p className="legend-note">Puan, modelin {hedefId ? isimYaz(hedefId) : "o kişi"} için verdiği olasılık. Dört kişinin puanı toplamda %100 eder. %60 eşiğini geçersen canlı modda da seni o kişi sanar.</p>
        </div>
      </div>
    </section>
  );
}
