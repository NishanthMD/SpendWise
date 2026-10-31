import { Bunny } from "./Critters.jsx";

/** A helpful empty state, with the bunny peeking over its edge. */
export default function Empty({ title, children, tips, compact = false }) {
  return (
    <section className={"empty" + (compact ? " compact" : "")}>
      <div className="empty-art">
        <Bunny tips={tips} size={compact ? 96 : 128} align="start" />
      </div>
      <div className="empty-text">
        <h2>{title}</h2>
        {children}
      </div>
    </section>
  );
}
