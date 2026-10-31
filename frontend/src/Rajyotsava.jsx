import { useLang } from "./i18n.jsx";

/* The Karnataka (Kannada) flag: a yellow band over a red band. The cloth is drawn as thin strips that ripple one
 * after another; with reduced motion they stay still (see styles.css). */
const STRIPS = 22;

export function KannadaFlag({ width = 78, className = "" }) {
  const w = 90;
  const h = 60;
  const sw = w / STRIPS;
  return (
    <svg className={"kn-flag " + className} width={width} height={(width * h) / w} viewBox={`-5 -3 ${w + 6} ${h + 6}`} role="img" aria-label="Karnataka flag">
      <rect x="-3" y="-3" width="2.4" height={h + 6} rx="1.2" fill="#6b4a1e" />
      <g>
        {Array.from({ length: STRIPS }, (_, i) => (
          <g key={i} className="kn-strip" style={{ animationDelay: `${i * -0.09}s` }}>
            <rect x={i * sw} y="0" width={sw + 0.6} height={h / 2} fill="#FFC400" />
            <rect x={i * sw} y={h / 2} width={sw + 0.6} height={h / 2} fill="#E4002B" />
          </g>
        ))}
      </g>
    </svg>
  );
}

/** Shown only in Kannada mode: a warm festival greeting for Kannada Rajyotsava (1 November). */
export default function Rajyotsava() {
  const { kn } = useLang();
  if (!kn) return null;
  return (
    <section className="rajyotsava" aria-label="Kannada Rajyotsava">
      <KannadaFlag width={84} />
      <div className="raj-text">
        <p className="raj-kn">ಕನ್ನಡ ರಾಜ್ಯೋತ್ಸವದ ಶುಭಾಶಯಗಳು</p>
        <p className="raj-sub">
          Happy Kannada Rajyotsava · ನವೆಂಬರ್ 1 · ಜೈ ಕರ್ನಾಟಕ ಮಾತೆ
        </p>
      </div>
      <KannadaFlag width={84} className="flip" />
    </section>
  );
}
