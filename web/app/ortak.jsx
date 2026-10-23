// Üç modun (canlı, örnek sohbet, ses haritası) ortak parçaları
export const SEKILLER = { cem: "square", elif: "triangle", onur: "circle", zehra: "diamond" };
const YEDEK_SEKILLER = ["square", "triangle", "circle", "diamond"];
export const sekilAdi = (isimler, k) => SEKILLER[isimler[k]] ?? YEDEK_SEKILLER[k % YEDEK_SEKILLER.length];

export const yuzde = (x) => "%" + Math.round(x * 100);
export const sure = (sn) => `${Math.floor(sn / 60)}:${String(Math.floor(sn % 60)).padStart(2, "0")}`;
export const isimYaz = (id) => id.charAt(0).toLocaleUpperCase("tr") + id.slice(1);
export const renk = (id) => ({ "--c": `var(--${id}, #6B6B6B)`, "--on": `var(--${id}-on, #FFFFFF)` });

export function Sekil({ ad, boy = 22 }) {
  const s = boy, h = 1.5;
  const govde = {
    square: <rect x={h} y={h} width={s - 3} height={s - 3} />,
    triangle: <polygon points={`${s / 2},${h} ${s - h},${s - h} ${h},${s - h}`} />,
    circle: <circle cx={s / 2} cy={s / 2} r={s / 2 - h} />,
    diamond: <polygon points={`${s / 2},${h} ${s - h},${s / 2} ${s / 2},${s - h} ${h},${s / 2}`} />,
  }[ad];
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="3">
      {govde}
    </svg>
  );
}

export function BilinmeyenSekil({ boy = 22 }) {
  return (
    <svg width={boy} height={boy} viewBox="0 0 22 22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="3">
      <rect x="1.5" y="1.5" width="19" height="19" strokeDasharray="4 3" />
      <path d="M8 8.5a3 3 0 1 1 4 2.8c-.7.3-1 .8-1 1.5V14M11 16.5v1.5" />
    </svg>
  );
}

