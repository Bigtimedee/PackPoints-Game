/**
 * Design by-eye recrop review.
 * 148 approved 1986 Topps cards and 52 approved 1988 Topps cards become dealable.
 * 12 cards stay blocked (2 from 1986, 10 from 1988).
 * The autograph and the eight DISCOVER TOPPS stamps are not baked or served.
 * #495, #574, and #499 are re-baked for QA.
 * This file is data only. It does not import the blocklist.
 */
export const TOPPS_1986_SET_ID = "2b77043a-6583-4d79-b59d-d2ab20291a17";
export const TOPPS_1988_SET_ID = "affd57b8-2b1d-4ea3-9f51-1530d8088e5c";

export const RECROP_APPROVED_1986_IDS: readonly string[] = [
  "cd39c62c-e253-4c88-9027-87325686027b",
  "b7e96d77-d1d6-4996-ad22-3ae57dc4df96",
  "c3bb82a4-028a-4260-b3e2-76866963e0e5",
  "d38ab45d-2b0e-4031-9863-46fe402cd425",
  "f49074cc-aafd-4f0c-8179-c5c9247ab869",
  "50ca77ca-dde9-4df9-8415-2176b9812bb2",
  "ed05ddde-862d-4b74-a7bc-01bec2f7f7c5",
  "55b8efb5-92f1-4b7f-baf7-bdd803f01a1e",
  "f55f6330-8ca6-44d1-ae4d-0a541d7abbd0",
  "b8014f85-f29c-458c-82e3-ca0a319b5dbe",
  "7959314e-5331-45e0-8381-026e1075bbf3",
  "1649e141-5e2a-42ca-902e-db74d4842140",
  "26976bd7-fd43-435b-ac28-7d7232a4f9d8",
  "1fdb9986-7519-4431-9158-f0cceac6b5b3",
  "b8eb1143-e487-4e8e-9c9b-a5b94a714bb4",
  "b2b417d0-4756-44a0-b6f2-332eb97150d9",
  "1d2dad66-dc2a-421d-8e19-1d710b1cb5d1",
  "561b9ec2-f28e-4ca1-86ba-a3b6c7ac396b",
  "b6ac789a-3b9a-4f49-9ab9-d1890ec8c7c3",
  "861f6154-4d18-4a63-9673-0f8881132fec",
  "c3c341ec-98ed-420f-9b55-8227cc3acb74",
  "9e07aa67-90e1-421f-9544-5d2a9224ff6e",
  "23369334-522a-480b-b74d-256337ba8353",
  "005012bc-5673-4443-a05a-e069b754e096",
  "976a594a-07bc-4d2b-8b51-04b8239591cf",
  "38aaa2a7-8c9a-4ef1-a75f-7cb184e07cb6",
  "a752a563-649e-4e77-b69c-f9d885901ea5",
  "349e05e9-b76f-4241-9677-6174c231ac18",
  "c533e858-0d40-4717-90ff-89b29ce106fe",
  "b085582a-1e95-420a-af97-053f3d8c885a",
  "a4651bd1-9ce5-4437-ba7f-64d91afce9b6",
  "a915447b-40bd-4d70-9f12-abcd328da95a",
  "067cc6e9-5f3c-46b3-be79-622328972340",
  "115d5258-08f3-46cd-a91b-5dc5619baf9c",
  "9e8d8a33-8b36-48c6-a000-e1d8268c9ae9",
  "d37f7373-1c23-405b-8b3d-209694c62f51",
  "48fc46e4-855a-4a40-9728-99e9a46dacac",
  "37f47a50-83fc-44ef-9968-28172bd27c46",
  "36d0d716-de9f-467f-8056-5a391b15eb68",
  "f4de8573-d855-4966-9d11-164bc5bb9854",
  "0400cbcd-dd41-455b-b661-944744783491",
  "5482de31-6f80-41a8-8b65-c57ea4d3a2a0",
  "798e8b02-16ef-4943-8e20-b949c01cbb77",
  "4d65366c-ae31-447d-97c8-e9b93b56b4af",
  "54bc619c-2589-4028-8e45-ade2b9899eb9",
  "44c7f023-7a59-4a08-8786-308a24b3642c",
  "0370490d-a2e8-4760-b947-39737993cf0b",
  "4010c3f9-2d62-4961-ae36-7d0ec9d40e0d",
  "cc3127d3-94de-4955-a5ae-3afeaf24c6ad",
  "dacf3aa2-d03f-4693-97c7-c67e051f8d0c",
  "30b7fdd6-ae7f-43b5-9f31-deb003172355",
  "a53dcac0-a250-45e7-942e-24bf08c06f63",
  "0c7d1587-c954-463c-aaa9-f43be05470fc",
  "35340a36-c6c8-4594-8620-471381a33a7f",
  "24b27ed3-9716-42b3-8b72-b635c4c537bf",
  "7e922ddb-10a2-4b15-81f9-9b3528264d7a",
  "452c6456-40ad-4cc7-b55c-a0f1b7d29ecb",
  "a46438a8-4d51-4e5c-9e66-610580f46fe5",
  "32d9b0a0-5e00-4d32-9352-c42f5770336b",
  "05e48d35-1071-4a6b-b36f-4f9ced626974",
  "1423ab19-3680-456a-b624-0e43274dd981",
  "59be0a26-1b98-4d2c-8914-ee5c863eb0f4",
  "a5552e47-dab9-4b9b-b737-5f0a7fb94d00",
  "3f89b4d9-2e82-49a5-86d0-71a1ac143fee",
  "b97547ac-34d1-474e-97b4-cc01d5162a75",
  "8eadc2e2-0efc-472d-b8f0-cd00b8bbcda2",
  "8a1612fc-aedd-4e93-b39a-87541af356e1",
  "868ee4f7-3794-4026-b5d6-c561ec057582",
  "266d32ed-7c28-4ad6-bdb6-db78500b7f6a",
  "59ae7bf9-e08c-42e1-848f-5459e4f44a01",
  "db30bfd1-39c7-4592-a0fd-ff2ad9d94250",
  "5e12fea0-3031-486c-8028-58fb6d3b9800",
  "8195eb46-bdf0-4115-b4de-540a72a2d04c",
  "79e47952-4c0c-43a1-9337-c6abe5d978ba",
  "7ab6fdb4-3a58-493c-903c-f1c4cca81506",
  "8b2e6559-ceb4-4397-a2d5-7e85688f8acd",
  "2579d8b5-f5af-4d00-bac1-ee965fb1814f",
  "133b91eb-b2a2-4061-a4ba-055ef5dd620c",
  "64e2978b-10fe-442b-8dc8-674c1c1bd2fc",
  "418d6130-9cde-4f62-ac17-8d498e9c81e7",
  "caa1aa7d-4a0a-4d59-8087-417a2cd48037",
  "446d0512-4d60-4acb-8b6b-637d98bf3a4c",
  "c0ec6573-571f-40a1-9e8a-422a19b32af8",
  "2d1e873b-fced-4794-866f-895ff8bb4125",
  "70cc7a29-b80b-4d52-9d29-463e651bb13e",
  "a7af8759-17f8-4b1a-8f97-e075fe0a9e05",
  "24e8b943-e4c6-4eb1-86d6-af4ff1b9dec9",
  "76f1757f-53a0-4509-a1d4-a65e1ad2adea",
  "1d861391-b230-4935-a739-0e72e003de55",
  "d2c35942-24cb-4c1e-9a57-901f16474a0e",
  "9017d52c-0959-4ce5-8bf1-c1283e6436ae",
  "0cda83b7-7edd-45b5-8a84-aa05739dfead",
  "e5e812bc-6b09-4b7f-94ad-34edfb668d6d",
  "fe02646e-b3f3-4af6-bcfa-69088dda171b",
  "2d3ce77f-d4c4-4bf3-a8e0-f900f2ed6580",
  "d8cdc4c3-5b24-421d-b852-57e02525786d",
  "793dabe2-d6bc-4415-9c9a-c5fe3e67761c",
  "acc54ecb-7a13-42a9-8289-06837da5283e",
  "f59f9760-eda5-413a-8bb6-b4bb06ed1c52",
  "40759437-66c2-4cb0-aab9-622d2ecfafec",
  "4f337315-c664-4fd5-8161-5a314ca80c41",
  "37e3926c-3b21-429a-9c30-327d909d8884",
  "4a3a3f8e-8fbf-4379-acb4-830d6fb2d212",
  "df273964-0f51-454c-b883-9d4849eae1a8",
  "fa81b563-b94d-4fb9-b6ff-31bf56518192",
  "6d2fc394-6588-495b-8470-d5fcb39dd35c",
  "5cf2e396-4536-4d78-acab-c48f63d30dc1",
  "855c2ca6-64fb-4ffd-a62b-edc6a4f70e98",
  "1f4175ce-08c7-4476-becb-d4e9f0a30557",
  "9f8a2281-042c-447e-b220-40ebc41d945f",
  "b24abe50-5127-4590-b11e-0590ce624a9b",
  "fe5b4b17-622c-494b-a894-6c170ca07ba6",
  "f9b07bc3-bbbf-4cc2-8549-c9449d570fef",
  "3d7a6ec5-8848-4e03-a35f-011ddec8426e",
  "af6d6fb4-a91a-4a74-8de6-e7d2b95565f5",
  "98313ede-8b34-431d-8b22-2797fe7f20a7",
  "ea8799a4-3974-4588-8ea2-d7a24b7e9c98",
  "db63d5e6-160e-4cf0-9af0-e8120094df3a",
  "12ca094d-50aa-419b-b14c-1ff51ea80615",
  "8aa079c4-dac0-4249-8130-3e1ddace516c",
  "69eef686-1ada-47bd-827b-3f5b7a6ce68d",
  "9cf9165e-ad8c-4b00-8da9-4794efa02e86",
  "93b8f9d9-61f9-41a8-89a0-8da76bafde34",
  "249c8535-5c6f-4699-bed8-5aa5b342a90f",
  "7662081e-14d0-4bda-bdf9-7df06dc919dc",
  "a3f47029-5487-4cf2-ab4c-89cc3023959e",
  "d71445a5-a03c-4cfe-8a21-176ca967b7d6",
  "ea68fdee-b59b-4738-891a-4ff792e534ae",
  "2c882376-d741-4fbb-ad65-a30e65db4d40",
  "ac72168d-b0db-4473-b73d-1fe571cce6ea",
  "88a0c3b1-6c5c-43ce-bdb1-e4f96a49cbce",
  "1fc4b7a9-1e46-4033-ab9d-964a137e5ab2",
  "ec64680a-1c30-462b-8fed-bdc5eec0feea",
  "0b826df2-d37d-4fd6-903b-7cbe4c018431",
  "cf42d7ed-f2c3-4570-a22f-5a5e0d7079f2",
  "f29cf4dc-3a12-4b61-92c4-a09fed6e23a7",
  "a2d516ea-933c-4bc2-8208-d41aeba4e9c8",
  "2e1c435c-792c-4c32-b147-f47954a16dbd",
  "2db6d654-4b81-403a-b7bc-1bf700abf820",
  "1260aac9-8dc9-4449-9dcf-31995e3bcc7b",
  "009d8ae1-906c-47f5-8bb0-895ed95c6ea2",
  "a78a4ee0-21a4-4543-bb52-e62aeacc3b85",
  "0b36a399-5d23-4ed4-b194-aa58fd25cf89",
  "8324b7d3-01a0-4d7d-8b59-a1eacddbef1f",
  "f20263a5-9f0a-43c8-91ab-10d521641602",
  "ba8db2f7-c485-4563-9714-71c6a810423f",
  "e7eb6dbd-6e98-419e-9435-301dca62ce13",
  "70d94da7-9a35-49db-a2a4-613935676414",
];

