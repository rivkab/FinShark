// Hash routing: "#/documents/12?fact=40".

export type Route =
  | { page: "documents" }
  | { page: "document"; id: number; factId: number | null }
  | { page: "review"; factId: number | null }
  | { page: "facts"; filters: Record<string, string> }
  | { page: "fact"; id: number }
  | { page: "accounts" }
  | { page: "demo" };

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
      return second !== undefined && ID.test(second) ? { page: "document", id: Number(second), factId: qId("fact") } : { page: "documents" };
    case "review":
      return { page: "review", factId: qId("fact") };
    case "facts": {
      if (second !== undefined && ID.test(second)) return { page: "fact", id: Number(second) };
      const filters: Record<string, string> = {};
      for (const k of ["status", "concept", "account", "document"]) {
        const v = q.get(k);
        if (v) filters[k] = v;
      }
      return { page: "facts", filters };
    }
    case "accounts":
      return { page: "accounts" };
    case "demo":
      return { page: "demo" };
    default:
      return { page: "documents" };
  }
}

export const hrefDocument = (id: number, factId?: number | null): string => `#/documents/${id}${factId ? `?fact=${factId}` : ""}`;
export const hrefFact = (id: number): string => `#/facts/${id}`;
export const hrefFacts = (filters: Record<string, string> = {}): string => {
  const s = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
  return `#/facts${s ? `?${s}` : ""}`;
};
