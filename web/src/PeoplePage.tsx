import { useState } from "react";
import type { PersonDto } from "@finshark/shared";
import { useActor } from "./context.tsx";
import { apiFetch, errorText } from "./api.ts";
import { ErrorNote } from "./ui.tsx";
import { Text } from "./Value.tsx";

/** One-field form that adds a person to the household. */
export function AddPersonForm({
  onAdded,
  label = "Add person",
  askRoles = false,
}: {
  onAdded: (p: PersonDto) => void | Promise<void>;
  label?: string;
  /** Show the owns-accounts and uses-FinShark choices. Without them the person is both. */
  askRoles?: boolean;
}) {
  const [name, setName] = useState("");
  const [ownsAccounts, setOwnsAccounts] = useState(true);
  const [usesApp, setUsesApp] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (name.trim() === "") return setError("Enter a name.");
    if (!ownsAccounts && !usesApp) return setError("Choose at least one: owns accounts or uses FinShark.");
    setBusy(true);
    try {
      const p = await apiFetch<PersonDto>("/api/people", { method: "POST", body: { displayName: name.trim(), ownsAccounts, usesApp } });
      setName("");
      setError(null);
      await onAdded(p);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); void add(); }}>
      <div className="row">
        <input type="text" dir="auto" placeholder="Name" aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" disabled={busy}>{label}</button>
      </div>
      {askRoles && (
        <div className="row">
          <RoleChecks ownsAccounts={ownsAccounts} usesApp={usesApp} onChange={(o, u) => { setOwnsAccounts(o); setUsesApp(u); }} />
        </div>
      )}
      <ErrorNote>{error}</ErrorNote>
    </form>
  );
}

function RoleChecks({ ownsAccounts, usesApp, onChange }: { ownsAccounts: boolean; usesApp: boolean; onChange: (ownsAccounts: boolean, usesApp: boolean) => void }) {
  return (
    <>
      <label className="inline"><input type="checkbox" checked={ownsAccounts} onChange={(e) => onChange(e.target.checked, usesApp)} /> Owns accounts</label>{" "}
      <label className="inline"><input type="checkbox" checked={usesApp} onChange={(e) => onChange(ownsAccounts, e.target.checked)} /> Uses FinShark</label>
    </>
  );
}

function PersonRow({ person, current, onChanged }: { person: PersonDto; current: boolean; onChanged: () => Promise<void> }) {
  const { mutate } = useActor();
  const [editing, setEditing] = useState(false);
  const [ownsAccounts, setOwnsAccounts] = useState(person.ownsAccounts);
  const [usesApp, setUsesApp] = useState(person.usesApp);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startEdit = () => {
    setOwnsAccounts(person.ownsAccounts);
    setUsesApp(person.usesApp);
    setError(null);
    setEditing(true);
  };
  const save = async () => {
    if (!ownsAccounts && !usesApp) return setError("Choose at least one: owns accounts or uses FinShark.");
    setBusy(true);
    try {
      await mutate(() => apiFetch<PersonDto>(`/api/people/${person.id}/roles`, { method: "PUT", body: { ownsAccounts, usesApp } }));
      await onChanged();
      setEditing(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr>
      <td>
        <Text>{person.displayName}</Text>
        {current && <span className="muted"> (using FinShark now)</span>}
      </td>
      {editing ? (
        <>
          <td colSpan={2}><RoleChecks ownsAccounts={ownsAccounts} usesApp={usesApp} onChange={(o, u) => { setOwnsAccounts(o); setUsesApp(u); }} /></td>
          <td>
            <button type="button" onClick={() => void save()} disabled={busy}>Save</button>{" "}
            <button type="button" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
            <ErrorNote>{error}</ErrorNote>
          </td>
        </>
      ) : (
        <>
          <td>{person.ownsAccounts ? "Yes" : <span className="muted">No</span>}</td>
          <td>{person.usesApp ? "Yes" : <span className="muted">No</span>}</td>
          <td><button type="button" onClick={startEdit}>Edit</button></td>
        </>
      )}
    </tr>
  );
}

export function PeoplePage({ people, personId, onAdded }: { people: PersonDto[]; personId: string; onAdded: () => Promise<void> }) {
  return (
    <section>
      <h1>People</h1>
      <p>
        <strong>Owns accounts</strong>: can be the owner of an account, or the person a number such as W-2 wages belongs to.{" "}
        <strong>Uses FinShark</strong>: can be chosen as the person using the app. FinShark records who did what; it is not a
        password, and everyone sees everything.
      </p>
      <table className="data">
        <thead>
          <tr><th>Name</th><th>Owns accounts</th><th>Uses FinShark</th><th /></tr>
        </thead>
        <tbody>
          {people.map((p) => <PersonRow key={p.id} person={p} current={String(p.id) === personId} onChanged={onAdded} />)}
        </tbody>
      </table>
      <div className="panel">
        <h3>Add a person</h3>
        <AddPersonForm onAdded={onAdded} askRoles />
      </div>
    </section>
  );
}