export const RECROP_APPROVED_1988_IDS: readonly string[] = [
  "bb90083d-50ab-44ca-b9f5-ad1271506eeb",
  "60400f52-32da-4190-b939-52f140a10a8b",
  "9338ee9e-c8f0-4f05-a93e-84acac068615",
  "9e2a26f3-5b7d-4158-a06d-70d5b6a503a5",
  "496cbe9b-6ed5-4c58-8662-aa1eea2b4c3a",
  "31ea8b51-2a71-4dad-a3c5-553bc918c670",
  "f650f498-1ee4-4500-89cd-38619dacf0a5",
  "cb4c5b1c-8c35-4b72-9969-77b52ad15432",
  "cd88397e-6ce9-43b3-b669-f77f5ba1c7e5",
  "92d1b8e4-5c1a-46e9-afca-decfccd312c4",
  "1f7f9fa4-f9b7-407e-9825-60800fed5c7c",
  "b0fa74c1-fc85-4268-98bc-2e58ed9a379d",
  "c07d2521-a9cc-481a-b1da-942848914bec",
  "5f99c965-36f2-4373-a5d9-38fc43a0bdd4",
  "1ca6fe85-23a9-46bd-8a01-f1464798212e",
  "c88946d0-2bed-4aa0-8660-3eeb0b18987e",
  "a29889f7-c769-4881-8198-f4506f6707bf",
  "626d0c7d-5ae2-45c1-87f0-4e44ddead8e4",
  "d021b068-0569-4ef0-9730-5542db03a182",
  "c439b5a5-a513-4e6f-a6af-915af04addc3",
  "828ce509-dc12-43db-aba2-f2ba797bcd6e",
  "44138c0d-87ab-4646-90b9-ad35df8eb4d9",
  "de26b1cd-33b0-4786-b243-1af4da07eb1d",
  "02733163-0f24-48a1-a3c8-d3eaac7b9af8",
  "19c24aec-3836-48a5-8794-9310ec8cccc5",
  "9d561f34-227a-43f4-98da-88eee47cb3c3",
  "886e519f-054d-4df0-9587-83b8e023c86c",
  "5ccdbc52-bf7b-408d-ba66-bddf51796fb8",
  "db725ec9-4026-4aff-9197-91a0ced5b930",
  "b765f3c8-2b16-49b9-9d51-71258597a268",
  "3798a764-63d6-4530-afa3-c7164fe72229",
  "e705318f-3038-4163-b740-1785d2046a69",
  "04a0305f-b253-427d-9f44-b59b970281b5",
  "f4b8f6b9-e88e-4bac-bc97-79f66e688f97",
  "cce4bf67-75a8-4112-b9be-1440f115ffea",
  "1a03d9e3-28e5-43b6-adae-8321aa2ff482",
  "c421606d-06ef-4d85-a715-43b4c939203a",
  "a0700f3a-efb2-4b0d-89ec-7b7dea8e6e62",
  "709bb1ef-b6cb-4e52-a35a-629c672c5f0b",
  "af832ecd-c731-411a-9e3c-e70c97a193e3",
  "185f669e-f4f6-495c-a131-264948ae2807",
  "5669d2c9-4eac-4ea2-8e28-e7fee0f948fd",
  "5b24e1e8-05e7-449e-aa54-460aa17e1a2d",
  "09f331ef-1fcb-45da-be6f-9e41a0090f30",
  "fc440551-583f-447c-b69d-d427475c0cb3",
  "b3e8a243-cd03-4eb0-b40e-ac4e82d43ab9",
  "7d5811c0-3b47-44c5-98bf-745bc0352018",
  "7564843c-7185-461c-be92-ec201da75913",
  "ab7c98c1-d0e7-4964-88fe-8e9e4f9d336a",
  "d5b2823a-9d3e-473d-8383-a9548ffa5bed",
  "f48b9dc3-b4aa-4415-b006-f7b61f01ca24",
  "5f75cab2-adb8-4a47-b47b-e47e3eed1957",
];

