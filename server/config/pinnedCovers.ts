/**
 * Public /sets cover lists. Design reviews this file. Change it only in a pull request.
 * Each set has ordered picks, then ordered alternates.
 * The picker walks picks, then alternates, and keeps the first cards that pass, up to 8.
 * A card that fails is skipped. Nothing outside this list fills a slot.
 */
export const MAX_PINNED_COVERS = 8;

export interface PinnedCoverList {
  set: string;
  picks: readonly string[];
  alternates: readonly string[];
}

export const PINNED_SET_COVERS: Readonly<Record<string, PinnedCoverList>> = {
  "91cfdf3f-a620-4e73-adc8-22b8df221716": {
    set: "1987 Topps Football",
    picks: ["704c2dab-140a-4276-b57e-b9febfa1ff20", "d0bce132-6137-497c-9d4c-884027c8d9ce", "7cdcf458-551f-429c-bc78-f75969bf74b9", "531ed7a8-f40d-4406-b5b2-f7b073a37443", "bf9fffc0-52e6-44fe-abe9-e6edb73f86fe", "69d09707-5f0a-4bd6-b92f-18f07dfe3529", "9bc2d83a-95e7-4a7e-9249-04c0362c17e8", "a0ae2b5d-9509-4426-91a1-dca3f3958840"],
    alternates: ["a33a9e6e-af5d-4649-af8e-22a8ded93291", "3115d5b9-a7f6-4f72-892b-93981f031a8b", "27bd423d-dad6-43af-bd85-4e91fa91d102", "19281048-e9d5-4c4b-83f5-f24fd0fd600c"],
  },
  "37fd025d-2ae1-4c92-b8ad-133375d0c722": {
    set: "1987 Topps",
    picks: ["3ce7064a-6079-4b00-855b-4bcea6332845", "72137e4f-2938-49ab-b111-70fec8ea7b6e", "80c25ada-ed93-43f8-b6ed-0f2776fd120e", "0084c5bd-433b-488f-9679-e67550c8f756", "d9da37d2-96ba-4587-b7f2-5a594b473833", "22c96fdb-5dc6-4156-9f05-b9c3f08a19dc", "0d9c3bb2-9e4e-4953-bab5-32fc452f547e", "7ba89144-f846-4359-85f1-36bf2775bd77"],
    alternates: ["11b7210e-d252-432a-9f20-2727755f9390", "f6b4680c-276e-4d88-a88d-e6c99cb9dfca", "9c81529a-e396-426b-88a7-2581ba21d576", "7639f40a-5b74-463a-b134-05f5924d5703"],
  },
  "aea515e2-24bc-42bd-a602-1514b89e8cd1": {
    set: "1989 Fleer Basketball",
    picks: ["d754d0aa-15f1-4f2b-939e-d76f42d4ea9b", "119393bc-df92-4c46-aab7-8730dd9217c8", "317a5624-f52d-42ef-942b-71e15408a99c", "8825c729-d044-4103-a397-11d3639045a0", "501fab97-a0b3-4164-872b-abe0fd485093", "5c581e6d-498a-43d3-b72b-67d550af8f01", "41145635-ba44-48e6-9046-810c2f78e8df"],
    alternates: [],
  },
  "352b33d1-c110-4e09-b641-8e3c02a94442": {
    set: "1989 Topps",
    picks: ["ad134fe8-29ea-4094-8d2e-3e94a4fa8130", "85564189-a445-464b-a8e3-ffe07d39e4c4", "33363bcd-1fe4-4ce6-bd3e-754e8e6ada68", "1ad90937-336b-4053-95bb-e218783a88be", "7f2dbe35-ae1d-4f83-8cdb-5d540b9856bf", "8165d013-8bd2-4ded-8407-688348a9b0d4", "453f32b9-ff9e-4125-a81a-20a6e4d9dd6c", "2be067c5-fee5-4d17-9c7c-1926cdf1a68f"],
    alternates: ["58f40b32-8387-4920-9c3a-3348203cc2ef", "951a7643-8428-4623-a8e4-e249bd26f01b", "d0b3701e-c814-4844-9265-724b9e03d2a7"],
  },
  "a09b2fe7-728e-431b-9df8-bbf2652aa3b2": {
    set: "1994 Topps Football",
    picks: ["12123433-f947-493a-8e2a-541487d1b706", "cd853c68-c124-403a-90fd-50b6c7b8fffa", "ac45ab9c-41a4-4b68-98f1-8d2da56bc45a", "ea0664ee-3a52-4b9f-a1e4-3c9d9715473a", "9ff97f57-983b-4d13-887f-a5645a95df67", "ca899fec-6863-42fd-8ac8-261876fcd895", "3e4ecbc9-7b25-4174-87e2-1cc4292905e7", "7a484391-df06-48f8-b374-5c26dba8cda2"],
    alternates: ["9f9a980d-0e0b-4290-b0a1-3d032efc8839", "6d197980-07b0-42cd-9966-2a8a433b6e6e", "68200dd9-f206-49ff-b54e-d2eecb393cd9", "38b4f41c-8771-46cf-b188-4927dc12d446"],
  },
  "74885a41-2043-4b7c-ab58-f9e16c05e2e3": {
    set: "2022 Panini Chronicles Football",
    picks: ["312886f9-98f3-46ff-b57a-c17b83c1621a", "29b132ad-d309-4d08-9516-895c9b45899a", "c835cd99-0da1-46e3-9866-93f9ec1af51b", "ea6d876e-2fc7-4338-96b6-663652226f73", "72ab951e-43cf-4c8e-871e-20ef257889b3", "868cd529-b5c9-43d3-8037-741e838b8743", "587875cd-d208-4cc5-98de-e7c7bab98e10", "6708a42c-e914-434a-8b1d-e38a03e91f0b"],
    alternates: ["ea26a028-938b-4373-b0dd-695965a9bd60", "a90b4dde-052c-45ff-9859-1eed2e83974b", "97e0dc4f-0026-49c6-b599-67479f2861ad"],
  },
  "229f0379-aa56-40a8-abe3-1af217a397e8": {
    set: "2024 Basketball",
    picks: ["33c3e9cb-bf3c-4bf0-924a-5bcd2e20d340", "8c36cd83-cca8-4ea4-970b-1e4cdae68d8f", "0407e40b-196c-48dc-a5b7-64e7592d0d45", "ad168080-40f0-43b4-9b74-28c7a5c4eb69", "2d6e0646-a203-481a-9017-ab870988b941", "cfae942e-6edf-4e33-bcba-aac43bb1b650", "8ab70f4a-1f83-42a8-a1d1-0c9037094767", "488147bc-934e-4d60-89eb-6246c9a83a88"],
    alternates: ["c4e1a127-93a9-46e7-b3fd-87089553756c", "3fb7ce44-6922-4058-b5e0-f92927479321", "f14f1934-2778-437a-bf4c-5634f0a63bf7", "86f77f38-faee-4ed0-ba35-082f08e248bd"],
  },
};

