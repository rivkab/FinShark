import { useEffect, useState } from "react";
import { fetchSession, setActingPerson } from "./api.ts";
import { DemoPage } from "./DemoPage.tsx";
import { PEOPLE } from "./people.ts";

const NAV = ["Documents", "Review", "Facts", "Accounts", "Queries", "Backups"] as const;
type Page = (typeof NAV)[number];

export function App() {
  const [page, setPage] = useState<Page>("Documents");
  const [personId, setPersonId] = useState<string | null | undefined>(undefined); // undefined = loading
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSession().then(
      (s) => setPersonId(s.personId),
      () => setError("Not signed in. Open FinShark using the link printed by the launcher."),
    );
  }, []);

  if (error) return <main className="center"><p className="error">{error}</p></main>;
  if (personId === undefined) return <main className="center"><p>Loading...</p></main>;

  if (personId === null) {
    return (
      <main className="center">
        <h1>Who's using FinShark?</h1>
        <p>This records who verifies and changes things. It is not a password.</p>
        <div className="people">
          {PEOPLE.map((p) => (
            <button
              key={p.id}
              onClick={() => setActingPerson(p.id).then(() => setPersonId(p.id), () => setError("Could not save your choice."))}
            >
              {p.name}
            </button>
          ))}
        </div>
      </main>
    );
  }

  const person = PEOPLE.find((p) => p.id === personId);
  return (
    <div className="shell">
      <header>
        <strong className="brand">FinShark</strong>
        <nav>
          {NAV.map((n) => (
            <button key={n} className={n === page ? "active" : undefined} onClick={() => setPage(n)}>
              {n}
            </button>
          ))}
        </nav>
        <span className="who">
          {person?.name ?? personId} <button onClick={() => setPersonId(null)}>Switch</button>
        </span>
      </header>
      <main>
        {page === "Documents" ? <DemoPage /> : (
          <section>
            <h1>{page}</h1>
            <p>Coming soon.</p>
          </section>
        )}
      </main>
    </div>
  );
}
