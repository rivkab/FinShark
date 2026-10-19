import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { AccountDto, ConceptDto, FactDto, FactStatus, InstitutionDto, Language } from "@finshark/shared";
import { errorText } from "./api.ts";
import { useRefData } from "./context.tsx";
import { accountNames, conceptPickerParts, filterConcepts, groupAccounts, pickLabel } from "./labels.ts";
import { Text, Value } from "./Value.tsx";

// ---------------------------------------------------------------- loading

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (d: T) => void;
}

/** Load something when `key` changes; `reload` refetches without blanking the screen. */
export function useLoad<T>(fn: () => Promise<T>, key: unknown): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);

  const run = useCallback(async (blank: boolean) => {
    const my = ++seq.current;
    if (blank) {
      setLoading(true);
      setData(null);
    }
    try {
      const d = await fnRef.current();
      if (my !== seq.current) return;
      setData(d);
      setError(null);
    } catch (e) {
      if (my === seq.current) setError(errorText(e));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run(true);
  }, [run, key]);

  return { data, error, loading, reload: () => run(false), setData };
}

// ---------------------------------------------------------------- small display pieces

export function ErrorNote({ children }: { children: ReactNode }) {
  return children ? <p className="error" role="alert">{children}</p> : null;
}

export function Warning({ children }: { children: ReactNode }) {
  return <p className="warning" role="alert">{children}</p>;
}

export function StatusBadge({ status }: { status: FactStatus }) {
  return <span className={`badge ${status}`}>{status}</span>;
}

/** A fact's concept name, in the language of the account it belongs to. */
export function FactConcept({ fact }: { fact: Pick<FactDto, "conceptLabelEn" | "conceptLabelHe" | "accountLanguage"> }) {
  const label = pickLabel(fact.conceptLabelEn, fact.conceptLabelHe, fact.accountLanguage);
  return (
    <span title={fact.conceptLabelEn}>
      <Text>{label}</Text>
    </span>
  );
}

export function AccountName({ account }: { account: Pick<AccountDto, "displayName" | "altName"> }) {
  const n = accountNames(account);
  return (
    <>
      <Text>{n.name}</Text>
      {n.alt && <span className="alt"> (<Text>{n.alt}</Text>)</span>}
    </>
  );
}

export function InstitutionName({ inst }: { inst: Pick<InstitutionDto, "name" | "altName"> }) {
  return <AccountName account={{ displayName: inst.name, altName: inst.altName }} />;
}

export function FactAmount({ fact }: { fact: Pick<FactDto, "formatted"> }) {
  return <Value>{fact.formatted}</Value>;
}

export function langLabel(l: Language | null): string {
  return l === "he" ? "Hebrew" : l === "en" ? "English" : "";
}

// ---------------------------------------------------------------- pickers

export function AccountSelect({
  accounts,
  institutionId,
  value,
  onChange,
  noneLabel = "No account",
  id,
}: {
  accounts: readonly AccountDto[];
  institutionId: number | null;
  value: string;
  onChange: (v: string) => void;
  noneLabel?: string;
  id?: string;
}) {
  const { people } = useRefData();
  const g = groupAccounts(accounts, institutionId);
  const ownerNames = (a: AccountDto) =>
    a.owners.map((o) => people.find((p) => p.id === o.personId)?.displayName).filter((n): n is string => !!n).join(", ");
  const opt = (a: AccountDto) => (
    <option key={a.id} value={a.id} dir="auto">
      {a.displayName}
      {a.altName ? ` (${a.altName})` : ""} · {a.institutionName} · {a.nativeCurrency}
      {ownerNames(a) ? ` · ${ownerNames(a)}` : ""}
    </option>
  );
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{noneLabel}</option>
      {g.others.length === 0 ? (
        g.preferred.map(opt)
      ) : (
        <>
          <optgroup label="This institution">{g.preferred.map(opt)}</optgroup>
          <optgroup label="Other accounts">{g.others.map(opt)}</optgroup>
        </>
      )}
    </select>
  );
}

/** Searchable concept list: type English or Hebrew words (or part of the id). */
export function ConceptPicker({
  concepts,
  value,
  onChange,
}: {
  concepts: readonly ConceptDto[];
  value: string;
  onChange: (c: ConceptDto) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const selected = concepts.find((c) => c.id === value);
  const results = filterConcepts(concepts, q).slice(0, 30);
  const shown = open ? q : selected ? (selected.jurisdiction === "IL" && selected.labelHe ? `${selected.labelEn} / ${selected.labelHe}` : selected.labelEn) : "";

  const pick = (c: ConceptDto) => {
    onChange(c);
    setQ("");
    setOpen(false);
  };

  return (
    <div className="picker">
      <input
        type="text"
        dir="auto"
        value={shown}
        placeholder="Search, e.g. balance, interest, יתרה"
        aria-label="Kind of number"
        onFocus={() => {
          setOpen(true);
          setHi(0);
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setHi(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter" && open) {
            e.preventDefault();
            const c = results[hi];
            if (c) pick(c);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && (
        <ul className="picker-list" role="listbox">
          {results.length === 0 && <li className="none">No match</li>}
          {results.map((c, i) => {
            const p = conceptPickerParts(c);
            return (
              <li
                key={c.id}
                role="option"
                aria-selected={i === hi}
                className={i === hi ? "hi" : undefined}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(c);
                }}
                onMouseEnter={() => setHi(i)}
              >
                {p.en}
                {p.he && <span className="alt" dir="auto"> {p.he}</span>}
                <small className="muted"> {c.periodType === "instant" ? "at a date" : c.periodType === "duration" ? "over a period" : ""}</small>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
