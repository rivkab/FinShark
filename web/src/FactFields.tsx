import type { AccountDto, ConceptDto } from "@finshark/shared";
import type { PeriodSource } from "./dates.ts";
import { applyConceptChange, isMoney, type FactFormState } from "./factForm.ts";
import { AccountSelect, ConceptPicker } from "./ui.tsx";

/** The fields of "Add a number" / "Correct". Controlled; the parent owns the buttons and the submit. */
export function FactFormFields({
  form,
  onChange,
  concepts,
  accounts,
  institutionId,
  period,
  valueHint,
}: {
  form: FactFormState;
  onChange: (next: FactFormState) => void;
  concepts: readonly ConceptDto[];
  accounts: readonly AccountDto[];
  institutionId: number | null;
  period: PeriodSource;
  valueHint?: string;
}) {
  const concept = concepts.find((c) => c.id === form.conceptId);
  const set = (patch: Partial<FactFormState>) => onChange({ ...form, ...patch });

  const onConcept = (c: ConceptDto) => onChange(applyConceptChange(form, c, concept, period));
  const onAccount = (v: string) => {
    const a = accounts.find((x) => String(x.id) === v);
    set({ accountId: v, ...(a ? { currency: a.nativeCurrency } : {}) });
  };

  return (
    <div className="fields">
      <label>
        <span>Kind of number</span>
        <ConceptPicker concepts={concepts} value={form.conceptId} onChange={onConcept} />
      </label>
      <label>
        <span>Account</span>
        <AccountSelect accounts={accounts} institutionId={institutionId} value={form.accountId} onChange={onAccount} noneLabel="No account (a person or household figure)" />
      </label>
      <div className="row">
        <label className="grow">
          <span>Value</span>
          <input type="text" dir="auto" value={form.value} onChange={(e) => set({ value: e.target.value })} placeholder="as printed, e.g. $83,421.17" />
        </label>
        {isMoney(concept) && (
          <label>
            <span>Currency</span>
            <select value={form.currency} onChange={(e) => set({ currency: e.target.value })}>
              <option value="">Choose...</option>
              <option value="USD">USD ($)</option>
              <option value="ILS">ILS (₪)</option>
            </select>
          </label>
        )}
      </div>
      {valueHint && <p className="muted small">{valueHint}</p>}
      {concept?.periodType === "instant" && (
        <label>
          <span>As of date</span>
          <input type="date" value={form.instantDate} onChange={(e) => set({ instantDate: e.target.value })} />
        </label>
      )}
      {concept?.periodType === "duration" && (
        <div className="row">
          <label>
            <span>Period start</span>
            <input type="date" value={form.periodStart} onChange={(e) => set({ periodStart: e.target.value })} />
          </label>
          <label>
            <span>Period end</span>
            <input type="date" value={form.periodEnd} onChange={(e) => set({ periodEnd: e.target.value })} />
          </label>
        </div>
      )}
      <label>
        <span>Note (optional)</span>
        <input type="text" dir="auto" value={form.note} onChange={(e) => set({ note: e.target.value })} />
      </label>
    </div>
  );
}
