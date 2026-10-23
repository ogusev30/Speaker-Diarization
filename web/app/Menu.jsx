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
  const kok = useRef(null);
  const dugme = useRef(null);

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
