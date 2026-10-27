import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountDto, ConceptDto, DocumentStatus, FactDto, FactStatus, InstitutionDto, Language } from "@finshark/shared";
import { errorText } from "./api.ts";
import { useRefData } from "./context.tsx";
import { Badge, Combobox, DataText, Select, Text, Value, type SelectOption } from "./ds/index.ts";
import { accountNames, conceptPickerParts, filterConcepts, groupAccounts, pickLabel } from "./labels.ts";

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

/**
 * Run an async action (a save, a status change) with busy and error state handled.
 * `run` resolves true when the action succeeded.
 */
export function useAction<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async (...args: A): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await fnRef.current(...args);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return { run, busy, error, setError };
}

// ---------------------------------------------------------------- small display pieces

const FACT_STATUS = {
  verified: { tone: "success", label: "verified" },
  proposed: { tone: "warning", label: "not verified" },
  rejected: { tone: "danger", label: "rejected" },
  superseded: { tone: "muted", label: "replaced" },
} as const satisfies Record<FactStatus, { tone: "success" | "warning" | "danger" | "muted"; label: string }>;

export function StatusBadge({ status }: { status: FactStatus }) {
  const { tone, label } = FACT_STATUS[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function DocStatusBadge({ status }: { status: DocumentStatus }) {
  if (status === "reviewed") return <Badge tone="success">reviewed</Badge>;
  if (status === "inbox") return <Badge tone="warning">needs review</Badge>;
  return <Badge tone="muted">{status}</Badge>;
}

/** A fact's concept name, in the language of the account it belongs to. */
export function FactConcept({ fact }: { fact: Pick<FactDto, "conceptLabelEn" | "conceptLabelHe" | "accountLanguage"> }) {
  return <DataText>{pickLabel(fact.conceptLabelEn, fact.conceptLabelHe, fact.accountLanguage)}</DataText>;
}

export function AccountName({ account }: { account: Pick<AccountDto, "displayName" | "altName"> }) {
  const n = accountNames(account);
  return (
    <>
      <DataText>{n.name}</DataText>
      {n.alt && (
        <>
          {" "}
          <Text tone="muted">
            (<DataText>{n.alt}</DataText>)
          </Text>
        </>
      )}
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
  const opt = (a: AccountDto): SelectOption => ({
    value: String(a.id),
    label: `${a.displayName}${a.altName ? ` (${a.altName})` : ""} · ${a.institutionName} · ${a.nativeCurrency}${ownerNames(a) ? ` · ${ownerNames(a)}` : ""}`,
    dir: "auto",
  });
  return g.others.length === 0 ? (
    <Select id={id} value={value} onChange={onChange} placeholder={noneLabel} options={g.preferred.map(opt)} />
  ) : (
    <Select
      id={id}
      value={value}
      onChange={onChange}
      placeholder={noneLabel}
      groups={[
        { label: "This institution", options: g.preferred.map(opt) },
        { label: "Other accounts", options: g.others.map(opt) },
      ]}
    />
  );
}

const PERIOD_NOTE = { instant: "at a date", duration: "over a period" } as const;

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
  const selected = concepts.find((c) => c.id === value);
  const shown = open ? q : selected ? (selected.jurisdiction === "IL" && selected.labelHe ? `${selected.labelEn} / ${selected.labelHe}` : selected.labelEn) : "";

  return (
    <Combobox
      inputValue={shown}
      onInputChange={setQ}
      open={open}
      onOpenChange={setOpen}
      items={filterConcepts(concepts, q).slice(0, 30)}
      getKey={(c) => c.id}
      renderItem={(c) => {
        const p = conceptPickerParts(c);
        const note = PERIOD_NOTE[c.periodType as keyof typeof PERIOD_NOTE];
        return (
          <>
            {p.en}
            {p.he && (
              <>
                {" "}
                <Text tone="muted"><DataText>{p.he}</DataText></Text>
              </>
            )}
            {note && (
              <>
                {" "}
                <Text tone="muted" size="sm">{note}</Text>
              </>
            )}
          </>
        );
      }}
      onPick={(c) => {
        onChange(c);
        setQ("");
      }}
      placeholder="Search, e.g. balance, interest, יתרה"
      aria-label="Kind of number"
    />
  );
}
