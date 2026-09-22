/**
 * Admin set hard-delete toast craft — Design SoR docs/design/ADMIN_SET_DELETE_TOAST.md
 */
import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { ApiError } from "../queryClient";
import {
  GAME_SET_DELETE_BANNED_OPAQUE,
  GAME_SET_DELETE_TOAST,
  gameSetDeleteBlockedToast,
  gameSetDeleteConfirmBody,
  gameSetDeleteSuccessToast,
} from "../gameSetDeleteToast";

const playableSetsSrc = readFileSync(
  new URL("../../pages/admin/playable-sets.tsx", import.meta.url),
  "utf8",
);

describe("gameSetDeleteSuccessToast", () => {
  it("uses locked success title and names the set + stored card count", () => {
    expect(
      gameSetDeleteSuccessToast({
        setName: "Panini 2018 Panini Prizm Basketball",
        storedCardCount: 2735,
      }),
    ).toEqual({
      title: "Set deleted",
      description: '"Panini 2018 Panini Prizm Basketball" and 2735 stored cards are gone.',
    });
  });

  it("falls back when stored card count is unknown", () => {
    expect(
      gameSetDeleteSuccessToast({ setName: "Some Set", storedCardCount: null }),
    ).toEqual({
      title: "Set deleted",
      description: "The game set has been permanently removed.",
    });
    expect(gameSetDeleteSuccessToast({})).toEqual({
      title: "Set deleted",
      description: GAME_SET_DELETE_TOAST.successFallback,
    });
  });

  it("allows zero stored cards when count is known", () => {
    expect(
      gameSetDeleteSuccessToast({ setName: "Empty Set", storedCardCount: 0 }),
    ).toEqual({
      title: "Set deleted",
      description: '"Empty Set" and 0 stored cards are gone.',
    });
  });
});

describe("gameSetDeleteBlockedToast", () => {
  it("maps 409 constraint / import Eng one-liners into Can't delete yet", () => {
    const constraint =
      'Cannot delete this set while playable cards still reference it (playable_cards_game_set_id_game_sets_id_fk). An import may still be writing cards. Wait for that import to finish, then delete again. update or delete on table "game_sets" violates foreign key constraint "playable_cards_game_set_id_game_sets_id_fk" on table "playable_cards"';
    expect(gameSetDeleteBlockedToast(new ApiError(constraint, 409))).toEqual({
      title: "Can't delete yet",
      description: constraint,
    });

    const importStopped = "Import stopped because this game set was deleted.";
    expect(gameSetDeleteBlockedToast(new ApiError(importStopped, 409))).toEqual({
      title: "Can't delete yet",
      description: importStopped,
    });
  });

  it("uses connection copy for network / timeout / opaque bodies", () => {
    expect(gameSetDeleteBlockedToast(new TypeError("Failed to fetch"))).toEqual({
      title: "Can't delete yet",
      description: "Check your connection and try again.",
    });
    expect(gameSetDeleteBlockedToast(new Error("Request timed out. Please try again."))).toEqual({
      title: "Can't delete yet",
      description: "Check your connection and try again.",
    });
    expect(
      gameSetDeleteBlockedToast(new ApiError("Failed to delete game set", 500)),
    ).toEqual({
      title: "Can't delete yet",
      description: "Check your connection and try again.",
    });
  });

  it("never returns banned opaque titles or bodies", () => {
    const cases = [
      gameSetDeleteBlockedToast(new ApiError("Failed to delete game set", 500)),
      gameSetDeleteBlockedToast(new Error("Delete failed")),
      gameSetDeleteBlockedToast(new Error("Something went wrong")),
      gameSetDeleteBlockedToast(undefined),
      gameSetDeleteSuccessToast({ setName: "X", storedCardCount: 1 }),
    ];
    for (const toast of cases) {
      for (const banned of GAME_SET_DELETE_BANNED_OPAQUE) {
        expect(toast.title).not.toBe(banned);
        expect(toast.description).not.toBe(banned);
      }
      expect(toast.title).not.toMatch(/delete failed/i);
      expect(toast.title).not.toMatch(/something went wrong/i);
    }
  });
});

describe("gameSetDeleteConfirmBody", () => {
  it("states honest stored card count before delete", () => {
    expect(gameSetDeleteConfirmBody("Panini 2018 Panini Prizm Basketball", 2735)).toBe(
      'Permanently delete "Panini 2018 Panini Prizm Basketball"? This will hard-delete the set and 2735 stored cards. This cannot be undone.',
    );
  });
});

describe("playable-sets wires Design toast craft", () => {
  it("imports and uses the Design toast helpers", () => {
    expect(playableSetsSrc).toContain("gameSetDeleteSuccessToast");
    expect(playableSetsSrc).toContain("gameSetDeleteBlockedToast");
    expect(playableSetsSrc).toContain("gameSetDeleteConfirmBody");
    expect(playableSetsSrc).toContain('from "@/lib/gameSetDeleteToast"');
  });

  it("does not ship banned opaque delete titles", () => {
    const marker = "const deleteMutation = useMutation({";
    const start = playableSetsSrc.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const mutation = playableSetsSrc.slice(start, start + 1800);
    for (const banned of GAME_SET_DELETE_BANNED_OPAQUE) {
      expect(mutation).not.toContain(`"${banned}"`);
      expect(mutation).not.toContain(`'${banned}'`);
    }
    expect(mutation).not.toContain('title: "Delete failed"');
    expect(mutation).not.toContain("Failed to delete game set");
  });
});
