"use client";
// Sol üstteki menü: modlar arasında geçiş. Seçilen mod adres çubuğunda (#ornek, #harita, ...) kalır.
// En altta sahne modu: mod değil, canlı ekranı projektör için tam ekrana alır.
import { useEffect, useRef, useState } from "react";

export const MODLAR = [
  { id: "canli", ad: "Canlı dinle", acik: "Mikrofona konuş, ıstakaya taş dizilsin.", sekil: "square" },
  { id: "ornek", ad: "Örnek sohbet", acik: "Dört kişinin kayıtlı sohbeti çalar. Model dinler, gerçek cevapla yan yana görürsün.", sekil: "triangle" },
  { id: "harita", ad: "Ses haritası", acik: "Konuşman dört kişinin ses bulutlarından hangisine düşüyor?", sekil: "diamond" },
  { id: "oyun", ad: "Taklit oyunu", acik: "Bir taş çekilir. O kişi gibi konuş, modelin ona verdiği yüzde puanın olur.", sekil: "circle" },
  { id: "rapor", ad: "Sohbet raporu", acik: "Canlı dinlemenin özeti: kim kaç kez söz aldı, kim kimden sonra konuştu.", sekil: "bars" },
];

// Renk temaları: tasarım aynı, sadece palet değişir (globals.css, :root[data-tema]). Örnek: çuha, ahşap, fildişi, üç taş rengi
export const TEMALAR = [
  { id: "klasik", ad: "Klasik", o: ["#0E7A47", "#8A4B1F", "#FBF6E9", "#E3242B", "#FFC21A", "#1F4FD8"] },
  { id: "eski", ad: "Eski ıstaka", o: ["#5F6B3E", "#7A5233", "#EFE2C0", "#B5462F", "#D4A03A", "#355A86"] },
  { id: "gece", ad: "Gece kahvesi", o: ["#1C2B4A", "#4A3426", "#F2EEE3", "#F0353C", "#FFC933", "#3366F0"] },
  { id: "bordo", ad: "Kahvehane", o: ["#7B1F2B", "#A86E33", "#FBF3E2", "#E3242B", "#FFC21A", "#1F4FD8"] },
];
const TEMA_ANAHTAR = "sira-kimde-tema";

function temaUygula(id) {
  const kok = document.documentElement;
  if (id === "klasik") delete kok.dataset.tema;
  else kok.dataset.tema = id;
  // Telefonun adres çubuğu da çuha renginde olsun
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", TEMALAR.find((t) => t.id === id).o[0]);
  try { localStorage.setItem(TEMA_ANAHTAR, id); } catch { /* gizli pencere: sadece bu sayfada kalır */ }
}

function Ikon({ sekil }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" fill="currentColor" stroke="var(--ink)" strokeWidth="2.5">
      {sekil === "square" && <rect x="2" y="2" width="18" height="18" />}
      {sekil === "triangle" && <polygon points="11,2 20,20 2,20" />}
      {sekil === "diamond" && <polygon points="11,1.5 20.5,11 11,20.5 1.5,11" />}
      {sekil === "circle" && <circle cx="11" cy="11" r="9.5" />}
      {sekil === "bars" && <><rect x="2" y="10" width="5" height="10" /><rect x="8.5" y="3" width="5" height="17" /><rect x="15" y="7" width="5" height="13" /></>}
      {sekil === "screen" && <><rect x="1.5" y="3" width="19" height="13" /><path d="M7 20h8M11 16v4" fill="none" /></>}
    </svg>
  );
}

export default function Menu({ mod, setMod, sahneAc }) {
  const [acik, setAcik] = useState(false);
  const [tema, setTema] = useState("klasik");
  const kok = useRef(null);
  const dugme = useRef(null);

  useEffect(() => {
    const t = document.documentElement.dataset.tema ?? "klasik";
    setTema(t);
    if (t !== "klasik") document.querySelector('meta[name="theme-color"]')?.setAttribute("content", TEMALAR.find((x) => x.id === t)?.o[0]);
  }, []);

  useEffect(() => {
    if (!acik) return;
    const disari = (e) => { if (!kok.current?.contains(e.target)) setAcik(false); };
    const tus = (e) => { if (e.key === "Escape") { setAcik(false); dugme.current?.focus(); } };
    document.addEventListener("pointerdown", disari);
    document.addEventListener("keydown", tus);
    kok.current?.querySelector("[aria-current='page']")?.focus();
    return () => {
      document.removeEventListener("pointerdown", disari);
      document.removeEventListener("keydown", tus);
    };
  }, [acik]);

  return (
    <nav className="menu" ref={kok}>
      <button ref={dugme} className="menu-dugme" aria-expanded={acik} aria-controls="menu-liste"
              aria-label={acik ? "Menüyü kapat" : "Menüyü aç"} onClick={() => setAcik((a) => !a)}>
        <svg width="26" height="22" viewBox="0 0 26 22" aria-hidden="true" stroke="currentColor" strokeWidth="4">
          {acik ? <path d="M4 2l18 18M22 2L4 20" /> : <path d="M1 3h24M1 11h24M1 19h24" />}
        </svg>
      </button>
      {acik && (
        <ul id="menu-liste" className="menu-liste">
          {MODLAR.map((m) => (
            <li key={m.id}>
              <button aria-current={m.id === mod ? "page" : undefined} data-mod={m.id}
                      onClick={() => { setMod(m.id); setAcik(false); }}>
                <Ikon sekil={m.sekil} />
                <span><b>{m.ad}</b><small>{m.acik}</small></span>
              </button>
            </li>
          ))}
          <li className="menu-tema">
            <h3 id="tema-h">Renk teması</h3>
            <div className="tema-sec" role="group" aria-labelledby="tema-h">
              {TEMALAR.map((t) => (
                <button key={t.id} aria-pressed={tema === t.id} onClick={() => { temaUygula(t.id); setTema(t.id); }}
                        style={{ "--o-felt": t.o[0], "--o-wood": t.o[1], "--o-ivory": t.o[2], "--o-c1": t.o[3], "--o-c2": t.o[4], "--o-c3": t.o[5] }}>
                  <span className="tema-ornek" aria-hidden="true"><i /><i /><i /></span>
                  <b>{t.ad}</b>
                </button>
              ))}
            </div>
          </li>
          <li className="menu-ayrac">
            <button data-mod="sahne" onClick={() => { sahneAc(); setAcik(false); }}>
              <Ikon sekil="screen" />
              <span><b>Sahne modu</b><small>Tam ekran, dev isim ve ıstaka. Projektörde sınıfın arkasından okunur. Kısayol F.</small></span>
            </button>
          </li>
        </ul>
      )}
    </nav>
  );
}
