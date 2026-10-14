import { useState } from "react";
import type { PersonDto } from "@finshark/shared";
import { apiFetch, errorText } from "./api.ts";
import { ErrorNote } from "./ui.tsx";
import { Text } from "./Value.tsx";

/** One-field form that adds a person to the household. */
export function AddPersonForm({ onAdded, label = "Add person" }: { onAdded: (p: PersonDto) => void | Promise<void>; label?: string }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (name.trim() === "") return setError("Enter a name.");
    setBusy(true);
    try {
      const p = await apiFetch<PersonDto>("/api/people", { method: "POST", body: { displayName: name.trim() } });
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
      <ErrorNote>{error}</ErrorNote>
    </form>
  );
}

export function PeoplePage({ people, personId, onAdded }: { people: PersonDto[]; personId: string; onAdded: () => Promise<void> }) {
  return (
    <section>
      <h1>People</h1>
      <p>
        Everyone in the household who checks or changes numbers. FinShark records who did what; it is not a password,
        and everyone sees everything.
      </p>
      <ul>
        {people.map((p) => (
          <li key={p.id}>
            <Text>{p.displayName}</Text>
            {String(p.id) === personId && <span className="muted"> (using FinShark now)</span>}
          </li>
        ))}
      </ul>
      <div className="panel">
        <h3>Add a person</h3>
        <AddPersonForm onAdded={onAdded} />
      </div>
    </section>
  );
}
