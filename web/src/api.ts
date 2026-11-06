// Same-origin API client. Mutations attach the per-session CSRF token (DESIGN §9).
import type {
  AccountDto,
  ApiErrorBody,
  BackupConfirmRequest,
  BackupFileDto,
  BackupImportKeyRequest,
  BackupSecondFolderRequest,
  BackupSetupRequest,
  BackupSetupResponse,
  BackupStatusDto,
  ConceptDto,
  ConflictDetails,
  CorrectFactRequest,
  CreateAccountRequest,
  CreateInstitutionRequest,
  CreatePersonRequest,
  DocumentDetailDto,
  DocumentDto,
  ExchangeRateDto,
  FactDetailDto,
  FactDto,
  FactStatus,
  FbarReportDto,
  ImportRatesResponse,
  InstitutionDto,
  InstitutionKind,
  PersonDto,
  ProposeFactRequest,
  ProposeFactResponse,
  RenamePersonRequest,
  SetAccountCadenceRequest,
  SetAccountNameRequest,
  SetAccountNotesRequest,
  SetAccountNumberRequest,
  SetAccountOwnersRequest,
  SetAccountTypeRequest,
  SetPersonRolesRequest,
  TaxonomyDto,
  UpdateDocumentRequest,
  UploadResponse,
} from "@finshark/shared";

export interface SessionInfo {
  csrfToken: string;
  personId: string | null;
}

let csrfToken: string | null = null;

