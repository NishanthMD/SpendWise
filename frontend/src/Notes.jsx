import { useEffect, useState } from "react";
import { api } from "./api";
import Empty from "./Empty.jsx";
import { useLang } from "./i18n.jsx";
import { longDate } from "./format";

export default function Notes() {
  const { t } = useLang();
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState({ title: "", body: "" });
  const [editing, setEditing] = useState(null); // {id, title, body}
  const [error, setError] = useState("");

  const load = () =>
    api
      .notes()
      .then(setNotes)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  async function add(e) {
    e.preventDefault();
    if (!draft.body.trim()) return;
    try {
      await api.addNote(draft.title.trim(), draft.body.trim());
      setDraft({ title: "", body: "" });
      load();
    } catch (x) {
      setError(x.message);
    }
  }

  async function save(e) {
    e.preventDefault();
    try {
      await api.editNote(editing.id, editing.title.trim(), editing.body.trim());
      setEditing(null);
      load();
    } catch (x) {
      setError(x.message);
    }
  }

  async function remove(id) {
    await api.deleteNote(id);
    load();
  }

  return (
    <section aria-labelledby="notes-h" className="narrow">
      <h2 id="notes-h">{t("Notes")}</h2>
      <p className="hint">{t("Jot down why a month was expensive, a budget idea, or something to check. Tick \"Include my notes\" when you download the report to add them.")}</p>
      <form className="note-form" onSubmit={add}>
        <label className="field">
          <span className="field-label">{t("Title (optional)")}</span>
          <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">{t("Note")}</span>
          <textarea rows={3} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} required />
        </label>
        <button className="btn primary">{t("Save note")}</button>
      </form>
      {error && <p className="msg err">{error}</p>}
      {notes.length === 0 ? (
        <Empty compact title={t("No notes yet")} tips={[t("Why was a month expensive? Write it down."), t("Notes can ride along in the PDF report.")]}>
          <p>{t("Your first note will show up here.")}</p>
        </Empty>
      ) : (
        <ul className="plain">
          {notes.map((n) => (
            <li key={n.id} className="note">
              {editing?.id === n.id ? (
                <form onSubmit={save} className="note-form">
                  <input aria-label={t("Title")} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
                  <textarea aria-label={t("Note")} rows={3} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} required />
                  <div className="row-gap">
                    <button className="btn primary">{t("Save changes")}</button>
                    <button type="button" className="btn" onClick={() => setEditing(null)}>
                      {t("Cancel")}
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="row-between">
                    <h3>{n.title || t("Untitled note")}</h3>
                    <small>{longDate(n.created_at.slice(0, 10))}</small>
                  </div>
                  <p className="pre">{n.body}</p>
                  <div className="row-gap">
                    <button className="link" onClick={() => setEditing({ id: n.id, title: n.title || "", body: n.body })}>
                      {t("Edit")}
                    </button>
                    <button className="link" onClick={() => remove(n.id)}>
                      {t("Delete")}
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
