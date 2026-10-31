import { useEffect, useRef, useState } from "react";

/* A small original cast, drawn as inline SVG: thick rounded outlines, flat fills from the app palette, and a
 * slight hand-drawn wobble (one shared displacement filter, see CritterDefs).
 *
 * Every animal has an idle loop (CSS). Click or tap one and it changes feeling, one step at a time:
 * happy, in love, surprised, sad, cross, sleepy, winking, then back to itself. Each feeling redraws the eyes
 * and mouth, adds a small floating mark (hearts, sparkles, an anger mark...) and a little body movement, and
 * the speech bubble gives one short tip. The feeling fades back to normal after a few seconds.
 * With prefers-reduced-motion the CSS animations are off, which leaves each one in a resting pose; the
 * feelings still change, they just do not move. The bubble never takes pointer events, so an animal can never
 * block a chart or table beside it.
 */

export const EMOTIONS = ["happy", "love", "surprised", "sad", "angry", "sleepy", "wink"];
const FEELING = { happy: "happy", love: "in love", surprised: "surprised", sad: "sad", angry: "cross", sleepy: "sleepy", wink: "winking" };
const RESET_MS = 9000;

/** Render once near the root. Other SVGs reference the filter by id. */
export function CritterDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <defs>
        <filter id="sw-wobble" x="-6%" y="-6%" width="112%" height="112%">
          <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="3" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Faces: eyes and mouth for every feeling, shared by the whole cast                                 */
/* ---------------------------------------------------------------------------------------------- */
const heart = (x, y, s) =>
  `M${x} ${y + s * 0.9} C${x - s * 1.7} ${y - s * 0.1} ${x - s * 0.8} ${y - s * 1.5} ${x} ${y - s * 0.5} C${x + s * 0.8} ${y - s * 1.5} ${x + s * 1.7} ${y - s * 0.1} ${x} ${y + s * 0.9} Z`;

/**
 * eyes: [[x, y], ...]   r: pupil radius   mouth: [x, y] (drawn only when a feeling is active)   mw: half mouth width
 * With no feeling, the eyes are plain dots, which is how every animal looks at rest.
 */
function Face({ emotion, eyes, r = 3, mouth, mw = 5 }) {
  const mid = eyes.reduce((a, e) => a + e[0], 0) / eyes.length;
  const eye = ([x, y], i) => {
    const side = eyes.length === 1 ? 1 : x < mid ? 1 : -1; // +1 for the left eye, -1 for the right one
    const dot = <circle key={i} cx={x} cy={y} r={r} className="f-ink nostroke" />;
    const arc = (up) => (
      <path key={i} className="eye-line" d={up ? `M${x - r * 1.3} ${y + r * 0.7} q${r * 1.3} ${-r * 2.1} ${r * 2.6} 0` : `M${x - r * 1.3} ${y - r * 0.3} q${r * 1.3} ${r * 1.9} ${r * 2.6} 0`} />
    );
    const brow = (inner) => (
      <path key={"b" + i} className="eye-line brow" d={`M${x - r * 1.7 * side} ${y - r * (inner ? 3.4 : 1.8)} L${x + r * 1.5 * side} ${y - r * (inner ? 1.8 : 3.4)}`} />
    );
    switch (emotion) {
      case "happy":
        return arc(true);
      case "sleepy":
        return arc(false);
      case "love":
        return <path key={i} d={heart(x, y, r * 1.35)} className="heart-eye" />;
      case "surprised":
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={r * 1.55} className="f-ink nostroke" />
            <circle cx={x - r * 0.45} cy={y - r * 0.5} r={r * 0.5} fill="#fff" stroke="none" />
          </g>
        );
      case "sad":
        return (
          <g key={i}>
            {dot}
            {brow(false)}
          </g>
        );
      case "angry":
        return (
          <g key={i}>
            {dot}
            {brow(true)}
          </g>
        );
      case "wink":
        return i === eyes.length - 1 ? arc(true) : dot;
      default:
        return dot;
    }
  };
  const [mx, my] = mouth || [0, 0];
  const smile = `M${mx - mw} ${my} q${mw} ${mw * 1.2} ${mw * 2} 0`;
  const frown = `M${mx - mw} ${my + mw * 0.5} q${mw} ${-mw * 1.1} ${mw * 2} 0`;
  return (
    <g className="face">
      {eyes.map(eye)}
      {mouth && ["happy", "love", "wink"].includes(emotion) && <path className="eye-line" d={smile} />}
      {mouth && emotion === "sad" && <path className="eye-line" d={frown} />}
      {mouth && emotion === "angry" && <path className="eye-line" d={`M${mx - mw} ${my + 1} q${mw} ${-mw * 0.5} ${mw * 2} -1`} />}
      {mouth && emotion === "surprised" && <ellipse cx={mx} cy={my + 1} rx={mw * 0.42} ry={mw * 0.62} className="f-ink nostroke" />}
      {mouth && emotion === "sleepy" && <path className="eye-line" d={`M${mx - mw * 0.5} ${my} h${mw}`} />}
      {emotion === "sad" && <path className="tear" d={`M${eyes[0][0]} ${eyes[0][1] + r * 1.6} q${r * 1.1} ${r * 1.9} 0 ${r * 2.6} q${-r * 1.1} ${-r * 0.7} 0 ${-r * 2.6} z`} />}
    </g>
  );
}

