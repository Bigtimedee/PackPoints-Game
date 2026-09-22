import { describe, expect, it } from "vitest";
import {
  catalogMatchPlayPath,
  catalogMatchTease,
  resolveCatalogMatch,
  USER_SET_PUBLISH_CLOSED,
  type CatalogCardRow,
  type IdentifyFields,
  type IntegratedMembership,
} from "@shared/catalogMatch";

const identified: IdentifyFields = {
  playerName: "Ken Griffey Jr.",
  year: 1992,
  brand: "Topps",
  setName: "1992 Topps",
  cardNumber: "14",
};

function membership(overrides: Partial<IntegratedMembership> = {}): IntegratedMembership {
  return {
    setId: "11111111-1111-4111-8111-111111111111",
    setName: "Junk Wax Classics",
    year: 1992,
    brand: "Topps",
    isUserCreated: false,
    isActive: true,
    cardCount: 5,
    player: "Ken Griffey Jr",
    cardNumber: "14",
    cardSet: "1992 Topps",
    ...overrides,
  };
}

describe("resolveCatalogMatch", () => {
  it("matches one integrated set and does not invent a user set", () => {
    const result = resolveCatalogMatch({
      identified,
      catalog: [],
      memberships: [membership()],
    });
    expect(result.match.status).toBe("matched");
    expect(result.match.sets).toEqual([
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Junk Wax Classics",
        cardCount: 5,
        tease: "5 cards · already live",
      },
    ]);
    expect(result.card?.label).toBe("1992 Topps #14");
  });

  it("drops user-created sets even when they are the only player hit", () => {
    const result = resolveCatalogMatch({
      identified,
      catalog: [],
      memberships: [membership({ isUserCreated: true, setName: "My PC Stack" })],
    });
    expect(result.match.status).toBe("none");
    expect(result.match.sets).toEqual([]);
  });

  it("drops inactive sets and empty shelves", () => {
    const result = resolveCatalogMatch({
      identified,
      catalog: [],
      memberships: [
        membership({ isActive: false, setId: "inactive" }),
        membership({ cardCount: 0, setId: "empty" }),
      ],
    });
    expect(result.match.status).toBe("none");
    expect(result.match.sets).toHaveLength(0);
  });

  it("stays ambiguous when two integrated sets score together", () => {
    const result = resolveCatalogMatch({
      identified,
      catalog: [],
      memberships: [
        membership(),
        membership({
          setId: "22222222-2222-4222-8222-222222222222",
          setName: "Porch 92s",
          cardCount: 8,
        }),
      ],
    });
    expect(result.match.status).toBe("ambiguous");
    expect(result.match.sets.map((set) => set.name).sort()).toEqual(["Junk Wax Classics", "Porch 92s"]);
    expect(result.match.sets.length).toBeLessThanOrEqual(5);
  });

  it("keeps a clear integrated winner and ignores a weaker user set", () => {
    const result = resolveCatalogMatch({
      identified,
      catalog: [],
      memberships: [
        membership(),
        membership({
          setId: "user-set",
          setName: "Named at the table",
          isUserCreated: true,
        }),
        membership({
          setId: "33333333-3333-4333-8333-333333333333",
          setName: "1992 Misc",
          year: 1992,
          brand: "Score",
          cardSet: "1992 Score",
          cardNumber: "200",
          cardCount: 12,
        }),
      ],
    });
    expect(result.match.status).toBe("matched");
    expect(result.match.sets).toHaveLength(1);
    expect(result.match.sets[0].name).toBe("Junk Wax Classics");
  });

  it("returns none when the card is known in catalog but not in a playable set", () => {
    const catalog: CatalogCardRow[] = [
      {
        id: "cat-14",
        player: "Ken Griffey Jr.",
        year: 1992,
        brand: "Topps",
        setName: "Topps",
        cardNumber: "14",
      },
    ];
    const result = resolveCatalogMatch({
      identified,
      catalog,
      memberships: [],
    });
    expect(result.match.status).toBe("none");
    expect(result.match.sets).toEqual([]);
    expect(result.catalogCardId).toBe("cat-14");
    expect(result.candidates[0]?.label).toBe("1992 Topps #14");
  });
});

describe("catalog match play path", () => {
  it("deep-links only to /sets/{slug}", () => {
    expect(catalogMatchPlayPath("junk-wax-classics-a1b2c3d4")).toBe("/sets/junk-wax-classics-a1b2c3d4");
    expect(catalogMatchPlayPath("/make")).toBe("/sets");
    expect(catalogMatchPlayPath("../make")).toBe("/sets");
    expect(catalogMatchPlayPath("sets/create")).toBe("/sets");
    expect(catalogMatchTease(1)).toBe("1 card · already live");
  });

  it("closes user-set publish with 410 and no soft flag", () => {
    expect(USER_SET_PUBLISH_CLOSED.status).toBe(410);
    expect(USER_SET_PUBLISH_CLOSED.error.toLowerCase()).not.toContain("admin");
  });
});
