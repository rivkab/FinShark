// People, institutions, accounts, concepts, terms.
import type { FastifyInstance } from "fastify";
import { Decimal } from "decimal.js";
import {
  ACCOUNT_TYPES,
  INSTITUTION_KINDS,
  type InstitutionKind,
  isKnownCurrency,
  type AccountDto,
  type AccountOwnerDto,
  type AccountType,
  type ConceptDto,
  type InstitutionDto,
  type Language,
  type PersonDto,
  type TaxonomyDto,
} from "@finshark/shared";
import {
  ACCOUNT_NUMBER_KIND,
  insertAccount,
  insertAccountIdentifier,
  insertInstitution,
  insertPerson,
  normalizeAccountNumber,
  OWNER_ROLES,
  setAccountNumber,
  setAccountOwners,
  type AccountOwnerInput,
} from "../../db/repo.ts";
import { isIsoDate } from "../../facts/validate.ts";
import { HttpError, badRequest, idParam, jsonBody, notFound, optEnum, optStr, reqInt, reqStr, type ApiContext, type Json } from "./common.ts";

type Row = Record<string, unknown>;

function instDto(r: Row): InstitutionDto {
  return {
    id: Number(r["id"]),
    name: String(r["name"]),
    altName: (r["alt_name"] as string | null) ?? null,
    country: String(r["country"]),
    language: r["language"] as Language,
    kind: (r["kind"] as InstitutionKind | null) ?? null,
  };
}

export function loadAccounts(ctx: ApiContext, onlyId?: number): AccountDto[] {
  const rows = ctx.db
    .prepare(
      `SELECT a.*, i.name AS institution_name FROM accounts a JOIN institutions i ON i.id = a.institution_id
       ${onlyId === undefined ? "" : "WHERE a.id = ?"} ORDER BY a.id`,
    )
    .all(...(onlyId === undefined ? [] : [onlyId])) as Row[];
  const idents = ctx.db.prepare("SELECT * FROM account_identifiers WHERE account_id = ? ORDER BY id");
  const ownerRows = ctx.db.prepare(
    "SELECT person_id, role, share FROM account_owners WHERE account_id = ? AND valid_to IS NULL ORDER BY id",
  );
  return rows.map((r) => {
    const identifiers = (idents.all(Number(r["id"])) as Row[]).map((x) => ({
      id: Number(x["id"]),
      kind: String(x["kind"]),
      value: String(x["value"]),
      validFrom: (x["valid_from"] as string | null) ?? null,
      validTo: (x["valid_to"] as string | null) ?? null,
    }));
    const current = identifiers.filter((i) => i.kind === ACCOUNT_NUMBER_KIND && i.validTo === null).at(-1);
    return {
    id: Number(r["id"]),
    institutionId: Number(r["institution_id"]),
    institutionName: String(r["institution_name"]),
    displayName: String(r["display_name"]),
    altName: (r["alt_name"] as string | null) ?? null,
    country: String(r["country"]),
    language: r["language"] as Language,
    nativeCurrency: String(r["native_currency"]),
    openedOn: (r["opened_on"] as string | null) ?? null,
    closedOn: (r["closed_on"] as string | null) ?? null,
    statementCadence: (r["statement_cadence"] as string | null) ?? null,
    accountType: (r["account_type"] as AccountType | null) ?? null,
    notes: (r["notes"] as string | null) ?? null,
    accountNumber: current?.value ?? null,
    identifiers,
    owners: (ownerRows.all(Number(r["id"])) as Row[]).map(
      (o): AccountOwnerDto => ({
        personId: Number(o["person_id"]),
        role: o["role"] as AccountOwnerDto["role"],
        share: (o["share"] as string | null) ?? null,
      }),
    ),
    };
  });
}

