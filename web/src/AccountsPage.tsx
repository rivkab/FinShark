import { useState } from "react";
import { ACCOUNT_TYPES, INSTITUTION_KINDS, type AccountType, type InstitutionKind } from "@finshark/shared";
import type {
  AccountDto,
  CreateAccountRequest,
  CreateInstitutionRequest,
  DocumentDto,
  InstitutionDto,
  Language,
  SetAccountNameRequest,
  SetAccountNotesRequest,
  SetAccountNumberRequest,
  SetAccountTypeRequest,
  SetAccountOwnersRequest,
} from "@finshark/shared";
import { apiFetch, errorText } from "./api.ts";
import { hrefDocuments } from "./route.ts";
import { useActor, useRefData } from "./context.tsx";
import { sortInstitutions } from "./institutionSort.ts";
import { sortAccounts, type AccountSortKey, type SortDir } from "./accountSort.ts";
import { ACCOUNT_TYPE_LABEL, INSTITUTION_KIND_LABEL, currencyForCountry, languageForCountry } from "./labels.ts";
import { Cell, Text, Value } from "./Value.tsx";
import { ErrorNote, InstitutionName, AccountName, Warning, langLabel, useLoad } from "./ui.tsx";

export function AccountsPage() {
  const { institutions, accounts, people } = useRefData();
  const docs = useLoad(() => apiFetch<{ documents: DocumentDto[] }>("/api/documents").then((r) => r.documents), 0);
  const [sort, setSort] = useState<{ key: AccountSortKey; dir: SortDir }>({ key: "name", dir: "asc" });
  const sorted = sortAccounts(accounts, sort.key, sort.dir, people);
  /** Clicking the active column flips the direction; another column starts ascending. */
  const sortBy = (key: AccountSortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  const sortHeader = (key: AccountSortKey, label: string) => (
    <th aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="sort" onClick={() => sortBy(key)}>
        {label}{sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );
  return (
    <section>
      <h1>Accounts</h1>
      <h2>Accounts</h2>
      {accounts.length === 0 ? (
        <p>No accounts yet.{institutions.length === 0 ? " Add an institution first." : ""}</p>
      ) : (
        <table className="data">
          <thead>
            <tr>{sortHeader("name", "Account")}{sortHeader("institution", "Institution")}{sortHeader("type", "Type")}{sortHeader("owners", "Owners")}<th>Account number</th>{sortHeader("country", "Country")}<th>Currency</th><th>Notes</th><th /></tr>
          </thead>
          <tbody>
            {sorted.map((a) => (
              <AccountRow
                key={a.id}
                account={a}
                docCount={docs.data ? docs.data.filter((d) => d.accountIds.includes(a.id)).length : null}
              />
            ))}
          </tbody>
        </table>
      )}
      {institutions.some((i) => i.kind !== "employer") && <AddAccount />}

      <h2>Institutions</h2>
      {institutions.length === 0 ? (
        <p>No institutions yet. Add the banks, brokers and funds your documents come from.</p>
      ) : (
        <table className="data">
          <thead>
            <tr><th>Name</th><th>Kind</th><th>Country</th><th>Language</th><th /></tr>
          </thead>
          <tbody>
            {sortInstitutions(institutions).map((i) => (
              <InstitutionRow key={i.id} inst={i} />
            ))}
          </tbody>
        </table>
      )}
      <AddInstitution />
    </section>
  );
}

/** Checkboxes for choosing people; at least one must stay checked. */
function OwnerPicker({ selected, onChange }: { selected: number[]; onChange: (ids: number[]) => void }) {
  const owners = useRefData().people.filter((p) => p.ownsAccounts);
  if (owners.length === 0) return <p className="muted">Add a person who owns accounts first (People page); every account needs an owner.</p>;
  return (
    <div className="owner-picker">
      {owners.map((p) => (
        <label key={p.id} className="inline">
          <input
            type="checkbox"
            checked={selected.includes(p.id)}
            onChange={(e) => onChange(e.target.checked ? [...selected, p.id] : selected.filter((x) => x !== p.id))}
          />{" "}
          <Text>{p.displayName}</Text>{" "}
        </label>
      ))}
    </div>
  );
}

function OwnersView({ account }: { account: AccountDto }) {
  const { people } = useRefData();
  return (
    <>
      {account.owners.length === 0 && <div className="muted">none recorded</div>}
      {account.owners.map((o) => (
        <div key={`${o.personId}-${o.role}`}>
          <Text>{people.find((p) => p.id === o.personId)?.displayName ?? `#${o.personId}`}</Text>
          {o.role !== "owner" && <span className="muted"> ({o.role})</span>}
          {o.share && <span className="muted"> <Value>{o.share}</Value></span>}
        </div>
      ))}
    </>
  );
}

function AccountRow({ account: a, docCount }: { account: AccountDto; docCount: number | null }) {
  const { reload } = useRefData();
  const { mutate } = useActor();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [notes, setNotes] = useState("");
  const [altName, setAltName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startEdit = () => {
    setSelected(a.owners.map((o) => o.personId));
    setNumber(a.accountNumber ?? "");
    setName(a.displayName);
    setType(a.accountType ?? "");
    setNotes(a.notes ?? "");
    setAltName(a.altName ?? "");
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    const newName = name.trim();
    if (newName === "") return setError("Enter the account's name.");
    if (selected.length === 0) return setError("Choose at least one owner.");
    const newNumber = number.trim() === "" ? null : number.trim();
    const ownersChanged =
      selected.length !== a.owners.length || a.owners.some((o) => !selected.includes(o.personId));
    const numberChanged = newNumber !== (a.accountNumber ?? null);
    setBusy(true);
    try {
      const newAlt = altName.trim() === "" ? null : altName.trim();
      if (newName !== a.displayName || newAlt !== (a.altName ?? null)) {
        const body: SetAccountNameRequest = { displayName: newName, altName: newAlt };
        await mutate(() => apiFetch<AccountDto>(`/api/accounts/${a.id}/name`, { method: "PUT", body }));
      }
      if (type !== (a.accountType ?? "")) {
        const body: SetAccountTypeRequest = { accountType: type === "" ? null : (type as AccountType) };
        await mutate(() => apiFetch<AccountDto>(`/api/accounts/${a.id}/type`, { method: "PUT", body }));
      }
      const newNotes = notes.trim() === "" ? null : notes.trim();
      if (newNotes !== a.notes) {
        const body: SetAccountNotesRequest = { notes: newNotes };
        await mutate(() => apiFetch<AccountDto>(`/api/accounts/${a.id}/notes`, { method: "PUT", body }));
      }
      if (ownersChanged) {
        // Keep role and share of owners that stay; new ones are plain owners.
        const body: SetAccountOwnersRequest = {
          owners: selected.map((personId) => {
            const existing = a.owners.find((o) => o.personId === personId);
            return { personId, role: existing?.role ?? "owner", share: existing?.share ?? null };
          }),
        };
        await mutate(() => apiFetch<AccountDto>(`/api/accounts/${a.id}/owners`, { method: "PUT", body }));
      }
      if (numberChanged) {
        const body: SetAccountNumberRequest = { accountNumber: newNumber };
        await mutate(() => apiFetch<AccountDto>(`/api/accounts/${a.id}/account-number`, { method: "PUT", body }));
      }
      setError(null);
      setEditing(false);
      await reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => { setEditing(false); setError(null); };

  return (
    <>
      <tr>
        {editing ? (
          <td>
            <label><span className="muted">Name</span><input type="text" dir="auto" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label><span className="muted">Name in the other language (optional)</span><input type="text" dir="auto" value={altName} onChange={(e) => setAltName(e.target.value)} /></label>
          </td>
        ) : (
          <Cell>
            <AccountName account={a} />
            {docCount !== null && (
              <div className="small">
                {docCount === 0 ? <span className="muted">no documents</span> : <a href={hrefDocuments(a.id)}>{docCount} {docCount === 1 ? "document" : "documents"}</a>}
              </div>
            )}
          </Cell>
        )}
        <Cell><Text>{a.institutionName}</Text></Cell>
        <td>
          {editing ? (
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Not set</option>
              {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{ACCOUNT_TYPE_LABEL[t]}</option>)}
            </select>
          ) : a.accountType ? ACCOUNT_TYPE_LABEL[a.accountType] : <span className="muted">not set</span>}
        </td>
        <td>{editing ? <OwnerPicker selected={selected} onChange={setSelected} /> : <OwnersView account={a} />}</td>
        <td>
          {editing ? (
            <>
              <input type="text" dir="ltr" size={16} value={number} onChange={(e) => setNumber(e.target.value)} />
              {a.accountNumber && <div className="muted">The old number is kept in the account's history.</div>}
            </>
          ) : a.accountNumber ? <Value>{a.accountNumber}</Value> : <span className="muted">none</span>}
        </td>
        <td>{a.country}</td>
        <td>{a.nativeCurrency}</td>
        <td>
          {editing ? (
            <textarea dir="auto" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          ) : a.notes ? <div className="notes" dir="auto">{a.notes}</div> : <span className="muted">none</span>}
        </td>
        <td>
          {editing ? (
            <>
              <button type="button" onClick={() => void save()} disabled={busy}>Save</button>{" "}
              <button type="button" onClick={cancel} disabled={busy}>Cancel</button>
              <ErrorNote>{error}</ErrorNote>
            </>
          ) : (
            <>
              <button type="button" onClick={startEdit}>Edit</button>
            </>
          )}
        </td>
      </tr>
    </>
  );
}

function InstitutionRow({ inst }: { inst: InstitutionDto }) {
  const { reload } = useRefData();
  const { mutate } = useActor();
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startEdit = () => {
    setKind(inst.kind ?? "");
    setError(null);
    setEditing(true);
  };
  const save = async () => {
    setBusy(true);
    try {
      if (kind !== (inst.kind ?? "")) {
        await mutate(() => apiFetch<InstitutionDto>(`/api/institutions/${inst.id}/kind`, { method: "PUT", body: { kind: kind === "" ? null : kind } }));
        await reload();
      }
      setEditing(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr>
      <Cell><InstitutionName inst={inst} /></Cell>
      <td>
        {editing ? (
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Not set</option>
            {INSTITUTION_KINDS.map((k) => <option key={k} value={k}>{INSTITUTION_KIND_LABEL[k]}</option>)}
          </select>
        ) : inst.kind ? INSTITUTION_KIND_LABEL[inst.kind] : <span className="muted">not set</span>}
      </td>
      <td>{inst.country}</td>
      <td>{langLabel(inst.language)}</td>
      <td>
        {editing ? (
          <>
            <button type="button" onClick={() => void save()} disabled={busy}>Save</button>{" "}
            <button type="button" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
            <ErrorNote>{error}</ErrorNote>
          </>
        ) : (
          <button type="button" onClick={startEdit}>Edit</button>
        )}
      </td>
    </tr>
  );
}

function AddInstitution() {
  const { reload } = useRefData();
  const { mutate } = useActor();
  const [name, setName] = useState("");
  const [altName, setAltName] = useState("");
  const [country, setCountry] = useState("US");
  const [language, setLanguage] = useState<Language>("en");
  const [kind, setKind] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (name.trim() === "") return setError("Enter the institution's name.");
    if (kind === "") return setError("Choose whether it is a financial institution or an employer.");
    const body: CreateInstitutionRequest = { name: name.trim(), country, language, kind: kind as InstitutionKind, ...(altName.trim() ? { altName: altName.trim() } : {}) };
    setBusy(true);
    try {
      await mutate(() => apiFetch<InstitutionDto>("/api/institutions", { method: "POST", body }));
      setName("");
      setAltName("");
      setError(null);
      await reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel fields" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <h3>Add an institution</h3>
      <div className="row">
        <label className="grow"><span>Name, as printed on its documents</span><input type="text" dir="auto" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="grow"><span>Name in the other language (optional)</span><input type="text" dir="auto" value={altName} onChange={(e) => setAltName(e.target.value)} /></label>
      </div>
      <div className="row">
        <label>
          <span>Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Choose…</option>
            {INSTITUTION_KINDS.map((k) => <option key={k} value={k}>{INSTITUTION_KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <label>
          <span>Country</span>
          <select value={country} onChange={(e) => { setCountry(e.target.value); setLanguage(languageForCountry(e.target.value)); }}>
            <option value="US">United States</option>
            <option value="IL">Israel</option>
          </select>
        </label>
        <label>
          <span>Language of its documents</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
            <option value="en">English</option>
            <option value="he">Hebrew</option>
          </select>
        </label>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div><button type="submit" disabled={busy}>Add institution</button></div>
    </form>
  );
}

/**
 * `institutionId` preselects the institution (a document's, when adding from a document).
 * `pickedText` is text boxed on a PDF, offered for the account number. `onCreated` runs after the account exists.
 */
export function AddAccount({
  institutionId: preferredInstitutionId = null,
  pickedText = null,
  onCreated,
}: {
  institutionId?: number | null;
  pickedText?: string | null;
  onCreated?: (account: AccountDto) => void | Promise<void>;
}) {
  const { institutions, accounts, people, reload } = useRefData();
  const { mutate } = useActor();
  const owningPeople = people.filter((p) => p.ownsAccounts);
  const [ownerIds, setOwnerIds] = useState<number[]>(owningPeople.length === 1 ? [owningPeople[0]!.id] : []);
  const sortedInstitutions = sortInstitutions(institutions.filter((i) => i.kind !== "employer"));
  const firstInstitution = sortedInstitutions.find((i) => i.id === preferredInstitutionId) ?? sortedInstitutions[0];
  const [institutionId, setInstitutionId] = useState(String(firstInstitution?.id ?? ""));
  const [displayName, setDisplayName] = useState("");
  const [altName, setAltName] = useState("");
  const [currency, setCurrency] = useState(currencyForCountry(firstInstitution?.country ?? "US"));
  const [openedOn, setOpenedOn] = useState("");
  const [closedOn, setClosedOn] = useState("");
  const [cadence, setCadence] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountType, setAccountType] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onInstitution = (v: string) => {
    setInstitutionId(v);
    const inst = institutions.find((i) => String(i.id) === v);
    if (inst) setCurrency(currencyForCountry(inst.country));
  };

  const submit = async () => {
    if (institutionId === "") return setError("Choose the institution.");
    if (displayName.trim() === "") return setError("Enter the account's name.");
    if (accountType === "") return setError("Choose the account type.");
    if (accountNumber.trim() === "") return setError("Enter the account number.");
    if (ownerIds.length === 0) return setError("Choose at least one owner.");
    const body: CreateAccountRequest = {
      owners: ownerIds.map((personId) => ({ personId })),
      institutionId: Number(institutionId),
      displayName: displayName.trim(),
      nativeCurrency: currency,
      ...(altName.trim() ? { altName: altName.trim() } : {}),
      ...(openedOn ? { openedOn } : {}),
      ...(closedOn ? { closedOn } : {}),
      ...(cadence ? { statementCadence: cadence as NonNullable<CreateAccountRequest["statementCadence"]> } : {}),
      accountType: accountType as AccountType,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(accountNumber.trim() ? { accountNumber: accountNumber.trim() } : {}),
    };
    setBusy(true);
    try {
      const created = await mutate(() => apiFetch<AccountDto>("/api/accounts", { method: "POST", body }));
      setDisplayName("");
      setAltName("");
      setAccountNumber("");
      setAccountType("");
      setNotes("");
      setOpenedOn("");
      setClosedOn("");
      setError(null);
      await reload();
      await onCreated?.(created);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const sameNumber = accountNumber.trim() === "" ? undefined : accounts.find((a) => a.accountNumber === accountNumber.trim());

  return (
    <form className="panel fields" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <h3>Add an account</h3>
      <div className="row">
        <label>
          <span>Institution</span>
          <select value={institutionId} onChange={(e) => onInstitution(e.target.value)}>
            {sortedInstitutions.map((i) => <option key={i.id} value={i.id} dir="auto">{i.name}</option>)}
          </select>
        </label>
        <label className="grow"><span>Account name</span><input type="text" dir="auto" value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
        <label className="grow"><span>Name in the other language (optional)</span><input type="text" dir="auto" value={altName} onChange={(e) => setAltName(e.target.value)} /></label>
      </div>
      <div className="row">
        <label>
          <span>Type</span>
          <select value={accountType} onChange={(e) => setAccountType(e.target.value)}>
            <option value="">Choose...</option>
            {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{ACCOUNT_TYPE_LABEL[t]}</option>)}
          </select>
        </label>
        <label>
          <span>Currency</span>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="USD">USD ($)</option>
            <option value="ILS">ILS (₪)</option>
          </select>
        </label>
        <label><span>Opened (optional)</span><input type="date" value={openedOn} onChange={(e) => setOpenedOn(e.target.value)} /></label>
        <label><span>Closed (optional)</span><input type="date" value={closedOn} onChange={(e) => setClosedOn(e.target.value)} /></label>
        <label>
          <span>How often it sends statements</span>
          <select value={cadence} onChange={(e) => setCadence(e.target.value)}>
            <option value="">Not sure</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="semiannual">Twice a year</option>
            <option value="annual">Once a year</option>
            <option value="irregular">Irregular</option>
          </select>
        </label>
        <label>
          <span>Account number</span>
          <input type="text" dir="ltr" size={16} value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
          {pickedText && pickedText !== accountNumber.trim() && (
            <button type="button" onClick={() => setAccountNumber(pickedText)}>Use boxed text: {pickedText}</button>
          )}
        </label>
      </div>
      {sameNumber && <Warning>An account with this number already exists: {sameNumber.displayName} ({sameNumber.institutionName}).</Warning>}
      <div>
        <span className="label">Owner(s)</span>
        <OwnerPicker selected={ownerIds} onChange={setOwnerIds} />
      </div>
      <label>
        <span>Notes (optional)</span>
        <textarea dir="auto" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <ErrorNote>{error}</ErrorNote>
      <div><button type="submit" disabled={busy}>Add account</button></div>
    </form>
  );
}
