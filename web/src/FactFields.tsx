import type { AccountDto, ConceptDto } from "@finshark/shared";
import type { PeriodSource } from "./dates.ts";
import { applyConceptChange, isMoney, type FactFormState } from "./factForm.ts";
import { useRefData } from "./context.tsx";
import { DateInput, Field, FieldRow, Select, Stack, Text, TextInput } from "./ds/index.ts";
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
  const { people } = useRefData();
  const concept = concepts.find((c) => c.id === form.conceptId);
  const set = (patch: Partial<FactFormState>) => onChange({ ...form, ...patch });

  const onConcept = (c: ConceptDto) => onChange(applyConceptChange(form, c, concept, period));
  const onAccount = (v: string) => {
    const a = accounts.find((x) => String(x.id) === v);
    set({ accountId: v, ...(a ? { currency: a.nativeCurrency } : {}) });
  };

  return (
    <Stack gap={3}>
      <Field label="Kind of number">
        <ConceptPicker concepts={concepts} value={form.conceptId} onChange={onConcept} />
      </Field>
      {concept?.subject !== "person" && (
        <Field label="Account">
          <AccountSelect accounts={accounts} institutionId={institutionId} value={form.accountId} onChange={onAccount} noneLabel="Choose an account..." />
        </Field>
      )}
      {concept?.subject === "person" && (
        <Field label="Person">
          <Select
            value={form.personId}
            onChange={(v) => set({ personId: v })}
            placeholder="Choose a person..."
            options={people.filter((p) => p.ownsAccounts).map((p) => ({ value: String(p.id), label: p.displayName, dir: "auto" }))}
          />
        </Field>
      )}
      <FieldRow>
        <Field label="Value" grow>
          <TextInput value={form.value} onChange={(v) => set({ value: v })} placeholder="as printed, e.g. $83,421.17" />
        </Field>
        {isMoney(concept) && (
          <Field label="Currency">
            <Select
              value={form.currency}
              onChange={(v) => set({ currency: v })}
              placeholder="Choose..."
              options={[
                { value: "USD", label: "USD ($)" },
                { value: "ILS", label: "ILS (₪)" },
              ]}
            />
          </Field>
        )}
      </FieldRow>
      {valueHint && <Text as="p" tone="muted" size="sm">{valueHint}</Text>}
      {concept?.periodType === "instant" && (
        <Field label="As of date">
          <DateInput value={form.instantDate} onChange={(v) => set({ instantDate: v })} />
        </Field>
      )}
      {concept?.periodType === "duration" && (
        <FieldRow>
          <Field label="Period start">
            <DateInput value={form.periodStart} onChange={(v) => set({ periodStart: v })} />
          </Field>
          <Field label="Period end">
            <DateInput value={form.periodEnd} onChange={(v) => set({ periodEnd: v })} />
          </Field>
        </FieldRow>
      )}
      <Field label="Note (optional)">
        <TextInput value={form.note} onChange={(v) => set({ note: v })} />
      </Field>
    </Stack>
  );
}
