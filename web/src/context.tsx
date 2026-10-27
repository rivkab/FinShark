import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AccountDto, ConceptDto, InstitutionDto, PersonDto, TaxonomyDto, TermDto } from "@finshark/shared";
import { ApiError, apiFetch, errorText, setActingPerson } from "./api.ts";
import { Alert, Button, DataText, Heading, Inline, Loading, Modal, Page, Stack, Text } from "./ds/index.ts";
import { useAction } from "./ui.tsx";

// ---------------------------------------------------------------- reference data

export interface RefData {
  people: PersonDto[];
  institutions: InstitutionDto[];
  accounts: AccountDto[];
  concepts: ConceptDto[];
  docTypes: TermDto[];
  reload: () => Promise<void>;
}

const RefContext = createContext<RefData | null>(null);

export function useRefData(): RefData {
  const v = useContext(RefContext);
  if (!v) throw new Error("RefDataProvider missing");
  return v;
}

export function RefDataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<RefData, "reload"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [p, i, a, c, t] = await Promise.all([
        apiFetch<{ people: PersonDto[] }>("/api/people"),
        apiFetch<{ institutions: InstitutionDto[] }>("/api/institutions"),
        apiFetch<{ accounts: AccountDto[] }>("/api/accounts"),
        apiFetch<{ concepts: ConceptDto[] }>("/api/concepts"),
        apiFetch<{ taxonomies: TaxonomyDto[] }>("/api/terms"),
      ]);
      setState({
        people: p.people,
        institutions: i.institutions,
        accounts: a.accounts,
        concepts: c.concepts,
        docTypes: t.taxonomies.find((x) => x.id === "doc_type")?.terms ?? [],
      });
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo(() => (state ? { ...state, reload } : null), [state, reload]);
  if (error && !value) return <Page width="narrow" title="FinShark"><Alert tone="danger">{`Could not load FinShark data: ${error}`}</Alert></Page>;
  if (!value) return <Page width="narrow" title="FinShark"><Loading /></Page>;
  return <RefContext.Provider value={value}>{children}</RefContext.Provider>;
}

// ---------------------------------------------------------------- who is acting

export interface Actor {
  personId: string | null;
  /** Run a mutation; if the server says "choose a person", ask who is using FinShark and retry once. */
  mutate: <T>(fn: () => Promise<T>) => Promise<T>;
}

const ActorContext = createContext<Actor | null>(null);

export function useActor(): Actor {
  const v = useContext(ActorContext);
  if (!v) throw new Error("ActorProvider missing");
  return v;
}

interface Prompt {
  resolve: () => void;
  reject: () => void;
}

export function ActorProvider({
  personId,
  setPersonId,
  people,
  children,
}: {
  personId: string | null;
  setPersonId: (id: string) => void;
  people: PersonDto[];
  children: ReactNode;
}) {
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const personRef = useRef(personId);
  personRef.current = personId;

  const mutate = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof ApiError) || e.code !== "choose_person") throw e;
      await new Promise<void>((resolve, reject) => setPrompt({ resolve, reject: () => reject(e) }));
      return await fn();
    }
  }, []);

  const actor = useMemo(() => ({ personId, mutate }), [personId, mutate]);

  const choose = useAction(async (p: PersonDto) => {
    await setActingPerson(String(p.id));
    setPersonId(String(p.id));
    prompt?.resolve();
    setPrompt(null);
  });

  return (
    <ActorContext.Provider value={actor}>
      {children}
      {prompt && (
        <Modal label="Who is using FinShark?">
          <Stack gap={4}>
            <Heading level={2}>Who is making this change?</Heading>
            <Text as="p">FinShark records who verifies and changes things. It is not a password.</Text>
            <Inline>
              {people.filter((p) => p.usesApp).map((p) => (
                <Button key={p.id} onClick={() => void choose.run(p)}>
                  <DataText>{p.displayName}</DataText>
                </Button>
              ))}
            </Inline>
            <Alert tone="danger">{choose.error}</Alert>
            <Inline>
              <Button
                variant="ghost"
                onClick={() => {
                  prompt.reject();
                  setPrompt(null);
                }}
              >
                Cancel
              </Button>
            </Inline>
          </Stack>
        </Modal>
      )}
    </ActorContext.Provider>
  );
}
