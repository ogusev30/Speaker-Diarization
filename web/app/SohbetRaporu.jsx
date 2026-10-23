"use client";
// Durdur'dan sonra ıstakanın altında: kim kaç kez söz aldı, en uzun konuşma, kim kimden sonra konuştu, RTTM / CSV indir.
import { BilinmeyenSekil, Sekil, isimYaz, renk, sekilAdi, sure } from "./ortak";

const sn1 = (x) => x.toFixed(1).replace(".", ",");

// Art arda aynı kişinin taşları tek söz sayılır. kisi: -1 = Tanıyamadım
function sozler(taslar) {
  const out = [];
  for (const t of taslar) {
    const kisi = t.tanindi ? t.kisi : -1;
    const son = out[out.length - 1];
    if (son && son.kisi === kisi) son.bit = t.bit;
    else out.push({ kisi, bas: t.bas, bit: t.bit });
  }
  return out;
}

function indir(ad, metin, tur) {
  const url = URL.createObjectURL(new Blob([metin], { type: tur }));
  const a = document.createElement("a");
  a.href = url;
  a.download = ad;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function SohbetRaporu({ isimler, taslar }) {
  const s = sozler(taslar);
  const ad = (k) => (k < 0 ? "Tanıyamadım" : isimYaz(isimler[k]));
  const sayi = new Map();
  for (const x of s) sayi.set(x.kisi, (sayi.get(x.kisi) ?? 0) + 1);
  const sirali = [...sayi.entries()].sort((a, b) => b[1] - a[1]);
  const enUzun = s.reduce((a, x) => (x.bit - x.bas > a.bit - a.bas ? x : a), s[0]);
  const gecis = new Map();
  for (let i = 1; i < s.length; i++) {
    const k = `${s[i - 1].kisi}>${s[i].kisi}`;
    gecis.set(k, (gecis.get(k) ?? 0) + 1);
  }
  const gecisler = [...gecis.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, n]) => [...k.split(">").map(Number), n]);

  const etiket = (k) => (k < 0 ? "bilinmeyen" : isimler[k]);
  const rttm = () => taslar.map((t) =>
    `SPEAKER sira_kimde 1 ${t.bas.toFixed(3)} ${(t.bit - t.bas).toFixed(3)} <NA> <NA> ${etiket(t.tanindi ? t.kisi : -1)} <NA> <NA>`).join("\n") + "\n";
  const csv = () => ["bas_sn,bit_sn,kisi,guven," + isimler.join(","),
    ...taslar.map((t) => [t.bas.toFixed(2), t.bit.toFixed(2), etiket(t.tanindi ? t.kisi : -1), t.guven.toFixed(3), ...t.p.map((v) => v.toFixed(3))].join(","))]
    .join("\n") + "\n";

  const Kim = ({ k, boy = 16 }) => (
    <span className="rapor-kim" style={k < 0 ? {} : renk(isimler[k])} data-bilinmeyen={k < 0}>
      {k < 0 ? <BilinmeyenSekil boy={boy} /> : <Sekil ad={sekilAdi(isimler, k)} boy={boy} />}{ad(k)}
    </span>
  );

  return (
    <div className="rapor" aria-labelledby="rapor-h">
      <h3 id="rapor-h">Sohbet raporu <span className="num">{s.length} söz, {sure(taslar[taslar.length - 1].bit)}</span></h3>
      <div className="rapor-ic">
        <div>
          <h4>Kaç kez söz aldı</h4>
          <dl>
            {sirali.map(([k, n]) => <div key={k}><dt><Kim k={k} /></dt><dd className="num">{n}</dd></div>)}
          </dl>
        </div>
        <div>
          <h4>En uzun konuşma</h4>
          <p className="rapor-buyuk num">{sn1(enUzun.bit - enUzun.bas)} sn</p>
          <p><Kim k={enUzun.kisi} />, {sure(enUzun.bas)} ile {sure(enUzun.bit)} arası</p>
        </div>
        <div>
          <h4>Kim kimden sonra</h4>
          {gecisler.length ? (
            <dl>
              {gecisler.map(([a, b, n]) => (
                <div key={`${a}-${b}`}><dt><Kim k={a} /><span aria-label="sonra">&rarr;</span><Kim k={b} /></dt><dd className="num">{n} kez</dd></div>
              ))}
            </dl>
          ) : <p>Tek kişi konuştu, söz hiç el değiştirmedi.</p>}
        </div>
      </div>
      <div className="rapor-indir">
        <button className="kucuk" onClick={() => indir("sira_kimde.rttm", rttm(), "text/plain")}>RTTM indir</button>
        <button className="kucuk" onClick={() => indir("sira_kimde.csv", csv(), "text/csv")}>CSV indir</button>
        <span>RTTM, DER hesaplamada kullanılan standart diarization dosyası. CSV her taşın dört kişiye verdiği olasılıkları da içerir.</span>
      </div>
    </div>
  );
}
