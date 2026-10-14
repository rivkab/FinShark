// People, institutions, accounts, concepts, terms.
import type { FastifyInstance } from "fastify";
import {
  isKnownCurrency,
  type AccountDto,
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
  setAccountNumber,
} from "../../db/repo.ts";
import { isIsoDate } from "../../facts/validate.ts";
import { badRequest, idParam, jsonBody, notFound, optEnum, optStr, reqInt, reqStr, type ApiContext, type Json } from "./common.ts";

type Row = Record<string, unknown>;

function instDto(r: Row): InstitutionDto {
  return {
    id: Number(r["id"]),
    name: String(r["name"]),
    altName: (r["alt_name"] as string | null) ?? null,
    country: String(r["country"]),
    language: r["language"] as Language,
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
    accountNumber: current?.value ?? null,
    identifiers,
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

function optDate(o: Json, k: string): string | undefined {
  const v = optStr(o, k);
  if (v !== undefined && !isIsoDate(v)) throw badRequest(`${k} must be a date (YYYY-MM-DD).`);
  return v;
}

export function registerReferenceRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const { db } = ctx;

  app.get("/api/people", async () => ({
    people: (db.prepare("SELECT id, display_name FROM people ORDER BY id").all() as Row[]).map(
      (r): PersonDto => ({ id: Number(r["id"]), displayName: String(r["display_name"]) }),
    ),
  }));

  app.post("/api/people", async (req, reply) => {
    const name = reqStr(jsonBody(req), "displayName").trim();
    if (name.length > 200) throw badRequest("displayName is too long.");
    const id = insertPerson(db, ctx.now, { displayName: name });
    return reply.code(201).send({ id, displayName: name } satisfies PersonDto);
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
    const id = insertInstitution(db, ctx.now, {
      name: reqStr(o, "name").trim(),
      country,
      ...(altName !== undefined ? { altName } : {}),
      ...(language !== undefined ? { language } : {}),
    });
    return reply.code(201).send(instDto(db.prepare("SELECT * FROM institutions WHERE id = ?").get(id) as Row));
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
    });
    if (accountNumber) setAccountNumber(db, ctx.now, id, accountNumber);
    return reply.code(201).send(loadAccounts(ctx, id)[0]);
  });

  app.put("/api/accounts/:id/account-number", async (req) => {
    const accountId = idParam(req);
    if (!db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(accountId)) throw notFound("Account");
    setAccountNumber(db, ctx.now, accountId, accountNumberField(jsonBody(req), true) ?? null);
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
