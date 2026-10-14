import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// INSERT ... SELECT with untyped params fails in Postgres ("inconsistent types
// deduced for parameter $1") and the error is swallowed, so first_answer never
// recorded. Every param in that statement must carry an explicit cast.
describe("funnel first_answer insert", () => {
  it("casts every parameter in the INSERT ... SELECT", () => {
    const src = fs.readFileSync(path.join(__dirname, "../services/funnel.ts"), "utf8");
    expect(src).toContain("SELECT $1::varchar,$2::varchar,$3::varchar");
    expect(src).toContain("$12::boolean");
    expect(src).toContain("f.event_type = $1::varchar");
  });
});
