import { useState } from "react";
import type {
  AccountDto,
  AccountIdentifierDto,
  CreateAccountRequest,
  CreateInstitutionRequest,
  InstitutionDto,
  Language,
  SetAccountNumberRequest,
  SetAccountOwnersRequest,
} from "@finshark/shared";
import { apiFetch, errorText } from "./api.ts";
import { useActor, useRefData } from "./context.tsx";
import { buildAttestationRequest, validateAttestation, type AttestationForm } from "./factForm.ts";
import { currencyForCountry, languageForCountry } from "./labels.ts";
import { Cell, Text, Value } from "./Value.tsx";
import { ErrorNote, InstitutionName, AccountName, langLabel } from "./ui.tsx";

export function AccountsPage() {
  const { institutions, accounts } = useRefData();
  return (
    <section>
      <h1>Accounts</h1>
      <h2>Institutions</h2>
      {institutions.length === 0 ? (
        <p>No institutions yet. Add the banks, brokers and funds your documents come from.</p>
      ) : (
        <table className="data">
          <thead>
            <tr><th>Name</th><th>Country</th><th>Language</th></tr>
          </thead>
          <tbody>
            {institutions.map((i) => (
              <tr key={i.id}>
                <Cell><InstitutionName inst={i} /></Cell>
                <td>{i.country}</td>
                <td>{langLabel(i.language)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <AddInstitution />

      <h2>Accounts</h2>
      {accounts.length === 0 ? (
        <p>No accounts yet.{institutions.length === 0 ? " Add an institution first." : ""}</p>
      ) : (
        <table className="data">
          <thead>
            <tr><th>Account</th><th>Institution</th><th>Owners</th><th>Account number</th><th>Country</th><th>Currency</th><th>Other identifiers</th><th>Dates</th><th /></tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <AccountRow key={a.id} account={a} />
            ))}
          </tbody>
        </table>
      )}
      {institutions.length > 0 && <AddAccount />}
    </section>
  );
}

/** Identifiers other than the current account number, including past account numbers. */
function Identifiers({ list }: { list: AccountIdentifierDto[] }) {
  const others = list.filter((i) => !(i.kind === "account_number" && i.validTo === null));
  return (
    <>
      {others.map((i) => (
        <div key={i.id}>
          {i.kind === "last4" ? "ending " : i.kind === "account_number" ? "previous number " : `${i.kind} `}
          <Value>{i.value}</Value>
          {i.kind === "account_number" && i.validTo && <span className="muted"> (until <Value>{i.validTo}</Value>)</span>}
        </div>
      ))}
    </>
  );
}

/** Checkboxes for choosing people; at least one must stay checked. */
function OwnerPicker({ selected, onChange }: { selected: number[]; onChange: (ids: number[]) => void }) {
  const { people } = useRefData();
  if (people.length === 0) return <p className="muted">Add a person first (People page); every account needs an owner.</p>;
  return (
    <div>
      {people.map((p) => (
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

function Owners({ account }: { account: AccountDto }) {
  const { people, reload } = useRefData();
  const { mutate } = useActor();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (selected.length === 0) return setError("Choose at least one owner.");
    // Keep role and share of owners that stay; new ones are plain owners.
    const body: SetAccountOwnersRequest = {
      owners: selected.map((personId) => {
        const existing = account.owners.find((o) => o.personId === personId);
        return { personId, role: existing?.role ?? "owner", share: existing?.share ?? null };
      }),
    };
    setBusy(true);
    try {
      await mutate(() => apiFetch<AccountDto>(`/api/accounts/${account.id}/owners`, { method: "PUT", body }));
      setError(null);
      setEditing(false);
      await reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
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
        <button type="button" onClick={() => { setSelected(account.owners.map((o) => o.personId)); setEditing(true); }}>
          {account.owners.length === 0 ? "Add" : "Change"}
        </button>
      </>
    );
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <OwnerPicker selected={selected} onChange={setSelected} />
      <button type="submit" disabled={busy}>Save</button>{" "}
      <button type="button" onClick={() => { setEditing(false); setError(null); }}>Cancel</button>
      {account.owners.length > 0 && <div className="muted">Previous owners are kept in the account's history.</div>}
      <ErrorNote>{error}</ErrorNote>
    </form>
  );
}

function AccountNumber({ account }: { account: AccountDto }) {
  const { reload } = useRefData();
  const { mutate } = useActor();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(account.accountNumber ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const body: SetAccountNumberRequest = { accountNumber: value.trim() === "" ? null : value.trim() };
    setBusy(true);
    try {
      await mutate(() => apiFetch<AccountDto>(`/api/accounts/${account.id}/account-number`, { method: "PUT", body }));
      setError(null);
      setEditing(false);
      await reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <>
        {account.accountNumber ? <Value>{account.accountNumber}</Value> : <span className="muted">none</span>}{" "}
        <button type="button" onClick={() => { setValue(account.accountNumber ?? ""); setEditing(true); }}>
          {account.accountNumber ? "Change" : "Add"}
        </button>
      </>
    );
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <input type="text" dir="ltr" size={16} autoFocus value={value} onChange={(e) => setValue(e.target.value)} />{" "}
      <button type="submit" disabled={busy}>Save</button>{" "}
      <button type="button" onClick={() => { setEditing(false); setError(null); }}>Cancel</button>
      {account.accountNumber && <div className="muted">The old number is kept in the account's history.</div>}
      <ErrorNote>{error}</ErrorNote>
    </form>
  );
}

function AccountRow({ account: a }: { account: AccountDto }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr>
        <Cell><AccountName account={a} /></Cell>
        <Cell><Text>{a.institutionName}</Text></Cell>
        <td><Owners account={a} /></td>
        <td><AccountNumber account={a} /></td>
        <td>{a.country}</td>
        <td>{a.nativeCurrency}</td>
        <td><Identifiers list={a.identifiers} /></td>
        <td>
          {a.openedOn && <div>opened <Value>{a.openedOn}</Value></div>}
          {a.closedOn && <div>closed <Value>{a.closedOn}</Value></div>}
          {a.statementCadence && <div className="muted">{a.statementCadence}</div>}
        </td>
        <td>
          <button onClick={() => setOpen(!open)}>{open ? "Cancel" : "Record a statement without a document"}</button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={9}>
            <Attest account={a} onDone={() => setOpen(false)} />
          </td>
        </tr>
      )}
    </>
  );
}

function Attest({ account, onDone }: { account: AccountDto; onDone: () => void }) {
  const { mutate } = useActor();
  const [form, setForm] = useState<AttestationForm>({ conceptId: "status.account_closed", date: "", periodStart: "", periodEnd: "", note: "" });
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const set = (p: Partial<AttestationForm>) => setForm({ ...form, ...p });

  const submit = async () => {
    const errs = validateAttestation(form);
    setErrors(errs);
    if (errs.length) return;
    setBusy(true);
    try {
      await mutate(() => apiFetch("/api/attestations", { method: "POST", body: buildAttestationRequest(account.id, form) }));
      setDone(true);
    } catch (e) {
      setErrors([errorText(e)]);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="panel">
        <p>Recorded. It is waiting for verification in <a href="#/review">Review</a>.</p>
        <button onClick={onDone}>Close</button>
      </div>
    );
  }
  return (
    <form className="panel fields" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <p>
        Use this when there is no document: for example the account was closed, or the institution did not issue a form.
        It is recorded as your statement, not as evidence from a document.
      </p>
      <label>
        <span>What do you want to record?</span>
        <select value={form.conceptId} onChange={(e) => set({ conceptId: e.target.value as AttestationForm["conceptId"] })}>
          <option value="status.account_closed">This account was closed</option>
          <option value="status.no_document_issued">No document was issued for a period</option>
        </select>
      </label>
      {form.conceptId === "status.account_closed" ? (
        <label>
          <span>Closed on</span>
          <input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} />
        </label>
      ) : (
        <div className="row">
          <label><span>Period start</span><input type="date" value={form.periodStart} onChange={(e) => set({ periodStart: e.target.value })} /></label>
          <label><span>Period end</span><input type="date" value={form.periodEnd} onChange={(e) => set({ periodEnd: e.target.value })} /></label>
        </div>
      )}
      <label>
        <span>Who says so, and why (required)</span>
        <textarea dir="auto" rows={2} value={form.note} onChange={(e) => set({ note: e.target.value })} />
      </label>
      {errors.map((m) => <ErrorNote key={m}>{m}</ErrorNote>)}
      <div><button type="submit" disabled={busy}>Record statement</button></div>
    </form>
  );
}

function AddInstitution() {
  const { reload } = useRefData();
  const { mutate } = useActor();
  const [name, setName] = useState("");
  const [altName, setAltName] = useState("");
  const [country, setCountry] = useState("US");
  const [language, setLanguage] = useState<Language>("en");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (name.trim() === "") return setError("Enter the institution's name.");
    const body: CreateInstitutionRequest = { name: name.trim(), country, language, ...(altName.trim() ? { altName: altName.trim() } : {}) };
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

function AddAccount() {
  const { institutions, people, reload } = useRefData();
  const { mutate } = useActor();
  const [ownerIds, setOwnerIds] = useState<number[]>(people.length === 1 ? [people[0]!.id] : []);
  const [institutionId, setInstitutionId] = useState(String(institutions[0]?.id ?? ""));
  const [displayName, setDisplayName] = useState("");
  const [altName, setAltName] = useState("");
  const [currency, setCurrency] = useState(currencyForCountry(institutions[0]?.country ?? "US"));
  const [openedOn, setOpenedOn] = useState("");
  const [closedOn, setClosedOn] = useState("");
  const [cadence, setCadence] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
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
      ...(accountNumber.trim() ? { accountNumber: accountNumber.trim() } : {}),
    };
    setBusy(true);
    try {
      await mutate(() => apiFetch<AccountDto>("/api/accounts", { method: "POST", body }));
      setDisplayName("");
      setAltName("");
      setAccountNumber("");
      setOpenedOn("");
      setClosedOn("");
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
      <h3>Add an account</h3>
      <div className="row">
        <label>
          <span>Institution</span>
          <select value={institutionId} onChange={(e) => onInstitution(e.target.value)}>
            {institutions.map((i) => <option key={i.id} value={i.id} dir="auto">{i.name}</option>)}
          </select>
        </label>
        <label className="grow"><span>Account name</span><input type="text" dir="auto" value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
        <label className="grow"><span>Name in the other language (optional)</span><input type="text" dir="auto" value={altName} onChange={(e) => setAltName(e.target.value)} /></label>
      </div>
      <div className="row">
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
        <label><span>Account number (optional)</span><input type="text" dir="ltr" size={16} value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} /></label>
      </div>
      <div>
        <span>Owner(s)</span>
        <OwnerPicker selected={ownerIds} onChange={setOwnerIds} />
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div><button type="submit" disabled={busy}>Add account</button></div>
    </form>
  );
}
