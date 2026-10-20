import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AccountDto, ConceptDto, InstitutionDto, PersonDto, TaxonomyDto, TermDto } from "@finshark/shared";
import { ApiError, apiFetch, errorText, setActingPerson } from "./api.ts";

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
  if (error && !value) return <main className="center"><p className="error">Could not load FinShark data: {error}</p></main>;
  if (!value) return <main className="center"><p>Loading...</p></main>;
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
  const [err, setErr] = useState<string | null>(null);
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

  const choose = async (p: PersonDto) => {
    try {
      await setActingPerson(String(p.id));
      setPersonId(String(p.id));
      setErr(null);
      prompt?.resolve();
      setPrompt(null);
    } catch (e) {
      setErr(errorText(e));
    }
  };

  return (
    <ActorContext.Provider value={actor}>
      {children}
      {prompt && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Who is using FinShark?">
          <div className="modal">
            <h2>Who is making this change?</h2>
            <p>FinShark records who verifies and changes things. It is not a password.</p>
            <div className="people">
              {people.filter((p) => p.usesApp).map((p) => (
                <button key={p.id} onClick={() => void choose(p)}>
                  {p.displayName}
                </button>
              ))}
            </div>
            {err && <p className="error">{err}</p>}
            <p>
              <button
                onClick={() => {
                  prompt.reject();
                  setPrompt(null);
                }}
              >
                Cancel
              </button>
            </p>
          </div>
        </div>
      )}
    </ActorContext.Provider>
  );
}
