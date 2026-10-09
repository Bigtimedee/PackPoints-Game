/**
 * No set goes public without a recorded Design approval of that exact id.
 */
import express from "express";
import type { AddressInfo } from "net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ recorded: [] as string[], set: null as any }));
vi.mock("../db", () => ({ db: {}, pool: { query: async () => ({ rows: [] }) } }));
vi.mock("../services/setLifecycle", () => ({ findSet: async () => state.set, refreshLifecycleRegistry: async () => {} }));
vi.mock("../services/publicMaskGate", () => ({ invalidatePublicMaskSetCache: () => {} }));

import {
  AWAITING_DESIGN_CLEARANCE_REASON,
  CLEARED_SET_IDS,
  holdReasonForIdentity,
  isDesignApprovedSetId,
} from "../config/heldSets";
import { replaceLifecycleRegistry } from "../services/setLifecycleRegistry";
import {
  DESIGN_APPROVAL_REQUIRED_ERROR,
  MASK_PROFILE_REQUIRED_ERROR,
  publishGateError,
  setDesignApprovalsForTests,
} from "../services/setDesignApproval";
import { identityKey } from "../services/setLifecycleCore";
import { TOPPS_1988_SET_ID } from "../masking/topps1988Geometry";

const NEW_ID = "cccccccc-dddd-4eee-8fff-000000000001";
const identity = { year: 2001, brand: "Upper Deck", sport: "baseball", setName: "2001 Upper Deck" };
const set = { id: NEW_ID, ...identity, isActive: true, isUserCreated: false };
const profile = { id: "custom", regions: [{ xPct: 0, yPct: 80, wPct: 100, hPct: 20, type: "blur", radiusPct: 0 }] } as any;

afterEach(() => { replaceLifecycleRegistry([]); });

describe("design approval gate", () => {
  it("never lists 1988 Topps as cleared and keeps the allowlist frozen", () => {
    expect(CLEARED_SET_IDS).not.toContain(TOPPS_1988_SET_ID);
    // Adding an id here needs a recorded Design approval; update this count only with one.
    expect(CLEARED_SET_IDS).toHaveLength(8);
  });

  it("holds a published lifecycle set until Design approval is recorded", () => {
    replaceLifecycleRegistry([{ setId: NEW_ID, identity: identityKey(identity), revision: "r1", profile, published: true }]);
    expect(holdReasonForIdentity(set)).toBe(AWAITING_DESIGN_CLEARANCE_REASON);
    const restore = setDesignApprovalsForTests([NEW_ID]);
    try {
      expect(isDesignApprovedSetId(NEW_ID)).toBe(true);
      expect(holdReasonForIdentity(set)).toBeNull();
    } finally { restore(); }
    expect(holdReasonForIdentity(set)).toBe(AWAITING_DESIGN_CLEARANCE_REASON);
  });

  it("holds an approved lifecycle set that has no mask profile", () => {
    replaceLifecycleRegistry([{ setId: NEW_ID, identity: identityKey(identity), revision: "r1", profile: null, published: true }]);
    const restore = setDesignApprovalsForTests([NEW_ID]);
    try { expect(holdReasonForIdentity(set)).toBe(AWAITING_DESIGN_CLEARANCE_REASON); } finally { restore(); }
  });

  it("publish gate returns the 409 message when approval or profile is missing", () => {
    expect(publishGateError({ setId: NEW_ID, designApproved: false, hasMaskProfile: true })).toBe(DESIGN_APPROVAL_REQUIRED_ERROR);
    expect(publishGateError({ setId: NEW_ID, designApproved: true, hasMaskProfile: false })).toBe(MASK_PROFILE_REQUIRED_ERROR);
    expect(publishGateError({ setId: NEW_ID, designApproved: true, hasMaskProfile: true })).toBeNull();
  });

  it("1988 Topps stays held without a recorded approval", () => {
    expect(holdReasonForIdentity({ id: TOPPS_1988_SET_ID, year: 1988, brand: "Topps", sport: "baseball", setName: "1988 Topps Baseball", isActive: true }))
      .toBe(AWAITING_DESIGN_CLEARANCE_REASON);
  });
});

describe("design approval QA route", () => {
  const app = express(); app.use(express.json());
  let base = ""; let server: ReturnType<typeof app.listen>;
  beforeAll(async () => {
    process.env.COVER_QA_TOKEN = "test-token";
    const { registerDesignApprovalQaRoutes } = await import("../routes/designApprovalQa");
    registerDesignApprovalQaRoutes(app);
    server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/qa/sets`;
  });
  afterAll(() => { server?.close(); delete process.env.COVER_QA_TOKEN; });

  it("404s without the header and ignores a query token", async () => {
    expect((await fetch(`${base}/${NEW_ID}/design-approval`, { method: "POST" })).status).toBe(404);
    expect((await fetch(`${base}/${NEW_ID}/design-approval?token=test-token`, { method: "POST" })).status).toBe(404);
  });

  it("requires an explicit approve body and refuses a set with no mask profile", async () => {
    const h = { "x-qa-token": "test-token", "content-type": "application/json" };
    expect((await fetch(`${base}/${NEW_ID}/design-approval`, { method: "POST", headers: h, body: "{}" })).status).toBe(400);
    state.set = { ...set };
    const res = await fetch(`${base}/${NEW_ID}/design-approval`, { method: "POST", headers: h, body: JSON.stringify({ approve: true, approvedBy: "Design" }) });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("no_mask_profile");
  });
});
