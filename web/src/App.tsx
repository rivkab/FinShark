import { useEffect, useState } from "react";
import type { PersonDto } from "@finshark/shared";
import { AccountsPage } from "./AccountsPage.tsx";
import { apiFetch, errorText, fetchSession, setActingPerson } from "./api.ts";
import { ActorProvider, RefDataProvider } from "./context.tsx";
import { DemoPage } from "./DemoPage.tsx";
import { DesignPage } from "./DesignPage.tsx";
import { DocumentsPage } from "./DocumentsPage.tsx";
import { DocumentView } from "./DocumentView.tsx";
import { FactHistory, FactsPage } from "./FactsPage.tsx";
import { parseHash, type Route } from "./route.ts";
import { useAction, useLoad } from "./ui.tsx";
import { WhoIsUsing } from "./WhoIsUsing.tsx";
import type { DocumentDto } from "@finshark/shared";
import {
  Alert,
  AppHeader,
  AppShell,
  Brand,
  Button,
  DataText,
  Field,
  FieldRow,
  Form,
  Inline,
  Link,
  Loading,
  NavTabs,
  Page,
  Stack,
  Text,
  TextInput,
  UserChip,
} from "./ds/index.ts";

const NAV = [
  { label: "Accounts", href: "#/accounts", pages: ["accounts"] },
  { label: "Documents", href: "#/documents", pages: ["documents", "document"] },
  { label: "Facts", href: "#/facts", pages: ["facts", "fact"] },
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

  const reloadPeople = async () => {
    setPeople((await apiFetch<{ people: PersonDto[] }>("/api/people")).people);
  };

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

  if (error) return <Page width="narrow" title="FinShark"><Alert tone="danger">{error}</Alert></Page>;
  if (personId === undefined || people === null) return <Page width="narrow" title="FinShark"><Loading /></Page>;

  if (people.length === 0) return <SetupPeople onDone={setPeople} />;

  if (personId === null) {
    return (
      <WhoIsUsing
        people={people}
        onChanged={reloadPeople}
        onChosen={async (p) => {
          try {
            await setActingPerson(String(p.id));
          } catch {
            throw new Error("Could not save your choice.");
          }
          setPersonId(String(p.id));
        }}
      />
    );
  }

  return (
    <ActorProvider personId={personId} setPersonId={setPersonId} people={people}>
      <RefDataProvider>
        <Shell people={people} personId={personId} onSwitch={() => {
          // Owners may have been added while working; refresh the list the switch screen shows.
          void reloadPeople().finally(() => setPersonId(null));
        }} />
      </RefDataProvider>
    </ActorProvider>
  );
}

function SetupPeople({ onDone }: { onDone: (p: PersonDto[]) => void }) {
  const [added, setAdded] = useState<PersonDto[]>([]);
  const [name, setName] = useState("");

  const add = useAction(async () => {
    const p = await apiFetch<PersonDto>("/api/people", { method: "POST", body: { displayName: name.trim() } });
    setAdded([...added, p]);
    setName("");
  });

  return (
    <Page width="narrow" title="Welcome to FinShark">
      <Text as="p">Who will use this? Add everyone in the household who will check or change numbers. FinShark records who did what. It is not a password.</Text>
      <Form onSubmit={() => { if (name.trim() !== "") void add.run(); }}>
        <FieldRow align="end">
          <Field label="Name" grow>
            <TextInput value={name} onChange={setName} autoFocus />
          </Field>
          <Button type="submit" busy={add.busy}>Add person</Button>
        </FieldRow>
      </Form>
      <Alert tone="danger">{add.error}</Alert>
      {added.length > 0 && (
        <>
          <Stack gap={1}>
            {added.map((p) => <Text key={p.id} as="div"><DataText>{p.displayName}</DataText></Text>)}
          </Stack>
          <Inline><Button variant="primary" onClick={() => onDone(added)}>Continue</Button></Inline>
        </>
      )}
    </Page>
  );
}

function Shell({
  people,
  personId,
  onSwitch,
}: {
  people: PersonDto[];
  personId: string;
  onSwitch: () => void;
}) {
  const route = useRoute();
  const person = people.find((p) => String(p.id) === personId);
  // Keyed on the route so the inbox count refreshes as you move around.
  const docs = useLoad(() => apiFetch<{ documents: DocumentDto[] }>("/api/documents").then((r) => r.documents), route);
  const inbox = docs.data?.filter((d) => d.status === "inbox").length ?? 0;

  const items = NAV.map((n) => ({
    label: n.label,
    href: n.href,
    active: (n.pages as readonly string[]).includes(route.page),
    ...(n.label === "Documents" ? { count: inbox } : {}),
  }));

  return (
    <AppShell
      header={
        <AppHeader
          brand={<Brand />}
          nav={<NavTabs items={items} />}
          user={<UserChip name={person?.displayName ?? personId} onSwitch={onSwitch} />}
        />
      }
      footer={
        <Inline gap={4}>
          <Link href="#/demo" tone="muted">Viewer demo</Link>
          <Link href="#/design" tone="muted">Design system</Link>
        </Inline>
      }
    >
      <RoutePage route={route} />
    </AppShell>
  );
}

function RoutePage({ route }: { route: Route }) {
  switch (route.page) {
    case "documents": return <DocumentsPage accountId={route.accountId} />;
    case "document": return <DocumentView id={route.id} factId={route.factId} />;
    case "facts": return <FactsPage filters={route.filters} />;
    case "fact": return <FactHistory id={route.id} />;
    case "accounts": return <AccountsPage />;
    case "demo": return <DemoPage />;
    case "design": return <DesignPage />;
  }
}
