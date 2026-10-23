// Kazanan model (Model B: ECAPA + sınıflandırıcı) tarayıcıda: ham ses -> kişilerin olasılıkları.
import * as ort from "onnxruntime-web/wasm";
import { PENCERE, dilimler, pencereler, taslar } from "./konusmaci";

const EMB = 192; // ECAPA embedding uzunluğu

// ORT ve VAD mutlak yol ister. BASE_PATH sadece sunucudaki önizleme için (/lab/absproxy/<port>); Vercel'de boş.
export const adres = (yol) => `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH || ""}${yol}`;

export function ortAyarla() {
  ort.env.wasm.wasmPaths = adres("/ort/");
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  ort.env.logLevel = "error";
}

// İlerlemeyi göstererek indirir: ilerleme(inenByte, toplamByte)
async function indir(url, ilerleme) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} indirilemedi (${r.status})`);
  const toplam = Number(r.headers.get("content-length")) || 0;
  if (!r.body) return new Uint8Array(await r.arrayBuffer());
  const okuyucu = r.body.getReader();
  const parcalar = [];
  let inen = 0;
  for (;;) {
    const { done, value } = await okuyucu.read();
    if (done) break;
    parcalar.push(value);
    inen += value.length;
    ilerleme(inen, toplam);
  }
  const out = new Uint8Array(inen);
  let o = 0;
  for (const p of parcalar) { out.set(p, o); o += p.length; }
  return out;
}

export async function modelYukle(ilerleme) {
  ortAyarla();
  const bilgi = await (await fetch(adres("/models/labels.json"))).json();
  const veri = await indir(adres(`/models/${bilgi.model}`), ilerleme);
  const oturum = await ort.InferenceSession.create(veri, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  return { oturum, bilgi };
}

// Pencereler -> olasılıklar [n * kişi] ve embedding'ler [n * 192]. 8'erli gruplar halinde modele verilir.
// her8(bitenPencere) her gruptan sonra çağrılır (örnek sohbet ilerledikçe gösterebilsin).
export async function pencereleriCalistir(model, veri, n, her8) {
  const nKisi = model.bilgi.labels.length;
  const olas = new Float32Array(n * nKisi);
  const emb = new Float32Array(n * EMB);
  for (let i = 0; i < n; i += 8) {
    const b = Math.min(8, n - i);
    const girdi = new ort.Tensor("float32", veri.subarray(i * PENCERE, (i + b) * PENCERE), [b, PENCERE]);
    const out = await model.oturum.run({ waveform: girdi });
    olas.set(out.probs.data, i * nKisi);
    emb.set(out.embedding.data, i * EMB);
    her8?.(i + b, olas, emb);
  }
  return { olas, emb };
}

// Bir konuşma (16 kHz Float32Array) -> taşlar. Her taşa, ortası taşın içine düşen pencerelerin embedding ortalaması eklenir (ses haritası için).
export async function konusmayiTani(model, ses, baslangicSn) {
  const { veri, n } = pencereler(ses);
  const nKisi = model.bilgi.labels.length;
  const t0 = performance.now();
  const { olas, emb } = await pencereleriCalistir(model, veri, n);
  const msPencere = (performance.now() - t0) / n;
  const sonuc = taslar(dilimler(olas, n, nKisi, ses.length), ses.length, baslangicSn).map((t) => {
    const orta = (i) => baslangicSn + i * 0.5 + 1; // pencerenin ortası (sn)
    let secilen = [];
    for (let i = 0; i < n; i++) if (orta(i) >= t.bas && orta(i) <= t.bit) secilen.push(i);
    if (!secilen.length) {
      let en = 0;
      for (let i = 1; i < n; i++) if (Math.abs(orta(i) - (t.bas + t.bit) / 2) < Math.abs(orta(en) - (t.bas + t.bit) / 2)) en = i;
      secilen = [en];
    }
    const e = new Float32Array(EMB);
    for (const i of secilen) for (let j = 0; j < EMB; j++) e[j] += emb[i * EMB + j] / secilen.length;
    return { ...t, emb: e };
  });
  return { taslar: sonuc, msPencere, n };
}
