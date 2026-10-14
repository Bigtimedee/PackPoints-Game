import { describe, it, expect } from "vitest";
import { soloDeepLinkSetId, setPageView } from "../soloDeepLink";

const T88 = "affd57b8-2b1d-4ea3-9f51-1530d8088e5c";

describe("soloDeepLinkSetId", () => {
  it("reads ?setId=", () => expect(soloDeepLinkSetId(`?setId=${T88}`)).toBe(T88));
  it("reads legacy ?set=", () => expect(soloDeepLinkSetId(`set=${T88}`)).toBe(T88));
  it("prefers setId over set", () => expect(soloDeepLinkSetId(`?set=x&setId=${T88}`)).toBe(T88));
  it("null when absent or blank", () => {
    expect(soloDeepLinkSetId("")).toBeNull();
    expect(soloDeepLinkSetId("?setId=")).toBeNull();
    expect(soloDeepLinkSetId(undefined)).toBeNull();
  });
});

describe("setPageView", () => {
  const base = { isLoading: false, isFetching: false, error: null, hasData: false };
  it("skeleton while the first fetch is in flight", () => expect(setPageView({ ...base, isLoading: true })).toBe("loading"));
  it("skeleton when no data and no error yet (guest race)", () => expect(setPageView(base)).toBe("loading"));
  it("skeleton while retrying a non-404 failure", () => expect(setPageView({ ...base, isFetching: true, error: { status: 401 } })).toBe("loading"));
  it("not found only on a real 404", () => expect(setPageView({ ...base, error: { status: 404 } })).toBe("notFound"));
  it("retry state, not 'not found', after a final non-404 failure", () => expect(setPageView({ ...base, error: { status: 500 } })).toBe("error"));
  it("ready once data arrives", () => expect(setPageView({ ...base, hasData: true, error: { status: 500 } })).toBe("ready"));
});
