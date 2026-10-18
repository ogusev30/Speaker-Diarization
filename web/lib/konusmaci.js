// Kim konuştu? Eğitimdeki (scripts/modeller.py) adımların aynısı, tarayıcı için.
// Bir konuşma -> 2 sn'lik pencereler (0,5 sn kaydırma) -> model -> her 0,5 sn'lik dilimin kişisi -> taşlar.

export const SR = 16000;
export const PENCERE = 2 * SR; // 32000 örnek
export const KAYDIRMA = SR / 2; // 8000 örnek
export const ESIK = 0.6; // bunun altında "Tanıyamadım"

// RMS'i -20 dBFS'e getir, sonra [-1, 1]'e kırp (labels.json: "each 2 s window RMS-normalised to -20 dBFS then clipped")
export function seviyeEsitle(x, hedefDbfs = -20) {
  let t = 0;
  for (let i = 0; i < x.length; i++) t += x[i] * x[i];
  const rms = Math.sqrt(t / x.length);
  const y = new Float32Array(x.length);
  if (rms < 1e-6) {
    y.set(x);
    return y;
  }
  const g = 10 ** (hedefDbfs / 20) / rms;
  for (let i = 0; i < x.length; i++) y[i] = Math.max(-1, Math.min(1, x[i] * g));
  return y;
}

// Konuşma -> [n * 32000] pencereler. 2 sn'den kısa konuşma sessizlikle doldurulur.
export function pencereler(ses) {
  let x = ses;
  if (x.length < PENCERE) {
    x = new Float32Array(PENCERE);
    x.set(ses);
  }
  const n = Math.floor((x.length - PENCERE) / KAYDIRMA) + 1;
  const out = new Float32Array(n * PENCERE);
  for (let i = 0; i < n; i++) out.set(seviyeEsitle(x.subarray(i * KAYDIRMA, i * KAYDIRMA + PENCERE)), i * PENCERE);
  return { veri: out, n };
}

// Pencere olasılıkları [n * nKisi] -> konuşmanın her 0,5 sn'lik diliminin olasılığı
// (dilimin üstüne düşen pencerelerin ortalaması; pencerelerin kapsamadığı son dilimler son pencereyi alır)
export function dilimler(olas, n, nKisi, uzunluk) {
  const adim = PENCERE / KAYDIRMA; // bir pencere 4 dilimi kapsar
  const nDilim = Math.ceil(Math.max(uzunluk, 1) / KAYDIRMA);
  const toplam = new Float64Array(nDilim * nKisi);
  const sayi = new Float64Array(nDilim);
  for (let i = 0; i < n; i++) {
    for (let d = i; d < Math.min(i + adim, nDilim); d++) {
      for (let k = 0; k < nKisi; k++) toplam[d * nKisi + k] += olas[i * nKisi + k];
      sayi[d] += 1;
    }
  }
  const sonuc = [];
  for (let d = 0; d < nDilim; d++) {
    const p = new Array(nKisi);
    for (let k = 0; k < nKisi; k++) {
      p[k] = sayi[d] ? toplam[d * nKisi + k] / sayi[d] : olas[(n - 1) * nKisi + k];
    }
    sonuc.push(p);
  }
  return sonuc;
}

// Dilimler -> taşlar: art arda aynı kişi birleşir. bas/bit saniye, p: taşın ortalama olasılıkları.
export function taslar(dilimOlas, uzunluk, baslangicSn = 0) {
  const sure = uzunluk / SR;
  const out = [];
  dilimOlas.forEach((p, d) => {
    let kisi = 0;
    p.forEach((v, k) => { if (v > p[kisi]) kisi = k; });
    const bas = baslangicSn + d * 0.5;
    const bit = baslangicSn + Math.min((d + 1) * 0.5, sure);
    const son = out[out.length - 1];
    if (son && son.kisi === kisi) {
      son.bit = bit;
      son.dilim.push(p);
    } else {
      out.push({ bas, bit, kisi, dilim: [p] });
    }
  });
  return out.map(({ bas, bit, kisi, dilim }) => {
    const p = dilim[0].map((_, k) => dilim.reduce((a, q) => a + q[k], 0) / dilim.length);
    return { bas, bit, kisi, guven: p[kisi], p, tanindi: p[kisi] >= ESIK };
  });
}