export class ApiError extends Error {
  readonly status: number;
  /** The server's error code ("choose_person", "conflict", ...), when the body had one. */
  readonly code: string | null;
  readonly details: unknown;
  constructor(status: number, message: string, code: string | null = null, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
  /** Verified facts that block verification (409 conflict), else null. */
  get conflicts(): FactDto[] | null {
    if (this.code !== "conflict") return null;
    const d = this.details as Partial<ConflictDetails> | undefined;
    return Array.isArray(d?.conflicts) ? d.conflicts : null;
  }
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function fetchSession(): Promise<SessionInfo> {
  const res = await fetch("/api/session", { credentials: "same-origin" });
  if (!res.ok) throw new ApiError(res.status, "session unavailable");
  const info = (await res.json()) as SessionInfo;
  csrfToken = info.csrfToken;
  return info;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function toError(res: Response, method: string, path: string): Promise<ApiError> {
  let body: Partial<ApiErrorBody> | null = null;
  try {
    body = (await res.json()) as Partial<ApiErrorBody>;
  } catch {
    // not JSON
  }
  const message = body?.message ?? `${method} ${path} failed (${res.status})`;
  return new ApiError(res.status, message, typeof body?.error === "string" ? body.error : null, body?.details);
}

/** fetch() for our own API: JSON in/out, CSRF header on mutations. */
async function apiFetch<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (MUTATING.has(method)) {
    if (!csrfToken) await fetchSession();
    headers["X-FinShark-CSRF"] = csrfToken!;
  }
  const hasBody = init.body !== undefined;
  if (hasBody) headers["Content-Type"] = "application/json";
  const res = await fetch(path, {
    method,
    headers,
    credentials: "same-origin",
    ...(hasBody ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!res.ok) throw await toError(res, method, path);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** Upload one PDF as the raw request body. */
async function uploadPdf(file: File): Promise<UploadResponse> {
  if (!csrfToken) await fetchSession();
  const path = "/api/documents";
  const res = await fetch(path, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/pdf",
      "X-Filename": encodeURIComponent(file.name),
      "X-FinShark-CSRF": csrfToken!,
    },
    credentials: "same-origin",
    body: file,
  });
  if (!res.ok) throw await toError(res, "POST", path);
  return (await res.json()) as UploadResponse;
}

/** Import a US Treasury Reporting Rates of Exchange CSV as the raw request body. */
async function uploadRatesCsv(file: File, note: string): Promise<ImportRatesResponse> {
  if (!csrfToken) await fetchSession();
  const path = `/api/exchange-rates/import${note.trim() ? `?note=${encodeURIComponent(note.trim())}` : ""}`;
  const res = await fetch(path, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "text/csv", "X-FinShark-CSRF": csrfToken! },
    credentials: "same-origin",
    body: await file.text(),
  });
  if (!res.ok) throw await toError(res, "POST", path);
  return (await res.json()) as ImportRatesResponse;
}

function qs(params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

export interface FactFilter {
  status?: FactStatus;
  concept?: string;
  account?: number;
  document?: number;
  person?: number;
}

const send = <T>(method: string, path: string, body?: unknown): Promise<T> => apiFetch<T>(path, { method, body });

/** The whole HTTP API as plain functions. Components use this, never paths. */
export const api = {
  session: {
    get: fetchSession,
    setPerson: (personId: string): Promise<{ personId: string }> => send("POST", "/api/session/person", { personId }),
  },

  people: {
    list: () => apiFetch<{ people: PersonDto[] }>("/api/people").then((r) => r.people),
    create: (body: CreatePersonRequest) => send<PersonDto>("POST", "/api/people", body),
    rename: (id: number, displayName: string) => send<PersonDto>("PUT", `/api/people/${id}/name`, { displayName } satisfies RenamePersonRequest),
    setRoles: (id: number, body: SetPersonRolesRequest) => send<PersonDto>("PUT", `/api/people/${id}/roles`, body),
  },

  institutions: {
    list: () => apiFetch<{ institutions: InstitutionDto[] }>("/api/institutions").then((r) => r.institutions),
    create: (body: CreateInstitutionRequest) => send<InstitutionDto>("POST", "/api/institutions", body),
    setKind: (id: number, kind: InstitutionKind | null) => send<InstitutionDto>("PUT", `/api/institutions/${id}/kind`, { kind }),
  },

  accounts: {
    list: () => apiFetch<{ accounts: AccountDto[] }>("/api/accounts").then((r) => r.accounts),
    create: (body: CreateAccountRequest) => send<AccountDto>("POST", "/api/accounts", body),
    setName: (id: number, body: SetAccountNameRequest) => send<AccountDto>("PUT", `/api/accounts/${id}/name`, body),
    setType: (id: number, body: SetAccountTypeRequest) => send<AccountDto>("PUT", `/api/accounts/${id}/type`, body),
    setCadence: (id: number, body: SetAccountCadenceRequest) => send<AccountDto>("PUT", `/api/accounts/${id}/cadence`, body),
    setNotes: (id: number, body: SetAccountNotesRequest) => send<AccountDto>("PUT", `/api/accounts/${id}/notes`, body),
    setOwners: (id: number, body: SetAccountOwnersRequest) => send<AccountDto>("PUT", `/api/accounts/${id}/owners`, body),
    setNumber: (id: number, body: SetAccountNumberRequest) => send<AccountDto>("PUT", `/api/accounts/${id}/account-number`, body),
  },

  reference: {
    concepts: () => apiFetch<{ concepts: ConceptDto[] }>("/api/concepts").then((r) => r.concepts),
    taxonomies: () => apiFetch<{ taxonomies: TaxonomyDto[] }>("/api/terms").then((r) => r.taxonomies),
  },

  documents: {
    list: () => apiFetch<{ documents: DocumentDto[] }>("/api/documents").then((r) => r.documents),
    get: (id: number) => apiFetch<DocumentDetailDto>(`/api/documents/${id}`),
    /** URL of the stored PDF, for the viewer. */
    fileUrl: (id: number) => `/api/documents/${id}/file`,
    upload: uploadPdf,
    update: (id: number, body: UpdateDocumentRequest) => send<unknown>("PATCH", `/api/documents/${id}`, body),
    linkAccount: (id: number, accountId: number) => send<unknown>("POST", `/api/documents/${id}/accounts`, { accountId }),
  },

  facts: {
    list: (filter: FactFilter = {}) => apiFetch<{ facts: FactDto[] }>(`/api/facts${qs({ ...filter })}`).then((r) => r.facts),
    get: (id: number) => apiFetch<FactDetailDto>(`/api/facts/${id}`),
    propose: (body: ProposeFactRequest) => send<ProposeFactResponse>("POST", "/api/facts", body),
    verify: (id: number, replace?: number[]) =>
      send<{ fact: FactDto }>("POST", `/api/facts/${id}/verify`, replace ? { replace } : {}).then((r) => r.fact),
    correct: (id: number, body: CorrectFactRequest) => send<{ fact: FactDto }>("POST", `/api/facts/${id}/correct`, body).then((r) => r.fact),
    reject: (id: number, reason: string) => send<{ fact: FactDto }>("POST", `/api/facts/${id}/reject`, { reason }).then((r) => r.fact),
    reopen: (id: number) => send<{ fact: FactDto }>("POST", `/api/facts/${id}/reopen`, {}).then((r) => r.fact),
  },

  rates: {
    list: () => apiFetch<{ rates: ExchangeRateDto[] }>("/api/exchange-rates").then((r) => r.rates),
    importCsv: uploadRatesCsv,
  },

  fbar: {
    report: (year?: number | null) => apiFetch<FbarReportDto>(`/api/fbar${qs({ year: year ?? undefined })}`),
  },

  backups: {
    status: () => apiFetch<BackupStatusDto>("/api/backups"),
    run: () => send<BackupFileDto>("POST", "/api/backups"),
    verify: (name: string) => send<BackupFileDto>("POST", `/api/backups/${encodeURIComponent(name)}/verify`),
    setup: (body: BackupSetupRequest) => send<BackupSetupResponse>("POST", "/api/backups/setup", body),
    confirmSetup: (body: BackupConfirmRequest) => send<BackupStatusDto>("POST", "/api/backups/setup/confirm", body),
    importKey: (body: BackupImportKeyRequest) => send<BackupStatusDto>("POST", "/api/backups/key", body),
    setSecondFolder: (body: BackupSecondFolderRequest) => send<BackupStatusDto>("PUT", "/api/backups/second-folder", body),
    chooseSecondFolder: () => send<BackupStatusDto>("POST", "/api/backups/second-folder/choose"),
  },
};