export type CoverListRole = "pick" | "alternate";

export interface ListedCover {
  cardId: string;
  role: CoverListRole;
}

const testOverrides = new Map<string, PinnedCoverList>();

/** Tests pin a set without editing the Design file. An array is picks only. Null clears that set. */
export function setPinnedCoversForTests(
  setId: string,
  spec: readonly string[] | { picks?: readonly string[]; alternates?: readonly string[] } | null,
): void {
  if (spec == null) {
    testOverrides.delete(setId);
    return;
  }
  if (Array.isArray(spec)) {
    testOverrides.set(setId, { set: "", picks: spec, alternates: [] });
    return;
  }
  const list = spec as { picks?: readonly string[]; alternates?: readonly string[] };
  testOverrides.set(setId, {
    set: "",
    picks: list.picks ?? [],
    alternates: list.alternates ?? [],
  });
}

export function pinnedCoverList(setId: string): PinnedCoverList {
  if (testOverrides.has(setId)) return testOverrides.get(setId) ?? { set: "", picks: [], alternates: [] };
  return PINNED_SET_COVERS[setId] ?? { set: "", picks: [], alternates: [] };
}

function cleanIds(ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of ids) {
    const id = String(raw ?? "").trim();
    if (id) out.push(id);
  }
  return out;
}

/** Picks, then alternates. Order is the Design order. */
export function listedPinnedCoverEntries(setId: string): ListedCover[] {
  const list = pinnedCoverList(setId);
  return [
    ...cleanIds(list.picks).map((cardId) => ({ cardId, role: "pick" as const })),
    ...cleanIds(list.alternates).map((cardId) => ({ cardId, role: "alternate" as const })),
  ];
}

export function listedPinnedCoverIds(setId: string): string[] {
  return listedPinnedCoverEntries(setId).map((entry) => entry.cardId);
}
