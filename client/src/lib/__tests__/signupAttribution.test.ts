/**
 * Client first-touch attribution: localStorage record (30 days, first touch
 * wins), sessionStorage compatibility, register payload, and OAuth stash.
 */
import { readFile } from "fs/promises";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import {
  ATTRIBUTION_STORAGE_KEY,
  ATTRIBUTION_TTL_MS,
  LEGACY_UTM_SESSION_KEY,
  captureFirstTouch,
  getSignupAttributionPayload,
  readFirstTouch,
  stashAttributionForOAuth,
  type AttributionEnv,
} from "../attribution";

class MemStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.has(k) ? this.data.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, String(v));
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

class ThrowingStorage {
  getItem(): string | null {
    throw new Error("blocked");
  }
  setItem(): void {
    throw new Error("blocked");
  }
  removeItem(): void {
    throw new Error("blocked");
  }
}

const NOW = Date.parse("2026-10-02T18:00:00.000Z");

function env(url: string, opts: Partial<AttributionEnv> & { local?: any; session?: any } = {}): AttributionEnv {
  const u = new URL(url, "https://packpts.com");
  return {
    search: u.search,
    pathname: u.pathname,
    referrer: "",
    host: "packpts.com",
    local: new MemStorage(),
    session: new MemStorage(),
    now: NOW,
    ...opts,
  };
}

describe("captureFirstTouch", () => {
  it("writes the first-touch record on landing", () => {
    const e = env("/daily?utm_source=eng_attr_test&utm_medium=qa&utm_campaign=attr_check&utm_term=t&utm_content=c&ref=AbC123&challenge=secret", {
      referrer: "https://www.instagram.com/some/path?x=1",
    });
    captureFirstTouch(e);
    const stored = JSON.parse((e.local as MemStorage).getItem(ATTRIBUTION_STORAGE_KEY)!);
    expect(stored).toEqual({
      v: 1,
      ts: NOW,
      utm_source: "eng_attr_test",
      utm_medium: "qa",
      utm_campaign: "attr_check",
      utm_term: "t",
      utm_content: "c",
      ref: "AbC123",
      landing_path: "/daily",
      referrer_host: "instagram.com",
    });
    expect(JSON.stringify(stored)).not.toContain("secret");
    expect(JSON.parse((e.session as MemStorage).getItem(LEGACY_UTM_SESSION_KEY)!)).toEqual({
      utm_source: "eng_attr_test",
      utm_medium: "qa",
      utm_campaign: "attr_check",
      utm_term: "t",
      utm_content: "c",
    });
  });

  it("first tagged touch wins and is not overwritten", () => {
    const local = new MemStorage();
    const session = new MemStorage();
    captureFirstTouch(env("/daily?utm_source=creator_jane&utm_medium=dm", { local, session }));
    captureFirstTouch(env("/sets?utm_source=reddit&utm_medium=post", { local, session, now: NOW + 1000 }));
    const rec = readFirstTouch(env("/", { local, session, now: NOW + 2000 }))!;
    expect(rec.utm_source).toBe("creator_jane");
    expect(rec.landing_path).toBe("/daily");
    // legacy session key tracks the current session's UTMs
    expect(JSON.parse(session.getItem(LEGACY_UTM_SESSION_KEY)!).utm_source).toBe("reddit");
    // payload uses the first touch
    expect(getSignupAttributionPayload(env("/", { local, session, now: NOW + 3000 })).utmSource).toBe("creator_jane");
  });

  it("an untagged visit does not overwrite a tagged one", () => {
    const local = new MemStorage();
    captureFirstTouch(env("/daily?utm_medium=beatme", { local }));
    captureFirstTouch(env("/sets", { local, referrer: "https://google.com/", now: NOW + 1000 }));
    expect(readFirstTouch(env("/", { local, now: NOW + 2000 }))!.utm_medium).toBe("beatme");
  });

  it("a plain first visit is upgraded once by a later tagged touch", () => {
    const local = new MemStorage();
    captureFirstTouch(env("/", { local }));
    expect(readFirstTouch(env("/", { local }))!.landing_path).toBe("/");
    captureFirstTouch(env("/daily?utm_source=creator_jane&utm_medium=dm", { local, now: NOW + 1000 }));
    captureFirstTouch(env("/daily?utm_source=other", { local, now: NOW + 2000 }));
    const rec = readFirstTouch(env("/", { local, now: NOW + 3000 }))!;
    expect(rec.utm_source).toBe("creator_jane");
  });

  it("expires after 30 days", () => {
    const local = new MemStorage();
    captureFirstTouch(env("/daily?utm_source=old", { local }));
    const later = NOW + ATTRIBUTION_TTL_MS + 1000;
    expect(readFirstTouch(env("/", { local, session: new MemStorage(), now: later }))).toBeNull();
    captureFirstTouch(env("/daily?utm_source=new", { local, session: new MemStorage(), now: later }));
    expect(readFirstTouch(env("/", { local, now: later }))!.utm_source).toBe("new");
  });

  it("drops our own referrer, bad ref codes, and markup", () => {
    const e = env("/daily?utm_source=%3Cb%3Ex%3C%2Fb%3E&ref=bad%20code!", { referrer: "https://packpts.com/sets" });
    const rec = captureFirstTouch(e)!;
    expect(rec.referrer_host).toBeUndefined();
    expect(rec.ref).toBeUndefined();
    expect(rec.utm_source).toBe("bx/b");
  });

  it("falls back to sessionStorage when localStorage throws", () => {
    const session = new MemStorage();
    captureFirstTouch(env("/daily?utm_medium=play_sets", { local: new ThrowingStorage(), session }));
    const p = getSignupAttributionPayload(env("/", { local: new ThrowingStorage(), session }));
    expect(p.utmMedium).toBe("play_sets");
    expect(p.landingPage).toBe("/daily");
  });
});

