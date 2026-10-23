// Ses haritası: 192 sayılık embedding -> 2 boyut (LDA, scripts/web_ornek.py) ve kişilerin merkezine benzerlik.
import { adres } from "./model";

export async function haritaYukle() {
  const r = await fetch(adres("/models/harita.json"));
  if (!r.ok) throw new Error(`harita.json indirilemedi (${r.status})`);
  return r.json();
}

function normalize(e) {
  let t = 0;
  for (const x of e) t += x * x;
  const n = Math.sqrt(t) || 1;
  return Array.from(e, (x) => x / n);
}

// -> { x, y, benzerlik: [kişi başına kosinüs benzerliği] }
export function yerlestir(harita, emb) {
  const e = normalize(emb);
  const [ex, ey] = harita.eksen;
  let x = 0, y = 0;
  for (let j = 0; j < e.length; j++) {
    const d = e[j] - harita.ort[j];
    x += d * ex[j];
    y += d * ey[j];
  }
  const benzerlik = harita.merkez.map((m) => m.reduce((a, v, j) => a + v * e[j], 0));
  return { x, y, benzerlik };
}