/** A small floating mark near the head that goes with the feeling. */
function Fx({ emotion, at }) {
  if (!emotion || !at) return null;
  const [x, y] = at;
  const star = (cx, cy, s, d) => (
    <path
      key={`${cx}${cy}`}
      className="fx-star"
      style={{ animationDelay: `${d}s` }}
      d={`M${cx} ${cy - s} L${cx + s * 0.28} ${cy - s * 0.28} L${cx + s} ${cy} L${cx + s * 0.28} ${cy + s * 0.28} L${cx} ${cy + s} L${cx - s * 0.28} ${cy + s * 0.28} L${cx - s} ${cy} L${cx - s * 0.28} ${cy - s * 0.28} Z`}
    />
  );
  return (
    <g className={`fx fx-${emotion}`} pointerEvents="none">
      {emotion === "happy" && [star(x - 14, y + 4, 5, 0), star(x + 4, y - 8, 7, 0.25), star(x + 20, y + 6, 4, 0.5)]}
      {emotion === "wink" && [star(x + 6, y, 7, 0), star(x - 8, y + 10, 4, 0.3)]}
      {emotion === "love" && [0, 1, 2].map((i) => <path key={i} className="fx-heart" style={{ animationDelay: `${i * 0.35}s` }} d={heart(x - 14 + i * 14, y + (i % 2) * 8, 4.2)} />)}
      {emotion === "surprised" && (
        <text x={x} y={y + 8} className="fx-text" textAnchor="middle" fontSize="26">
          !
        </text>
      )}
      {emotion === "angry" && <path className="fx-anger" d={`M${x - 6} ${y - 6} q4 4 0 8 M${x + 6} ${y - 6} q-4 4 0 8 M${x - 8} ${y + 4} q4 -4 8 0 M${x - 8} ${y - 8} q4 4 8 0`} />}
      {emotion === "sleepy" && (
        <g className="fx-zz">
          <text x={x - 8} y={y + 10} fontSize="14">
            z
          </text>
          <text x={x + 6} y={y} fontSize="18">
            z
          </text>
        </g>
      )}
      {emotion === "sad" && <path className="fx-cloud" d={`M${x - 14} ${y + 6} q-2 -9 8 -8 q3 -9 14 -3 q10 -2 10 7 q4 5 -2 6 h-26 q-6 0 -4 -2 z`} />}
    </g>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* The clickable wrapper                                                                             */
/* ---------------------------------------------------------------------------------------------- */
function Critter({ name, label, tips = [], size = 112, align = "start", className = "", fx, children }) {
  const [say, setSay] = useState(null);
  const [emotion, setEmotion] = useState(null);
  const [poke, setPoke] = useState(0);
  const next = useRef(0);
  const sayTimer = useRef(null);
  const emoTimer = useRef(null);

  useEffect(() => () => [sayTimer, emoTimer].forEach((t) => clearTimeout(t.current)), []);

  function tap() {
    const list = tips.filter(Boolean);
    if (list.length) setSay(list[next.current++ % list.length]);
    setPoke((n) => n + 1);
    // happy -> in love -> surprised -> sad -> cross -> sleepy -> winking -> back to itself
    setEmotion((cur) => {
      const i = cur ? EMOTIONS.indexOf(cur) + 1 : 0;
      return i >= EMOTIONS.length ? null : EMOTIONS[i];
    });
    clearTimeout(sayTimer.current);
    sayTimer.current = setTimeout(() => setSay(null), 4500);
    clearTimeout(emoTimer.current);
    emoTimer.current = setTimeout(() => setEmotion(null), RESET_MS);
  }

  return (
    <div className={`critter critter-${name} bubble-${align} ${className}${emotion ? ` emo-${emotion}` : ""}`} style={{ width: size }}>
      {say && (
        <span className="bubble" role="status">
          {say}
        </span>
      )}
      <span className="sr-only" role="status">
        {emotion ? `${label} looks ${FEELING[emotion]}.` : ""}
      </span>
      <button type="button" className="critter-btn" aria-label={`${label}. Tap for a tip and to change how it feels.`} onClick={tap}>
        <svg className={"cr" + (poke ? ` poke-${poke % 2 ? "a" : "b"}` : "")} viewBox="0 0 120 120" width={size} height={size} aria-hidden="true">
          <g filter="url(#sw-wobble)">
            {children(emotion)}
            <Fx emotion={emotion} at={fx} />
          </g>
        </svg>
      </button>
    </div>
  );
}

/* ---------------------------------- Piggy bank: savings, upload success ---------------------------------- */
export function Piggy({ tips, size, align, celebrate = false }) {
  return (
    <Critter name="pig" label="Piggy bank" tips={tips} size={size} align={align} className={celebrate ? "celebrate" : ""} fx={[84, 22]}>
      {(emo) => (
        <g className="cr-react">
          <g className="pig-coin">
            <circle cx="52" cy="22" r="10" className="f-amber" />
            <path d="M52 17 V27" strokeWidth="3" />
          </g>
          <g className="pig-body">
            <path d="M22 66 C10 62 10 48 20 48 C28 48 26 58 20 56" className="nofill" />
            <rect x="36" y="86" width="13" height="18" rx="6" className="f-pink-d" />
            <rect x="72" y="86" width="13" height="18" rx="6" className="f-pink-d" />
            <ellipse cx="58" cy="68" rx="40" ry="29" className="f-pink" />
            <path d="M66 42 L72 24 L86 44 Z" className="f-pink-d" />
            <ellipse cx="100" cy="72" rx="12" ry="10" className="f-pink-d" />
            <circle cx="97" cy="72" r="1.8" className="f-ink nostroke" />
            <circle cx="104" cy="72" r="1.8" className="f-ink nostroke" />
            <Face emotion={emo} eyes={[[86, 58]]} r={3.4} mouth={[95, 87]} mw={5} />
            <path d="M42 46 H62" strokeWidth="5" />
          </g>
        </g>
      )}
    </Critter>
  );
}

/* ---------------------------------- Cat: asleep, stirring, or alert (until you click it) ---------------------------------- */
export function Cat({ mood = "asleep", tips, size, align }) {
  return (
    <Critter name="cat" label={mood === "alert" ? "Cat, wide awake" : mood === "stirring" ? "Cat, one eye open" : "Cat, napping"} tips={tips} size={size} align={align} className={`mood-${mood}`} fx={[44, 22]}>
      {(emo) => {
        const alert = !emo && mood === "alert";
        const half = !emo && mood === "stirring";
        return (
          <g className="cr-react">
            <g className="cat-body">
              {alert ? (
                <>
                  <path d="M100 92 C122 90 122 62 104 66" className="nofill cat-tail" strokeWidth="15" />
                  <path d="M100 92 C122 90 122 62 104 66" className="nofill f-none-cat" stroke="var(--c-cat)" strokeWidth="7" />
                </>
              ) : (
                <path d="M100 94 C116 96 112 110 90 110 L68 110" className="nofill cat-tail" strokeWidth="5" />
              )}
              <ellipse cx="62" cy="90" rx="42" ry="22" className="f-cat" />
              <path d="M78 70 q4 8 0 14 M90 74 q4 8 0 14" className="nofill" strokeWidth="3" />
              <g className="cat-head">
                <path d="M24 50 L22 26 L42 42 Z" className="f-cat" />
                <path d="M52 42 L64 26 L62 54 Z" className="f-cat" />
                <circle cx="42" cy="66" r="24" className="f-cat" />
                <path d="M40 74 l3 4 l3 -4 z" className="f-pink-d" strokeWidth="2" />
                {emo ? (
                  <Face emotion={emo} eyes={[[32, 62], [53, 62]]} r={3.4} mouth={[43, 83]} mw={5} />
                ) : alert ? (
                  <>
                    <circle cx="32" cy="62" r="7.5" className="f-white" />
                    <circle cx="53" cy="62" r="7.5" className="f-white" />
                    <circle cx="33" cy="63" r="3.2" className="f-ink nostroke" />
                    <circle cx="52" cy="63" r="3.2" className="f-ink nostroke" />
                    <ellipse cx="43" cy="84" rx="3.5" ry="4.5" className="f-ink nostroke" />
                  </>
                ) : half ? (
                  <>
                    <circle cx="32" cy="63" r="5.5" className="f-white" />
                    <circle cx="33" cy="64" r="2.4" className="f-ink nostroke" />
                    <path d="M48 64 q5 4 10 0" className="nofill" strokeWidth="3.5" />
                    <path d="M38 80 q5 3 10 0" className="nofill" strokeWidth="3" />
                  </>
                ) : (
                  <>
                    <path d="M26 64 q6 5 12 0 M47 64 q6 5 12 0" className="nofill" strokeWidth="3.5" />
                    <path d="M38 80 q5 3 10 0" className="nofill" strokeWidth="3" />
                  </>
                )}
              </g>
            </g>
            {!emo &&
              (alert ? (
                <path d="M96 44 q6 8 0 12 q-6 -4 0 -12 z" className="f-blue-l sweat" strokeWidth="2.5" />
              ) : (
                <g className="zz" fill="var(--line)" stroke="none" fontFamily="var(--display)" fontWeight="700">
                  <text x="74" y="46" fontSize="16" className="z1">
                    z
                  </text>
                  <text x="88" y="32" fontSize="20" className="z2">
                    z
                  </text>
                  {!half && (
                    <text x="102" y="16" fontSize="24" className="z3">
                      z
                    </text>
                  )}
                </g>
              ))}
          </g>
        );
      }}
    </Critter>
  );
}

/* ---------------------------------- Squirrel: the daily-average calculator ---------------------------------- */
export function Squirrel({ tips, size, align }) {
  return (
    <Critter name="squirrel" label="Squirrel with an acorn" tips={tips} size={size} align={align} fx={[52, 14]}>
      {(emo) => (
        <g className="cr-react">
          <path className="f-brown sq-tail" d="M74 100 C116 104 120 50 92 38 C78 32 80 54 88 60 C92 66 84 72 78 70" />
          <ellipse cx="52" cy="80" rx="24" ry="28" className="f-brown-l" />
          <ellipse cx="52" cy="86" rx="13" ry="18" className="f-cream" />
          <circle cx="52" cy="44" r="19" className="f-brown-l" />
          <circle cx="40" cy="28" r="7" className="f-brown-l" />
          <circle cx="64" cy="28" r="7" className="f-brown-l" />
          <Face emotion={emo} eyes={[[45, 44], [60, 44]]} r={2.8} mouth={[52, 58]} mw={4.5} />
          <ellipse cx="52" cy="53" rx="3.5" ry="2.6" className="f-ink nostroke" />
          <g className="sq-nut">
            <circle cx="52" cy="76" r="9.5" className="f-amber" />
            <path d="M42 72 q10 -11 20 0 z" className="f-brown" />
          </g>
          <path d="M34 78 q4 -6 10 -4 M70 78 q-4 -6 -10 -4" className="nofill" strokeWidth="3.5" />
          <rect x="38" y="104" width="12" height="9" rx="4" className="f-brown-l" />
          <rect x="56" y="104" width="12" height="9" rx="4" className="f-brown-l" />
        </g>
      )}
    </Critter>
  );
}

/* ---------------------------------- Owl: reminders due today ---------------------------------- */
export function Owl({ tips, size, align }) {
  return (
    <Critter name="owl" label="Owl" tips={tips} size={size} align={align} fx={[100, 24]}>
      {(emo) => (
        <g className="cr-react">
          <path d="M10 108 H110" className="nofill" strokeWidth="5" />
          <path d="M46 104 v6 M70 104 v6" className="nofill" strokeWidth="4" />
          <ellipse cx="60" cy="70" rx="32" ry="36" className="f-blue-l" />
          <ellipse cx="60" cy="82" rx="19" ry="22" className="f-cream" />
          <path d="M44 84 q5 4 10 0 M62 84 q5 4 10 0 M52 96 q8 4 16 0" className="nofill" strokeWidth="2.5" />
          <path d="M30 70 C18 76 22 96 34 94 Z M90 70 C102 76 98 96 86 94 Z" className="f-blue" />
          <g className="owl-head">
            <path d="M34 42 L30 20 L50 34 Z M86 42 L90 20 L70 34 Z" className="f-blue-l" />
            <circle cx="46" cy="52" r="13" className="f-white" />
            <circle cx="74" cy="52" r="13" className="f-white" />
            <Face emotion={emo} eyes={[[48, 53], [72, 53]]} r={5} />
            <path d="M60 58 l-6 8 h12 z" className="f-amber" strokeWidth="3" />
            {!emo && (
              <g className="owl-lids" stroke="none" fill="var(--c-blue-l)">
                <circle cx="46" cy="52" r="12.5" className="lid" />
                <circle cx="74" cy="52" r="12.5" className="lid" />
              </g>
            )}
          </g>
        </g>
      )}
    </Critter>
  );
}

/* ---------------------------------- Turtle: loading ---------------------------------- */
export function Turtle({ tips, size = 72, align }) {
  return (
    <Critter name="turtle" label="Turtle" tips={tips} size={size} align={align} fx={[96, 38]}>
      {(emo) => (
        <g className="cr-react">
          <g className="tu-legs">
            <rect className="leg leg-a" x="30" y="86" width="13" height="16" rx="6" fill="var(--c-green-d)" />
            <rect className="leg leg-b" x="68" y="86" width="13" height="16" rx="6" fill="var(--c-green-d)" />
          </g>
          <path d="M16 84 l-9 5 l9 3" className="f-green-d" />
          <g className="tu-head">
            <circle cx="100" cy="68" r="13" className="f-green-d" />
            <Face emotion={emo} eyes={[[104, 65]]} r={2.6} mouth={[102, 76]} mw={4} />
            {!emo && <path d="M100 74 q4 3 8 0" className="nofill" strokeWidth="2.5" />}
          </g>
          <path d="M18 88 C18 44 40 36 58 36 C80 36 94 52 94 88 Z" className="f-green" />
          <path d="M34 88 C34 66 40 52 58 50 C76 52 82 66 82 88 M58 50 V88 M34 70 H82" className="nofill" strokeWidth="2.5" />
        </g>
      )}
    </Critter>
  );
}

/** A turtle that walks across while something loads. Under reduced motion it rests at the start. */
export function TurtleLoader({ text = "Loading…" }) {
  return (
    <div className="turtle-loader" role="status" aria-live="polite">
      <div className="turtle-track">
        <div className="turtle-mover">
          <Turtle size={64} tips={["Slow and steady. I am reading every row.", "Nothing leaves this computer."]} />
        </div>
      </div>
      <span>{text}</span>
    </div>
  );
}

/* ---------------------------------- Bunny: peeks over the edge of empty states ---------------------------------- */
export function Bunny({ tips, size = 120, align }) {
  return (
    <Critter name="bunny" label="Bunny" tips={tips} size={size} align={align} fx={[100, 40]}>
      {(emo) => (
        <g className="cr-react">
          <g className="bun-head">
            <ellipse className="bun-ear ear-l f-white" cx="46" cy="30" rx="8" ry="22" />
            <ellipse className="bun-ear ear-r f-white" cx="76" cy="30" rx="8" ry="22" />
            <ellipse cx="46" cy="32" rx="3.5" ry="14" className="f-pink nostroke" />
            <ellipse cx="76" cy="32" rx="3.5" ry="14" className="f-pink nostroke" />
            <circle cx="61" cy="70" r="26" className="f-white" />
            <g className={emo ? "" : "bun-eyes"}>
              <Face emotion={emo} eyes={[[51, 68], [71, 68]]} r={3.2} mouth={[61, 86]} mw={5} />
            </g>
            <path d="M57 77 h8 l-4 5 z" className="f-pink-d" strokeWidth="2" />
            <path d="M34 76 h-10 M34 82 l-9 3 M88 76 h10 M88 82 l9 3" className="nofill" strokeWidth="2" />
          </g>
          <rect x="6" y="92" width="108" height="30" rx="8" className="f-cream" />
          <ellipse cx="46" cy="94" rx="9" ry="6" className="f-white" />
          <ellipse cx="76" cy="94" rx="9" ry="6" className="f-white" />
        </g>
      )}
    </Critter>
  );
}
