import { useEffect, useState } from "react";
import type { PersonDto } from "@finshark/shared";
import { AccountsPage } from "./AccountsPage.tsx";
import { apiFetch, errorText, fetchSession, setActingPerson } from "./api.ts";
import { ActorProvider, RefDataProvider } from "./context.tsx";
import { DemoPage } from "./DemoPage.tsx";
import { DocumentsPage } from "./DocumentsPage.tsx";
import { DocumentView } from "./DocumentView.tsx";
import { FactHistory, FactsPage } from "./FactsPage.tsx";
import { ReviewPage } from "./ReviewPage.tsx";
import { parseHash, type Route } from "./route.ts";
import { ErrorNote } from "./ui.tsx";
import { Text } from "./Value.tsx";

const NAV = [
  { label: "Documents", href: "#/documents", pages: ["documents", "document"] },
  { label: "Review", href: "#/review", pages: ["review"] },
  { label: "Facts", href: "#/facts", pages: ["facts", "fact"] },
  { label: "Accounts", href: "#/accounts", pages: ["accounts"] },
] as const;

function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function App() {
  const [personId, setPersonId] = useState<string | null | undefined>(undefined); // undefined = loading
  const [people, setPeople] = useState<PersonDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSession().then(
      async (s) => {
        try {
          setPeople((await apiFetch<{ people: PersonDto[] }>("/api/people")).people);
          setPersonId(s.personId);
        } catch (e) {
          setError(errorText(e));
        }
      },
      () => setError("Not signed in. Open FinShark using the link printed by the launcher."),
    );
  }, []);

  if (error) return <main className="center"><p className="error">{error}</p></main>;
  if (personId === undefined || people === null) return <main className="center"><p>Loading...</p></main>;

  if (people.length === 0) return <SetupPeople onDone={setPeople} />;

  if (personId === null) {
    return (
      <main className="center">
        <h1>Who's using FinShark?</h1>
        <p>This records who verifies and changes things. It is not a password.</p>
        <div className="people">
          {people.map((p) => (
            <button
              key={p.id}
              onClick={() => setActingPerson(String(p.id)).then(() => setPersonId(String(p.id)), () => setError("Could not save your choice."))}
            >
              <Text>{p.displayName}</Text>
            </button>
          ))}
        </div>
      </main>
    );
  }

  return (
    <ActorProvider personId={personId} setPersonId={setPersonId} people={people}>
      <RefDataProvider>
        <Shell people={people} personId={personId} onSwitch={() => setPersonId(null)} />
      </RefDataProvider>
    </ActorProvider>
  );
}

function SetupPeople({ onDone }: { onDone: (p: PersonDto[]) => void }) {
  const [added, setAdded] = useState<PersonDto[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    if (name.trim() === "") return;
    try {
      const p = await apiFetch<PersonDto>("/api/people", { method: "POST", body: { displayName: name.trim() } });
      setAdded([...added, p]);
      setName("");
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <main className="center">
      <h1>Welcome to FinShark</h1>
      <p>Who will use this? Add everyone in the household who will check or change numbers. FinShark records who did what. It is not a password.</p>
      <form onSubmit={(e) => { e.preventDefault(); void add(); }} className="row">
        <input type="text" dir="auto" placeholder="Name" aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <button type="submit">Add person</button>
      </form>
      <ErrorNote>{error}</ErrorNote>
      {added.length > 0 && (
        <>
          <ul>{added.map((p) => <li key={p.id}><Text>{p.displayName}</Text></li>)}</ul>
          <button className="primary" onClick={() => onDone(added)}>Continue</button>
        </>
      )}
    </main>
  );
}

function Shell({ people, personId, onSwitch }: { people: PersonDto[]; personId: string; onSwitch: () => void }) {
  const route = useRoute();
  const person = people.find((p) => String(p.id) === personId);
  return (
    <div className="shell">
      <header>
        <strong className="brand">FinShark</strong>
        <nav>
          {NAV.map((n) => (
            <a key={n.label} href={n.href} className={(n.pages as readonly string[]).includes(route.page) ? "active" : undefined}>
              {n.label}
            </a>
          ))}
        </nav>
        <span className="who">
          <Text>{person?.displayName ?? personId}</Text> <button onClick={onSwitch}>Switch</button>
        </span>
      </header>
      <main>
        <Page route={route} />
      </main>
      <footer><a href="#/demo">Viewer demo</a></footer>
    </div>
  );
}

function Page({ route }: { route: Route }) {
  switch (route.page) {
    case "documents": return <DocumentsPage />;
    case "document": return <DocumentView id={route.id} factId={route.factId} />;
    case "review": return <ReviewPage startFactId={route.factId} />;
    case "facts": return <FactsPage filters={route.filters} />;
    case "fact": return <FactHistory id={route.id} />;
    case "accounts": return <AccountsPage />;
    case "demo": return <DemoPage />;
  }
}
