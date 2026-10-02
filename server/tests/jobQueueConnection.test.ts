import { beforeEach, describe, expect, it, vi } from "vitest";

const connect = vi.hoisted(() => vi.fn());
const poolQuery = vi.hoisted(() => vi.fn());

vi.mock("../db", () => ({
  pool: {
    connect,
    query: poolQuery,
    on: vi.fn(),
  },
  db: {},
}));

import { registerJob, runNextPendingJob } from "../jobs/pgJobQueue";

describe("job queue connection", () => {
  beforeEach(() => {
    connect.mockReset();
    poolQuery.mockReset();
    poolQuery.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  it("releases the claim connection before the handler runs", async () => {
    let released = false;
    connect.mockImplementation(async () => ({
      query: async (sql: string) => {
        if (String(sql).includes("SELECT")) {
          return {
            rows: [{ id: 7, payload: { gameSetId: "set-1" }, attempts: 0, max_attempts: 3 }],
          };
        }
        return { rows: [], rowCount: 1 };
      },
      release: () => {
        released = true;
      },
    }));

    let sawRelease = false;
    registerJob("mask_warmup_connection", async () => {
      sawRelease = released;
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(released).toBe(true);
    });

    await expect(runNextPendingJob("mask_warmup_connection")).resolves.toBe(true);
    expect(sawRelease).toBe(true);
    expect(released).toBe(true);
  });
});
