import { useState } from "react";
import type { DocumentDto, FactDetailDto, FactDto, FactEventDto } from "@finshark/shared";
import { ApiError, apiFetch } from "./api.ts";
import { useActor, useRefData } from "./context.tsx";
import { hrefDocument, hrefFact } from "./route.ts";
import { factDateLabel } from "./suggest.ts";
import { AccountName, FactAmount, FactConcept, StatusBadge, useAction, useLoad } from "./ui.tsx";
import { FactFormFields } from "./FactFields.tsx";
import { buildCorrectRequest, formFromFact, mismatchWarning, validateFactForm, type FactFormState } from "./factForm.ts";
import {
  Alert,
  Button,
  Checkbox,
  DataText,
  Empty,
  Field,
  FieldRow,
  Form,
  Inline,
  KeyValues,
  Link,
  LinkButton,
  List,
  ListItem,
  Loading,
  Page,
  Panel,
  Section,
  Select,
  Stack,
  Table,
  TableBody,
  TableHead,
  Td,
  Text,
  TextInput,
  Th,
  Timeline,
  TimelineItem,
  Tr,
  Value,
} from "./ds/index.ts";

// ---------------------------------------------------------------- history

export function FactHistory({ id }: { id: number }) {
  const { mutate } = useActor();
  const { people, concepts, accounts } = useRefData();
  const detail = useLoad(() => apiFetch<FactDetailDto>(`/api/facts/${id}`), id);
  const [form, setForm] = useState<FactFormState | null>(null);
  const [deleteReason, setDeleteReason] = useState<string | null>(null);
  // One action at a time: its busy flag disables every button, its error shows below.
  const act = useAction((job: () => Promise<unknown>) => job());

  const back = { href: "#/accounts", label: "Accounts" };
  if (detail.error) {
    return (
      <Page back={back} title="Fact">
        <Alert tone="danger">{detail.error}</Alert>
      </Page>
    );
  }
  if (!detail.data) return <Page back={back} title="Fact"><Loading /></Page>;
  const { fact: f, events, supersedes, supersededBy } = detail.data;
  const warning = mismatchWarning(f.valueMatchesSource, f.sources[0]?.quotedText ?? null);

  const reopen = async () => {
    if (await act.run(() => mutate(() => apiFetch(`/api/facts/${id}/reopen`, { method: "POST", body: {} })))) await detail.reload();
  };
  const remove = async () => {
    if (act.busy || deleteReason === null) return;
    if (deleteReason.trim() === "") return act.setError("Say why this number is being deleted.");
    const ok = await act.run(() => mutate(() => apiFetch(`/api/facts/${id}/reject`, { method: "POST", body: { reason: deleteReason.trim() } })));
    if (!ok) return;
    setDeleteReason(null);
    await detail.reload();
  };
  const verify = async () => {
    if (act.busy) return;
    const ok = await act.run(async () => {
      try {
        await mutate(() => apiFetch(`/api/facts/${id}/verify`, { method: "POST", body: {} }));
      } catch (e) {
        throw e instanceof ApiError && e.conflicts
          ? new Error("Still conflicts: a different value is already verified for the same kind of number, account, person and date.")
          : e;
      }
    });
    if (ok) await detail.reload();
  };
  const submitCorrection = async (verify: boolean) => {
    if (!form || act.busy) return;
    const concept = concepts.find((c) => c.id === form.conceptId);
    const errs = validateFactForm(form, concept);
    if (errs.length || !concept) return act.setError(errs.join(" "));
    let created: FactDto | null = null;
    const ok = await act.run(async () => {
      created = (
        await mutate(() => apiFetch<{ fact: FactDto }>(`/api/facts/${id}/correct`, { method: "POST", body: buildCorrectRequest(form, concept, verify) }))
      ).fact;
    });
    if (!ok || !created) return;
    setForm(null);
    window.location.hash = hrefFact((created as FactDto).id).slice(1);
  };
  const who = (e: FactEventDto) => e.actorName ?? (e.actor !== null ? people.find((p) => p.id === e.actor)?.displayName : null) ?? "someone";

  const editable = f.status === "proposed" || f.status === "verified";
  const actions = (
    <>
      <StatusBadge status={f.status} />
      {f.status === "proposed" && !form && <Button variant="primary" busy={act.busy} onClick={() => void verify()}>Verify</Button>}
      {editable && !form && (
        <Button onClick={() => { act.setError(null); setForm(formFromFact(f)); }}>Correct this number</Button>
      )}
      {editable && !form && deleteReason === null && (
        <Button variant="danger" onClick={() => { act.setError(null); setDeleteReason(""); }}>Delete this number</Button>
      )}
      {f.status === "rejected" && <Button busy={act.busy} onClick={() => void reopen()}>Reopen</Button>}
    </>
  );

  return (
    <Page back={back} eyebrow={<>Fact #{f.id} · <FactConcept fact={f} /></>} title={<FactAmount fact={f} />} actions={actions}>
      <Stack gap={5}>
        <Panel>
          <Stack gap={4}>
            <KeyValues
              items={[
                { label: "Kind of number", value: <FactConcept fact={f} /> },
                { label: "Account", value: f.accountName ? <AccountName account={{ displayName: f.accountName, altName: null }} /> : <Text tone="muted">none</Text> },
                f.personName ? { label: "Person", value: <DataText>{f.personName}</DataText> } : null,
                { label: "Date", value: <Value>{factDateLabel(f)}</Value> },
                { label: "How it got here", value: f.origin === "attestation" ? "A person's statement (no document)" : f.origin },
                f.note ? { label: "Note", value: <DataText block>{f.note}</DataText> } : null,
              ]}
            />
            {warning && <Alert tone="warning">{warning}</Alert>}
          </Stack>
        </Panel>
        {deleteReason !== null && (
          <Panel title="Delete this number">
            <Form onSubmit={() => void remove()}>
              <Text as="p" size="sm" tone="muted">
                The number is marked deleted and no longer used in answers. It stays in the history, and you can reopen it later.
              </Text>
              <Field label="Why">
                <TextInput autoFocus value={deleteReason} onChange={setDeleteReason} />
              </Field>
              <Inline>
                <Button type="submit" variant="primary" busy={act.busy}>Delete</Button>
                <Button disabled={act.busy} onClick={() => { setDeleteReason(null); act.setError(null); }}>Cancel</Button>
              </Inline>
            </Form>
          </Panel>
        )}
        {form && (
          <Panel title="Correct this number">
            <Form onSubmit={() => void submitCorrection(true)}>
              {f.status === "verified" && (
                <Text as="p" size="sm" tone="muted">
                  Saving creates a new number that replaces this one; the old one stays in the history.
                </Text>
              )}
              <FactFormFields form={form} onChange={setForm} concepts={concepts} accounts={accounts} institutionId={null} period={{ periodStart: null, periodEnd: null }} />
              <Inline>
                <Button type="submit" variant="primary" busy={act.busy}>Save correction and verify</Button>
                <Button disabled={act.busy} onClick={() => void submitCorrection(false)}>Save without verifying</Button>
                <Button disabled={act.busy} onClick={() => { setForm(null); act.setError(null); }}>Cancel</Button>
              </Inline>
            </Form>
          </Panel>
        )}
        <Alert tone="danger">{act.error}</Alert>
      </Stack>

      <Section title="Sources">
        {f.sources.length === 0 ? (
          <Text as="p" tone="muted">No document. This is a statement made by a person; see the note above and the timeline below.</Text>
        ) : (
          <List divided>
            {f.sources.map((s) => (
              <ListItem key={s.id}>
                <Link href={hrefDocument(s.documentId, f.id)}><DataText>{s.documentName}</DataText></Link>
                {s.pageNo !== null && <>, page {s.pageNo}</>}
                {s.quotedText !== null && <> · text in the box: <Value>{s.quotedText.trim() || "(empty)"}</Value></>}
              </ListItem>
            ))}
          </List>
        )}
      </Section>

      <Section title="Timeline">
        <Timeline>
          {events.map((e) => (
            <TimelineItem key={e.id} time={<Value>{e.at.replace("T", " ").slice(0, 16)}</Value>}>
              <Stack gap={1}>
                <Text>
                  <DataText>{who(e)}</DataText> · <Text weight="semibold">{eventText(e)}</Text>
                </Text>
                <EventDetail e={e} />
              </Stack>
            </TimelineItem>
          ))}
        </Timeline>
      </Section>

      <Section title="Replacements">
        {supersedes.length === 0 && supersededBy.length === 0 ? (
          <Text as="p" tone="muted">This number has not been corrected or replaced.</Text>
        ) : (
          <List divided>
            {[...supersededBy].reverse().map((x) => <ChainRow key={x.id} f={x} label="Newer" />)}
            <ChainRow f={f} label="This one" current />
            {supersedes.map((x) => <ChainRow key={x.id} f={x} label="Older" />)}
          </List>
        )}
      </Section>
    </Page>
  );
}

function ChainRow({ f, label, current = false }: { f: FactDto; label: string; current?: boolean }) {
  return (
    <ListItem current={current}>
      <Inline gap={2} align="baseline">
        <Text tone="muted">{label}:</Text>
        {current ? <Value>#{f.id}</Value> : <Link href={hrefFact(f.id)}>#{f.id}</Link>}
        <FactAmount fact={f} />
        <StatusBadge status={f.status} />
      </Inline>
    </ListItem>
  );
}

function eventText(e: FactEventDto): string {
  switch (e.event) {
    case "proposed": return "added";
    case "verified": return "verified";
    case "corrected": return "corrected";
    case "rejected": return "deleted";
    case "superseded": return "replaced by a correction";
    case "reopened": return "reopened";
  }
}

function EventDetail({ e }: { e: FactEventDto }) {
  const p = e.payload;
  if (e.event === "rejected" && typeof p["reason"] === "string" && p["reason"]) return <Text as="div" size="sm">Reason: <DataText>{p["reason"]}</DataText></Text>;
  if (e.event === "corrected" && Array.isArray(p["changed"])) return <Text as="div" size="sm" tone="muted">Changed: {(p["changed"] as unknown[]).map(String).join(", ")}</Text>;
  if (e.event === "superseded" && typeof p["supersededBy"] === "number") return <Text as="div" size="sm">Replaced by <Link href={hrefFact(p["supersededBy"])}>#{p["supersededBy"]}</Link></Text>;
  if (e.event === "corrected" && typeof p["supersedes"] === "number") return <Text as="div" size="sm">Replaces <Link href={hrefFact(p["supersedes"])}>#{p["supersedes"]}</Link></Text>;
  return null;
}
