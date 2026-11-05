"use client";

import { useEffect, useRef, useState } from "react";
import { Contact, MAX_CONTACTS as MAX, loadContacts as load, normalisePhone, saveContacts as save, sendToContacts } from "@/lib/contacts";
import Icon from "./Icon";
import { pl, t } from "@/lib/i18n";

/**
 * "Send to all": one tap opens the phone's SMS app with every trusted contact filled in and the
 * message (route, ETA, current location) written. Websites cannot send messages on their own, and
 * WhatsApp links take one number, so SMS is the only way to reach several people in one step;
 * the person still presses send in their messaging app.
 *
 * Contacts live only in this browser's localStorage. They are never sent to Ghar Tak's server.
 */
interface ContactsApi {
  select(props: string[], opts: { multiple: boolean }): Promise<{ name?: string[]; tel?: string[] }[]>;
}

export default function TrustedContacts({ text }: { text: string }) {
  const [list, setList] = useState<Contact[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => setList(load()), []);

  const update = (next: Contact[]) => {
    setList(next);
    save(next);
  };

  const sendAll = async () => {
    if (!list.length) {
      dialog.current?.showModal();
      return;
    }
    setBusy(true);
    setStatus(t("Getting your location…"));
    const { located } = await sendToContacts(list, text);
    setBusy(false);
    setStatus(
      t(located ? "Opening your messages app for {n} contacts with your current location. Press send there." : "Opening your messages app for {n} contacts (location not shared). Press send there.", { n: list.length }),
    );
  };

  const canPick = typeof navigator !== "undefined" && "contacts" in navigator;

  return (
    <>
      <button type="button" className="btn primary" onClick={sendAll} disabled={busy}>
        <Icon name="users" />
        {list.length ? t(pl(list.length, "Send to {n} contact", "Send to {n} contacts"), { n: list.length }) : t("Send to my people")}
      </button>
      {list.length > 0 && (
        <button type="button" className="link" onClick={() => dialog.current?.showModal()}>
          {t("Edit contacts")}
        </button>
      )}
      {status && <p className="share-status" aria-live="polite">{status}</p>}
      <ContactsDialog
        ref={dialog}
        list={list}
        canPick={canPick}
        onChange={update}
      />
    </>
  );
}

export function ContactsDialog({
  ref, list, canPick, onChange,
}: {
  ref: React.RefObject<HTMLDialogElement | null>;
  list: Contact[];
  canPick: boolean;
  onChange: (l: Contact[]) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = (entries: Contact[]) => {
    const merged = [...list];
    for (const e of entries) {
      if (merged.length >= MAX) break;
      if (!merged.some((m) => m.phone === e.phone)) merged.push(e);
    }
    onChange(merged);
  };

  const addManual = (ev: React.FormEvent) => {
    ev.preventDefault();
    const p = normalisePhone(phone);
    if (!p) {
      setError("Enter a 10-digit Indian mobile number, or a full number with country code.");
      return;
    }
    add([{ name: name.trim() || p, phone: p }]);
    setName("");
    setPhone("");
    setError(null);
  };

  const pick = async () => {
    try {
      const picked = await (navigator as Navigator & { contacts: ContactsApi }).contacts.select(["name", "tel"], { multiple: true });
      const entries: Contact[] = [];
      for (const c of picked) {
        const p = c.tel?.map(normalisePhone).find(Boolean);
        if (p) entries.push({ name: c.name?.[0] ?? p, phone: p });
      }
      add(entries);
    } catch {
      // the person closed the picker
    }
  };

  return (
    <dialog ref={ref} className="contacts" aria-labelledby="contacts-title">
      <form method="dialog" className="contacts-head">
        <h2 id="contacts-title">{t("Trusted contacts")}</h2>
        <button className="link">{t("Done")}</button>
      </form>
      <p className="note">
        {t("Saved only on this device; Ghar Tak never receives them. “Send to all” opens your SMS app with everyone filled in, plus your route, arrival time and current location. You press send.")}
      </p>
      {list.length > 0 ? (
        <ul className="contact-list">
          {list.map((c) => (
            <li key={c.phone}>
              <span>
                {c.name}
                <span className="muted"> {c.phone}</span>
              </span>
              <button type="button" className="link" onClick={() => onChange(list.filter((x) => x.phone !== c.phone))}>
                {t("Remove")}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{t("No contacts yet.")}</p>
      )}
      {canPick && list.length < MAX && (
        <button type="button" className="btn" onClick={pick}>{t("Pick from phone contacts")}</button>
      )}
      {list.length < MAX && (
        <form className="contact-form" onSubmit={addManual}>
          <input aria-label={t("Name")} placeholder={t("Name")} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
          <input
            aria-label={t("Phone number")} placeholder={t("Phone, e.g. 98xxxxxx10")} inputMode="tel" value={phone}
            onChange={(e) => setPhone(e.target.value)} maxLength={20} required
          />
          <button className="btn">{t("Add")}</button>
        </form>
      )}
      {error && <p className="error-inline">{error}</p>}
    </dialog>
  );
}
