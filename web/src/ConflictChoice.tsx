import { useState } from "react";
import type { FactDto } from "@finshark/shared";
import { api, ApiError } from "./api.ts";
import { useActor } from "./context.tsx";
import { hrefDocument, hrefFact } from "./route.ts";
import { FactAmount, useAction } from "./ui.tsx";
import { Alert, Button, DataText, Inline, Link, List, ListItem, Stack, Text } from "./ds/index.ts";

/**
 * A number that could not be verified because a different value is already verified for the same
 * kind of number, account, person and date. The person picks which one is right; nothing is chosen
 * for them (DESIGN §4.5). The losing number is deleted with a reason and stays in the history.
 */
export function ConflictChoice({
  fact,
  conflicts: initial,
  onDone,
}: {
  fact: FactDto;
  conflicts: FactDto[];
  onDone: (outcome: "replaced" | "kept") => void | Promise<void>;
}) {
  const { mutate } = useActor();
  const [conflicts, setConflicts] = useState(initial);
  const act = useAction((job: () => Promise<unknown>) => job());
  const ids = conflicts.map((c) => `#${c.id}`).join(", ");

  const replace = async () => {
    const ok = await act.run(async () => {
      try {
        await mutate(() => api.facts.verify(fact.id, conflicts.map((c) => c.id)));
      } catch (e) {
        // Something else was verified for the same slot meanwhile: show the current list and let them choose again.
        if (e instanceof ApiError && e.conflicts) {
          const sent = conflicts.map((c) => c.id).toSorted().join();
          const now = e.conflicts.map((c) => c.id).toSorted().join();
          if (sent === now) throw new Error("The server did not replace the old value. Nothing was changed.");
          setConflicts(e.conflicts);
          throw new Error("The verified values changed meanwhile. Check the list and choose again.");
        }
        throw e;
      }
    });
    if (ok) await onDone("replaced");
  };
  const keep = async () => {
    const ok = await act.run(() =>
      mutate(() => api.facts.reject(fact.id, `Kept ${ids} instead`)),
    );
    if (ok) await onDone("kept");
  };

  return (
    <Alert tone="warning">
      <Stack gap={2}>
        <Text>
          <FactAmount fact={fact} /> conflicts with {conflicts.length === 1 ? "a value" : "values"} already verified for the same kind of number, account,
          person and date:
        </Text>
        <List>
          {conflicts.map((c) => (
            <ListItem key={c.id}>
              <Inline gap={2} align="baseline">
                <Link href={hrefFact(c.id)}>#{c.id}</Link>
                <FactAmount fact={c} />
                {c.sources[0] ? (
                  <Text size="sm" tone="muted">
                    from <Link href={hrefDocument(c.sources[0].documentId, c.id)}><DataText>{c.sources[0].documentName}</DataText></Link>
                    {c.sources[0].pageNo !== null && <>, page {c.sources[0].pageNo}</>}
                  </Text>
                ) : (
                  <Text size="sm" tone="muted">a person's statement</Text>
                )}
              </Inline>
            </ListItem>
          ))}
        </List>
        <Text size="sm" tone="muted">The one not chosen is deleted with a note saying why. It stays in the history and can be reopened.</Text>
        <Inline>
          <Button variant="primary" busy={act.busy} onClick={() => void replace()}>
            Use <FactAmount fact={fact} /> instead
          </Button>
          <Button disabled={act.busy} onClick={() => void keep()}>
            Keep {conflicts.length === 1 ? <FactAmount fact={conflicts[0]!} /> : "the verified values"}
          </Button>
        </Inline>
        {act.error && <Text tone="danger">{act.error}</Text>}
      </Stack>
    </Alert>
  );
}
