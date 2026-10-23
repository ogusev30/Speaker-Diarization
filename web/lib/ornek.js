// Örnek sohbet: kayıtlı bir sohbeti modele verir, doğru cevapla (RTTM) karşılaştırır.
// Adımlar scripts/modeller.py diarize() ile aynı: bütün ses 2 sn pencere / 0,5 sn kaydırma, sonra VAD bölgelerinde her 0,5 sn'lik dilimin en olası kişisi.
import { KAYDIRMA, SR } from "./konusmaci";

// 16 bit PCM WAV -> Float32Array (sohbetler zaten 16 kHz mono, yeniden örnekleme yok)
export function wavOku(buf) {
  const v = new DataView(buf);
  let o = 12;
  while (o < v.byteLength - 8) {
    const ad = String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
    const boy = v.getUint32(o + 4, true);
    if (ad === "data") {
      const n = Math.floor(Math.min(boy, v.byteLength - o - 8) / 2);
      const x = new Float32Array(n);
      for (let i = 0; i < n; i++) x[i] = v.getInt16(o + 8 + 2 * i, true) / 32768;
      return x;
    }
    o += 8 + boy + (boy % 2);
  }
  throw new Error("WAV okunamadı");
}

// dilimOlas: dilimler() çıktısı, hazir: kaç dilim kesinleşti. -> [{bas, bit, kisi, guven}] (bitişik aynı kişi birleşik)
export function tahminParcalari(dilimOlas, hazir, konusma) {
  const dilimSn = KAYDIRMA / SR;
  const out = [];
  for (const [b, e] of konusma) {
    let t = b;
    while (t < e) {
      const k = Math.min(Math.floor(t / dilimSn + 1e-9), dilimOlas.length - 1);
      if (k < 0 || k >= hazir) return out;
      const sinir = Math.min(e, (k + 1) * dilimSn);
      const p = dilimOlas[k];
      let j = 0;
      p.forEach((x, i) => { if (x > p[j]) j = i; });
      const son = out[out.length - 1];
      if (son && son.kisi === j && Math.abs(son.bit - t) < 1e-6) {
        son.bit = sinir;
        son.g.push(p[j]);
      } else {
        out.push({ bas: t, bit: sinir, kisi: j, g: [p[j]] });
      }
      t = sinir;
    }
  }
  return out;
}

const KARE = 0.01; // DER 10 ms'lik karelerle

// Her karede kim konuşuyor (-1: kimse). parcalar: [{bas, bit, kisi}]
function kareler(parcalar, n) {
  const k = new Int8Array(n).fill(-1);
  for (const p of parcalar) {
    for (let i = Math.round(p.bas / KARE); i < Math.min(n, Math.round(p.bit / KARE)); i++) k[i] = p.kisi;
  }
  return k;
}

// 0..sn arası DER: (kaçırılan + fazladan + yanlış kişi) / gerçek konuşma. Hatalı bölgeler de döner.
export function derHesapla(gercek, tahmin, sn) {
  const n = Math.floor(sn / KARE);
  const r = kareler(gercek, n), h = kareler(tahmin, n);
  let konusma = 0, kacan = 0, fazla = 0, yanlis = 0;
  const hatalar = [];
  for (let i = 0; i < n; i++) {
    if (r[i] >= 0) konusma++;
    const hata = r[i] >= 0 && h[i] < 0 ? "kacan" : r[i] < 0 && h[i] >= 0 ? "fazla" : r[i] >= 0 && r[i] !== h[i] ? "yanlis" : null;
    if (hata === "kacan") kacan++;
    else if (hata === "fazla") fazla++;
    else if (hata === "yanlis") yanlis++;
    if (!hata) continue;
    const son = hatalar[hatalar.length - 1];
    if (son && son.tur === hata && son.bitK === i) son.bitK = i + 1;
    else hatalar.push({ tur: hata, basK: i, bitK: i + 1 });
  }
  return {
    der: konusma ? (kacan + fazla + yanlis) / konusma : null,
    konusma: konusma * KARE, kacan: kacan * KARE, fazla: fazla * KARE, yanlis: yanlis * KARE,
    hatalar: hatalar.map((x) => ({ tur: x.tur, bas: x.basK * KARE, bit: x.bitK * KARE })),
  };
}
