"use client";
// Sol üstteki menü: üç mod arasında geçiş. Seçilen mod adres çubuğunda (#ornek, #harita) kalır.
import { useEffect, useRef, useState } from "react";

export const MODLAR = [
  { id: "canli", ad: "Canlı dinle", acik: "Mikrofona konuş, ıstakaya taş dizilsin.", sekil: "square" },
  { id: "ornek", ad: "Örnek sohbet", acik: "Dört kişinin kayıtlı sohbeti çalar. Model dinler, gerçek cevapla yan yana görürsün.", sekil: "triangle" },
  { id: "harita", ad: "Ses haritası", acik: "Konuşman dört kişinin ses bulutlarından hangisine düşüyor?", sekil: "diamond" },
];

function Ikon({ sekil }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" fill="currentColor" stroke="var(--ink)" strokeWidth="2.5">
      {sekil === "square" && <rect x="2" y="2" width="18" height="18" />}
      {sekil === "triangle" && <polygon points="11,2 20,20 2,20" />}
      {sekil === "diamond" && <polygon points="11,1.5 20.5,11 11,20.5 1.5,11" />}
    </svg>
  );
}

export default function Menu({ mod, setMod }) {
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
        </ul>
      )}
    </nav>
  );
}