describe("getSignupAttributionPayload", () => {
  it("maps the record onto register body fields", () => {
    const local = new MemStorage();
    captureFirstTouch(env("/daily?utm_source=creator_jane&utm_medium=dm&utm_campaign=launch&ref=R1", { local, referrer: "https://t.co/x" }));
    expect(getSignupAttributionPayload(env("/auth", { local }))).toEqual({
      utmSource: "creator_jane",
      utmMedium: "dm",
      utmCampaign: "launch",
      referredByCode: "R1",
      landingPage: "/daily",
      referrerHost: "t.co",
    });
  });

  it("still reads legacy session-only UTMs", () => {
    const session = new MemStorage();
    session.setItem(LEGACY_UTM_SESSION_KEY, JSON.stringify({ utm_source: "legacy", utm_medium: "beatme" }));
    expect(getSignupAttributionPayload(env("/", { session }))).toEqual({ utmSource: "legacy", utmMedium: "beatme" });
  });

  it("is empty when nothing was stored", () => {
    expect(getSignupAttributionPayload(env("/"))).toEqual({});
    expect(getSignupAttributionPayload(null)).toEqual({});
  });
});

describe("stashAttributionForOAuth", () => {
  it("posts the stored attribution to /api/auth/attribution", async () => {
    const local = new MemStorage();
    captureFirstTouch(env("/daily?utm_source=creator_jane&utm_medium=dm", { local }));
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    await stashAttributionForOAuth(fetchImpl as any, env("/auth", { local }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/auth/attribution");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(JSON.parse(String(init.body))).toEqual({ utmSource: "creator_jane", utmMedium: "dm", landingPage: "/daily" });
  });

  it("skips the request with nothing stored and never throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    await stashAttributionForOAuth(fetchImpl as any, env("/"));
    expect(fetchImpl).not.toHaveBeenCalled();
    const local = new MemStorage();
    captureFirstTouch(env("/?utm_source=x", { local }));
    await expect(stashAttributionForOAuth(fetchImpl as any, env("/", { local }))).resolves.toBeUndefined();
  });
});

describe("register and OAuth call sites", () => {
  const root = path.resolve(__dirname, "../../..");
  const read = (p: string) => readFile(path.join(root, p), "utf8");

  it("/auth page and SignupModal send stored attribution on register", async () => {
    for (const file of ["src/pages/auth.tsx", "src/components/signup-modal.tsx"]) {
      const src = await read(file);
      const i = src.indexOf('"/api/auth/register"');
      expect(i, file).toBeGreaterThan(0);
      const call = src.slice(i, src.indexOf("});", i));
      expect(/\.\.\.(getStoredUtmParams\(\)|utmParams)/.test(call), file).toBe(true);
    }
  });

  it("local auth surfaces no longer offer WorkOS starts", async () => {
    for (const file of ["src/pages/auth.tsx", "src/components/signup-modal.tsx"]) {
      const src = await read(file);
      expect(src, file).not.toMatch(/window\.location\.href\s*=\s*["']\/api\/auth\/workos\/start/);
      expect(src, file).not.toContain("startWorkosAuth");
    }
  });

  it("App captures first touch on load", async () => {
    const app = await read("src/App.tsx");
    expect(app).toContain("captureUtmParams()");
    const qc = await read("src/lib/queryClient.ts");
    expect(qc).toContain("captureFirstTouch()");
  });
});