export const RECROP_STAMP_IDS: readonly string[] = [
  "70676922-f57e-4e99-a0d5-f400422c9b0e",
  "9e799b45-d0bf-495a-bb8f-ac0bc43bf73c",
  "63c44120-3b19-4d97-b1e0-63b372fcfafd",
  "09896463-19fd-49f2-b8b4-ee83fd3d034a",
  "41369e40-fe82-409c-9115-eaa18883049d",
  "50f40f17-1248-4f86-aa66-f8a6093cc94c",
  "1bcbc907-57c1-4d59-ba37-62613fca3267",
  "86c72bc0-1100-4bad-bc77-01ffc4f0c3e9",
];

export const RECROP_STRETCH_IDS: readonly string[] = [
  "fc440551-583f-447c-b69d-d427475c0cb3",
  "f48b9dc3-b4aa-4415-b006-f7b61f01ca24",
];

export type RecropFlag = "discover_stamp" | "margin" | "signature" | "wrong_photo";

export interface RecropBlockedCard {
  id: string;
  setId: string;
  setName: string;
  number: string;
  surname: string;
  reason: string;
  flags: readonly RecropFlag[];
}

export const RECROP_BLOCKED_CARDS: readonly RecropBlockedCard[] = [
  {
    id: "93a3e9e6-3b14-41f0-a31f-9b3c3d192b85",
    setId: "2b77043a-6583-4d79-b59d-d2ab20291a17",
    setName: "1986 Topps Baseball",
    number: "328",
    surname: "obrien",
    reason: "ink autograph across the photo. Permanently excluded: not baked, not served, not dealt (Design recrop review 2026-10-22)",
    flags: ["signature"],
  },
  {
    id: "1cf53402-61f8-4fac-9aae-4fb7b9cf112e",
    setId: "2b77043a-6583-4d79-b59d-d2ab20291a17",
    setName: "1986 Topps Baseball",
    number: "499",
    surname: "gibson",
    reason: "scanner mat around the card. Cropped to the printed card edge on rebake. The bottom name band stays 14 percent (Design 2026-10-23)",
    flags: [],
  },
  {
    id: "70676922-f57e-4e99-a0d5-f400422c9b0e",
    setId: "affd57b8-2b1d-4ea3-9f51-1530d8088e5c",
    setName: "1988 Topps Baseball",
    number: "245",
    surname: "gedman",
    reason: "bad scan: DISCOVER TOPPS seller stamp on front. Permanently excluded: not baked, not served, not dealt (Design 2026-10-23)",
    flags: ["discover_stamp"],
  },
  {
    id: "9e799b45-d0bf-495a-bb8f-ac0bc43bf73c",
    setId: "affd57b8-2b1d-4ea3-9f51-1530d8088e5c",
    setName: "1988 Topps Baseball",
    number: "347",
    surname: "johnson",
    reason: "bad scan: DISCOVER TOPPS seller stamp on front. Permanently excluded: not baked, not served, not dealt (Design 2026-10-23)",
    flags: ["discover_stamp"],
  },
  {
    id: "63c44120-3b19-4d97-b1e0-63b372fcfafd",
    setId: "affd57b8-2b1d-4ea3-9f51-1530d8088e5c",
    setName: "1988 Topps Baseball",
    number: "410",
    surname: "pena",
    reason: "bad scan: DISCOVER TOPPS seller stamp on front. Permanently excluded: not baked, not served, not dealt (Design 2026-10-23)",
    flags: ["discover_stamp"],
  },
  {
    id: "8d0fc5e2-41ea-4428-a662-e9a059350599",
    setId: "affd57b8-2b1d-4ea3-9f51-1530d8088e5c",
    setName: "1988 Topps Baseball",
    number: "495",
    surname: "murray",
    reason: "scanner mat around the card. Cropped to the printed card edge on rebake. The diagonal name mask is not widened (Design 2026-10-23)",
    flags: ["margin"],
  },
  {
    id: "09896463-19fd-49f2-b8b4-ee83fd3d034a",
    setId: "affd57b8-2b1d-4ea3-9f51-1530d8088e5c",
    setName: "1988 Topps Baseball",
    number: "54",
    surname: "clancy",
    reason: "bad scan: DISCOVER TOPPS seller stamp on front. Permanently excluded: not baked, not served, not dealt (Design 2026-10-23)",
    flags: ["discover_stamp"],
  },
  {
    id: "a5106b0b-151c-496b-91bc-815174d48bb3",
    setId: "affd57b8-2b1d-4ea3-9f51-1530d8088e5c",
    setName: "1988 Topps Baseball",
    number: "574",
    surname: "nettles",
    reason: "scanner mat around the card. Cropped to the printed card edge on rebake. The diagonal name mask is not widened (Design 2026-10-23)",
    flags: ["margin"],
  },
  {
    id: "41369e40-fe82-409c-9115-eaa18883049d",
    setId: "affd57b8-2b1d-4ea3-9f51-1530d8088e5c",
    setName: "1988 Topps Baseball",
    number: "58",
    surname: "magadan",
    reason: "bad scan: DISCOVER TOPPS seller stamp on front. Permanently excluded: not baked, not served, not dealt (Design 2026-10-23)",
    flags: ["discover_stamp"],
  },
  {
    id: "50f40f17-1248-4f86-aa66-f8a6093cc94c",
    setId: "affd57b8-2b1d-4ea3-9f51-1530d8088e5c",
    setName: "1988 Topps Baseball",
    number: "62",
    surname: "hamilton",
    reason: "bad scan: DISCOVER TOPPS seller stamp on front. Permanently excluded: not baked, not served, not dealt (Design 2026-10-23)",
    flags: ["discover_stamp"],
  },
  {
    id: "1bcbc907-57c1-4d59-ba37-62613fca3267",
    setId: "affd57b8-2b1d-4ea3-9f51-1530d8088e5c",
    setName: "1988 Topps Baseball",
    number: "65",
    surname: "durham",
    reason: "bad scan: DISCOVER TOPPS seller stamp on front. Permanently excluded: not baked, not served, not dealt (Design 2026-10-23)",
    flags: ["discover_stamp"],
  },
  {
    id: "86c72bc0-1100-4bad-bc77-01ffc4f0c3e9",
    setId: "affd57b8-2b1d-4ea3-9f51-1530d8088e5c",
    setName: "1988 Topps Baseball",
    number: "690",
    surname: "howell",
    reason: "bad scan: DISCOVER TOPPS seller stamp on front. Permanently excluded: not baked, not served, not dealt (Design 2026-10-23)",
    flags: ["discover_stamp"],
  },
];

