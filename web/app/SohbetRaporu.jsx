"use client";
// Sohbet raporu: canlı dinlemedeki taşlardan özet. Art arda aynı kişinin taşları tek söz sayılır.
// Kim kimden sonra konuştu tablosu ve CSV / RTTM indirme (RTTM: eğitimdeki doğru cevap dosyalarıyla aynı biçim).
import { BilinmeyenSekil, Sekil, isimYaz, renk, sekilAdi, sure, yuzde } from "./ortak";

const sn1 = (x) => `${x.toFixed(1).replace(".", ",")} sn`;

function indir(ad, metin, tur) {
  const url = URL.createObjectURL(new Blob([metin], { type: tur }));
  const a = Object.assign(document.createElement("a"), { href: url, download: ad });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function SohbetRaporu({ bilgi, taslar, canliyaGit }) {
  const isimler = bilgi.labels;
  const B = isimler.length; // "Tanıyamadım" satırı
  const etiket = (t) => (t.tanindi ? t.kisi : B);
  const adi = (k) => (k === B ? "Tanıyamadım" : isimYaz(isimler[k]));

  if (!taslar.length) {
    return (
      <section className="rapor" aria-labelledby="rapor-h">
        <div className="ornek-bas"><h2 id="rapor-h">Sohbet raporu</h2></div>
        <div className="rapor-ic">
          <div className="notice">
            <h3>Henüz rapor yok</h3>
            <p>Rapor, canlı dinlemede ıstakaya dizilen taşlardan çıkar. Canlı dinle&apos;de birkaç kişi sırayla konuşsun, sonra buraya dön.</p>
            <button className="mic btn-tekrar" onClick={canliyaGit}>Canlı dinle&apos;ye git</button>
          </div>
        </div>
      </section>
    );
  }

  // Sözler: art arda aynı etiketli taşlar birleşir
  const sozler = [];
  for (const t of taslar) {
    const k = etiket(t);
    const son = sozler[sozler.length - 1];
    if (son && son.k === k && t.bas - son.bit < 1.5) son.bit = t.bit;
    else sozler.push({ k, bas: t.bas, bit: t.bit });
  }
  const kisi = Array.from({ length: B + 1 }, () => ({ soz: 0, toplam: 0, enUzun: 0 }));
  for (const s of sozler) {
    const d = s.bit - s.bas;
    kisi[s.k].soz += 1;
    kisi[s.k].toplam += d;
    kisi[s.k].enUzun = Math.max(kisi[s.k].enUzun, d);
  }
  const toplam = kisi.reduce((a, x) => a + x.toplam, 0);
  const enUzun = sozler.reduce((a, s) => (s.bit - s.bas > a.bit - a.bas ? s : a), sozler[0]);
  const enCok = kisi.slice(0, B).reduce((a, x, k) => (x.toplam > kisi[a].toplam ? k : a), 0);

  // Geçişler: satır önce konuşan, sütun hemen sonra konuşan
  const gecis = Array.from({ length: B + 1 }, () => new Array(B + 1).fill(0));
  for (let i = 1; i < sozler.length; i++) gecis[sozler[i - 1].k][sozler[i].k] += 1;
  const enCokGecis = Math.max(1, ...gecis.flatMap((r, a) => r.filter((_, b) => a !== b)));
  const satirlar = [...Array(B + 1).keys()].filter((k) => kisi[k].soz > 0);

  function csv() {
    const s = ["baslangic_sn,bitis_sn,kisi,tanindi,guven", ...taslar.map((t) =>
      [t.bas.toFixed(2), t.bit.toFixed(2), isimler[t.kisi], t.tanindi ? 1 : 0, t.guven.toFixed(3)].join(","))];
    indir("sohbet.csv", s.join("\n") + "\n", "text/csv");
  }
  function rttm() {
    const s = taslar.map((t) =>
      `SPEAKER canli 1 ${t.bas.toFixed(3)} ${(t.bit - t.bas).toFixed(3)} <NA> <NA> ${t.tanindi ? isimler[t.kisi] : "bilinmeyen"} <NA> <NA>`);
    indir("sohbet.rttm", s.join("\n") + "\n", "text/plain");
  }

  return (
    <section className="rapor" aria-labelledby="rapor-h">
      <div className="ornek-bas">
        <h2 id="rapor-h">Sohbet raporu</h2>
        <span className="istaka-meta num">{taslar.length} taş, {sozler.length} söz, {sure(toplam)}</span>
        <button className="kucuk" onClick={csv}>CSV indir</button>
        <button className="kucuk koyu" onClick={rttm}>RTTM indir</button>
      </div>

      <div className="rapor-ic">
        <div className="rapor-ozet">
          <div className="rapor-kart" style={renk(isimler[enCok])}>
            <small>En çok konuşan</small>
            <b>{isimYaz(isimler[enCok])}</b>
            <span className="num">{sure(kisi[enCok].toplam)}, toplam sürenin {yuzde(kisi[enCok].toplam / toplam)} kadarı</span>
          </div>
          <div className="rapor-kart" style={enUzun.k === B ? {} : renk(isimler[enUzun.k])} data-bilinmeyen={enUzun.k === B}>
            <small>En uzun tek konuşma</small>
            <b>{adi(enUzun.k)}</b>
            <span className="num">{sn1(enUzun.bit - enUzun.bas)}, {sure(enUzun.bas)} civarı</span>
          </div>
          <div className="rapor-kart" data-bilinmeyen="true">
            <small>Söz değişimi</small>
            <b className="num">{sozler.length - 1}</b>
            <span>kez söz başkasına geçti</span>
          </div>
        </div>

        <div className="rapor-alt">
          <div>
            <h3 className="benzer-h">Kişi kişi</h3>
            <table className="rapor-tablo">
              <thead><tr><th scope="col">Kişi</th><th scope="col">Söz</th><th scope="col">Toplam</th><th scope="col">En uzun</th></tr></thead>
              <tbody>
                {satirlar.map((k) => (
                  <tr key={k}>
                    <th scope="row">
                      <span className="rapor-kisi" style={k === B ? {} : renk(isimler[k])} data-bilinmeyen={k === B}>
                        {k === B ? <BilinmeyenSekil boy={14} /> : <Sekil ad={sekilAdi(isimler, k)} boy={14} />}{adi(k)}
                      </span>
                    </th>
                    <td className="num">{kisi[k].soz}</td>
                    <td className="num">{sure(kisi[k].toplam)}</td>
                    <td className="num">{sn1(kisi[k].enUzun)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="benzer-h">Kim kimden sonra konuştu</h3>
            {sozler.length < 2 ? <p className="legend-note">Tek bir söz var. Söz başkasına geçince burada görünür.</p> : (
              <div className="gecis-kap">
                <table className="rapor-tablo gecis">
                  <thead>
                    <tr><th scope="col"><span className="gecis-kose">önce / sonra</span></th>
                      {satirlar.map((k) => <th key={k} scope="col">{adi(k)}</th>)}</tr>
                  </thead>
                  <tbody>
                    {satirlar.map((a) => (
                      <tr key={a}>
                        <th scope="row">{adi(a)}</th>
                        {satirlar.map((b) => {
                          const n = gecis[a][b];
                          return (
                            <td key={b} className="num" data-bos={n === 0} data-en={a !== b && n === enCokGecis}
                                style={{ "--d": n / enCokGecis }} aria-label={`${adi(a)} sonrası ${adi(b)}: ${n}`}>
                              {a === b ? "" : n}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="legend-note">Satırdaki kişi sustuktan sonra sözü sütundaki kişi aldı. 1,5 saniyeden kısa arayla gelen aynı kişinin taşları tek söz sayılır.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
