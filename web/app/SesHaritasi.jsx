"use client";
// Ses haritası: dört kişinin kayıtları birer bulut, her konuşma (taş) haritaya bir nokta olarak düşer.
// Konum 192 sayılık embedding'in 2 boyuta indirilmiş hali; benzerlikler 192 boyutta hesaplanır.
import { useEffect, useMemo, useState } from "react";
import { haritaYukle, yerlestir } from "../lib/harita";
import { BilinmeyenSekil, Sekil, isimYaz, renk, sekilAdi, yuzde } from "./ortak";

const SINIR = 1.12; // görünen alan: -SINIR..SINIR
const sayi2 = (x) => x.toFixed(2).replace(".", ",");

// SVG içinde şekil: x, y merkez, r yarıçap
function Nokta({ ad, x, y, r, ...p }) {
  if (ad === "square") return <rect x={x - r} y={y - r} width={2 * r} height={2 * r} {...p} />;
  if (ad === "triangle") return <polygon points={`${x},${y - r * 1.15} ${x + r * 1.1},${y + r * 0.85} ${x - r * 1.1},${y + r * 0.85}`} {...p} />;
  if (ad === "diamond") return <polygon points={`${x},${y - r * 1.25} ${x + r * 1.25},${y} ${x},${y + r * 1.25} ${x - r * 1.25},${y}`} {...p} />;
  return <circle cx={x} cy={y} r={r} {...p} />;
}

export default function SesHaritasi({ bilgi, taslar }) {
  const isimler = bilgi.labels;
  const [harita, setHarita] = useState(null);
  const [hata, setHata] = useState("");
  const [secili, setSecili] = useState(null); // tıklanan taşın sırası; yoksa son taş

  useEffect(() => {
    haritaYukle().then(setHarita).catch((e) => setHata(String(e.message ?? e)));
  }, []);

  const noktalar = useMemo(
    () => (harita ? taslar.filter((t) => t.emb).map((t, i) => ({ ...t, sira: i + 1, ...yerlestir(harita, t.emb) })) : []),
    [harita, taslar],
  );
  useEffect(() => setSecili(null), [taslar.length]);

  // Her bulutun ortası (etiket için)
  const merkezler = useMemo(() => {
    if (!harita) return [];
    return isimler.map((_, k) => {
      const p = harita.noktalar.filter((n) => n[0] === k);
      return [p.reduce((a, n) => a + n[1], 0) / p.length, p.reduce((a, n) => a + n[2], 0) / p.length];
    });
  }, [harita, isimler]);

  if (hata) {
    return <section className="harita"><div className="notice error" role="alert"><h3>Harita açılamadı</h3><p>{hata}</p></div></section>;
  }

  const odak = noktalar.find((n) => n.sira === secili) ?? noktalar[noktalar.length - 1];
  // SVG'de y aşağı; bulutların çok dışına düşen nokta kenarda kalsın
  const sik = (v) => Math.max(-SINIR + 0.06, Math.min(SINIR - 0.06, v));
  const yX = (x) => sik(x), yY = (y) => sik(-y);

  return (
    <section className="harita" aria-labelledby="harita-h">
      <div className="ornek-bas">
        <h2 id="harita-h">Ses haritası</h2>
        <span className="istaka-meta num">{noktalar.length ? `${noktalar.length} nokta` : "Henüz nokta yok"}</span>
      </div>
      <div className="harita-ic">
        <div className="harita-cizim">
          {!harita ? <p className="harita-bos">Harita yükleniyor</p> : (
            <svg viewBox={`${-SINIR} ${-SINIR} ${2 * SINIR} ${2 * SINIR}`} role="img"
                 aria-label="Dört kişinin ses bulutları ve senin konuşmaların">
              {[-1, -0.5, 0, 0.5, 1].map((v) => (
                <g key={v} className="izgara">
                  <line x1={v} x2={v} y1={-SINIR} y2={SINIR} />
                  <line y1={v} y2={v} x1={-SINIR} x2={SINIR} />
                </g>
              ))}
              {harita.noktalar.map(([k, x, y], i) => (
                <Nokta key={i} ad={sekilAdi(isimler, k)} x={yX(x)} y={yY(y)} r={0.018}
                       className="bulut" style={renk(isimler[k])} />
              ))}
              {merkezler.map(([x, y], k) => (
                <g key={k} className="bulut-adi" style={renk(isimler[k])}>
                  <rect x={yX(x) - 0.13} y={yY(y) - 0.2} width={0.26} height={0.09} />
                  <text x={yX(x)} y={yY(y) - 0.135}>{isimYaz(isimler[k])}</text>
                </g>
              ))}
              {noktalar.map((n) => {
                const odakta = n === odak;
                return (
                  <g key={n.sira} className={`canli-nokta${n.tanindi ? "" : " bilinmeyen"}${odakta ? " odak" : ""}`}
                     style={n.tanindi ? renk(isimler[n.kisi]) : {}} onClick={() => setSecili(n.sira)}>
                    {odakta && <circle cx={yX(n.x)} cy={yY(n.y)} r={0.09} className="halka" />}
                    {n.tanindi
                      ? <Nokta ad={sekilAdi(isimler, n.kisi)} x={yX(n.x)} y={yY(n.y)} r={0.045} />
                      : <rect x={yX(n.x) - 0.045} y={yY(n.y) - 0.045} width={0.09} height={0.09} />}
                    <text x={yX(n.x)} y={yY(n.y) + 0.016}>{n.sira}</text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>

        <div className="harita-yan">
          {!odak ? (
            <div className="notice">
              <h3>Konuş, noktan düşsün</h3>
              <p>Model her 2 saniyelik sesi 192 sayıyla özetler. Harita bunu 2 boyuta indirir: aynı kişinin sesleri bir bulutta toplanır. Başlat&apos;a bas ve konuş; her taş haritaya numaralı bir nokta olarak düşer.</p>
            </div>
          ) : (
            <>
              <div className="harita-odak" style={odak.tanindi ? renk(isimler[odak.kisi]) : {}} data-bilinmeyen={!odak.tanindi}>
                <span className="shape">{odak.tanindi ? <Sekil ad={sekilAdi(isimler, odak.kisi)} boy={28} /> : <BilinmeyenSekil boy={28} />}</span>
                <small>{odak.sira}. taş</small>
                <b>{odak.tanindi ? isimYaz(isimler[odak.kisi]) : "Tanıyamadım"}</b>
                <span>Model {yuzde(odak.guven)} emin</span>
              </div>
              <h3 className="benzer-h">Hangi buluta ne kadar benziyor</h3>
              <div className="benzerlik">
                {isimler.map((id, k) => (
                  <div key={id} className="benzer" style={renk(id)}>
                    <span className="lbl"><Sekil ad={sekilAdi(isimler, k)} boy={14} />{isimYaz(id)}</span>
                    <span className="bar">
                      <i style={{ width: `${Math.max(0, odak.benzerlik[k]) * 100}%` }} />
                      <em style={{ left: `${harita.tipik[k] * 100}%` }} title={`${isimYaz(id)}'in kendi kayıtları: ${sayi2(harita.tipik[k])}`} />
                    </span>
                    <span className="pct num">{sayi2(odak.benzerlik[k])}</span>
                  </div>
                ))}
              </div>
              <p className="legend-note">
                1 = aynı ses, 0 = ilgisiz. Kesik çizgi, o kişinin modelin eğitimde görmediği kayıtlarının tipik benzerliği.
                Çubuk çizgiye yetişmiyorsa ses o kişiye pek benzemiyor. Bir noktaya dokununca o taşı gösterir.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
