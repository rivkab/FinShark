// Hash routing: "#/documents/12?fact=40".

export type Route =
  | { page: "documents"; accountId: number | null }
  | { page: "document"; id: number; factId: number | null }
  | { page: "facts"; filters: Record<string, string> }
  | { page: "fact"; id: number }
  | { page: "accounts" }
  | { page: "account"; id: number }
  | { page: "rates" }
  | { page: "fbar"; year: number | null }
  | { page: "demo" }
  | { page: "design" };

const ID = /^\d{1,15}$/;

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, "");
  const qi = raw.indexOf("?");
  const pathPart = qi < 0 ? raw : raw.slice(0, qi);
  const q = new URLSearchParams(qi < 0 ? "" : raw.slice(qi + 1));
  const segs = pathPart.split("/").filter(Boolean).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
  const qId = (k: string): number | null => {
    const v = q.get(k);
    return v !== null && ID.test(v) ? Number(v) : null;
  };
  const [head, second] = segs;
  switch (head) {
    case "documents":
      return second !== undefined && ID.test(second)
        ? { page: "document", id: Number(second), factId: qId("fact") }
        : { page: "documents", accountId: qId("account") };
    case "facts": {
      if (second !== undefined && ID.test(second)) return { page: "fact", id: Number(second) };
      const filters: Record<string, string> = {};
      for (const k of ["status", "removed", "concept", "account", "document"]) {
        const v = q.get(k);
        if (v) filters[k] = v;
      }
      return { page: "facts", filters };
    }
    case "accounts":
      return second !== undefined && ID.test(second) ? { page: "account", id: Number(second) } : { page: "accounts" };
    case "fbar": {
      const y = q.get("year");
      return { page: "fbar", year: y !== null && /^\d{4}$/.test(y) ? Number(y) : null };
    }
    case "rates":
      return { page: "rates" };
    case "demo":
      return { page: "demo" };
    case "design":
      return { page: "design" };
    default:
      return { page: "accounts" };
  }
}

/** The documents list, optionally only those linked to one account. */
export const hrefDocuments = (accountId?: number | null): string => (accountId ? `#/documents?account=${accountId}` : "#/documents");
export const hrefDocument = (id: number, factId?: number | null): string => `#/documents/${id}${factId ? `?fact=${factId}` : ""}`;
export const hrefFact = (id: number): string => `#/facts/${id}`;
export const hrefFacts = (filters: Record<string, string> = {}): string => {
  const s = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  return `#/facts${s ? `?${s}` : ""}`;
};
export const hrefAccount = (id: number): string => `#/accounts/${id}`;
export const hrefFbar = (year?: number | null): string => (year ? `#/fbar?year=${year}` : "#/fbar");