/** Validated account number from a request body field, or undefined if absent. */
function accountNumberField(o: Json, required: boolean): string | null | undefined {
  const v = o["accountNumber"];
  if (v === undefined && !required) return undefined;
  if (v === null || (typeof v === "string" && v.trim() === "")) return null;
  if (typeof v !== "string") throw badRequest("accountNumber must be a string or null.");
  try {
    return normalizeAccountNumber(v);
  } catch (e) {
    throw badRequest((e as Error).message);
  }
}

/** Validated owners from a request body: at least one, known people, no repeats. */
const MAX_NOTES = 2000;

/** Notes from a request body: trimmed; blank or null means none (null). undefined when the field is absent. */
function notesField(o: Json, k: string): string | null | undefined {
  const v = o[k];
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") throw badRequest(`${k} must be a string or null.`);
  const t = v.trim();
  if (t.length > MAX_NOTES) throw badRequest(`${k} may be at most ${MAX_NOTES} characters.`);
  return t === "" ? null : t;
}

function ownersField(ctx: ApiContext, o: Json): AccountOwnerInput[] {
  const raw = o["owners"];
  if (!Array.isArray(raw) || raw.length === 0) throw badRequest("An account needs at least one owner.");
  const seen = new Set<string>();
  return raw.map((item: unknown): AccountOwnerInput => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) throw badRequest("Each owner must be an object.");
    const e = item as Json;
    const personId = reqInt(e, "personId");
    const person = ctx.db.prepare("SELECT owns_accounts FROM people WHERE id = ?").get(personId) as Row | undefined;
    if (!person) throw badRequest(`No such person: ${personId}`);
    if (person["owns_accounts"] !== 1) throw badRequest(`This person is not marked as an account owner: ${personId}`);
    const role = optEnum(e, "role", OWNER_ROLES) ?? "owner";
    let share: string | null = null;
    const rawShare = e["share"];
    if (rawShare !== undefined && rawShare !== null) {
      if (typeof rawShare !== "string") throw badRequest("share must be a decimal string like \"0.5\", or null.");
      let d: Decimal;
      try {
        d = new Decimal(rawShare.trim());
      } catch {
        throw badRequest(`share must be a decimal fraction, got "${rawShare}".`);
      }
      if (!d.gt(0) || d.gt(1)) throw badRequest("share must be greater than 0 and at most 1.");
      share = d.toFixed();
    }
    const key = `${personId}|${role}`;
    if (seen.has(key)) throw badRequest("The same person is listed twice with the same role.");
    seen.add(key);
    return { personId, role, share };
  });
}

function optDate(o: Json, k: string): string | undefined {
  const v = optStr(o, k);
  if (v !== undefined && !isIsoDate(v)) throw badRequest(`${k} must be a date (YYYY-MM-DD).`);
  return v;
}

