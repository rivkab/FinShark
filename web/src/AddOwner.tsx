import { useState } from "react";
import type { PersonDto } from "@finshark/shared";
import { useRefData } from "./context.tsx";
import { createPerson, setPersonRoles } from "./people.ts";
import { useAction } from "./ui.tsx";
import { Alert, Button, DataText, Field, FieldRow, Inline, Stack, TextInput } from "./ds/index.ts";

/**
 * "Add owner...": makes someone available as an account owner or as the person a number belongs to.
 * Either a new name, or an existing app user who does not own accounts yet (turning the flag on, so
 * the same human is not listed twice). Reloads the reference data, then hands the person back so the
 * caller can select them. Safe inside another form: it is not a form itself and Enter does not submit.
 */
export function AddOwner({ onOwner }: { onOwner: (person: PersonDto) => void }) {
  const { people, reload } = useRefData();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const promotable = people.filter((p) => p.usesApp && !p.ownsAccounts);

  const finish = async (p: PersonDto) => {
    await reload();
    setName("");
    setOpen(false);
    onOwner(p);
  };
  const add = useAction(async () => {
    await finish(await createPerson({ displayName: name.trim(), ownsAccounts: true, usesApp: false }));
  });
  const promote = useAction(async (p: PersonDto) => {
    await finish(await setPersonRoles(p.id, { ownsAccounts: true, usesApp: p.usesApp }));
  });

  const submit = () => {
    if (name.trim() === "") return add.setError("Enter a name.");
    void add.run();
  };
  const busy = add.busy || promote.busy;

  if (!open) {
    return <Inline><Button variant="link" onClick={() => setOpen(true)}>Add owner…</Button></Inline>;
  }
  return (
    <Stack gap={2}>
      {promotable.length > 0 && (
        <Inline gap={2}>
          {promotable.map((p) => (
            <Button key={p.id} size="sm" disabled={busy} onClick={() => void promote.run(p)}>
              Also an owner: <DataText>{p.displayName}</DataText>
            </Button>
          ))}
        </Inline>
      )}
      <FieldRow align="end">
        <Field label="New owner's name" grow>
          <TextInput value={name} onChange={setName} onEnter={submit} autoFocus />
        </Field>
        <Button onClick={submit} busy={add.busy} disabled={promote.busy}>Add owner</Button>
        <Button onClick={() => { setOpen(false); add.setError(null); promote.setError(null); }} disabled={busy}>Cancel</Button>
      </FieldRow>
      <Alert tone="danger">{add.error ?? promote.error}</Alert>
    </Stack>
  );
}