const RECROP_SET_IDS = new Set([TOPPS_1986_SET_ID, TOPPS_1988_SET_ID]);
const BLOCKED_BY_ID = new Map(RECROP_BLOCKED_CARDS.map((card) => [card.id, card]));

/** Autograph and DISCOVER TOPPS stamps. Never baked, served, or dealt. */
export function recropPermanentlyExcluded(cardId: string | null | undefined): boolean {
  if (!cardId) return false;
  const card = BLOCKED_BY_ID.get(cardId);
  if (!card) return false;
  return card.flags.includes("signature") || card.flags.includes("discover_stamp");
}

export function isRecropReviewSet(setId: string): boolean {
  return RECROP_SET_IDS.has(setId);
}

export function recropBlockedForSet(setId: string): RecropBlockedCard[] {
  return RECROP_BLOCKED_CARDS.filter((card) => card.setId === setId);
}

export function recropBlockedCard(setId: string, cardId: string): RecropBlockedCard | null {
  const card = BLOCKED_BY_ID.get(cardId);
  if (!card || card.setId !== setId) return null;
  return card;
}

export function recropMaskedPath(setId: string, cardId: string): string {
  return `/api/qa/sets/${setId}/recrop-review/${cardId}`;
}

/** Held 1988 rebakes may follow a corrected scan. They stay blocked, so a drifted source cannot be dealt. */
export function recropHeldSkipsSourceHash(cardId: string | null | undefined): boolean {
  if (!cardId) return false;
  const card = BLOCKED_BY_ID.get(cardId);
  return card?.setId === TOPPS_1988_SET_ID;
}