export function registerReferenceRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const { db } = ctx;

  const personDto = (r: Row): PersonDto => ({
    id: Number(r["id"]),
    displayName: String(r["display_name"]),
    ownsAccounts: r["owns_accounts"] === 1,
    usesApp: r["uses_app"] === 1,
  });
  const boolField = (o: Json, k: string): boolean | undefined => {
    const v = o[k];
    if (v === undefined) return undefined;
    if (typeof v !== "boolean") throw badRequest(`${k} must be true or false.`);
    return v;
  };

  app.get("/api/people", async () => ({
    people: (db.prepare("SELECT * FROM people ORDER BY id").all() as Row[]).map(personDto),
  }));

  // Names are how people are told apart in history and attributions, so they must be unique
  // (case-insensitive). `exceptId` lets a person keep their own name when renaming.
  const cleanName = (raw: string, exceptId?: number): string => {
    const name = raw.trim();
    if (name === "") throw badRequest("displayName must not be blank.");
    if (name.length > 200) throw badRequest("displayName is too long.");
    const taken = (db.prepare("SELECT id, display_name FROM people").all() as Row[]).some(
      (r) => Number(r["id"]) !== exceptId && String(r["display_name"]).toLocaleLowerCase() === name.toLocaleLowerCase(),
    );
    if (taken) throw new HttpError(409, "duplicate_name", `There is already someone called ${name}.`);
    return name;
  };

  app.post("/api/people", async (req, reply) => {
    const name = cleanName(reqStr(jsonBody(req), "displayName"));
    const o = jsonBody(req);
    const ownsAccounts = boolField(o, "ownsAccounts") ?? true;
    const usesApp = boolField(o, "usesApp") ?? true;
    if (!ownsAccounts && !usesApp) throw badRequest("A person must own accounts, use FinShark, or both.");
    const id = insertPerson(db, ctx.now, { displayName: name, ownsAccounts, usesApp });
    return reply.code(201).send(personDto(db.prepare("SELECT * FROM people WHERE id = ?").get(id) as Row));
  });

  // History resolves names through people.id (fact_events.actor, verified_by), so a rename shows everywhere.
  app.put("/api/people/:id/name", async (req) => {
    const id = idParam(req);
    if (!db.prepare("SELECT 1 FROM people WHERE id = ?").get(id)) throw notFound("Person");
    const name = cleanName(reqStr(jsonBody(req), "displayName"), id);
    db.prepare("UPDATE people SET display_name = ? WHERE id = ?").run(name, id);
    return personDto(db.prepare("SELECT * FROM people WHERE id = ?").get(id) as Row);
  });

  app.put("/api/people/:id/roles", async (req) => {
    const id = idParam(req);
    if (!db.prepare("SELECT 1 FROM people WHERE id = ?").get(id)) throw notFound("Person");
    const o = jsonBody(req);
    const ownsAccounts = boolField(o, "ownsAccounts");
    const usesApp = boolField(o, "usesApp");
    if (ownsAccounts === undefined || usesApp === undefined) throw badRequest("ownsAccounts and usesApp are required.");
    if (!ownsAccounts && !usesApp) throw badRequest("A person must own accounts, use FinShark, or both.");
    if (!ownsAccounts && db.prepare("SELECT 1 FROM account_owners WHERE person_id = ? AND valid_to IS NULL LIMIT 1").get(id)) {
      throw new HttpError(409, "person_owns_accounts", "This person is a current owner of an account. Change those accounts' owners first.");
    }
    if (!usesApp && req.session?.personId === String(id)) {
      throw new HttpError(409, "person_is_using", "You are using FinShark as this person. Switch to someone else first.");
    }
    db.prepare("UPDATE people SET owns_accounts = ?, uses_app = ? WHERE id = ?").run(ownsAccounts ? 1 : 0, usesApp ? 1 : 0, id);
    return personDto(db.prepare("SELECT * FROM people WHERE id = ?").get(id) as Row);
  });

  app.get("/api/institutions", async () => ({
    institutions: (db.prepare("SELECT * FROM institutions ORDER BY id").all() as Row[]).map(instDto),
  }));

  app.post("/api/institutions", async (req, reply) => {
    const o = jsonBody(req);
    const country = reqStr(o, "country").trim();
    if (!/^[A-Za-z]{2}$/.test(country)) throw badRequest("country must be a 2-letter ISO 3166-1 code.");
    const altName = optStr(o, "altName");
    const language = optEnum<Language>(o, "language", ["en", "he"]);
    const kind = optEnum<InstitutionKind>(o, "kind", INSTITUTION_KINDS);
    const id = insertInstitution(db, ctx.now, {
      name: reqStr(o, "name").trim(),
      country,
      ...(altName !== undefined ? { altName } : {}),
      ...(language !== undefined ? { language } : {}),
      ...(kind !== undefined ? { kind } : {}),
    });
    return reply.code(201).send(instDto(db.prepare("SELECT * FROM institutions WHERE id = ?").get(id) as Row));
  });

  app.put("/api/institutions/:id/kind", async (req) => {
    const id = idParam(req);
    if (!db.prepare("SELECT 1 FROM institutions WHERE id = ?").get(id)) throw notFound("Institution");
    const o = jsonBody(req);
    // null clears the kind; anything else must be one of INSTITUTION_KINDS.
    const kind = o["kind"] === null ? null : optEnum<InstitutionKind>(o, "kind", INSTITUTION_KINDS);
    if (kind === undefined) throw badRequest("kind is required (use null to clear it).");
    db.prepare("UPDATE institutions SET kind = ? WHERE id = ?").run(kind, id);
    return instDto(db.prepare("SELECT * FROM institutions WHERE id = ?").get(id) as Row);
  });

  app.get("/api/accounts", async () => ({ accounts: loadAccounts(ctx) }));

  app.post("/api/accounts", async (req, reply) => {
    const o = jsonBody(req);
    const institutionId = reqInt(o, "institutionId");
    if (!db.prepare("SELECT 1 FROM institutions WHERE id = ?").get(institutionId)) throw badRequest(`No such institution: ${institutionId}`);
    const nativeCurrency = reqStr(o, "nativeCurrency").trim().toUpperCase();
    if (!isKnownCurrency(nativeCurrency)) throw badRequest(`Unknown currency: ${nativeCurrency}`);
    const altName = optStr(o, "altName");
    const country = optStr(o, "country");
    if (country !== undefined && !/^[A-Za-z]{2}$/.test(country)) throw badRequest("country must be a 2-letter ISO 3166-1 code.");
    const language = optEnum<Language>(o, "language", ["en", "he"]);
    const openedOn = optDate(o, "openedOn");
    const closedOn = optDate(o, "closedOn");
    const cadence = optEnum(o, "statementCadence", ["monthly", "quarterly", "semiannual", "annual", "irregular"] as const);
    const accountNumber = accountNumberField(o, false);
    const accountType = optEnum<AccountType>(o, "accountType", ACCOUNT_TYPES);
    const notes = notesField(o, "notes");
    const owners = ownersField(ctx, o);
    const id = insertAccount(db, ctx.now, {
      institutionId,
      displayName: reqStr(o, "displayName").trim(),
      nativeCurrency,
      ...(altName !== undefined ? { altName } : {}),
      ...(country !== undefined ? { country } : {}),
      ...(language !== undefined ? { language } : {}),
      ...(openedOn !== undefined ? { openedOn } : {}),
      ...(closedOn !== undefined ? { closedOn } : {}),
      ...(cadence !== undefined ? { statementCadence: cadence } : {}),
      ...(accountType !== undefined ? { accountType } : {}),
      ...(notes ? { notes } : {}),
    });
    if (accountNumber) setAccountNumber(db, ctx.now, id, accountNumber);
    setAccountOwners(db, ctx.now, id, owners);
    return reply.code(201).send(loadAccounts(ctx, id)[0]);
  });

  app.put("/api/accounts/:id/notes", async (req) => {
    const accountId = idParam(req);
    if (!db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(accountId)) throw notFound("Account");
    const notes = notesField(jsonBody(req), "notes");
    if (notes === undefined) throw badRequest("notes is required (use null to clear it).");
    db.prepare("UPDATE accounts SET notes = ? WHERE id = ?").run(notes, accountId);
    return loadAccounts(ctx, accountId)[0];
  });

  app.put("/api/accounts/:id/type", async (req) => {
    const accountId = idParam(req);
    if (!db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(accountId)) throw notFound("Account");
    const o = jsonBody(req);
    // null clears the type; anything else must be one of ACCOUNT_TYPES.
    const accountType = o["accountType"] === null ? null : optEnum<AccountType>(o, "accountType", ACCOUNT_TYPES);
    if (accountType === undefined) throw badRequest("accountType is required (use null to clear it).");
    db.prepare("UPDATE accounts SET account_type = ? WHERE id = ?").run(accountType, accountId);
    return loadAccounts(ctx, accountId)[0];
  });

  app.put("/api/accounts/:id/name", async (req) => {
    const accountId = idParam(req);
    if (!db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(accountId)) throw notFound("Account");
    const o = jsonBody(req);
    const displayName = reqStr(o, "displayName").trim();
    if (displayName === "") throw badRequest("displayName must not be empty.");
    // altName: absent keeps the current one; null or blank clears it.
    const rawAlt = o["altName"];
    if (rawAlt !== undefined && rawAlt !== null && typeof rawAlt !== "string") throw badRequest("altName must be a string or null.");
    if (rawAlt === undefined) {
      db.prepare("UPDATE accounts SET display_name = ? WHERE id = ?").run(displayName, accountId);
    } else {
      const altName = rawAlt === null || rawAlt.trim() === "" ? null : rawAlt.trim();
      db.prepare("UPDATE accounts SET display_name = ?, alt_name = ? WHERE id = ?").run(displayName, altName, accountId);
    }
    return loadAccounts(ctx, accountId)[0];
  });

  app.put("/api/accounts/:id/account-number", async (req) => {
    const accountId = idParam(req);
    if (!db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(accountId)) throw notFound("Account");
    setAccountNumber(db, ctx.now, accountId, accountNumberField(jsonBody(req), true) ?? null);
    return loadAccounts(ctx, accountId)[0];
  });

  app.put("/api/accounts/:id/owners", async (req) => {
    const accountId = idParam(req);
    if (!db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(accountId)) throw notFound("Account");
    setAccountOwners(db, ctx.now, accountId, ownersField(ctx, jsonBody(req)));
    return loadAccounts(ctx, accountId)[0];
  });

  app.post("/api/accounts/:id/identifiers", async (req, reply) => {
    const accountId = idParam(req);
    if (!db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(accountId)) throw notFound("Account");
    const o = jsonBody(req);
    const validFrom = optDate(o, "validFrom");
    const validTo = optDate(o, "validTo");
    insertAccountIdentifier(db, {
      accountId,
      kind: reqStr(o, "kind").trim(),
      value: reqStr(o, "value").trim(),
      ...(validFrom !== undefined ? { validFrom } : {}),
      ...(validTo !== undefined ? { validTo } : {}),
    });
    return reply.code(201).send(loadAccounts(ctx, accountId)[0]);
  });

  app.get("/api/concepts", async () => ({
    concepts: (db.prepare("SELECT * FROM concepts ORDER BY id").all() as Row[]).map(
      (r): ConceptDto => ({
        id: String(r["id"]),
        labelEn: String(r["label_en"]),
        labelHe: (r["label_he"] as string | null) ?? null,
        description: (r["description"] as string | null) ?? null,
        periodType: r["period_type"] as ConceptDto["periodType"],
        valueType: r["value_type"] as ConceptDto["valueType"],
        subject: r["subject"] as ConceptDto["subject"],
        genericConceptId: (r["generic_concept_id"] as string | null) ?? null,
        jurisdiction: (r["jurisdiction"] as string | null) ?? null,
        authorityRank: Number(r["authority_rank"]),
        deprecatedBy: (r["deprecated_by"] as string | null) ?? null,
      }),
    ),
  }));

  app.get("/api/terms", async () => {
    const terms = db.prepare("SELECT * FROM terms ORDER BY id").all() as Row[];
    return {
      taxonomies: (db.prepare("SELECT * FROM taxonomies ORDER BY id").all() as Row[]).map(
        (t): TaxonomyDto => ({
          id: String(t["id"]),
          labelEn: String(t["label_en"]),
          labelHe: (t["label_he"] as string | null) ?? null,
          terms: terms
            .filter((x) => x["taxonomy_id"] === t["id"])
            .map((x) => ({
              id: String(x["id"]),
              taxonomyId: String(x["taxonomy_id"]),
              parentTermId: (x["parent_term_id"] as string | null) ?? null,
              labelEn: String(x["label_en"]),
              labelHe: (x["label_he"] as string | null) ?? null,
            })),
        }),
      ),
    };
  });
}
