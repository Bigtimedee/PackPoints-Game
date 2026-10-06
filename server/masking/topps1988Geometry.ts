/** Exact-source, visually inspected expanded cohort. Not a metadata-based approval of all base cards.
 * 563 exact portrait sources: originals and masked outputs inspected 2026-10-06,
 * each passed real whole-image production OCR. Source hash/name/id must all match;
 * changing an image or expanding the cohort requires another layout review.
 * Live bakes and explicit post-bake QA are still required. The set remains held.
 */
import type { MaskRegion } from "@shared/schema";
export const TOPPS_1988_SET_ID = "affd57b8-2b1d-4ea3-9f51-1530d8088e5c";
export const TOPPS_1988_PROFILE_ID = "1988-topps-diagonal-reviewed-v1";
/** Conservative stair-step triangle over the slanted lower-right name ribbon.
 * 12 narrow overlapping strips, never a full-width bottom band. 13.85% area.
 * The inspected faces and upper bodies remain entirely outside this corner.
 */
export const TOPPS_1988_REGIONS: readonly MaskRegion[] = Array.from({ length: 12 }, (_, i) => {
  const x = 40 + i * 5;
  const y = 100 - (x + 5 - 40) * 0.7 - 1;
  return { xPct: x, yPct: y, wPct: Math.min(5.2, 100 - x), hPct: 100 - y, type: "blur" as const, radiusPct: 0 };
});
export interface ReviewedToppsSource { cardId: string; player: string; number: string; imageUrl: string; sha256: string }
export const TOPPS_1988_REVIEWED_SOURCES: readonly ReviewedToppsSource[] = [
  {
    "cardId": "002e0c66-c1c9-4084-afba-eb28acaa2e8d",
    "player": "Jim Presley",
    "number": "285",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779168111638x423406014295006460/resize",
    "sha256": "f63728bc423d13e4601da192ae74e9995e1e6d0e6ab94cb8c2caec05805e3546"
  },
  {
    "cardId": "0047f249-6173-4083-9344-2d619c80515b",
    "player": "Neal Heaton",
    "number": "765",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781463929355x234297227906887550/resize",
    "sha256": "acd7fbcec260bc995139a142409e0086ca9e65cda10e9cb34cff2b993bfff94b"
  },
  {
    "cardId": "01579e64-c557-4ea4-8e6d-48a533836d50",
    "player": "John Farrell",
    "number": "533",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1721405140277x345773170480552240/crop_image",
    "sha256": "0e34b7148505d89d346a45c48dcfbd5e529ac971b769a0a905afd5024fe24b28"
  },
  {
    "cardId": "01699363-f81b-4158-8960-991ccbcba7e3",
    "player": "Donnie Moore",
    "number": "471",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1778601951339x813980121183987200/resize",
    "sha256": "2cfbdb2e05ddad228e7e6fee86d04f62716baad9afdfe87e145ed5d3106d555d"
  },
  {
    "cardId": "01c0d709-44ef-459e-b00e-8de39c79519e",
    "player": "Dennis Boyd",
    "number": "704",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1724466070039x935766033914894100/crop_image",
    "sha256": "48bd777cbc5af124c8c8a35ed60e8ad8b8db13e03096b2c32965f3bd8b5a0a98"
  },
  {
    "cardId": "0258d36f-c940-4151-bfae-13404ec30888",
    "player": "Jim Fregosi",
    "number": "714",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1730678460570x788031397806705900/crop_image",
    "sha256": "47f9ed8bfbc18914a5de65bcf1523f5c313779294a87f2d073d40b23e468387b"
  },
  {
    "cardId": "02733163-0f24-48a1-a3c8-d3eaac7b9af8",
    "player": "Glenn Davis",
    "number": "430",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1739940195702x261354154220323040/crop_image",
    "sha256": "134c347af89183a389671cabe5edbe2d4cba6863072cd2a94c0e209c7d03b19f"
  },
  {
    "cardId": "0383d01c-fe53-4b8d-a1a4-c007c0dab3ad",
    "player": "Mickey Hatcher",
    "number": "607",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726738435056x721496835705651700/crop_image",
    "sha256": "e648be59ef50507e889db27f36cb05201e178e3d4b0e8cda605a4a6a31ed7feb"
  },
  {
    "cardId": "0390c11e-487e-4024-b5a7-73f8c9eb98d7",
    "player": "Floyd Youmans",
    "number": "365",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1780253075652x167889145241900450/resize",
    "sha256": "7653c53a1724e9da7d00c710b80699443aae7fbeabc56f058601fbc6ab12c8ad"
  },
  {
    "cardId": "03afa332-dfb5-45f0-a989-fe3677e9e458",
    "player": "Rick Leach",
    "number": "323",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779482473682x172910393660043140/resize",
    "sha256": "affbff38645753429d4560842c0e486b40659952f4871c2fe49834d2646de93a"
  },
  {
    "cardId": "040fc8b3-308e-4552-9829-70afb0dbc33f",
    "player": "Rafael Santana",
    "number": "233",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633998740x118185961239120940/crop_image",
    "sha256": "92c0be9df6509ffb104f7f6ee88a8b5daff34bc2ea1e3f28f3ae4e2a0575efca"
  },
  {
    "cardId": "04a0305f-b253-427d-9f44-b59b970281b5",
    "player": "Darrell Miller",
    "number": "679",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1743554102645x910656757130772600/crop_image",
    "sha256": "d3cab6d862b83c0a5026362a0a5199cc904bd3ced998318de107e3217bb35ff8"
  },
  {
    "cardId": "051e4805-8cab-4c1e-896d-9073e452f12c",
    "player": "Dave Stieb",
    "number": "775",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1722964869455x261986294538641540/crop_image",
    "sha256": "99eb09a07d1339a2dc090be33bbe9d603f2c9869629c6ffc76cd4555f374e100"
  },
  {
    "cardId": "05df6b8e-471e-4032-a2b3-835f7fe99f1a",
    "player": "Dale Mohorcic",
    "number": "163",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1789881831072x288569568776292600/resize",
    "sha256": "7f3e0455a305971f6e7abae20bc6ebcc1dcce4ce4a23476e3563f4cf8edf03ce"
  },
  {
    "cardId": "06735cf4-1669-4b02-8598-69c37f0cc86e",
    "player": "Sam Horn",
    "number": "377",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1732317660782x650129941709420800/crop_image",
    "sha256": "e875073956bbd061c3dc425ef88c2c72d24fa152186bfa11e71e94506e94b25a"
  },
  {
    "cardId": "06e3fdf9-e27c-483a-b885-9b557fe45025",
    "player": "Felix Fermin",
    "number": "547",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1778601955081x951899265516837000/resize",
    "sha256": "73a1de935e90fa5d4422559d8c380c3d6a3a36ff5bc6c038c3276e98d0b06cf6"
  },
  {
    "cardId": "071efb24-6642-44ee-8005-f859c1670d48",
    "player": "Wally Ritchie",
    "number": "494",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781087633552x922058538639452000/resize",
    "sha256": "d1ef0c844b6a38f8e1ee832c4e9cd7d54ad7e03dbfc785f9e27204673b38fbfe"
  },
  {
    "cardId": "07368810-9965-4995-bdd4-d765895f44b9",
    "player": "Fred Manrique",
    "number": "437",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781714590137x395371699247412350/resize",
    "sha256": "c20d462f81e5b3c8604253915d6c1643962d178f0e714ea3e5d2b156c00e81dd"
  },
  {
    "cardId": "079965ce-aeba-46f0-9724-226d24ebc499",
    "player": "Kelly Downs",
    "number": "629",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779168793947x314305720427512400/resize",
    "sha256": "f561ed758178ac6aa4f48da9bacc1ef48f3c047b04057f167922d912cfaa8ba6"
  },
  {
    "cardId": "07ceb46d-18b7-4be8-9be1-fb8c255605b0",
    "player": "Barry Lyons",
    "number": "633",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633991799x103181402056798050/crop_image",
    "sha256": "2d7b59556b5eda5592fd4af509735e0cbf918c52a1d3141b06b536ab9841065e"
  },
  {
    "cardId": "080cf59e-3874-4efc-b448-c3996df5fb16",
    "player": "Mitch Williams",
    "number": "26",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1782095277028x912324686092200800/resize",
    "sha256": "98a052f8d6f55e43725b76206227220f298b8a27625fab57a0f9c4f042fb8723"
  },
  {
    "cardId": "09896463-19fd-49f2-b8b4-ee83fd3d034a",
    "player": "Jim Clancy",
    "number": "54",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1746372705803x618750712200754000/crop_image",
    "sha256": "dce6f17ea1e0bedb109e370db79c3dfd4c571de4de0f83c7aef5d5469db17a3b"
  },
  {
    "cardId": "09f331ef-1fcb-45da-be6f-9e41a0090f30",
    "player": "Orel Hershiser",
    "number": "40",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1739071916333x742844954796115800/crop_image",
    "sha256": "dfe89b33b3f01e66a26885f21d36fc729b8880f349ff358ad2406b87a00406f1"
  },
  {
    "cardId": "0a50d264-ff7d-4058-ba0c-2eca0dd22e89",
    "player": "Von Hayes",
    "number": "215",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779047356826x293578032941610500/resize",
    "sha256": "33a07a2286c88c062d6fd9e681b4b460292ce68b2b7d6c43d489735168b9b4c8"
  },
  {
    "cardId": "0b52cab5-9f6c-438e-9b51-d00e2dde364f",
    "player": "Harold Reynolds",
    "number": "485",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1763751866881x717278146535708500/crop_image",
    "sha256": "57b8e3395cad6aee8df94d95dc081c141d1b093b222d9eba92339cf4c1f9ea86"
  },
  {
    "cardId": "0bfb6caa-a103-40ee-92d7-0717ae24266a",
    "player": "Luis Polonia",
    "number": "238",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1778601656444x681861910684334500/resize",
    "sha256": "5049d39847372b009aec8760a1a92249d7e5c3ec2d38f2fd4000dbb25005ddb1"
  },
  {
    "cardId": "0c549ad8-d79a-4c5b-a2f5-f1d0b91e0d6e",
    "player": "Lenny Dykstra",
    "number": "655",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1776957890438x879462042992566500/resize",
    "sha256": "6f7d06235cab45cfab06ed3c13f822a5c5871ca66c76c96312aa50c129c424e9"
  },
  {
    "cardId": "0c95981e-cbd5-438f-83cc-cf392d6818d7",
    "player": "Rick Sutcliffe",
    "number": "740",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1728660318550x309983129058777360/crop_image",
    "sha256": "9c40e0fa81667d0d685eaca8493c25f1b090e7d4ca9e2cfaa48203e02e596fe8"
  },
  {
    "cardId": "0cccd181-3464-4441-b622-ab04e721fd43",
    "player": "Greg Gross",
    "number": "518",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779166495092x129106237193531870/resize",
    "sha256": "ba2abb7555ae09a65e545033fa61ba10c9f443f66d67ca9d6cbf286878b3f079"
  },
  {
    "cardId": "0ce54feb-8a40-4c85-bd3d-d12c5ec12ed0",
    "player": "Mark Williamson",
    "number": "571",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779168160317x888241721876150000/resize",
    "sha256": "cde102f18148c532883378dd2aeaec36157c9a86c23ead08f4d282f61caff512"
  },
  {
    "cardId": "0d40317d-bc3d-42ab-8ec4-035002b46231",
    "player": "Ray Searage",
    "number": "788",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1733667994874x181435650212021340/crop_image",
    "sha256": "6128842fa94a223c0a08a0b8934ab73359ce499423b5039ac45983fc17cd6db7"
  },
  {
    "cardId": "0d96fdc7-65b4-4d7d-a8e2-972afaaba3bb",
    "player": "Rick Cerone",
    "number": "561",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1778602014059x744937588502505100/resize",
    "sha256": "8d781e3aea4cfee5ae2763159defa812d285649cd5d99c422393e24eb73f090c"
  },
  {
    "cardId": "0e76ef40-4d4b-4c7a-9b71-5810619be763",
    "player": "B.J. Surhoff",
    "number": "491",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1778601774077x752614322789952400/resize",
    "sha256": "bf2f4386e93c43667f71ae74af0453e0b1578b2455b79fe00ad50c7396f89655"
  },
  {
    "cardId": "0f72d488-d52b-4895-a87f-23843d16d199",
    "player": "Candy Maldonado",
    "number": "190",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781422062100x727040019583094400/resize",
    "sha256": "7f0fa02d4ed05439c0d99ebf2e00ce5df0e2c7a4020f2e68b74b3abeefa5ab71"
  },
  {
    "cardId": "0f7f6f19-1085-4519-922c-9723e4b63f49",
    "player": "Ken Griffey",
    "number": "443",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1737647109506x448231518783222400/crop_image",
    "sha256": "73588ded24edf0f7e864aef1fb052d3ac683f74d124f3b402fbfe69493e37c67"
  },
  {
    "cardId": "0fde500d-e437-4800-bc87-f5a14c271d5b",
    "player": "Joe Sambito",
    "number": "784",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633990765x756019245845959800/crop_image",
    "sha256": "8e746dfc3b606f2042b393e13db6450f3572905f117ecb3128767ffb173e45b3"
  },
  {
    "cardId": "1021ccaf-69f6-435a-bb32-f6d647f9086c",
    "player": "Gerald Perry",
    "number": "39",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1782560632470x907524214722418700/resize",
    "sha256": "3d78fdc982ff72cf0745ff68b5849646a7c8ce47181d3d347470e33f7102947a"
  },
  {
    "cardId": "11583e1a-9d74-4c42-949a-396ce9cb8483",
    "player": "Scott Bradley",
    "number": "762",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1790494920501x383582063740380160/resize",
    "sha256": "9353645f2bb3e9a7dce5fb018ff8044c10fe871b58f5c600dec1e6e77621a729"
  },
  {
    "cardId": "1160f6ce-c1d6-41e5-947c-0cbf7e84ba07",
    "player": "Domingo Ramos",
    "number": "206",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1777509579731x584707371257699600/resize",
    "sha256": "7b6603150283591a639147c43e5786c4dfa984e85764a9b7f54ce65411be5118"
  },
  {
    "cardId": "11f32ec6-7377-44f9-b0cf-d0c9062e6cb6",
    "player": "Kelly Gruber",
    "number": "113",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1778109181881x493094919690098400/resize",
    "sha256": "254dd86006ffc7a1adf67ad4f65d27be14bf3f9d43f191cc6ee5aeb3100ee4f8"
  },
  {
    "cardId": "120fae63-f13f-49f5-a5a4-9e69b33d5b07",
    "player": "Ernie Whitt",
    "number": "79",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1780253060548x188994261579079170/resize",
    "sha256": "5216163ad401e74a595626e5b1232b4f23e73125a991aefedb4960f299e50cab"
  },
  {
    "cardId": "14521257-9f1d-486c-b9c0-f8379f6c1c23",
    "player": "Jeff Sellers",
    "number": "653",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726834373718x413541747890696900/crop_image",
    "sha256": "0937e25434ba5e1c3ffe4cdf0e25c52d9dbaabafc90feaad01885ca1609cbd82"
  },
  {
    "cardId": "14567ca8-f107-4f8e-af1b-54a1a41e0c4e",
    "player": "Bob Dernier",
    "number": "642",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781087630139x663022828785893200/resize",
    "sha256": "ff09c6b0ae09a29c7c4820edca7fc3edb245368ae0370167d8132707f9ff2225"
  },
  {
    "cardId": "152ec2dc-3106-4361-9d13-56b44e48ddc9",
    "player": "Steve Sax",
    "number": "305",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1720252614295x756383636179742500/crop_image",
    "sha256": "93b9b7b0f337ca9f6885427471bdff32efeca66b297ea854fd72d5f38c367c93"
  },
  {
    "cardId": "15aaf52f-f463-42e0-8072-1462ba3b108f",
    "player": "Jeffrey Leonard",
    "number": "570",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633995802x915340790853555100/crop_image",
    "sha256": "5101adc5b04ea505a2c4d20ae0eb5dac1646f9d9e84f46d4270c5df437b3a567"
  },
  {
    "cardId": "1637c30d-7eb1-4b11-9d91-159707c71bd3",
    "player": "Gerald Young",
    "number": "368",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1728167572761x496204367020226750/crop_image",
    "sha256": "85cf5e37363713bf04d93fc588270f88c0dbb404478e05b2b938afae5b8da3b6"
  },
  {
    "cardId": "1732a22b-dd6a-4195-b96c-361ded4ef4b1",
    "player": "Bill Long",
    "number": "309",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1720499098416x464123554856640900/crop_image",
    "sha256": "ab81f4fad6f8f04ae70601d33796d00b5d28056ddc78adf24cf8ef0d0db20319"
  },
  {
    "cardId": "17aca1de-fce1-41a5-9ae0-4ff588d61c7d",
    "player": "Gary Ward",
    "number": "235",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1782053300226x785788647807714000/resize",
    "sha256": "bc5f06258b74edd5370d505c2d36c70753b256c8e6da0cd7daf8d299b2e5aaf8"
  },
  {
    "cardId": "185f669e-f4f6-495c-a131-264948ae2807",
    "player": "Dave Righetti",
    "number": "790",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1751904674935x761375916774935400/crop_image",
    "sha256": "4c0be138b5aead0d4f972f557b78dce718dd2b6cbdbd47d91542204c30b8b4f8"
  },
  {
    "cardId": "193195a4-4222-4192-8c35-7b2365a5acc7",
    "player": "Fernando Valenzuela",
    "number": "780",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1720483281884x432209088750319800/crop_image",
    "sha256": "b83a742dcd33dbca09be43a1fa8b7d14e43ae60a5c441e8d6133b6ce02e9fe8c"
  },
  {
    "cardId": "19c24aec-3836-48a5-8794-9310ec8cccc5",
    "player": "Mike Moore",
    "number": "432",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1752280390401x597978508614199900/crop_image",
    "sha256": "87f4d7093a36aa1bb2d141b78b3ad770ea7e8253c484d2bc263983c2ce25ca1d"
  },
  {
    "cardId": "1a03d9e3-28e5-43b6-adae-8321aa2ff482",
    "player": "Eric Nolte",
    "number": "694",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1752281892604x719294917364450000/crop_image",
    "sha256": "0a7156cf64d484da0811b5c8040a561f95b187aee27d085e899581e95ed2f8d3"
  },
  {
    "cardId": "1a730e41-93bd-47fc-96e1-65f7e180f1fc",
    "player": "Gary Lucas",
    "number": "524",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1786499905160x537042011061615600/resize",
    "sha256": "cba967073b53ff8b2ee0d4637636cfafecc4cf8c194616a14827315b9b280474"
  },
  {
    "cardId": "1a8ae6c0-3357-4fe5-b58d-2dad09ed34b5",
    "player": "Jim Traber",
    "number": "544",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1750742172378x554314746655571000/crop_image",
    "sha256": "26b67ad68959493aa23e57d9b95e19fdb1a87d440a1688350f169fad3ac44bd0"
  },
  {
    "cardId": "1bb23f38-455f-42e6-a8a0-53c2df7d32db",
    "player": "Dion James",
    "number": "408",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1733718870834x316490791506237200/crop_image",
    "sha256": "929f92f3f90b710118fd8a904ab9af02b7423329fdd232a6fd3be43347eddb30"
  },
  {
    "cardId": "1bcbc907-57c1-4d59-ba37-62613fca3267",
    "player": "Leon Durham",
    "number": "65",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1752634863472x642810576882305800/crop_image",
    "sha256": "247f542d64751d06d7b5feccd989d80d26035d71861a4d11f904816a0becaf0a"
  },
  {
    "cardId": "1bd360ed-d6e4-4f69-a67e-547a8199f30c",
    "player": "Ray Knight",
    "number": "124",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1722695105028x418637473591660300/crop_image",
    "sha256": "785a260ffefef9eff32b26e52e8631a74247c4765bed631975d119bcfefbdc8f"
  },
  {
    "cardId": "1bec9480-6799-43df-a2ff-7678c9c37101",
    "player": "Dave Stewart",
    "number": "476",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1734581019199x573795774395394560/crop_image",
    "sha256": "0a82fa424c560cd692c3507cda2c8103fee4f3d1c532d4475d361a5d937e2c81"
  },
  {
    "cardId": "1c32c79a-e039-4a0b-922d-942aace7ad4a",
    "player": "Jose Uribe",
    "number": "302",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779169550675x880657555290614400/resize",
    "sha256": "95a86e4bfd75084786cacfd5833bd612fbfc69c3d599dae3f5745b201a012751"
  },
  {
    "cardId": "1ca6fe85-23a9-46bd-8a01-f1464798212e",
    "player": "Carney Lansford",
    "number": "292",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1751637320139x576326761203036900/crop_image",
    "sha256": "e4056784c697439b6a744882f9fb386660a3de608489445f7040c0c35dc807c1"
  },
  {
    "cardId": "1cb399bc-932f-408e-8d3f-82c22eb8cec7",
    "player": "Mel Hall",
    "number": "318",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779167053912x166525563473175040/resize",
    "sha256": "a87c0fbb43dd16ff88a17037d8ce75759047c3a45da8560ee80e4baba99b58de"
  },
  {
    "cardId": "1e18a7a8-014f-4afa-8370-77d4af7b8be3",
    "player": "Andre Dawson",
    "number": "500",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1731794708596x582922626201273200/crop_image",
    "sha256": "889f1f486b45bd3c4661f196953e12222881b96e553e604bb3cb07bde4293cc9"
  },
  {
    "cardId": "1f7f9fa4-f9b7-407e-9825-60800fed5c7c",
    "player": "Les Straker",
    "number": "264",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1752279183934x580781486268201700/crop_image",
    "sha256": "5db90c6964da84955b0d750d111d51c36fbd5614054f9090dabeeb1b68b2e155"
  },
  {
    "cardId": "1fec50de-25f4-4c11-b816-6d801cf13763",
    "player": "Keith Hernandez",
    "number": "610",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1720529581626x304835552277187260/crop_image",
    "sha256": "e2f11f51337191f2024392030ab938e9a0f5b667ed7d8e323ff0f396f76fb64f"
  },
  {
    "cardId": "2066c9e0-50b6-4ba8-850c-21737a4f097c",
    "player": "Don Carman",
    "number": "415",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726250470497x395358807834432600/crop_image",
    "sha256": "d8f6503922547aa4f217a4060a7fee15e1de809f42b05d4fb19abfc90d5aeb99"
  },
  {
    "cardId": "208d2759-a100-4450-809b-72e2a31c4bea",
    "player": "Danny Darwin",
    "number": "461",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1782588139796x744445470453563900/resize",
    "sha256": "4576476b317c22a55a857e00ed18ce558ea22ea2974a2881f462926516062dd4"
  },
  {
    "cardId": "20a978be-8c1f-4e81-8458-e2c7a3f02ea7",
    "player": "Mike Heath",
    "number": "237",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726282383436x532295619129282700/crop_image",
    "sha256": "e837c3d533fe990d23f9106b63dc49e18320f83a09a5e12f6fa5751135bfbcc5"
  },
  {
    "cardId": "20c42268-6362-4be6-995a-9afa128ecc17",
    "player": "Rick Honeycutt",
    "number": "641",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633990934x322365899001095800/crop_image",
    "sha256": "300448daea41bdc38b617e60c2a2baa48a6f7b765c90fabfeb6e69f12b4741f4"
  },
  {
    "cardId": "20e0cd69-a418-4641-ab5b-61b3cc1e81b4",
    "player": "Chet Lemon",
    "number": "366",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1722912353392x466389717755744100/crop_image",
    "sha256": "0c672dfe356453bce4e9440b997c37e6f2163645676d9512b20bc0cb7f55c904"
  },
  {
    "cardId": "20e30e74-2c84-4bc9-835a-eab78cdb4a2e",
    "player": "Tommy Hinzo",
    "number": "576",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1732582627909x826461214185050900/crop_image",
    "sha256": "dd2d8097c29c340a273f0ad4b9f30db9b2f0cfeaa8a28b7d1331acb360265576"
  },
  {
    "cardId": "20e6f561-02fd-42a8-9c48-78b7c617e354",
    "player": "Frank Lucchesi",
    "number": "564",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1728659822752x613460011824930300/crop_image",
    "sha256": "d10cee7712ce063bf4be3f524f88c360cb880d3fa5c5c0402cf19ff8bdbab706"
  },
  {
    "cardId": "21a811ac-ea7b-4332-aedb-6c60bd003968",
    "player": "Mike Loynd",
    "number": "319",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779167052751x277515281366343520/resize",
    "sha256": "425f68793d326a76573f9e7e7a8575feba7fd5783bcd7dbfc1d32926cd569d25"
  },
  {
    "cardId": "21bc079a-43bd-42c8-9240-2b1eb8645b6d",
    "player": "Sid Bream",
    "number": "478",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1778601880216x780478980039935800/resize",
    "sha256": "e956d347301dba8475a37b0591561a63834eeabd37200cfcf744fe41dc690fac"
  },
  {
    "cardId": "22194706-053e-48dc-9031-1174a4321b8d",
    "player": "Mike LaValliere",
    "number": "539",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781087614157x480544967774254600/resize",
    "sha256": "e36724e08f9ba68eb398f6d186fc648b15c5bbf1be88d2aa4f45d2b00feaee06"
  },
  {
    "cardId": "2265502c-5ce6-4f45-8f03-3dc0b1b84b63",
    "player": "Bobby Thigpen",
    "number": "613",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779169151736x802781175627127300/resize",
    "sha256": "c6a4402a02113133432e8ea6ba16aa71bb687950a01fac5ba6e104db14e0a27f"
  },
  {
    "cardId": "22fad5ee-94a6-4c4c-9103-e580ce429290",
    "player": "Randy Myers",
    "number": "412",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726834372298x414050841197819900/crop_image",
    "sha256": "53bf5b734b467b199bdccd88a8da5413f94f30946c82f81075a344137306fbd3"
  },
  {
    "cardId": "235d7c50-6172-4d01-93f9-3822bbe1c814",
    "player": "Willie Fraser",
    "number": "363",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779161835581x805820819231488600/resize",
    "sha256": "43504c265e5ad83ffcd87fe7f4c09a9f91860ebae6bc121b9a49c676da3ffc57"
  },
  {
    "cardId": "236287f3-e793-4595-8b03-99488a034fe1",
    "player": "Ozzie Smith",
    "number": "460",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1721899754642x459869108780466940/crop_image",
    "sha256": "c20bc39910df195e77a4a826d3427ce37a6f9075df513018dc3333030eaf2f4c"
  },
  {
    "cardId": "2402faa5-83ac-4363-b435-b26d2e8e0c36",
    "player": "Dave Clark",
    "number": "49",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1776202410046x267831416282845470/resize",
    "sha256": "fbd04b7c6ad7efde2ee22fd5346f1a992efe9728355f7e011f16e0d9d463142a"
  },
  {
    "cardId": "252ed1f5-e954-48df-ab88-dd3c0a711226",
    "player": "Mike Scioscia",
    "number": "225",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1720252613515x782588403160896000/crop_image",
    "sha256": "0b0b28568cef7bf9da3532f9c801dc02b7ca70eb57892bbfb0d596434e8226b8"
  },
  {
    "cardId": "25441d2c-fdad-45dc-9b9a-9cb0b45da889",
    "player": "Jamie Quirk",
    "number": "477",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633996599x991690478843620500/crop_image",
    "sha256": "4957d5cf0bbd36739c8ac82c83dbb0c6af3d59d00d1612cb51e0c027e8a73e72"
  },
  {
    "cardId": "259d0f06-115f-45fe-9c1f-2535d9124ecb",
    "player": "Rick Rhoden",
    "number": "185",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1735339624693x252389768761981600/crop_image",
    "sha256": "05a83dac53f3602e450f87bc50cad68725951b23ee71f9d314b50b00d8c64a08"
  },
  {
    "cardId": "271116f7-cd97-4304-941d-413185b5e04b",
    "player": "Dennis Eckersley",
    "number": "72",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1722605848900x907216266444987300/crop_image",
    "sha256": "fb085befaace7ba42a5f96e5cf74f44fdbc06644162ff4946b696be067493d24"
  },
  {
    "cardId": "279b2be3-5ed7-496e-ac83-9041f9058c24",
    "player": "Tom Browning",
    "number": "577",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1727295186632x368167439053408400/crop_image",
    "sha256": "e6c717ec705538645a15699884c61b36df6680d63c594a0c56d2454922c2d5d9"
  },
  {
    "cardId": "27d5661c-8d2c-4bfb-9f6b-128b20fc5985",
    "player": "Tom Kelly",
    "number": "194",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1748728327913x723292782780671000/crop_image",
    "sha256": "3624ebda26e07ddb31849bed458bbd5a520131c37ba285213781582c5f25f63d"
  },
  {
    "cardId": "2868bc66-d28e-4d1e-8012-e4ef706fd12d",
    "player": "Frank Williams",
    "number": "773",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781087692854x343752809442935000/resize",
    "sha256": "ca638281e0219e92d8a045833383237fab2af9f717a51f27913c6cd7cecb6bbb"
  },
  {
    "cardId": "288dca8c-c2f7-4226-b679-f4eda73512c5",
    "player": "Jose Guzman",
    "number": "563",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1778356881284x591020827114080900/resize",
    "sha256": "179e855512e12110c7b90e6fe9eab350ba9542669e9d70877de26b9304e12cfa"
  },
  {
    "cardId": "29301584-7312-4fee-b9c9-546afab3fdb6",
    "player": "Gene Mauch",
    "number": "774",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779165532167x793952482192310900/resize",
    "sha256": "64d90f97708463ab6165163ef9341a334140beda54ebf478bf2e55fe6b2a1184"
  },
  {
    "cardId": "293bf6dc-edea-4713-baba-6be6479fad54",
    "player": "Wally Joyner",
    "number": "420",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1727575047939x963170313903233500/crop_image",
    "sha256": "eadd43fab0b568c7d03d0638e094a3a87832b1bb3c3ff4ab77caba442d58ceff"
  },
  {
    "cardId": "29405034-698b-40cb-8b57-277f222ddd8a",
    "player": "Eric Davis",
    "number": "150",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1723242774369x407748154778543300/crop_image",
    "sha256": "40b2fc54333172102808a10f0dbd2edde7b0a2c500a9f2ee71647391306153bf"
  },
  {
    "cardId": "2967f76a-a992-4665-af94-0f85c7d798b5",
    "player": "Lou Piniella",
    "number": "44",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1723071444285x657683201676412000/crop_image",
    "sha256": "504e9bbc5636e7f778e8b4ae7a95d5ea35f6252914e70555d41d83bd722f794b"
  },
  {
    "cardId": "2968b57e-b42d-4f1a-9667-54fa358d3a07",
    "player": "Mark Knudson",
    "number": "61",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1777833779608x732680063331052700/resize",
    "sha256": "df09d17ce6212e1d43cb284d2689932468716502bc23439d3fa93a8e8a0d0b2a"
  },
  {
    "cardId": "2a1ac05e-6be0-48e0-893e-5e621008ef45",
    "player": "Jeff Russell",
    "number": "114",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633990838x468558417325340740/crop_image",
    "sha256": "a61da1b8f6d5c4b52350fcaeb34af03b7982570b0793dedf3859981a464f2a4b"
  },
  {
    "cardId": "2a2902cc-6a51-4754-8e93-4fd7b93cc78c",
    "player": "Don Robinson",
    "number": "52",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781422062037x198958303140728260/resize",
    "sha256": "b9946e299fd8b768b769973fad18e10b799b4c9b22c99e72b3bde67c246ec7be"
  },
  {
    "cardId": "2af6444c-d97a-4384-995c-868d94321569",
    "player": "Atlee Hammaker",
    "number": "157",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1728536603444x320316326997461570/crop_image",
    "sha256": "ea24d8f5e24c9f7884d2671499aff5478321da1d3004f55c6b15061a66dac428"
  },
  {
    "cardId": "2b8da556-99fa-4cc1-a9c7-672b8bc03b4e",
    "player": "Steve Ontiveros",
    "number": "272",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779168478409x483056240512810240/resize",
    "sha256": "45ef55233850ffa517e2489ad33432477e32154b08856dcb5e0ec3a9cf901517"
  },
  {
    "cardId": "2c3a25b6-6bd5-4cd1-b078-015219ccf1fa",
    "player": "Larry Herndon",
    "number": "743",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726282382859x231357662747760700/crop_image",
    "sha256": "f3367376d156c4767851ca450a4461e079d564627a9ccc5c49dd543e53ae3881"
  },
  {
    "cardId": "2d210f0e-58f8-4546-b3ad-14ae9aa59465",
    "player": "Lee Lacy",
    "number": "598",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1731989847028x785834928012153700/crop_image",
    "sha256": "86820456a0a59aa0e14d2962e9c0a89e7ca05a61b4e240954c0714698947609b"
  },
  {
    "cardId": "2d4ca594-6a29-407e-afe4-8337ef67f59b",
    "player": "Joaquin Andujar",
    "number": "47",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1786138739278x303034186399240500/resize",
    "sha256": "01b86df3ca5502fbd4059c607e30a445008465a92290a4535e057d030dfbaeb9"
  },
  {
    "cardId": "2d7dd010-a4f7-4035-984b-09f3ed37ad38",
    "player": "Jody Reed",
    "number": "152",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779165290986x779463588910376400/resize",
    "sha256": "4d810f09260dccee3312d2672f7442b32a88e067669782b0e9cc4cb6587eb451"
  },
  {
    "cardId": "2d7f7158-69ab-4125-b910-2b4ac946f002",
    "player": "Ivan Calderon",
    "number": "184",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779166496095x242693547788437980/resize",
    "sha256": "b3e77c23a2e8cedca0c438003bd667a35a882a449fe886e78461b4a25f7a468d"
  },
  {
    "cardId": "2f1f9fc4-9917-4335-8d08-c051152e1ab9",
    "player": "Gary Gaetti",
    "number": "578",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1789753442590x999923494834354000/resize",
    "sha256": "67f06b4b9d55d670b42729eeb6a2d93ef55e406e161c9f082bcd5b12930af928"
  },
  {
    "cardId": "2f755025-6753-4e8e-b2b6-d531a8bc1a0e",
    "player": "Tim Raines",
    "number": "720",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1720569933500x248922614144501800/crop_image",
    "sha256": "e78f75c26b4a3d1c7bc4d01fee2c97fc871cd2cc7be48acc158b29dfc77c23a3"
  },
  {
    "cardId": "2fcdb68c-817d-43eb-8487-ecf3eb2ba30a",
    "player": "James Steels",
    "number": "117",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1721322320197x675813810978893600/crop_image",
    "sha256": "f7e36d59318d5a3e56d93428ddc9aaa3ef7898cf297df623f2534dbef10f3b8a"
  },
  {
    "cardId": "305335db-6807-4e22-9735-0856f11bd2d1",
    "player": "Jerry Browne",
    "number": "139",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781244177553x934098806589894900/resize",
    "sha256": "2e9fe11fa79b14469a8c96c82e422ae4eea8d14d60dd9a202ff378945dd108ce"
  },
  {
    "cardId": "31667bf4-a795-4af9-8138-104448a30fb4",
    "player": "Robin Yount",
    "number": "165",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1721046562341x957656960810388500/crop_image",
    "sha256": "75625ef5501bb2a6c9bf54118c015edfabc36737d9b5771619d09e5378410eed"
  },
  {
    "cardId": "31944625-1ac6-4bc3-93d1-ca472405ea98",
    "player": "Dan Schatzeder",
    "number": "218",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1727304313695x780890967255671400/crop_image",
    "sha256": "3071bc8a006b03675a13b22a25383d298e12846f3add541573d13a43f429abaf"
  },
  {
    "cardId": "31ea8b51-2a71-4dad-a3c5-553bc918c670",
    "player": "Lloyd McClendon",
    "number": "172",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1751292249185x294511022843315900/crop_image",
    "sha256": "218342a27c84dc158bf3548006d2efa50269d58d3a123776cb08df907218ee63"
  },
  {
    "cardId": "328cecc3-ced4-4c0b-9bb8-26978002c2fc",
    "player": "Ken Howell",
    "number": "149",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1782560391458x280433230420608100/resize",
    "sha256": "0f7f01aa9cb087b09dc0794408fe8a1902e231c6b8839647e0a65cec6b50d20a"
  },
  {
    "cardId": "3501eaf2-6a19-4a46-a682-20e7575dc1bd",
    "player": "Ron Guidry",
    "number": "535",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726102412522x557975360547465800/crop_image",
    "sha256": "8624e6c6d8bd241e05668a45acdb1fbc9a70b2b1c569493a1fb133d3aa623ad9"
  },
  {
    "cardId": "35781384-40ac-4f65-9936-cb511599d19a",
    "player": "Jose Lind",
    "number": "767",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1724084284271x199265544348320670/crop_image",
    "sha256": "def534f9bda0a53e2c77286a2d3e254c4d2e50e8262e0f5d4a9a9501155600c5"
  },
  {
    "cardId": "35d307cf-e496-417c-a786-02a8a50f7de1",
    "player": "Joel Skinner",
    "number": "109",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1776202481358x149050107024770940/resize",
    "sha256": "a6352c7f6fb58e8f196044e7219a1e523e7846c2ff4467f075fffab451b918c9"
  },
  {
    "cardId": "35e502fc-6dd7-4231-acdf-da93eef7aa15",
    "player": "Devon White",
    "number": "192",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1728837447645x932412327677869700/crop_image",
    "sha256": "1562360d5da9f04092f08a03d1e2d0a3b9ae96561d028955d4ec3019b59a1758"
  },
  {
    "cardId": "36582855-de3e-464d-897a-ff75c54a5686",
    "player": "Bruce Sutter",
    "number": "155",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1761271822689x703852125638017700/crop_image",
    "sha256": "0b8e07b3e6ccf14d68ba4b96cb75be76ebb520988d1c32b0c585493074386383"
  },
  {
    "cardId": "36f65e74-5985-4369-8a2f-26338a570556",
    "player": "Tony Phillips",
    "number": "673",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1778602174418x907306052001346300/resize",
    "sha256": "82306d3a46090591554dde005f2192af106a54e487e91034d655cc55865bdf8a"
  },
  {
    "cardId": "36f77485-0e05-4f81-8504-371f19fc7019",
    "player": "Terry McGriff",
    "number": "644",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1728239127401x680932515029159700/crop_image",
    "sha256": "7e5ab77e8c5fa8168328fff787949e782aa34a6e799ecd7765636b9ccdd793e7"
  },
  {
    "cardId": "376d64e8-18ed-4144-a3b4-d237e161e34a",
    "player": "Mitch Webster",
    "number": "138",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1737239447365x775544555323907300/crop_image",
    "sha256": "115e9fcbe6f15d484dea9c92b490e9f3ed04978f07d34e0d6ca3f7d96c182e13"
  },
  {
    "cardId": "3776bb28-f710-45f5-812c-03bcd35e1b11",
    "player": "Marvell Wynne",
    "number": "454",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1785698393009x521426742299863550/resize",
    "sha256": "0f5cf22b8cfa0e78c9250624a1204cd76c25474305244ba4a055e964e2cafc40"
  },
  {
    "cardId": "3798a764-63d6-4530-afa3-c7164fe72229",
    "player": "Mike Dunne",
    "number": "619",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1721062378631x353896592968870660/crop_image",
    "sha256": "af20826f9de65858bf4c3ae7858454a4d86f1901a52d79b827ce1d8e8caa4a6f"
  },
  {
    "cardId": "3857b7a5-2d9c-474a-ab42-7d21af66be83",
    "player": "Tony Gwynn",
    "number": "360",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1720556929639x211476145228439260/crop_image",
    "sha256": "7c5d255d02b00ead144a1c88524f088eb49b2aa0809bb8f61d3489a764781e81"
  },
  {
    "cardId": "38a7c9a0-3556-40b1-8d23-cf2b84b8b2d6",
    "player": "John Morris",
    "number": "536",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1778601945804x117008064701831460/resize",
    "sha256": "9cb7a274f32f12f860a9dc2751bc85108e74395363922beebe76d0e50fdd3fb1"
  },
  {
    "cardId": "3b37a94d-ab8d-4ff3-98db-e76495fcc2f6",
    "player": "Keith Comstock",
    "number": "778",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1722685825674x683092303422646400/crop_image",
    "sha256": "fa1762c0c731d4af7828f32de830f9e2b62663669f2e45cf7900a9cfa5ca4081"
  },
  {
    "cardId": "3ba9bf6b-c9aa-44b8-ad02-970b0da3abb9",
    "player": "Brad Arnsberg",
    "number": "159",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779156669068x131121910899148370/resize",
    "sha256": "ddb83077f4e473a45910d17620d4b5cde1aef625fac0a944fe9d125b9b893f74"
  },
  {
    "cardId": "3cdb775b-bd72-4bb8-a0ba-22e9e3314e90",
    "player": "Harry Spilman",
    "number": "217",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633998868x392708455043783600/crop_image",
    "sha256": "c758505b16cb25e704157337e0d5c373ccdf7d2bf9e220c5c077f693a21d0620"
  },
  {
    "cardId": "3d6f25c8-91c5-461c-9266-9ca167118088",
    "player": "Denny Martinez",
    "number": "76",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1724965290171x246749600548515460/crop_image",
    "sha256": "d592878f4fe167c43ff044765eaac7cbfa4b983bc4427abc7d7d89f2f185e3c9"
  },
  {
    "cardId": "3e40fc4e-eda0-4886-9494-2b6752be0791",
    "player": "Rich Yett",
    "number": "531",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779167176067x923178130128189200/resize",
    "sha256": "0bb76c11bd34bc0b5001257e8944fee105aba941b8e93442b46693e2c6ad9861"
  },
  {
    "cardId": "3e4a83a5-07d9-4d4f-b607-4c43218f9a6b",
    "player": "Tom Niedenfuer",
    "number": "242",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1722431490254x741821439035636100/crop_image",
    "sha256": "bd35bd00911b4465930f41605fb1f2b9fc6acf394daca5716a3eaf59ea2ac615"
  },
  {
    "cardId": "400db8a0-bb20-470f-a497-a50fd8e9461f",
    "player": "Mark Davis",
    "number": "482",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1778601779115x589279471723074400/resize",
    "sha256": "cafa472eb44e79d4b684acd33a15a8d920ad2cd8187a474aa5a3b06ab57a2804"
  },
  {
    "cardId": "4071dc2f-6373-47c2-bba1-729b5df001e1",
    "player": "Keith Miller",
    "number": "382",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633988518x784332420367923600/crop_image",
    "sha256": "f6e7a3a3ab20daa771629afc27a68e5cca8b9f966edb4bab5c4574245b701bf9"
  },
  {
    "cardId": "40870ed3-e4bd-4ee3-a064-ead8e3f194e6",
    "player": "Darren Daulton",
    "number": "468",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1721859680156x872381444634538400/crop_image",
    "sha256": "e4020cf947b99eb5177cae04e56d6c65411f592b4f39d75511e46476b42079cb"
  },
  {
    "cardId": "41014769-1d67-4130-978c-4f4eb9c55b69",
    "player": "Jerry Mumphrey",
    "number": "466",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1782175704997x892866738951850500/resize",
    "sha256": "bb306b3abf6eb4b24c313d8d926050e0ecb91f66abe52e9d2c9e417106917b0a"
  },
  {
    "cardId": "41369e40-fe82-409c-9115-eaa18883049d",
    "player": "Dave Magadan",
    "number": "58",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1776647541256x507067290883916200/resize",
    "sha256": "f3270a22a958c185c99e277c49dab05d941aa998dca9beb82928f5adf88869a0"
  },
  {
    "cardId": "419c2450-6413-49e4-8eb3-b8f5aa560e6e",
    "player": "Rene Gonzales",
    "number": "98",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1760217282665x607523977964628000/crop_image",
    "sha256": "165d0084a0193b7596e74ed33860c84bb9fd73fa148a88ddd468a9a21025b812"
  },
  {
    "cardId": "421428c4-7589-413e-b711-01f1326e03de",
    "player": "Manny Trillo",
    "number": "287",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1788157996490x880132968264566400/resize",
    "sha256": "ad6f3950453a689035a2b7ff5b42e0ab24bb26f6ec6316ca965ac1acc313dd64"
  },
  {
    "cardId": "42eddb0a-4c3c-43b4-9c4e-436513ff77bb",
    "player": "Jeff Calhoun",
    "number": "38",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1733022852197x498193112816698300/crop_image",
    "sha256": "b83f321475dc54bf125fb35af216c471d95e295f0eeb623f582a6d4e9514b911"
  },
  {
    "cardId": "43087bf6-1233-41b0-a93a-5066084d924e",
    "player": "Mike LaCoss",
    "number": "754",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1731990127739x931382939487677800/crop_image",
    "sha256": "671b0d69905dfab5d03478474f28708cb6a366eade7416bbe6c3d28349d8272b"
  },
  {
    "cardId": "4328449e-c58d-49f9-a992-bb063e6c3b5e",
    "player": "Charlie Kerfeld",
    "number": "608",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1782560664648x871629264579321100/resize",
    "sha256": "8d37b36fd21dbace385bc7f95a34627d8f03d26b85e8dc2a2ff8e24da0cea8ae"
  },
  {
    "cardId": "432bd57f-5358-4613-b5fe-22797d85d960",
    "player": "Mickey Brantley",
    "number": "687",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779167357392x290159714974076440/resize",
    "sha256": "ee46b08a0b60ffa295407a6c998368f9aa7a81481e91c6f73b525e3a8cba7238"
  },
  {
    "cardId": "43624cbb-35fa-49d2-a7e8-e7a099656b16",
    "player": "Dave Martinez",
    "number": "439",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1721491744882x780878353580425300/crop_image",
    "sha256": "5376a27b0fc7d97e61d3c23840349e4b94a0c41e031d7bdcb44da0f27a98daef"
  },
  {
    "cardId": "439dee0e-75a8-4999-b84c-8503dd76dcb6",
    "player": "John Smiley",
    "number": "423",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726834373972x302752440220118000/crop_image",
    "sha256": "236628e79ce731e1eac4faa9050bdcc555a77547dae0d674c65b5b52f6be1284"
  },
  {
    "cardId": "44138c0d-87ab-4646-90b9-ad35df8eb4d9",
    "player": "Ed Vandeberg",
    "number": "421",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1752280392544x706605190455020300/crop_image",
    "sha256": "06e5a4b3be7a0e1ec29b44fa223ebe1598f0b7291b215e1159d93074ae379fcc"
  },
  {
    "cardId": "441d0914-6a03-4a42-908a-00c102bb54f1",
    "player": "Thad Bosley",
    "number": "247",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633993158x852344089281194400/crop_image",
    "sha256": "bc371162bfb8cb788a7b4d9a085b0c8fb7177bd69e37c984d0ff0cf1997e6c24"
  },
  {
    "cardId": "44671ed7-9524-4961-b080-7935ecc756b2",
    "player": "Dickie Noles",
    "number": "768",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1740686465331x246615605915837760/crop_image",
    "sha256": "0a7ec3736c8f59c9d59a42c13ddcd0614910a7aea27c1fa4e178a4736c25a88c"
  },
  {
    "cardId": "446aa39e-d9a1-49ef-b99f-63343979c26b",
    "player": "Roger McDowell",
    "number": "355",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633997029x396230229291218960/crop_image",
    "sha256": "cf5af95869be8965eb0e2ad87914da1067ede697595c6340e8166abfc1b7bad5"
  },
  {
    "cardId": "450df71c-72f3-4fc5-97ad-a473943509f6",
    "player": "Pete Rose",
    "number": "475",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1724431487524x702523771137014000/crop_image",
    "sha256": "77b4eeaf00428973a9dacf081b5d75c0e939a2417bcade2f57598654361a7365"
  },
  {
    "cardId": "45389b4e-6364-44ba-920e-f49c5341e282",
    "player": "Dwayne Henry",
    "number": "178",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781574929776x500860430326657300/resize",
    "sha256": "f1fe37581a2bb3b04564fb7d1aa72c9998bfe8d2f12676e2ec9ac6b59e1b8e43"
  },
  {
    "cardId": "4562ffca-7722-4d18-b1c7-6857bf8ca01e",
    "player": "Fred Lynn",
    "number": "707",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1730906462897x767371256863871700/crop_image",
    "sha256": "38d62fc881146bca0e4981be99255831ca2691491d3f4fe653947a1186df7bea"
  },
  {
    "cardId": "45f1a151-705c-4cd3-801f-947698804f97",
    "player": "Mario Soto",
    "number": "666",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1733407278091x285175862941483100/crop_image",
    "sha256": "93897bb78fdce5c6fced8cf644d0927529bcadf7e770ee2910f84866453d8e66"
  },
  {
    "cardId": "466dcdb9-7015-47f6-96cf-70d474e50a58",
    "player": "Tito Landrum",
    "number": "581",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1782095732918x347861643638999200/resize",
    "sha256": "306f25ac7bd74e75648d009478d4e4885b084e47c437d8079d1b31b076be275c"
  },
  {
    "cardId": "4697f993-caa2-4e5b-b536-416f80adb146",
    "player": "Juan Nieves",
    "number": "515",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633996513x785631927481492200/crop_image",
    "sha256": "80831aa0ee1e798d2b509110917fd8111891f87d2c7a218791d81d120782602b"
  },
  {
    "cardId": "46b4d19c-c7ac-4604-b30a-407d07428470",
    "player": "Frank Viola",
    "number": "625",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1736780102958x929551107181614700/crop_image",
    "sha256": "d2ef03f614a262d022f08235b0c9ff03cf3a9decce3ed339fc7ebd378eb6b20e"
  },
  {
    "cardId": "47081c81-3f77-4754-8a12-a01fff77f6f3",
    "player": "Rob Ducey",
    "number": "438",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779218748675x851049901756334200/resize",
    "sha256": "e464c820b0551b0d5050832adcc18c838d44605df785ab9defe483553c2c6b2f"
  },
  {
    "cardId": "47805836-17d7-436e-bd96-0bad22bc4700",
    "player": "Jose Canseco",
    "number": "370",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1722614722523x474478792355623500/crop_image",
    "sha256": "5501478395ddee3d831bd9509794f30f4c512549acf2d54a487b5a100a94db86"
  },
  {
    "cardId": "47f6e64f-ea04-4f59-8e3d-bfd3b6fffe83",
    "player": "Bobby Bonilla",
    "number": "681",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1754888810977x138761318715048260/crop_image",
    "sha256": "5f69056b6209a0367f03a75b93b7691920bd776ac3c3da6449f2d6527bd72c60"
  },
  {
    "cardId": "4807bb0c-d0cf-49c2-926f-77f0c18feba4",
    "player": "Jeff Musselman",
    "number": "229",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1741822144085x933596631444370700/crop_image",
    "sha256": "9a8de9a8f5f6054423d5652b861460235367623627b5c5f927f9fa32ac3b26c2"
  },
  {
    "cardId": "48ae9ca1-159a-4a70-9e76-d8917980d1a0",
    "player": "Rich Gossage",
    "number": "170",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1734841747442x235545074619697200/crop_image",
    "sha256": "8da2f3c988216f3a36c17e383f42a4479db1861dc5cf30ea29e081b5449e68c9"
  },
  {
    "cardId": "496cbe9b-6ed5-4c58-8662-aa1eea2b4c3a",
    "player": "Barry Jones",
    "number": "168",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1752278833318x705633857147660500/crop_image",
    "sha256": "1fdd10770d7e3efd6a0ef6ba7211e3691d939e67dfe42a3046b2a7f5c7839f6b"
  },
  {
    "cardId": "49887ddc-0b92-47b3-ba65-b8b53f5b7d87",
    "player": "Ron Oester",
    "number": "17",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1725112870498x644943130782795800/crop_image",
    "sha256": "ce9694374fc02dabd34645ebcaf5aff6a9372bb25ca27c4b7c0b952bea987d2e"
  },
  {
    "cardId": "4a38f288-2751-4aa9-88d0-2aaab307e2de",
    "player": "Willie Randolph",
    "number": "210",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1733279134107x911606331715251600/crop_image",
    "sha256": "f13740d11be7c5679ab0f71c0f9a95641910009b05247f05d866d3b6360497aa"
  },
  {
    "cardId": "4a61c651-a421-411c-9cee-d7c28ab584be",
    "player": "Andy Allanson",
    "number": "728",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1732696378491x954818951229457200/crop_image",
    "sha256": "2809dd4d47dbbf3b226dd6c56fc7edd85eb0b5233c0301ed850f25a7eeaa2b08"
  },
  {
    "cardId": "4afa90be-a282-4922-b558-eec1c5901fd4",
    "player": "Greg Booker",
    "number": "727",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781087686657x972048318792291100/resize",
    "sha256": "ae064c3dfaba94854028db3f6b057fcb2058b7882773adbf8ac58e593651ba4a"
  },
  {
    "cardId": "4c792ccf-9951-4ecd-8be0-6bc8dbf6b3f4",
    "player": "Ed Lynch",
    "number": "336",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1722183733864x722981610567775100/crop_image",
    "sha256": "87e465703a4a0965680d0b8790a23820ff6d849e152d5565a5b8f71a7984763f"
  },
  {
    "cardId": "4cd6b493-12af-47ae-b780-4b2add450efc",
    "player": "Bill Pecota",
    "number": "433",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781834119329x902178373605824600/resize",
    "sha256": "bded06dbf150097a67c229c35fdbc81bf369d823bc58922b3e46124e03c1234e"
  },
  {
    "cardId": "4ce27da9-3240-438f-a5d1-b1024f1075cc",
    "player": "Bruce Hurst",
    "number": "125",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1785626885424x182681146479024350/resize",
    "sha256": "8db0dfdea7710375a7b40b7dd68985b82b2ad393e1c346ef838d68d4faca2cd6"
  },
  {
    "cardId": "4dab1b8a-67f6-4191-898b-9f193626603c",
    "player": "Rick Schu",
    "number": "731",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633991095x674616702479839100/crop_image",
    "sha256": "735f984202df1e108daeb7af9eac2e471d0971af05d00da7f6e1c36f44ed377d"
  },
  {
    "cardId": "4e043056-73d3-42c3-ab7e-3c2fcce1cc79",
    "player": "Alejandro Pena",
    "number": "277",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779168108037x464568131787282300/resize",
    "sha256": "abb342e72dc311c52f8eccffa7adee5f1001b1d96db09e2805a4e045445c192f"
  },
  {
    "cardId": "4f01f8e8-f1a3-427c-96cf-6a0fc1dc75ea",
    "player": "Terry Francona",
    "number": "686",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633991000x182466672216110560/crop_image",
    "sha256": "f1b19f53b905171c1c039167a354a9743a75b018fc625ec4d7bfa27cc6ad5040"
  },
  {
    "cardId": "4f2ddc3a-b7a0-48b3-a5d0-b55d3d051531",
    "player": "Rafael Belliard",
    "number": "221",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1782053358101x891443730649513300/resize",
    "sha256": "308cc8a8761cbe63807a17bf7eab405d486e085c119f1b24258f1e03b295485a"
  },
  {
    "cardId": "4f3bd894-ac7d-4c8a-8814-8e6f972acd9f",
    "player": "Chris Speier",
    "number": "329",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1778601728633x572531384456285800/resize",
    "sha256": "9ab479d0fe974b4292a714fe0ecba87bf810cba0717142989ded7b40fa43e5c0"
  },
  {
    "cardId": "50618d22-7082-41c9-8749-9e6b5fae05fc",
    "player": "Mike Diaz",
    "number": "567",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779157971567x823673996893474000/resize",
    "sha256": "8957a5e2774b35eb2af3fac2130faad77fc39e2a45c552330c120cefe415341e"
  },
  {
    "cardId": "50f40f17-1248-4f86-aa66-f8a6093cc94c",
    "player": "Jeff Hamilton",
    "number": "62",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1783575778727x812789649852427800/resize",
    "sha256": "c1c08fa6de65f52c4b04fc6898cdd3da9c77a02f4aea9bc4f57b5f1f2f7793ba"
  },
  {
    "cardId": "525ee77c-e21e-4072-a782-e24353ee394f",
    "player": "Dennis Rasmussen",
    "number": "135",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1785640399635x670264385684985500/resize",
    "sha256": "a8f4eaf10ba07f0cdbaf7c510adf072eee3c30e0cc957d22fbc2a0704ec0e698"
  },
  {
    "cardId": "52c731bb-2e0c-4305-aa1a-490fe5f168c5",
    "player": "Greg Gagne",
    "number": "343",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1731178886168x243263160580452060/crop_image",
    "sha256": "238ce760da30bd6f1bf101ffcaaa0c815ea04905f0b9b146f0dc777a65b720ac"
  },
  {
    "cardId": "53556b50-daca-415f-811b-49226d4926ac",
    "player": "Ted Simmons",
    "number": "791",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1757387603750x426381960914969500/crop_image",
    "sha256": "26fbcc1b85a1688a95e0ea111111ed2a8de66bbf3d66136bc8c7e35ee1d9aea1"
  },
  {
    "cardId": "53924d42-f5f2-408b-89b5-b12509bedbe0",
    "player": "Les Lancaster",
    "number": "112",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1724571175538x805206954479306600/crop_image",
    "sha256": "33cab020ac594a76f2c2e9b3880e4df00846fb1b55322b5a940a08e18e96198e"
  },
  {
    "cardId": "53e52da6-1b54-41ea-8cc9-efc5b371d491",
    "player": "Steve Crawford",
    "number": "299",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779169538451x472249005557583900/resize",
    "sha256": "17c1407489dfff60c8a3b616d45949c3ff61ad12466c8e5e23b53b32bc3fbd85"
  },
  {
    "cardId": "547ab2f7-ecf9-4fa5-9725-23b612fb20db",
    "player": "Ron Darling",
    "number": "685",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1771797318479x123445729838786100/crop_image",
    "sha256": "2a611736e6adcf93072ce5544a56874b82834f75f9a175be01ef084a4f678305"
  },
  {
    "cardId": "54a21bb0-a75c-49f0-b463-0d184564dd7e",
    "player": "Frank White",
    "number": "595",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1728418160250x990912288882443500/crop_image",
    "sha256": "35c25f57232ae1ea419e27d5b9316c86b8dd466e17b95ddaffd28ba422887a7a"
  },
  {
    "cardId": "554aa2ba-04d1-4581-8ec6-77dfc085c4a6",
    "player": "Jim Morrison",
    "number": "751",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1778860821503x738839653329784700/resize",
    "sha256": "86ab649b7e21546d7548f884a2a938c0b41fb0c7c3055ec45072e1d5858df86f"
  },
  {
    "cardId": "55b61afc-b04f-4c64-9b77-b13f4ba8e101",
    "player": "Darrell Evans",
    "number": "630",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726749667511x613112850190514800/crop_image",
    "sha256": "7c1cc77b575379ba7d38dc1e47cc803a30cf81e0a20c8acc1424f8ef0382311f"
  },
  {
    "cardId": "5669d2c9-4eac-4ea2-8e28-e7fee0f948fd",
    "player": "Kevin Elster",
    "number": "8",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1751890268345x635498016223272600/crop_image",
    "sha256": "79589a05ee31002781b132e4a1cec98277d869eadf89efa72f6585856942da0c"
  },
  {
    "cardId": "56a97019-ec39-46a3-b1d6-1ef5fec91739",
    "player": "Glenn Hoffman",
    "number": "202",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726550690826x629908528613588000/crop_image",
    "sha256": "455ef2adef186801f9b33d452b2de511e99e75a99f9521b5a5829831a1337353"
  },
  {
    "cardId": "57654e0f-cf2f-4338-84bf-5179298ecc5c",
    "player": "Mickey Tettleton",
    "number": "143",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779165529771x860689296150545300/resize",
    "sha256": "87185bc355d9678cae7f7e3070383d63760a4d45a7eeb8e72dbbb6a62df838f6"
  },
  {
    "cardId": "57d8aef0-b78d-432e-9da0-b8e4cff28276",
    "player": "Sal Butera",
    "number": "772",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1731248683154x149132754371637860/crop_image",
    "sha256": "a9af565d3d0340f88139156a05b5a5573f774e9cf822d7452d061ac24d45dc16"
  },
  {
    "cardId": "57dcf5e6-912f-4a7a-8ebb-a09728596bd0",
    "player": "Dave Henderson",
    "number": "628",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781602869471x412312488841084300/resize",
    "sha256": "abffee2cc78ee22b07ca9c03bd56063402bf3d95516045567fde36e4f3018c91"
  },
  {
    "cardId": "57ffb288-3cae-4720-b17d-6190de6440bd",
    "player": "Ozzie Virgil",
    "number": "755",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1731990122366x662503314859270700/crop_image",
    "sha256": "98d5cc011fa297f85d60916d924eaabde5f965f734dd439ab2144bef883ecb88"
  },
  {
    "cardId": "5823a9ac-e0b3-43ed-b7ee-7292ecd2606f",
    "player": "Kirk McCaskill",
    "number": "16",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1782095280132x983288393829441900/resize",
    "sha256": "078757396a792f7fb0c7292b4ef53cce0dae39dfd0268736d60a03a83c784627"
  },
  {
    "cardId": "5860f025-2bf6-4373-8c71-2b0e49a7346b",
    "player": "Jose Rijo",
    "number": "316",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1775290317344x207747673123405800/resize",
    "sha256": "535339900adde29f646f96c660063b0fdb6bc8fe6333fe546b7990b391427b0b"
  },
  {
    "cardId": "5899b141-3f0d-47af-9bf9-49666963e333",
    "player": "Mark Gubicza",
    "number": "507",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633991459x248528774989893440/crop_image",
    "sha256": "6a13cbecd7575a11fd8f0df01a5a0c9cc22c1379d0566d3a5b2cd7e49945d92a"
  },
  {
    "cardId": "59a67324-01ae-4d91-8630-0f15445d17ba",
    "player": "Teddy Higuera",
    "number": "110",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1739938635757x747739224327787600/crop_image",
    "sha256": "c585b31e83c3b048983ed93ac0cb960587c67ed6994bec0993b8d731306f58b5"
  },
  {
    "cardId": "59aabd9a-1d12-4233-b839-b5eb5814726a",
    "player": "Luis Salazar",
    "number": "276",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779168469983x643266570194949100/resize",
    "sha256": "f86f936af457ea387dfdf5a368468be898f478fe25b664ce1c2cf8c0d013f9c4"
  },
  {
    "cardId": "5a13efdb-28b3-4968-8d0d-4c72e69b82b0",
    "player": "Gary Roenicke",
    "number": "523",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1729696866578x678067334538106500/crop_image",
    "sha256": "477e3ae3487bb9bafdacf61a752768c83226346b2abc644c1fd2caa955427643"
  },
  {
    "cardId": "5a464aa1-6c93-4308-9c34-9ab41efc44e9",
    "player": "Jim Gott",
    "number": "127",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1757225134706x140342852427791420/crop_image",
    "sha256": "c80affedaa1fbbd019118bb7ef3a1a6ef5b356c56380cc738469b03ae1e14a35"
  },
  {
    "cardId": "5a8d93e9-6893-495b-a21c-7627125c6025",
    "player": "Charlie Puleo",
    "number": "179",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779166542907x711395533966974800/resize",
    "sha256": "637a9bd5626690553b485be8df79fa7b926710ef0bcd26306d864af0cced51f5"
  },
  {
    "cardId": "5b24e1e8-05e7-449e-aa54-460aa17e1a2d",
    "player": "Darrel Akerfelds",
    "number": "82",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1752589663124x343959862720012860/crop_image",
    "sha256": "3ea6a4e3b99967a6958ad99cde7ac164264267dd7e18f204a2487a0327d97b38"
  },
  {
    "cardId": "5b82c94e-d1b7-4972-b063-b55155233b57",
    "player": "Dan Pasqua",
    "number": "691",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1722226189084x159925909350396400/crop_image",
    "sha256": "46fb136f856afd64f942ffe1b345c019f8ae92c5d3226729c00992658978a9f8"
  },
  {
    "cardId": "5bac1144-2cdb-4637-872f-13f7591c3d59",
    "player": "Mike Boddicker",
    "number": "725",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1730906464014x670880720384589700/crop_image",
    "sha256": "3cd4342258febc413a186792806e918fffb821f4fea50770901aca0ae7502978"
  },
  {
    "cardId": "5cc50060-290e-4dc5-885e-47abe697f73f",
    "player": "Kevin Seitzer",
    "number": "275",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1776202477736x163655533154481120/resize",
    "sha256": "b3f523721021a16baa347e67cabc43a376025a15cf301adad0387f29b2edc2bb"
  },
  {
    "cardId": "5ccdbc52-bf7b-408d-ba66-bddf51796fb8",
    "player": "Dave Smith",
    "number": "520",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1752280940251x310159486685601200/crop_image",
    "sha256": "371c408cc3ec7617afb84d87d2f2e484fabf2dcaffc2ea71d6c630e5d1f5bb21"
  },
  {
    "cardId": "5cefe655-1f3c-4864-ad43-a811219cde3a",
    "player": "Fred McGriff",
    "number": "463",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1720569933750x324848469188771400/crop_image",
    "sha256": "a8c5669338dea616b10731992a547f15af567cc9e6fcc023922d33db0ad6959d"
  },
  {
    "cardId": "5da7fe9c-1642-453e-9c5b-bcb37ae62371",
    "player": "Chili Davis",
    "number": "15",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1740016986917x947186756716725600/crop_image",
    "sha256": "4b7da5246e50f105bffa70c810b754bdcf9849b543684dd5001a43f2130879d8"
  },
  {
    "cardId": "5e4a49a7-988e-4263-b309-a35e2e2c3b8b",
    "player": "Jack Lazorko",
    "number": "601",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1731989843809x624474685663393200/crop_image",
    "sha256": "fad01d8a982e871c44fc255ba9b26fe23b7301f17dbed20cee6fbecc8b410068"
  },
  {
    "cardId": "5ecba922-351c-4e91-a76d-fa407a0d7e3e",
    "player": "Brook Jacoby",
    "number": "555",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633996276x710930028747304600/crop_image",
    "sha256": "f910ad14274bc2f21d8e5d5b1e0c9c14369949a7888da64ce10df1c79b1f9584"
  },
  {
    "cardId": "5f75cab2-adb8-4a47-b47b-e47e3eed1957",
    "player": "Lenn Sakata",
    "number": "716",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1733952532230x669482450608629400/crop_image",
    "sha256": "b2aa7fcbfe06f520f12eb8b1f90411fc2703658e2d6f01b9850b9b76148ae4cb"
  },
  {
    "cardId": "5f99c965-36f2-4373-a5d9-38fc43a0bdd4",
    "player": "Jerry Hairston",
    "number": "281",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1747849479054x169357973128367870/crop_image",
    "sha256": "490655a67d0203d468a940fde1e06da84704f9d205e0fed568cbb25f104d92fd"
  },
  {
    "cardId": "60400f52-32da-4190-b939-52f140a10a8b",
    "player": "Jesse Barfield",
    "number": "140",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1744495505581x967676019691678900/crop_image",
    "sha256": "1fe46dbe36c4c4f355d48b5dd78f6cd9afed62bcafb76023317120e2dd9dd11f"
  },
  {
    "cardId": "6044a0df-8c6b-4cca-a0aa-39a73b904860",
    "player": "Don Gordon",
    "number": "144",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1734053687618x501380618309468500/crop_image",
    "sha256": "b7037c90f9028d48556dbdea9412882b2f3f89afa00198b514ba908b7a75a681"
  },
  {
    "cardId": "610052df-1c74-4dfa-a5ad-75a60c40168b",
    "player": "George Brett",
    "number": "700",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1727396842168x234567867886903650/crop_image",
    "sha256": "7a1dcba4a75bff7fe4244d18905ac95b0843d65996cc9325451937e0ac17498e"
  },
  {
    "cardId": "615a25d3-dbc5-41ac-be74-3ac2d8db2a89",
    "player": "Bill Wegman",
    "number": "538",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633996078x684707270672489100/crop_image",
    "sha256": "71f01cf40d18aee4cd8bcadb4706449c1e2f724e5adaaa2de17113de3b480d9b"
  },
  {
    "cardId": "619289e8-e42f-4bf1-ad8e-c5609036fee7",
    "player": "Nelson Liriano",
    "number": "205",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781463866312x445278673605747700/resize",
    "sha256": "60d860261c2c2e8914d8d6a6b544050f626bae9145f3f8b7635a39ac88485aa3"
  },
  {
    "cardId": "61ff33de-1b8a-4b9d-8371-bd5bb802ff16",
    "player": "Dave Parker",
    "number": "315",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633993265x448388635983545360/crop_image",
    "sha256": "9df89e0211a0f357d09635d431590fafde654410b0457f313f291948c4be40f6"
  },
  {
    "cardId": "6213c04d-d879-4ba6-8250-6f7830c468da",
    "player": "Bob Tewksbury",
    "number": "593",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1731989621996x907871750116334500/crop_image",
    "sha256": "7446ee6bd7134dd1a640af73bd0184dd1b4a1b8558cea8dc6c2ea622580df780"
  },
  {
    "cardId": "62331b52-8532-42c3-b823-03ccaa56f8c8",
    "player": "Bob Brower",
    "number": "252",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1755264057929x129019992600505570/crop_image",
    "sha256": "337df82b65ab0bbe4dbd8c6bc20a4d9c39c5d65d6e20b793d12de722a21ac50b"
  },
  {
    "cardId": "626d0c7d-5ae2-45c1-87f0-4e44ddead8e4",
    "player": "Rob Deer",
    "number": "33",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1739939828618x754655153783488500/crop_image",
    "sha256": "98ac130bea4313d79d8fd3cdecd701d0c61f2037fcbdda034babd4decf591389"
  },
  {
    "cardId": "62d2bec2-ded8-4282-a3f3-9218ba3d5256",
    "player": "Paul Assenmacher",
    "number": "266",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1731988669144x469838661345135740/crop_image",
    "sha256": "347ec5fca6c5c225d48abd582edcaea68afb4d1e84fcc2b24192f63e4616a25c"
  },
  {
    "cardId": "633f8f7a-2402-49f0-8fd6-1ed6b376d6b3",
    "player": "Ken Caminiti",
    "number": "64",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1731987948038x230683404467494600/crop_image",
    "sha256": "d866919687c8b24091f13bb65d0f7d09916d22d84172f08266cc2d9bc6a22fcd"
  },
  {
    "cardId": "6357b88a-8dfc-4a8e-84eb-f30a417941d7",
    "player": "Tom Lasorda",
    "number": "74",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1732500796938x759624940183219100/crop_image",
    "sha256": "16458c00246fa6e8ee6059b22ece52d30361e3a4bc371dfd0a7d0b86f5175156"
  },
  {
    "cardId": "63780cc0-c5c6-4f18-87fb-ac569100bfc3",
    "player": "Ken Landreaux",
    "number": "23",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1721258208226x707469537206608000/crop_image",
    "sha256": "cb3ba312517c2dfced54d77bd83fbb20b6e4218c2983bdaa2eac91f55d4b6ea3"
  },
  {
    "cardId": "63c44120-3b19-4d97-b1e0-63b372fcfafd",
    "player": "Tony Pena",
    "number": "410",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1780770689002x842861077519200300/resize",
    "sha256": "e1ffe773b752732c4ae56681ea766843a6e4fa1e47e07b8276b4a9e2e67de0e6"
  },
  {
    "cardId": "646c2abc-e14d-4362-924d-9ee52c5a30a9",
    "player": "Jimmy Jones",
    "number": "63",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1789881836530x191455366329946530/resize",
    "sha256": "96f3da0cf25514db4facb6be5d50a6b1f6805b6b28dde8fa95be76f1407b747d"
  },
  {
    "cardId": "649515a9-f3e4-48f8-a3cf-f6799ce7c284",
    "player": "Mike Davis",
    "number": "448",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633998411x816824461304294500/crop_image",
    "sha256": "50793fca0dc4bad4f7c2ae76b75d5d591c296b92ca5f423227525579c96b1274"
  },
  {
    "cardId": "658f6228-c41f-4613-b0b9-04a0b8617d8c",
    "player": "John Wathan",
    "number": "534",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1784312881848x146754615543566180/resize",
    "sha256": "978007a96a7f2cf3c6d44aa92e29299ec5efec1e7b8dbf06211823e14abd531b"
  },
  {
    "cardId": "66adde4b-8ac3-4c3f-ab70-efc366391167",
    "player": "Gary Thurman",
    "number": "89",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1724767267670x641336121146535400/crop_image",
    "sha256": "37df9335f2fff3b1370c890bae38d803df33cf000daad73b961729567fbf3e87"
  },
  {
    "cardId": "67385e84-e813-48d9-a5a2-c16857d0de44",
    "player": "Mark Ryal",
    "number": "243",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633999170x101016252060753150/crop_image",
    "sha256": "23a6649e72ac80ef30640fa0acd98200c4cef5d48e252e6d1ec42b8488c95a5d"
  },
  {
    "cardId": "67b0c058-8241-4717-801c-c40c3245f89e",
    "player": "Steve Jeltz",
    "number": "126",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1746710140100x705060744927666200/crop_image",
    "sha256": "355f86db1a7fc5cd1e8d5e8a47d4befe01bdc512431c924d751cabbb8c7ebf41"
  },
  {
    "cardId": "68088b88-96fe-40a5-ad03-6b942b8e4534",
    "player": "Don Slaught",
    "number": "462",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779167680186x109383723454761660/resize",
    "sha256": "f56439c6b6c3dbd42566919b7186162580ecd09408601cc470faee0068430da9"
  },
  {
    "cardId": "68564cfc-11df-4271-80cc-c7e8d2bf53d9",
    "player": "Roger Clemens",
    "number": "70",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1723993090184x412172552672024770/crop_image",
    "sha256": "62dec81a7758330cf4a3fb2e18df6472f2006206c5f9a31c9bd08b70d59910cf"
  },
  {
    "cardId": "686ff243-42e2-45bf-bc1a-4de5af3f5653",
    "player": "Jerry Reuss",
    "number": "216",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779167224686x981946430846832400/resize",
    "sha256": "1f43e146568e480fb347b32aef776711c2a5327217efcd65df46e22195b3152f"
  },
  {
    "cardId": "68b42267-20bc-4980-8d77-d6df01d93600",
    "player": "Dave Bergman",
    "number": "289",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726282383551x847860632770867100/crop_image",
    "sha256": "25732b05397ff844bbb08d601bcce5278b774b6fdae9e9c01f68a7bea05907f1"
  },
  {
    "cardId": "68f010f8-3e3b-45cc-92da-3ab78602bea5",
    "player": "Casey Candaele",
    "number": "431",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1733678107059x175857755792259160/crop_image",
    "sha256": "2213addff4d5446ae54dae9327e243e6dfc946d10304706b942b1b0bcf6a3e9a"
  },
  {
    "cardId": "68f34690-2144-4941-95d0-fae08d165523",
    "player": "Bill Almon",
    "number": "787",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779156908088x586009979731946000/resize",
    "sha256": "ef233f10874f6471ab6c34ad0372d2fa8a8fba338d5fc09704f64605f111c3a6"
  },
  {
    "cardId": "69217862-d66a-40d1-966a-2730960bd48e",
    "player": "Herm Winningham",
    "number": "614",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1733328071065x100952278980643410/crop_image",
    "sha256": "6348a60111814268fc6ed308b30905de2f4e34cdbfe66a56a6bdd68f4ed30dbe"
  },
  {
    "cardId": "6944c019-24a9-41b0-a0a3-a3085d2a7ef1",
    "player": "Ron Karkovice",
    "number": "86",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1790442797808x499291139343373630/resize",
    "sha256": "920e9b06d87df0a368eaf8901681365caa486179f099c57a1bd734e0afbf7b56"
  },
  {
    "cardId": "69fbc04f-57d6-4e27-a86a-91d557be053b",
    "player": "Nolan Ryan",
    "number": "250",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1720571597753x224603597837842460/crop_image",
    "sha256": "b67e537adb661c88898efc11d4138b985fdb285930d56f1b8555dfc4a2d2c31e"
  },
  {
    "cardId": "6a315284-8cdc-4590-bbfd-162254b0df45",
    "player": "George Frazier",
    "number": "709",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1736709793943x154989442086479460/crop_image",
    "sha256": "54ba2c706c28adc42766732cfd46b0c3e5d73b9841a90af9c0a02d9b3f620012"
  },
  {
    "cardId": "6a563238-4411-41a6-9e82-e36ce5d3cfed",
    "player": "Dave Dravecky",
    "number": "68",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1730906462378x108548235560300240/crop_image",
    "sha256": "aff2d5602ebd0bff117cbee007abfb4b56431b472007cfaa14c5de7bc826f183"
  },
  {
    "cardId": "6a99a952-4835-4214-840c-c908176363cd",
    "player": "Wally Backman",
    "number": "333",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1720648164275x785964990546792200/crop_image",
    "sha256": "11487a3735e552d1db49613b7ff085beb01781073435afae520f3a4ef115b8f1"
  },
  {
    "cardId": "6b1c5743-2c7b-41ac-9953-edeebb585856",
    "player": "Tom O'Malley",
    "number": "77",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1787689661915x104506744825828340/resize",
    "sha256": "825e7e94bc86673d8efbd32f28b01b66985ddd7b3cdaca75be80ed3ed38fdc86"
  },
  {
    "cardId": "6bc963a8-2620-4d04-95ab-3f4abd4d1812",
    "player": "Garth Iorg",
    "number": "273",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1764169140248x387293531044275000/crop_image",
    "sha256": "5357ab5358b04cad461ecf91c36420ebc60f4998514188a96dd6ef8608f35ac5"
  },
  {
    "cardId": "6cd80687-0009-4b03-94ba-1e66c6fffbd8",
    "player": "Gene Garber",
    "number": "597",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633993790x979976167584653200/crop_image",
    "sha256": "d5b1965fc7b5b99c6d684f6b91847dfd70e951073ee044994366210283a11a88"
  },
  {
    "cardId": "6cfc461a-46d6-4fbd-8eb8-01de409fb91a",
    "player": "Jim Acker",
    "number": "678",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1733718871616x224478739999078620/crop_image",
    "sha256": "2938842f8d98061632e2b73325c36e014f03dddfd23f903ff45c66020f48e2a9"
  },
  {
    "cardId": "6f06e68c-a809-4dd3-b9a8-6ac1f1a50686",
    "player": "Pat Keedy",
    "number": "486",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781446267562x631433668914813700/resize",
    "sha256": "6757797896bb6842bbdd7edd9a66217f0527cd29de7c316f3220bf78cf21c552"
  },
  {
    "cardId": "6ffa1a58-a6cd-407c-ad7e-8589465ad91f",
    "player": "Tom Glavine",
    "number": "779",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1720279054180x593924098643424600/crop_image",
    "sha256": "d7619d5f5d7bf6418bda30ee615803af5b75d5bf50a0766c5f8d93e197a34687"
  },
  {
    "cardId": "701769f8-a608-4620-b26f-71b1a5439382",
    "player": "Bill Ripken",
    "number": "352",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1734817689646x962770716450384300/crop_image",
    "sha256": "5412e8c8aa6680e54a4196fd3b0e50997744cb8665eb6503425e2630c0bfa445"
  },
  {
    "cardId": "70375caf-4743-4c88-a328-0324abb450f1",
    "player": "Daryl Boston",
    "number": "739",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1728934632305x522390091739186200/crop_image",
    "sha256": "9b3759658f5f91ef49a90c93d41626fffac36caaadbecad0b50e050172855573"
  },
  {
    "cardId": "70676922-f57e-4e99-a0d5-f400422c9b0e",
    "player": "Rich Gedman",
    "number": "245",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726861497023x446673215405972900/crop_image",
    "sha256": "38d12c4a1e3b6426c315ad2ebe6f300cf010e3c2bda4ea1494e6cb2a4b251ca6"
  },
  {
    "cardId": "70749c9d-46c3-4a6c-97c7-56127324fd55",
    "player": "Lloyd Moseby",
    "number": "565",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779028874485x518521183645287400/resize",
    "sha256": "c06dcf6c4fd88f3f6f0c69ce349e6c6d156c22a4e45e8ec81daac8132407cb81"
  },
  {
    "cardId": "708c5165-b9c3-468d-bbb8-4861ea176690",
    "player": "Joe Hesketh",
    "number": "371",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779161834386x551869633487742000/resize",
    "sha256": "37ebfc6f97bd4c4fece0dd4df3ea89db15abe5968dcaf58845f4be0a133ead83"
  },
  {
    "cardId": "709bb1ef-b6cb-4e52-a35a-629c672c5f0b",
    "player": "Greg Walker",
    "number": "764",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1762144933597x842462868171566800/crop_image",
    "sha256": "581f2c68dc617f05abce7bb8084d98a0d1ea9cf0bd6d354b4344fb34b157c6f9"
  },
  {
    "cardId": "70ae5fb6-df45-417a-90aa-b8d6351eef93",
    "player": "Marty Barrett",
    "number": "525",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633991632x994724152608235300/crop_image",
    "sha256": "b994a3612244c86867ba8cce994878ca0b888c0488aa7dec314ee139ed1bb5d5"
  },
  {
    "cardId": "70e3d146-df25-413f-9103-fb3561d3fac9",
    "player": "Jerry Royster",
    "number": "257",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779168158094x588577933138534100/resize",
    "sha256": "06b9517222e8f5a5ec3ccd20c3f611690a70cb64fa8f375f7f83c099018088d0"
  },
  {
    "cardId": "717944f6-11f3-419b-bf9b-9aa369780dbe",
    "player": "Steve Bedrosian",
    "number": "440",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1789661382155x232127966463093540/resize",
    "sha256": "31bac37e01539a1be2f3daf8aa8428f41865000b262af1359da358eb304afb0b"
  },
  {
    "cardId": "72affb65-41d1-4e8f-8230-e6acb9a41dc6",
    "player": "Len Dykstra",
    "number": "655",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1722649053536x529976122367951550/crop_image",
    "sha256": "361e1ee61c5a8896683bf2544d84bc4baa2a1bf001f904e6fe6e85da336accea"
  },
  {
    "cardId": "72c31426-4479-47a4-8bf8-6769bdd1acc7",
    "player": "Kal Daniels",
    "number": "622",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1728602241994x757517232446237300/crop_image",
    "sha256": "3331ba99005de6c1e474202786e7e58040fc89a00327a6890d86b7be46f5f7ee"
  },
  {
    "cardId": "7311d6ac-b6ab-4c20-a8a7-319b8b5933a2",
    "player": "Chuck Tanner",
    "number": "134",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1725885882875x680142274209516300/crop_image",
    "sha256": "37ea48ac7120dcf1e300cd0bbfe5b2252bb25fc3b1dad611a1c68c457fa1fc09"
  },
  {
    "cardId": "7564843c-7185-461c-be92-ec201da75913",
    "player": "Shawn Hillegas",
    "number": "455",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1739940447333x587882038718371000/crop_image",
    "sha256": "8b19000201074b684e79fdaaca3d248ed074511331c789e60d6e5a0d3d0bef9f"
  },
  {
    "cardId": "758bb07b-e91e-4524-a7e6-0ea6264f06d0",
    "player": "Terry Pendleton",
    "number": "635",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726834383283x551060465540106560/crop_image",
    "sha256": "6009464350b202a39a72dabfb1228cf887dd561ba7a7bfe229cc9df58d0795ce"
  },
  {
    "cardId": "763d3153-963a-4419-bde1-8138a05bf5a8",
    "player": "Jay Bell",
    "number": "637",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1724793670815x547344143231006900/crop_image",
    "sha256": "7d180fc2ee038ed84001f2d4808769bbe0c8cfb5fccd93aa03412160143bd1eb"
  },
  {
    "cardId": "7666fde8-1034-4513-9369-5b75836c9eed",
    "player": "Doug Sisk",
    "number": "763",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1776202619394x279343609395864770/resize",
    "sha256": "87aa715bbc134cf4685a013b318134d8074ffed16003199a34f820bfb7b21b72"
  },
  {
    "cardId": "7674a957-604a-4607-8225-73c8a9263f87",
    "player": "Charlie Hough",
    "number": "680",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1723929871023x401924418574395800/crop_image",
    "sha256": "fb71d8db5d843283699b3c779a8ed99edebe4232deefc29f6f0b517d7169fa9e"
  },
  {
    "cardId": "76771c7d-8d80-44d7-971d-61c6b5978eae",
    "player": "Charles Hudson",
    "number": "636",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633995564x556013178130555970/crop_image",
    "sha256": "d8503e5903f0f49ef90ffbc6628b7007c3140ae0052bf23c7595059e116612a1"
  },
  {
    "cardId": "772650eb-9b07-4334-849f-a3773f842ef5",
    "player": "Stan Clarke",
    "number": "556",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1733496890518x798978967957571800/crop_image",
    "sha256": "ad58a161ca60b02733811b92d5db506b6832eef5e415b9b61cf5b3f97c144c0d"
  },
  {
    "cardId": "78445dff-c01f-45e9-adf0-a77db73a2919",
    "player": "John Franco",
    "number": "730",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726506790685x979520691277560200/crop_image",
    "sha256": "68d79a14775230fb78b8ad9722e1dd409f85c86c6d1946864aeb523f38fd9525"
  },
  {
    "cardId": "7860537e-a548-4e26-a687-0f7fc736789f",
    "player": "Steve Kiefer",
    "number": "187",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779166497529x278976128425839420/resize",
    "sha256": "f1ddd2a142e8e4ffad1fb9c32e07ec9d90083f018dcadd86947272420d088fa5"
  },
  {
    "cardId": "78ad0d9c-2a48-45d0-9a81-609e60da90ea",
    "player": "Pat Tabler",
    "number": "230",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633998663x844366468862810500/crop_image",
    "sha256": "45294a634533d92f136256861cba903d79d6f7d519f4986ac3e064a421677ceb"
  },
  {
    "cardId": "78f2deb4-8543-4feb-b0e6-fcac8dc4ecf6",
    "player": "Phil Lombardi",
    "number": "283",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779168156976x870759817522632100/resize",
    "sha256": "f1b374eaca5c5a5520b856df4ff54141a9c9de2bb42fdaa03046f267199e72e4"
  },
  {
    "cardId": "798d1e2f-faf6-431c-ad9e-13679d2ae243",
    "player": "Todd Worrell",
    "number": "715",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1759031597786x235275142509371970/crop_image",
    "sha256": "a81ae6ef06a92cbb5c00fdb5c2b4b84ed8d61908f4eeb7d7aa9738d7c9713c54"
  },
  {
    "cardId": "79bd3e3a-3177-4ef6-b7b5-0a1b76fc0555",
    "player": "Barry Larkin",
    "number": "102",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1724430777453x747630858149544600/crop_image",
    "sha256": "490626b01115f91a2d2b5b2e7b0c2b593ddeee8ae8f671333e503306ee2255a0"
  },
  {
    "cardId": "79c2763d-5bd2-43c5-b9e8-1158e3b5403e",
    "player": "Luis Quinones",
    "number": "667",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781087691834x621700771479653200/resize",
    "sha256": "8ebc738bcd904b86e88e1c65c71f33d862b338fdf61d6b59bd3b8d777d2249bd"
  },
  {
    "cardId": "7a435094-5578-4212-a902-728955e180be",
    "player": "Rickey Henderson",
    "number": "60",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1722491336796x273938421600350880/crop_image",
    "sha256": "829e10f8bae224cb4dd33cd0ccabbe75bb70e5ea8648d1477d35bade7d4cba4c"
  },
  {
    "cardId": "7adedd73-eaa1-4ff6-8cb4-c6140af816ea",
    "player": "Denny Walling",
    "number": "719",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1745373328476x871557949607676700/crop_image",
    "sha256": "4630d0219c4e09fecefa0b72827fe3abf4f9d3bbebb37d74224b78efb1c9ea80"
  },
  {
    "cardId": "7b52daec-bc05-4d34-9edf-15f5d6eb0154",
    "player": "Juan Beniquez",
    "number": "541",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1789987412180x210276462050028350/resize",
    "sha256": "30e815da711c676a18021e7fe639968572114867563bf01574ebbd978071eba4"
  },
  {
    "cardId": "7b933b99-0eba-4c05-86e7-45c17d0f9dfd",
    "player": "Dale Sveum",
    "number": "592",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781419628462x930197724519020300/resize",
    "sha256": "44626fe41e00a698ee4c85eeb6d61b2795df2fa05998d4e0a97218001543c5af"
  },
  {
    "cardId": "7ba13a40-b240-4b71-bf5d-78873b45ca86",
    "player": "Bill Madlock",
    "number": "145",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1725728701862x389484948768404200/crop_image",
    "sha256": "1fca074cb8512b9ad7e0d7d57fc97fac966d7032d61feb403b07b639dc83f021"
  },
  {
    "cardId": "7bbd16fc-f99c-4589-b841-36b4e0d6be79",
    "player": "Whitey Herzog",
    "number": "744",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779165485035x796179186187426700/resize",
    "sha256": "ca65e696dd3b84c655b3e95b1d300b04a7d03ff2c6017c51e0992267281a233e"
  },
  {
    "cardId": "7c08a73c-e448-415c-a56a-98c3cb9e169e",
    "player": "Scott Bankhead",
    "number": "738",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779156728164x950448149731302900/resize",
    "sha256": "b9d000f53a2a23dd651fd7c8c62e6579e53e86470c2bb945e063b3e4421d5ddb"
  },
  {
    "cardId": "7c0a0578-1be2-4c7d-a6e7-0d70fda2ea25",
    "player": "Ed Olwine",
    "number": "353",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779167172621x809570477530405100/resize",
    "sha256": "f713874bd7b708c50119dd99a64a2223bf89657f590b29cbdad65adb5503f745"
  },
  {
    "cardId": "7d5811c0-3b47-44c5-98bf-745bc0352018",
    "player": "Carlton Fisk",
    "number": "385",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1737300397486x865709311533220200/crop_image",
    "sha256": "42c233d56add77a2086a28dd71307f2c0d91a49e792c85cbfe70d76d377fbab1"
  },
  {
    "cardId": "7f7ba2f3-33a9-4d35-b666-ee1495f59062",
    "player": "Kevin Mitchell",
    "number": "497",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779812992996x578600087823961000/resize",
    "sha256": "73da485eb5ea7d4d1b00d59ccc279613bc781bf632413b8e341788edc4afd4f7"
  },
  {
    "cardId": "809ae50d-70f9-453e-8299-12dc94246250",
    "player": "Bob Melvin",
    "number": "41",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1727588452043x857482561849944800/crop_image",
    "sha256": "ce75361cecd341960de970fabd6e8ced3e846065ac6363bd7f280a99d883f492"
  },
  {
    "cardId": "828ce509-dc12-43db-aba2-f2ba797bcd6e",
    "player": "Greg Harris",
    "number": "369",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1746643433835x308832644884586800/crop_image",
    "sha256": "19e7938861db9dc31d751233a6e056d9ad0a51f9d2e4df0f550920b3f4b7b453"
  },
  {
    "cardId": "82c1364a-0c25-4d87-87d2-a86a218affb7",
    "player": "Allan Anderson",
    "number": "101",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779160131353x165759716429807040/resize",
    "sha256": "3bdc25bdd4aed2fe3045def0d0b9d62a2a84e5c42744265896246158d964ad5c"
  },
  {
    "cardId": "83ba4046-5fa3-42cb-8d13-4de3ff3df56e",
    "player": "Mike Stanley",
    "number": "219",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781463866371x389612099593323200/resize",
    "sha256": "b71ba874cb450fecdb3db6d96265ec89b90b59180f8e1798737336f4505dea77"
  },
  {
    "cardId": "84535c37-a1d4-425b-a824-61a7f5a2526a",
    "player": "Mark McGwire",
    "number": "580",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1721049685754x135309733874968260/crop_image",
    "sha256": "ff8b4214b66f671c543e2a4d683ffb43c3d473c6be68396433a197d87c05def4"
  },
  {
    "cardId": "857b1276-8c13-4f8a-babe-7779dc173f85",
    "player": "Bill Dawley",
    "number": "509",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1754624850185x308223215422601900/crop_image",
    "sha256": "3866da3c2104cf5db23fafc2e6a397dca7204b3faa760ec7a79f0745fc9d8b2f"
  },
  {
    "cardId": "85c8b2cc-16a3-4d94-8544-a3d8078cc4a2",
    "player": "Shawon Dunston",
    "number": "695",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1730906459472x740635210011224000/crop_image",
    "sha256": "f893b697e9b9cd2f7509889e2cc130819419e402182af89c854271c7b58fe38e"
  },
  {
    "cardId": "869bad7c-f06a-4cb2-be5b-1d024c1d6a70",
    "player": "Jerry Reed",
    "number": "332",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779167004587x605005655286073500/resize",
    "sha256": "a03e76479e03511c6b0ecbf1b4d14d7dc966d06a4009fb16c08204c11f459e95"
  },
  {
    "cardId": "86c61178-8594-4078-aa63-cb1ad3dbbad6",
    "player": "Glenn Hubbard",
    "number": "325",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1721941738671x165656834994416960/crop_image",
    "sha256": "b9b614a09e35378ae7209f9017d3d5fba151f24d681b5e3df338c75c683cd183"
  },
  {
    "cardId": "86c72bc0-1100-4bad-bc77-01ffc4f0c3e9",
    "player": "Jay Howell",
    "number": "690",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779159838610x252474888587057340/resize",
    "sha256": "e1fefcafed00dbcc21f23ca42ef7737ae367361b5c231640d9f69ea185cf6e63"
  },
  {
    "cardId": "86f59a2f-3f60-400a-b466-db3b2be30f3a",
    "player": "Scott Bailes",
    "number": "107",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1722458090279x346453619204802700/crop_image",
    "sha256": "badcc8539f733ba234f54f7d6bd27df38126aaab59aced9804e374fe4a08b72b"
  },
  {
    "cardId": "86f9339d-7d8f-4792-a8e0-4759b27b9988",
    "player": "Mike Easler",
    "number": "741",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1729601599797x143703604442287700/crop_image",
    "sha256": "af3c7c55300d8fdbcb8e1d4b2feae8cf19630dffd0d4e847a149914b477516ff"
  },
  {
    "cardId": "87374d0d-0fef-468c-a606-05b8bb24ad01",
    "player": "Tony Fernandez",
    "number": "290",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1778601662343x751117079354538800/resize",
    "sha256": "ab8de94fd7e47bbe1136448a44b149b417bea5a13967c80875501cbbdbb6961b"
  },
  {
    "cardId": "87ee4367-0585-47c7-90a5-92895d980048",
    "player": "Cecil Fielder",
    "number": "618",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1730906459907x825793770383810000/crop_image",
    "sha256": "02b2d9f22045576fc0775b85657f43edc573ee671faa040da6ea889381ff9a34"
  },
  {
    "cardId": "886e519f-054d-4df0-9587-83b8e023c86c",
    "player": "John Cangelosi",
    "number": "506",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1739940905400x716311608711643000/crop_image",
    "sha256": "762c8b33749824ec95990689d8eceb68bcdb1d560d170a09f2969ceaf4b80ff6"
  },
  {
    "cardId": "8870c6fc-b38b-4836-b2ba-91b3ac39d5bb",
    "player": "Juan Samuel",
    "number": "705",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633993887x763172187232997100/crop_image",
    "sha256": "7e4dc5b11928b22ac003795162878c86f0b52c8b56ee4e08ea24c9722140a546"
  },
  {
    "cardId": "88835d2d-1369-4e43-9ed7-47cf0f97c87f",
    "player": "Brett Butler",
    "number": "479",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633991357x398559921934810200/crop_image",
    "sha256": "2bd0ae5e5a15f04778d421c8950b21e59d2d3d2f485a7e17fb798d0cefeb2972"
  },
  {
    "cardId": "895fd817-2ff3-40c6-9c1d-f5b6c2e16f5b",
    "player": "Rick Mahler",
    "number": "706",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1789681069077x507100041972590400/resize",
    "sha256": "6f381bbf2f823a174ab316a3e841ac256c0aae61d7a1d748a603db17109daf85"
  },
  {
    "cardId": "89665786-15a3-4e46-a501-b0751324654c",
    "player": "Rick Reuschel",
    "number": "660",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779775597478x594145438849852500/resize",
    "sha256": "6b0c967a841d5786b7de136f14ff919143d0db40225c8a063e2c6177804ab33a"
  },
  {
    "cardId": "89706635-d06e-4d06-bf03-41dbf1965dbe",
    "player": "Lee Mazzilli",
    "number": "308",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1785256507932x195556111905920160/resize",
    "sha256": "4eb5aa0604a4dd37a7c0a7e8af6b900f073edb4f8f6a787a68cf8a6ad98bdebe"
  },
  {
    "cardId": "89712d15-add4-48a6-8afd-ffaab45fecf4",
    "player": "Danny Cox",
    "number": "59",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1778601513144x302829474013129660/resize",
    "sha256": "0191981f115d26c354addbb4e6597a1faf011ea6a1a7d4ee87cd28211e28cb24"
  },
  {
    "cardId": "89ca711f-327f-4ebc-b85c-49e0d2d89310",
    "player": "Mike Aldrete",
    "number": "602",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1760517122284x699136847351357000/crop_image",
    "sha256": "8bf503f7abeded4b72d0729ea56ea92dd4c7a524469886222187378be29a55c7"
  },
  {
    "cardId": "8b4d163d-dcbb-47d1-998e-e54b53b2d670",
    "player": "Floyd Bannister",
    "number": "357",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633996776x453440436349235000/crop_image",
    "sha256": "b12909819ef5f0cc1af36743b52cb96c5da916440c6eb1a9717299b3358477b7"
  },
  {
    "cardId": "8cf4a320-df26-44bc-9de4-07de81a9c014",
    "player": "Darnell Coles",
    "number": "46",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1724654200432x714937928757162900/crop_image",
    "sha256": "1f8bbd2cfc1c80603e2b22ec18256e05989b0828a9fb2a4eb0afb847b49c8c00"
  },
  {
    "cardId": "8d0fc5e2-41ea-4428-a662-e9a059350599",
    "player": "Eddie Murray",
    "number": "495",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1724876952647x409335166139060100/crop_image",
    "sha256": "2878fc3941ea76932d5609595e0e6b49c770f3f0b1e5d0f455f28e913735a0ba"
  },
  {
    "cardId": "8e339865-b08f-40df-b35e-1064609a6fd0",
    "player": "Bryn Smith",
    "number": "161",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1778601572936x994315699159805700/resize",
    "sha256": "c25036415bbee86716d31bf0ff5abfc912a530d626a58db01569d8dd338c9587"
  },
  {
    "cardId": "8e37931b-f167-43cc-885b-8f0044c32b4b",
    "player": "Len Matuszek",
    "number": "92",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1724767266659x685850600044279700/crop_image",
    "sha256": "d85ab4ae2536ca44b3c593c2d8c15eb403c49efdf97386f7049b43563f318e30"
  },
  {
    "cardId": "8eb7dce1-cd5a-4c4f-8bac-8c3a208f1f6e",
    "player": "Steve Trout",
    "number": "584",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1737350319027x900834482670957300/crop_image",
    "sha256": "a7694666e3b9b4c38d0d6c53b3e23b458257bee8b419e3d91d0390bc113e90a8"
  },
  {
    "cardId": "8fb330bb-cf78-4948-9dd5-9235be8d4cce",
    "player": "Pat Pacillo",
    "number": "288",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726076477990x718256212965098500/crop_image",
    "sha256": "817ea904b39b504993afcf054c9c198c2a016f441ee9bb1cad8547073aa16f38"
  },
  {
    "cardId": "90f9eb44-8ea8-4707-bca9-a58df5a46f0e",
    "player": "Danny Tartabull",
    "number": "724",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1787468630741x757129470991278800/resize",
    "sha256": "81de1c6e2184864a28cefe485818b477667ba0a8184b70bbae1f5debfed1f9b1"
  },
  {
    "cardId": "910fb99f-b9b1-4910-b7cc-b5e689e38780",
    "player": "Dave LaPoint",
    "number": "334",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779167007614x558998975705117250/resize",
    "sha256": "e7a221058669fac48c6f5d73a241b108b9b4730489c7dc32c2820ea35db571f8"
  },
  {
    "cardId": "91aa1d4b-6657-46ce-83f7-753bc0095f3a",
    "player": "Roger Craig",
    "number": "654",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1728536612309x400036532495025900/crop_image",
    "sha256": "251d89f2fc973ea618841e0f011f62d0f655355a819e9debbd36fb03c98b84e9"
  },
  {
    "cardId": "91bf5b0d-5cee-4166-a5c8-be3eba4b68bb",
    "player": "Ryne Sandberg",
    "number": "10",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1721046564476x227565997983814050/crop_image",
    "sha256": "13003df337c7179e078963486fc26c9981b44aa72209e534828c102e4f61ffec"
  },
  {
    "cardId": "91f018b7-91d1-483e-95f8-d575649b4772",
    "player": "Duane Ward",
    "number": "696",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1736345354933x650299532811126000/crop_image",
    "sha256": "025426f8d045eea50589e081132c9a57addaf0ffd44d721322b0ce505306219f"
  },
  {
    "cardId": "9244e822-443b-4907-9f2a-1c3b3e27daed",
    "player": "Joe Boever",
    "number": "627",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1790011500732x226158893300343100/resize",
    "sha256": "a9645df94e42a0e5955480fcadb629b5d811e2b6c2d6d12c4e3521576992d123"
  },
  {
    "cardId": "92d1b8e4-5c1a-46e9-afca-decfccd312c4",
    "player": "Greg Swindell",
    "number": "22",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1739938978711x860470787347720400/crop_image",
    "sha256": "ac7009a343fee042329895abd22f99ece93f726c4895dc687ee4b5d66ef45dc4"
  },
  {
    "cardId": "92f618d1-26f1-4468-abdf-fbc5e603a1e2",
    "player": "Ken Gerhart",
    "number": "271",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1734064632909x654269282418414500/crop_image",
    "sha256": "d6b262c1dc8a2b43f8a8bc340624c408be732ee30e3544691f350e02f2c848ae"
  },
  {
    "cardId": "9338ee9e-c8f0-4f05-a93e-84acac068615",
    "player": "Donell Nixon",
    "number": "146",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1752278572617x660920983201898100/crop_image",
    "sha256": "47e4fbffd91a89c7a7925d6164127807f396bfb882596f9117b04e646d56fe64"
  },
  {
    "cardId": "93fedd2f-4f91-4e2b-9dc0-e6f73f3c4aa3",
    "player": "Damaso Garcia",
    "number": "241",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779168943299x698042291914641200/resize",
    "sha256": "28c3cb8e668af3e0f84c936ae174278c620449c6c28a243db39caa6678c4ec63"
  },
  {
    "cardId": "94486b3d-e50e-44ad-a427-253c9600a40f",
    "player": "Steve Farr",
    "number": "222",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1778601675004x941058580376686800/resize",
    "sha256": "7c90d0629b7fc6d20272706cc044100ca837066232faa66c14abca03b465000d"
  },
  {
    "cardId": "9449e8cc-22f5-43bc-bfa0-8312472ccd01",
    "player": "Joe Magrane",
    "number": "380",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1786053317192x431457170173754640/resize",
    "sha256": "6f8579230973a10a19101bdc4d33a4e635d82e2535f7f0e9dedadfcd091788e6"
  },
  {
    "cardId": "94b318ad-1c23-4164-a5e9-3aa777fc2176",
    "player": "Tim Wallach",
    "number": "560",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1737647212281x447062638236629800/crop_image",
    "sha256": "3d7ed30e014c187c4b630544fe191b275d45639c65b29452996583c734642a9b"
  },
  {
    "cardId": "9602586f-ac0f-46b5-8680-89598374fdb8",
    "player": "Franklin Stubbs",
    "number": "198",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1722231249279x295118512917662340/crop_image",
    "sha256": "ed1934a23d1c001361da079e503ff893eaff8b8ec26ed62d0a18ad84b9512066"
  },
  {
    "cardId": "969ab143-0dd4-46cf-b31d-78884339ea9d",
    "player": "Billy Bean",
    "number": "267",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1721228703793x360453825468701950/crop_image",
    "sha256": "8fbec254fd74ab27fe3f8436743d28ad2c5b6e1e1773238464e16cac64006fab"
  },
  {
    "cardId": "97854897-f4ee-4549-9128-f6cd3dac1f03",
    "player": "Gene Larkin",
    "number": "746",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1729895101429x172488710726537380/crop_image",
    "sha256": "86f3e54a6b9ffd62138b2ca0c802f15f365a0ee67c9c1bd0eec5a152fcacbea5"
  },
  {
    "cardId": "979bdee9-0434-4786-8c3e-e111fe035aac",
    "player": "George Bell",
    "number": "590",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1727392634283x443195694045969150/crop_image",
    "sha256": "3d6291bbba01afad1f231b26668645595e841bbf8c569cc8268a870f757179b3"
  },
  {
    "cardId": "97d2498f-2f8b-4a76-aff9-fca2d0fbe8df",
    "player": "Jim Eisenreich",
    "number": "348",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633997191x389570474063533760/crop_image",
    "sha256": "19ed4a2ea964061c8c8ae70e442fc9bbb11f0a8f4f72af1255b2d3876c50b32e"
  },
  {
    "cardId": "990144f8-5ec4-4b36-b070-dd224952f002",
    "player": "Al Leiter",
    "number": "18",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1777743472073x415421033673051100/resize",
    "sha256": "0ce042aea44850717784d025cadf83345be05ba6a89f99e24dfa842869dba73f"
  },
  {
    "cardId": "994fdda2-d854-4ca4-9c4f-e0daeafa17dd",
    "player": "Dwight Gooden",
    "number": "480",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1727731986830x709023588908198800/crop_image",
    "sha256": "31b5361d3e11ff7f7b9c37b5b6651d73065d23125deb7744f04649ba91a05d6e"
  },
  {
    "cardId": "99a8e0c4-cd64-458c-946f-37a274aa5b5b",
    "player": "Jody Davis",
    "number": "615",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1751919107570x495180182997627700/crop_image",
    "sha256": "92d73e0f09cfcf167730d5c9f635c203bb7897b25be557c8bf25894b0db09204"
  },
  {
    "cardId": "99f87bdc-4f22-401a-b70c-081761998592",
    "player": "Mike Felder",
    "number": "718",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633995506x992240658701636600/crop_image",
    "sha256": "013974b64df199b139b790054a15ac776d6914b354ed0f66c487db7ff3da41f8"
  },
  {
    "cardId": "9a0db0b3-aa15-4ecd-bc56-095edf380bc3",
    "player": "Tom Trebelhorn",
    "number": "224",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1736718787718x886437798174080800/crop_image",
    "sha256": "c14490c4b2763e179a195d9f2b171e231f1e7fab8f9a1e7ac356827bc796e2f1"
  },
  {
    "cardId": "9adfb4d3-63f2-4422-8253-913fe9e3fd84",
    "player": "Wallace Johnson",
    "number": "228",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1784512793991x482749754281141600/resize",
    "sha256": "f9fa082b69c2667a0047e04895701e30eb12b5d31ab98139fd8813716199681d"
  },
  {
    "cardId": "9b7b319d-8791-438a-8327-5d38043f25b3",
    "player": "Bobby Witt",
    "number": "747",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1721172801656x230792249186262850/crop_image",
    "sha256": "e857c2f0e7e4ff920c9c5e6a341dc73201b28380460164140815374ecf677b44"
  },
  {
    "cardId": "9b8f241a-3d96-40f2-bd6e-a181b797640d",
    "player": "Brian Downing",
    "number": "331",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781480734407x262765031456141150/resize",
    "sha256": "24d1f189ae73b2c75c26daed69715bee655ff4b9bf0ed28665023bafe2274d06"
  },
  {
    "cardId": "9bb6a25e-e0bc-4fe9-97e8-2641bcaeed81",
    "player": "Bret Saberhagen",
    "number": "540",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1762050625665x698922684014812400/crop_image",
    "sha256": "ef7f13f8c961387d01882ad315d1abc9f9b44eca09c2159a41643818ebc40023"
  },
  {
    "cardId": "9be4a9a0-073d-4220-b5df-820151a328d4",
    "player": "Jeff Reardon",
    "number": "425",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1728424371495x690704808127754500/crop_image",
    "sha256": "482bcd02ed578bb3af409c6d03586b0cac783cfd4820bedcc798f74099c83933"
  },
  {
    "cardId": "9d3ff44d-184e-405b-b5ca-9aea6c89413d",
    "player": "Garry Templeton",
    "number": "640",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1780842481655x648705507472804100/resize",
    "sha256": "bc19359fea9b6e22b05145690a730583c32976f042967594f4c527610e9138a4"
  },
  {
    "cardId": "9d405db1-0d7f-47a6-856f-3c494bf5c4f3",
    "player": "Gary Carter",
    "number": "530",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1723084168531x154664907867033920/crop_image",
    "sha256": "095e8f3c2cee43bacbd0047dc49851ccfc7a5c18a41e36792de6a7697b40961f"
  },
  {
    "cardId": "9d561f34-227a-43f4-98da-88eee47cb3c3",
    "player": "Andy McGaffigan",
    "number": "488",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1747169289201x138407974844599870/crop_image",
    "sha256": "371e83c36e196a8ae8e3ef8c6d009e139713c45ffd0fcd8d2e0bb400b4136acb"
  },
  {
    "cardId": "9db68972-288a-493d-99fa-5f234879da54",
    "player": "Terry Puhl",
    "number": "587",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781422062273x838122650675776600/resize",
    "sha256": "2cbbe7c128dc417352c027a7c3b9e3266e2885e3a9153d6cab65b60290146147"
  },
  {
    "cardId": "9de9037b-72a3-4883-9ec9-e090f013bafe",
    "player": "Steve Balboni",
    "number": "638",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1724281496064x876488461309967700/crop_image",
    "sha256": "43243bf50523907a5ad8062b992d29a89ff828bafcd2d2ff3dedfe34e7fb02b2"
  },
  {
    "cardId": "9dfd1de5-d613-4cfc-b5a0-730fa2692381",
    "player": "Gene Nelson",
    "number": "621",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779159524820x375793571565983940/resize",
    "sha256": "4e33ef4a40f311dbec83a2c6e6efe484f9b9742ac8a5d5f50bf677ff666368ad"
  },
  {
    "cardId": "9e00e21f-b84c-4a79-a0be-2b01199626d4",
    "player": "Robby Thompson",
    "number": "472",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781312904257x876061353828794200/resize",
    "sha256": "42cf6a45163cece96964d8b20ae79084f850151d35fa4e5c8dd0cacd660c7ec7"
  },
  {
    "cardId": "9e2a26f3-5b7d-4158-a06d-70d5b6a503a5",
    "player": "Carmelo Martinez",
    "number": "148",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1752278637117x330768401032486280/crop_image",
    "sha256": "04198196e51e6a6d9f270aabf7d798399f4110d4bd0dedded64f4698a5d26142"
  },
  {
    "cardId": "9e4fd114-8e4e-4bca-b5ae-15d6e0764965",
    "player": "Jim Leyland",
    "number": "624",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1723916946512x170680163422402000/crop_image",
    "sha256": "c3a9493c6a174a9af5fe4318bb9b59abe218e94e63ac4c073e00b2316666f38c"
  },
  {
    "cardId": "9e799b45-d0bf-495a-bb8f-ac0bc43bf73c",
    "player": "Joe Johnson",
    "number": "347",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1735331123653x321173991430829400/crop_image",
    "sha256": "2f738b1702ce443a3dd70de26bfc56a1b7196ad57640ec2e5c2debf66b9a52d9"
  },
  {
    "cardId": "9ef9f093-1013-4720-a42d-ad1687680a76",
    "player": "Hal Lanier",
    "number": "684",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1758141935658x925345395325536100/crop_image",
    "sha256": "8fccc3978e99973aa58daaf345119259e0318bd837cd73089a26a28ba71991e4"
  },
  {
    "cardId": "a0700f3a-efb2-4b0d-89ec-7b7dea8e6e62",
    "player": "Randy Bush",
    "number": "73",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1738377312909x977596128441307800/crop_image",
    "sha256": "fd487c17629c5b949324c405a0815c0abeb003c3734a34459e0fcdbc61ab13a1"
  },
  {
    "cardId": "a094f411-abf9-496b-a458-19a49772bd47",
    "player": "Floyd Rayford",
    "number": "296",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1786411176239x930387309639185700/resize",
    "sha256": "6fdbc8c7267fe4d663a480c539ad5ce5926a1805b89679a0828af4ad7c5966a2"
  },
  {
    "cardId": "a14275f5-029f-411f-8c67-0a11675115bd",
    "player": "Pat Perry",
    "number": "282",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633998578x469904017461295400/crop_image",
    "sha256": "86328f0632cd19925e931c8b6476d623c2b3562dfab1109ce59f5c7123e42978"
  },
  {
    "cardId": "a14ae2a5-4332-4317-9150-d08ad5823745",
    "player": "Andres Thomas",
    "number": "13",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1790825264906x237749671464318370/resize",
    "sha256": "2ea0308ceed96638f6521f26da55d0df05ef16597af430d78d7ee0d780341133"
  },
  {
    "cardId": "a196f817-8080-45d7-b22a-200bd89a4755",
    "player": "John McNamara",
    "number": "414",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779584915911x726857831636568200/resize",
    "sha256": "c346c7a7a0216f2fb8bd3f832db961584b68b4830bdabf70c3d1e6992ff9e498"
  },
  {
    "cardId": "a26b3ffa-2060-4aec-9ca0-4809cc90bd7f",
    "player": "Paul Molitor",
    "number": "465",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633991526x894976012594844700/crop_image",
    "sha256": "e0712878f4ed2bd04f65b9c1ecaa1101fa34a0f53f6b2e38cdc05794c220445a"
  },
  {
    "cardId": "a29889f7-c769-4881-8198-f4506f6707bf",
    "player": "Tom Nieto",
    "number": "317",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1752279547431x720032833606880900/crop_image",
    "sha256": "e05acc67cde6fee896494194ac6e8fdccb446251cd1dad61caed79ebad9128fe"
  },
  {
    "cardId": "a2ce239d-9189-48a5-a1d4-e32f9aa84556",
    "player": "Danny Heep",
    "number": "753",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1736054448984x205060427711576200/crop_image",
    "sha256": "023fddd4da8e8da69b93055d3e948c0c1ad0c080740fef48c6ce1c61ccab71a7"
  },
  {
    "cardId": "a2f135e1-6d11-48c4-981f-4a3714cc0619",
    "player": "Jose Cruz",
    "number": "278",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726771752350x317672006572657000/crop_image",
    "sha256": "0398f79fce10ed3297878e6e62c8256d25b46a8be736f898cb20cd3c0caea3af"
  },
  {
    "cardId": "a368b39e-d681-4e60-8e2e-c3f03557935b",
    "player": "Barry Bonds",
    "number": "450",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1720569934506x544109696181152450/crop_image",
    "sha256": "1b46bfb6f58c01abc0310f89405db4c0e916e96af3e8622d2916a71bab039753"
  },
  {
    "cardId": "a5036c01-7305-42fe-abca-8a320996141d",
    "player": "John Christensen",
    "number": "413",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781463923618x830087970487921800/resize",
    "sha256": "9bafe1eeaf77f52aad7fb5dea4b27a09467a79657b50a10977d95ffec2f0bf88"
  },
  {
    "cardId": "a5106b0b-151c-496b-91bc-815174d48bb3",
    "player": "Graig Nettles",
    "number": "574",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726619605220x680704305579752000/crop_image",
    "sha256": "d85f45734c2806c07abf93c6b42a873d8679a5aecd290603768a754da540474c"
  },
  {
    "cardId": "a530be7a-6717-4a63-9163-a0d5e3f2c705",
    "player": "Ross Jones",
    "number": "169",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1778601515624x111943320931656700/resize",
    "sha256": "7547608de0938a1e76b2cb88e1202853167f1bbdea68ea3169c897c08b666321"
  },
  {
    "cardId": "a5eb9021-581f-4f46-b948-0e819392858a",
    "player": "Ken Phelps",
    "number": "182",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1724632405780x458632816893798100/crop_image",
    "sha256": "87c0aa038670a5c207895c2f9769c55f0e7ff0d03ef8f74efa6e135be7387e50"
  },
  {
    "cardId": "a6c08bd3-58d3-4201-ab39-6787410f0f16",
    "player": "Paul O'Neill",
    "number": "204",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1740651182526x237048555941843400/crop_image",
    "sha256": "b5c5c76d72810ab936dfc1efb074d6bf9c4c88dac9c74f401ff709074c01686c"
  },
  {
    "cardId": "a719c813-3736-4e7c-aa2c-349b6a0b2b4f",
    "player": "Chris James",
    "number": "572",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1785969768628x390594559725504960/resize",
    "sha256": "79070b582275c4434eab7a2ee78a81c5b3d49eb5099278e7e9cf963149c96d17"
  },
  {
    "cardId": "a72671e9-8a18-454e-b8ee-ca24af323b89",
    "player": "Rafael Palmeiro",
    "number": "186",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1737388615355x816594345567595000/crop_image",
    "sha256": "217445892920c651d5130f8597cc66bc4e35b66aed7ecd149f405e790bd7f70a"
  },
  {
    "cardId": "a78521f5-a3c6-41e3-a5a8-64e50b676e14",
    "player": "Storm Davis",
    "number": "248",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779159838511x936648943844395600/resize",
    "sha256": "aa923e5fd9da35146f44d3dd048c529c026db1c714738b30cb0f857f6487cad2"
  },
  {
    "cardId": "a7c6b2fc-e6b7-451d-b2ba-6f7f65cf9560",
    "player": "Greg Minton",
    "number": "129",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779168108912x150061326083479330/resize",
    "sha256": "c7152507762b212c74e54bcf15fac7b05e2ec9b92194be3f971f98682d3adc96"
  },
  {
    "cardId": "a94d8320-fafc-4fdb-9c3e-3c1cc3be281c",
    "player": "Tom Henke",
    "number": "220",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1723469578561x185372014591078200/crop_image",
    "sha256": "3c6d0619f3d618463a4472cdde98fb280c2dc721437fc3f8a0683107716c18a1"
  },
  {
    "cardId": "a9dce792-02df-41ba-89df-69a4d08c8cff",
    "player": "Bruce Benedict",
    "number": "652",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633994051x265884383216839600/crop_image",
    "sha256": "3e7c4e94af2f007c6f8bcaab21b56e81726fa271ba97df70f2322152ea493c0e"
  },
  {
    "cardId": "ab2321a4-55b6-4606-967c-3521f1190fdc",
    "player": "Tim Teufel",
    "number": "508",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779165950771x914644159167450100/resize",
    "sha256": "b271793ac1e5a603592766d813642c2888db689be1e1b9ddedff10606de7a7f5"
  },
  {
    "cardId": "ab7c98c1-d0e7-4964-88fe-8e9e4f9d336a",
    "player": "Guy Hoffman",
    "number": "496",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1742060117732x839325451563562200/crop_image",
    "sha256": "971193db4e2eab6e4edccacd92a5a18bcd82a341bc8493206a412294d843203b"
  },
  {
    "cardId": "abb81a9f-ded2-4361-8141-06a66f92c11d",
    "player": "Johnny Grubb",
    "number": "128",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1785223346159x671959763393268700/resize",
    "sha256": "99291081e9174616e7cccd577a0a4e33bfd4f917912d98b539ebdb0009676acf"
  },
  {
    "cardId": "ac3fc7da-e607-4905-8852-72796953bb21",
    "player": "Mark Eichhorn",
    "number": "749",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1764353903091x420574102343365570/crop_image",
    "sha256": "0bd9e901bd55df1e2b01b31792ea692d330ae0a63349b0f95356a50e8a4774db"
  },
  {
    "cardId": "ad297187-4cef-4a4d-a45b-6283e2db83dc",
    "player": "Mike Hart",
    "number": "69",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1723893677833x123553102109837280/crop_image",
    "sha256": "4af1b3ef715b4ccc368d0762e369e1e7389a842391e5782be689a4db3ba616a6"
  },
  {
    "cardId": "ad2fdb3b-3501-4cae-a119-fe21336b24b9",
    "player": "Chuck Crim",
    "number": "286",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1731988887833x280196247526878200/crop_image",
    "sha256": "4eabd8b0d5126a0376615c298862e1a8a60d38bfba588abafaa3f2ff6b8f0796"
  },
  {
    "cardId": "ad9456ef-6be6-4d7c-bac9-d409ed276c35",
    "player": "Joe Price",
    "number": "786",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1733281046322x605777886116881700/crop_image",
    "sha256": "19f11ca0786ac10156a381c37cec2f535756128716cea7f93e74230ad7b8ec0b"
  },
  {
    "cardId": "add313c2-526f-496b-bbb4-b89a37f909ef",
    "player": "Dave Engle",
    "number": "196",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779156723882x326187576336695700/resize",
    "sha256": "816002d629f4cbccda53fbf818ecd85e3c8e7876995a6a374103e70fb0a17639"
  },
  {
    "cardId": "add866e9-a076-4e8e-8fbb-85640344f51e",
    "player": "Howard Johnson",
    "number": "85",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1725400830870x796301431443245000/crop_image",
    "sha256": "e11e8caf76eb50a2c23ded9f1f91e8c3aee6a2a8155994286f97545a0f037a2f"
  },
  {
    "cardId": "adeb6752-68cb-4f78-bfdf-8711d19e2e03",
    "player": "Hubie Brooks",
    "number": "50",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1723155424545x521813730555869000/crop_image",
    "sha256": "896f1777887039881b75a93a0a66de55bfd3fd841f434a6da158a81e756b9e57"
  },
  {
    "cardId": "ae5cdcba-509b-45f5-8a43-e32966ad5c7e",
    "player": "David Cone",
    "number": "181",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1789961030152x965334086330984500/resize",
    "sha256": "9204a48d999e787483999c2514883ae0c0bf85143c83b84acb3fbf8827bcb939"
  },
  {
    "cardId": "af0fd667-655f-4ec8-906f-590f36ebef4a",
    "player": "Harold Baines",
    "number": "35",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1724169500850x584783273857152500/crop_image",
    "sha256": "64a11317ae115dff3af87ffcbe9d7578732ee278e6fa9f1a70455e90f863ded9"
  },
  {
    "cardId": "af832ecd-c731-411a-9e3c-e70c97a193e3",
    "player": "Henry Cotto",
    "number": "766",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1741534986371x483828573098870100/crop_image",
    "sha256": "d9737aa2f021ce629aa282ce9ab87cdacd1f727d7dc14755875c452d79b66189"
  },
  {
    "cardId": "af9d5546-74cb-46fc-8d24-9b47925396f7",
    "player": "Eric Bell",
    "number": "383",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1785736569365x713318391917290800/resize",
    "sha256": "120ae207436b865312e223761a05a4113292091e413be3092d5d7a3ae932207c"
  },
  {
    "cardId": "afcd869b-ba39-4833-a402-898a36a7891b",
    "player": "Tim Laudner",
    "number": "671",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1735371552549x755208612349126100/crop_image",
    "sha256": "dc109a625e24d995d902b819865d8ece58f609229acc36d757f1d4ef2fdd8e29"
  },
  {
    "cardId": "afce0de6-3732-48ea-b7dd-a5b0a188b8dc",
    "player": "Andy Van Slyke",
    "number": "142",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1724849564203x902976418714489600/crop_image",
    "sha256": "0f8db1125515f31da6b7847bc4b0de561fb96523407c3440c3c6858a17627723"
  },
  {
    "cardId": "b03203e2-2b5c-408c-8e83-c21c56ad713c",
    "player": "Kirk Gibson",
    "number": "605",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1733944751548x742287721793329900/crop_image",
    "sha256": "1dc32aecbc224273e827986af7c3ad9340685eb8f35f7d81f230fa526bc17b79"
  },
  {
    "cardId": "b0cbe8e4-43c4-445f-925b-da186f4753f7",
    "player": "Keith Hughes",
    "number": "781",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1776202548872x913528713017158300/resize",
    "sha256": "d801a3abcb9238b7ecd5e8026fad2c855792d1a85687edce5ac6093921da04cc"
  },
  {
    "cardId": "b0d7e436-8bb9-4a55-bcba-fa932070774d",
    "player": "Tom Lawless",
    "number": "183",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1748899013916x507629366856205300/crop_image",
    "sha256": "1bd750cf8cddac3025ceb2dc85d9e22255648c39d409e5f57c4886cb724b6e1f"
  },
  {
    "cardId": "b0fa74c1-fc85-4268-98bc-2e58ed9a379d",
    "player": "Bruce Ruffin",
    "number": "268",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1746710141039x767433452945215000/crop_image",
    "sha256": "2701a10aa6622abdb36dce860542d2445a6122ca950237ecc62c507388d15955"
  },
  {
    "cardId": "b1dddeae-ff5c-40f3-a91b-a27a6ab4b37e",
    "player": "Mike Schmidt",
    "number": "600",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1720569934568x214988388077101100/crop_image",
    "sha256": "546d07c8f76d7961e7259ddf3bc6a4de72330acff910808f60d93a9f05bc055b"
  },
  {
    "cardId": "b25ea77a-783f-490a-9074-094c9e9ba558",
    "player": "Keith Atherton",
    "number": "451",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1729421820273x822086018794337300/crop_image",
    "sha256": "cf99b20f0be25546f330b4686c568855361ab1f083c1d3b0ff8e49d3b3e30f35"
  },
  {
    "cardId": "b3989bab-49e8-43ea-847d-226413abf9ab",
    "player": "Ellis Burks",
    "number": "269",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1723918852710x571385783083790500/crop_image",
    "sha256": "b4f4d42e8dcba2b0b0a73e56cf1c685ae5b0e02a78d6da39272e313397ca2a6d"
  },
  {
    "cardId": "b3e8a243-cd03-4eb0-b40e-ac4e82d43ab9",
    "player": "Bob Walk",
    "number": "349",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1750258875436x443112704926762500/crop_image",
    "sha256": "ee85e639035b6be0060af773879cff6173d7a4c68705f088186ba5abab78f092"
  },
  {
    "cardId": "b42247ed-299b-4176-84d8-297c2aefe134",
    "player": "Matt Williams",
    "number": "372",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1721744486543x927546700581184600/crop_image",
    "sha256": "d61941e603db11cfb5a1551a6cc830cdb042f84090e2e1431f83b83f22dfdc0b"
  },
  {
    "cardId": "b4a69e51-ccde-4b05-8c4a-695d06e458c0",
    "player": "Nick Esasky",
    "number": "364",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779663818927x322785605380282900/resize",
    "sha256": "0b6447a9e41a2a3030096343cc6b47ab47b88ee55690b4f0b3ed34208853a8c4"
  },
  {
    "cardId": "b5b3defd-47b2-4c23-ae2d-4794ec366b8a",
    "player": "Mike Witt",
    "number": "270",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1725228073226x427146193637632400/crop_image",
    "sha256": "fa9373c2aed0ebf89e747e2f97be49af972d35b4aa8b400b8a0ae934fe990cd9"
  },
  {
    "cardId": "b5dfcb46-c162-4822-b4b9-4225ca6d04a2",
    "player": "John Davis",
    "number": "672",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779078827044x408660967615466700/resize",
    "sha256": "441a999585ab09cecbf5b0060598f0d0d860ddfe13cb98d5b9097c5931650b63"
  },
  {
    "cardId": "b60a6ce3-2401-4950-ad61-0a075d9a4123",
    "player": "Pascual Perez",
    "number": "647",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1735363264802x178375555386343520/crop_image",
    "sha256": "1787656932e4bab633c917c72b0cdde3dc6fc493a45d5a2aa325f3e078f1c696"
  },
  {
    "cardId": "b63ddd51-95a8-4899-8499-a73b8dff9e59",
    "player": "Mike Greenwell",
    "number": "493",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1728103995246x404281546734186500/crop_image",
    "sha256": "e523b1bafa0ea167656db9a8727b7942ea10083ce7315ef5a3c93ebaf10dad8b"
  },
  {
    "cardId": "b765f3c8-2b16-49b9-9d51-71258597a268",
    "player": "Don Sutton",
    "number": "575",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1739941372508x969322151065311000/crop_image",
    "sha256": "24c05495ca8fddd7e03f35fa9194d22ba68a51ed76b0c075f990401d1be8c9d3"
  },
  {
    "cardId": "b7faeda4-e13d-4381-b6f3-daaf164d2995",
    "player": "Jim Walewander",
    "number": "106",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779169102581x676529004254807600/resize",
    "sha256": "791cdbd7fa983e43355b239648f76b69c86d2a4cc0b6b529614ba76da40044b4"
  },
  {
    "cardId": "b838aa63-5b36-4919-a9f6-8777e6dabf93",
    "player": "Kirby Puckett",
    "number": "120",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1724850306240x670189741285947600/crop_image",
    "sha256": "4f8006c31afdf1489a104256a9568ace3f14f62fa1e46c38a3dec0b2fcfb91ca"
  },
  {
    "cardId": "b9374c14-679e-48c6-b2ed-efc62db1ca97",
    "player": "Albert Hall",
    "number": "213",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779167011963x993908124880773400/resize",
    "sha256": "b8cd8a43b389a54e51cac56ce8771759ebc9de0c55e68c0ea964505bcae7f2d0"
  },
  {
    "cardId": "b974f121-8042-436d-a41f-eba877936f98",
    "player": "Don Baylor",
    "number": "545",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1731178885886x299391910348375300/crop_image",
    "sha256": "0127551a6d0c3c93d86ade7bb079bda5d153487847a2799e01166aaa66cf5528"
  },
  {
    "cardId": "bad90d72-a55f-4df8-b94e-cb3461900f95",
    "player": "Cecil Cooper",
    "number": "769",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1732202240330x713310187376257000/crop_image",
    "sha256": "bb65cbf37b7e0f893bf72871f733fe54e43efb9462d2c178672b40e757cb698a"
  },
  {
    "cardId": "bb20a088-3374-422e-912b-fdc78373a8f8",
    "player": "Junior Noboa",
    "number": "503",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779157136817x994372353033612200/resize",
    "sha256": "0183ba97dfc3aad6e95fa8cafafc0d9540d385ec2dfd3fb599c7260a3664e3dd"
  },
  {
    "cardId": "bb90083d-50ab-44ca-b9f5-ad1271506eeb",
    "player": "Chris Bosio",
    "number": "137",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1752278386419x541626234923240800/crop_image",
    "sha256": "7d7a5054102ad2a0b975b4bb170bfcef11438ff2a43d3ea6c225c87867cda42e"
  },
  {
    "cardId": "bbbe8ed7-bbbf-4017-93b7-ae3affb864fe",
    "player": "Lou Whitaker",
    "number": "770",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633994357x772424238505350100/crop_image",
    "sha256": "30574ac5a90ca4c5bbbec4debad0f117a9df9c3e81a81d9d7a3376575811a3e5"
  },
  {
    "cardId": "bbf630a3-9949-4149-b4fd-f4409be1c56b",
    "player": "Ken Schrom",
    "number": "256",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1733279351421x723772998444001300/crop_image",
    "sha256": "536b287111eb7b570f4024e9eb565c38a5bfbb06091004dc99c58a101ea06b5b"
  },
  {
    "cardId": "bc6be84f-b24e-4bfb-802e-12d4b10fd161",
    "player": "Mark Grant",
    "number": "752",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1780205909956x481409646051915700/resize",
    "sha256": "ec241c4a72efa14a9a80de12acb607754d1885378d0722f9c59e94af876f39a7"
  },
  {
    "cardId": "bd65894d-0133-4516-b6a6-a0d223e164f3",
    "player": "Earnie Riles",
    "number": "88",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781671110195x979617856280115000/resize",
    "sha256": "8f1c2841cd68e7867fdd8984e86a9d5c9befdc6097e95d21d803777fd54f3d02"
  },
  {
    "cardId": "bd977d12-6778-4bb1-8caa-023b678173b5",
    "player": "Willie McGee",
    "number": "160",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1721899754863x713068197520719600/crop_image",
    "sha256": "e15f6d5d024494524378ddfbc757fff4c69fbfcbcccd9a11cb4e58191616eb62"
  },
  {
    "cardId": "bdb88c01-e740-4ee5-933e-034e6c29be95",
    "player": "Oddibe McDowell",
    "number": "617",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1782560631327x345689706018126300/resize",
    "sha256": "462a01dcc93fc93caf1e97414a4d12c7a6b46169c8461f9b92558154e1d4bc9d"
  },
  {
    "cardId": "bde0d4dd-c133-4615-a2b5-97b1ee457b9a",
    "player": "Bo Diaz",
    "number": "265",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1721169669209x200986385607305540/crop_image",
    "sha256": "5c631cc32a3ccd75dd0c4ed6277bfdd1d70627d60dec0a37a372af8996d3184c"
  },
  {
    "cardId": "be2c8461-b841-4be4-b68a-89fc1c77784a",
    "player": "Al Leiter",
    "number": "18",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779005104700x309022598924470400/resize",
    "sha256": "9bad8720711fc17e11c8c9e50e5e080ae988358191d83f39baa186b651a945f7"
  },
  {
    "cardId": "be846708-2e17-4596-8b89-2d4cb492ae2e",
    "player": "Lee Smith",
    "number": "240",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1733245512470x717045224763893200/crop_image",
    "sha256": "5a65ab58746433cb360c48a688ed9a35f2a7e2a56ae30743dfe32e36ec6d9073"
  },
  {
    "cardId": "bf0d259b-77d9-4244-a80a-10e3b8f14112",
    "player": "Mariano Duncan",
    "number": "481",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1787702294018x469583854892334800/resize",
    "sha256": "3a1f8f020d8a81adab883f1d414e1d7d9f335387da3e4656f6e7440b5daa1dc6"
  },
  {
    "cardId": "bf205d95-a4e1-4f01-878b-ea3709f1a8d5",
    "player": "Spike Owen",
    "number": "733",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779165530928x827130730231969900/resize",
    "sha256": "ac229043d4f5c8e2bc48b1bffec51c181985fd30fc39592707d7972eddffd767"
  },
  {
    "cardId": "bf31fc72-1caf-4f1d-875e-ea745593b21f",
    "player": "R.J. Reynolds",
    "number": "27",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1733171118660x749810318895436200/crop_image",
    "sha256": "ed0bff3675ab750fc08c860550ae0f618dc26d612b24a7be990d8c1f9380eac4"
  },
  {
    "cardId": "bf4f7a6b-e634-4ba8-b955-be8d88cafd19",
    "player": "Ricky Horton",
    "number": "34",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1789790035141x113038753034825580/resize",
    "sha256": "bd8da58e63f91898e86d966c49fd7a0cedfe48de5b17614cb0c6cbaf626b84e7"
  },
  {
    "cardId": "bf6dd43a-138c-46b6-94e1-ad21576577ee",
    "player": "John Candelaria",
    "number": "546",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633994124x537220385452440640/crop_image",
    "sha256": "f4b3a76999e5b4acd08e8afaebcb4766f6866963585ef516f1f3dc3e6ffea92a"
  },
  {
    "cardId": "bfcfe384-3404-4086-a87d-29489a61555f",
    "player": "Doug DeCinces",
    "number": "446",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1777415107514x201976720884721180/resize",
    "sha256": "ba9e81480eaa8d4cddb1ca03f88246d6ad75220454dde3996623e4e0ebbfec9f"
  },
  {
    "cardId": "c00ad721-8875-4553-80da-3d7c167746cb",
    "player": "John Tudor",
    "number": "792",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1760831541070x141760117046441980/crop_image",
    "sha256": "ed6a87123ab620b06df552ff626dbaa320861e7a11967d8a27ef474971bee19c"
  },
  {
    "cardId": "c07d2521-a9cc-481a-b1da-942848914bec",
    "player": "Pete Incaviglia",
    "number": "280",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1739939352569x779150018364645000/crop_image",
    "sha256": "9c7169f8a89690bc44e4d9bffa8c98b83f37a34484e67b02195b96c668d33a70"
  },
  {
    "cardId": "c0cd71db-3b90-46df-aa24-f25af08cdfdf",
    "player": "Mookie Wilson",
    "number": "255",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1722315103939x258669025643641470/crop_image",
    "sha256": "43d7e794088f4387fee3996bc3b81ae89b2c68f18876ee405a9a8d6bba785243"
  },
  {
    "cardId": "c15edbc2-35d0-4fac-9df3-b5ae2a1571fc",
    "player": "Ken Dixon",
    "number": "676",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779078870991x645089137770783200/resize",
    "sha256": "f187dc4e3264a299ba0a2ce9628d51a332ba00030e70fc2f84cc8dd4e6c918ea"
  },
  {
    "cardId": "c1a96208-e81e-400e-a7ec-acb15107e311",
    "player": "Dan Plesac",
    "number": "670",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633991272x515372946698068100/crop_image",
    "sha256": "8e5918b89d953e17232a8758bd124d7b0b6cb6d88ec8a6006c117b2c3402d2fa"
  },
  {
    "cardId": "c1ad5040-ddd1-4e65-9488-ca38090fed21",
    "player": "Rocky Childress",
    "number": "643",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1785753248582x710430572891774600/resize",
    "sha256": "9f9b9a3dfd92008d4af0f14a1ae7e9964728c2f442469534eafe368a418e1e5a"
  },
  {
    "cardId": "c246cb3d-d5db-46ea-a9f9-d08ffa7bb67c",
    "player": "Mike Bielecki",
    "number": "436",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1721405139819x101816051659155970/crop_image",
    "sha256": "e8fc23cccecc37f12b6ff83028f698614b9d1f5c9bbef08f992f2cbe4c264302"
  },
  {
    "cardId": "c284f57c-ebe6-4128-a8e2-35ac668460ce",
    "player": "Craig Lefferts",
    "number": "734",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1778883160048x186888847991410370/resize",
    "sha256": "9bbc6924ece781876d6fb17e56057525906b386202f651bed428554ad1c82366"
  },
  {
    "cardId": "c2b9ac72-e3ef-4258-afca-29609270a3c2",
    "player": "Todd Benzinger",
    "number": "96",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1723690623424x103959681815574130/crop_image",
    "sha256": "18ad192453a91449e776c006e559c72e27bc7d502eb792bd7b163a9d9b40414d"
  },
  {
    "cardId": "c31ecb7f-c7f1-4d96-a1b7-64a21d1ceb3d",
    "player": "Mark Thurmond",
    "number": "552",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779167173272x929466219600011400/resize",
    "sha256": "3a0d40fbe4340de65ad44a14d71f7934f4c98370730541fa0fa47216f7678e69"
  },
  {
    "cardId": "c3842129-d957-44c3-a734-cb24751d9569",
    "player": "Tim Stoddard",
    "number": "359",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779684696806x238956467745728540/resize",
    "sha256": "1f339c160fa3076704a2597a2e523c903345448a368a1efe71e3e5258467c946"
  },
  {
    "cardId": "c3ced3ff-dea5-42c3-a0d9-3a3a7c7b947e",
    "player": "Pete O'Brien",
    "number": "721",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1730940310973x125831023099021200/crop_image",
    "sha256": "9a61ea19a2ad2c86f2dd3abfc37e00c190675ed7bcf8c62be701d417788d3dcb"
  },
  {
    "cardId": "c421606d-06ef-4d85-a715-43b4c939203a",
    "player": "John Moses",
    "number": "712",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1752718242935x691671959374714500/crop_image",
    "sha256": "73eda1428d1eb462812f44889cecf1a25ab343f0fbf239f779c16fc0dcb70aab"
  },
  {
    "cardId": "c439b5a5-a513-4e6f-a6af-915af04addc3",
    "player": "Jamie Moyer",
    "number": "36",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1752277919571x202717858249576320/crop_image",
    "sha256": "29510d3f82f46586ae1e12c083c5bcd1d96450044cdc009ef7dde998f11046ad"
  },
  {
    "cardId": "c4816dc6-eee7-4e9a-a9e7-6976ccece1a3",
    "player": "Kent Tekulve",
    "number": "543",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1724539264582x350868768120663500/crop_image",
    "sha256": "cb2ba87b466bbf0393bf4649ee2f6d5cf250b6270ad0d8f26718a70a6900f775"
  },
  {
    "cardId": "c4ab576b-67c6-493e-8c72-6ee459693c8f",
    "player": "Tim Flannery",
    "number": "513",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779165946046x609027772001744300/resize",
    "sha256": "a4ea4f1c948a6d6410eb701957ad1272b6f17f2490b9f94468dec5356b2855e3"
  },
  {
    "cardId": "c4db2077-be2d-4d0d-a396-fa40cc962b5c",
    "player": "Phil Bradley",
    "number": "55",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1728489684073x162186726802310720/crop_image",
    "sha256": "7d9312b36989b35ca1fefef1fab9fdbc440a74abbfdb639c5427f3086e26f042"
  },
  {
    "cardId": "c511ee67-da2e-42e3-9889-1e622ba9938f",
    "player": "George Hendrick",
    "number": "304",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1735265388213x475791583868745400/crop_image",
    "sha256": "923af5d7765bee2965fe0b838212b2721713036ced9e3da8bb9840987b794692"
  },
  {
    "cardId": "c54842ed-e868-4274-880c-8839a3373bef",
    "player": "Dwayne Murphy",
    "number": "424",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1778601867839x529103677747264830/resize",
    "sha256": "3607a5cd63bd8c6aa8cb3cf42e9e18dca6935bb5455d3a17f3be1711ce3454c1"
  },
  {
    "cardId": "c755b444-48e5-4112-9036-f3331bab3f24",
    "player": "Jim Dwyer",
    "number": "521",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779157312987x953973693074514600/resize",
    "sha256": "53ce96c939a568efcb82e292915dd20032ca0ba8901271715dfa529656db2b53"
  },
  {
    "cardId": "c7d37e46-42bf-4a70-8e94-c234a3e2d8d0",
    "player": "Dave Johnson",
    "number": "164",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1721231137770x985185519257228800/crop_image",
    "sha256": "20d703163b4a5bffd95edec5e7a22d6c8814a608de68d91eac5b579f18410db8"
  },
  {
    "cardId": "c7de6fe0-8c12-45d6-9cf9-d76982164c1c",
    "player": "Neil Allen",
    "number": "384",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1731989371807x296657435804285700/crop_image",
    "sha256": "7bbf07b0ee2ebce218b9369619a96d337f0a1dff2f29e7593198f9c788891243"
  },
  {
    "cardId": "c856e22d-cf90-4814-acd3-e6bc42112b6a",
    "player": "Scott McGregor",
    "number": "419",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1727311969997x145468752633057800/crop_image",
    "sha256": "177f7b78a799e1994d5464155e0f4b04b7717968fffa1c395a399bfa3f6dbb2f"
  },
  {
    "cardId": "c88946d0-2bed-4aa0-8660-3eeb0b18987e",
    "player": "Zane Smith",
    "number": "297",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1752279307977x490508730921478400/crop_image",
    "sha256": "b11c06ebb7cf882e00f4568ce9c11443c8ceb3853108cb225273280934bbd412"
  },
  {
    "cardId": "c8ecca6d-a849-4384-8891-871e2f1c92e2",
    "player": "Benito Santiago",
    "number": "693",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633990644x356274381779267100/crop_image",
    "sha256": "1e508f6cc56ab41909e8e21b4f5819bec3e7b606c7e2527c5fc5083953a13546"
  },
  {
    "cardId": "c8f87aef-ece5-4965-84b7-e7b208ba8f93",
    "player": "Jack Morris",
    "number": "340",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633988365x885655090184621200/crop_image",
    "sha256": "5daa6a7461b8ebf4a1a32d9f943f461687c08092a587f1d75884c231df3f2088"
  },
  {
    "cardId": "c9127437-b6a9-47f2-bdbe-bc386e14bba6",
    "player": "Vance Law",
    "number": "346",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781422062376x377683679253352000/resize",
    "sha256": "15fecc3314d652f2a5ed687e741f1e517329d61431eecfced206df5ba2c306b2"
  },
  {
    "cardId": "c926035d-e5b9-4b32-b898-68135bcb8f9f",
    "player": "Jack Howell",
    "number": "631",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1782560631767x282100677745582340/resize",
    "sha256": "b73732279d36bf378c7b1ff21789048abfdf5d595c67ab95ac9773a9421f7b65"
  },
  {
    "cardId": "c9306067-dc2a-4ff0-b3bd-e4ce2142741e",
    "player": "Bobby Meacham",
    "number": "659",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1780380233199x270991549669115080/resize",
    "sha256": "a233695493f2c067b9deedade66308a3bc92ebdf5cc744647b2860475a6488f0"
  },
  {
    "cardId": "c966e2ef-4a3d-4ddc-921a-66aa1c26cd21",
    "player": "John Kruk",
    "number": "596",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1770178538531x460771814176238300/resize",
    "sha256": "71b10747b147a10d02b069c372c10f3c480bcc413795409c27f4cbe444db19fd"
  },
  {
    "cardId": "caca9d74-f990-439b-beb0-533c1fea3b97",
    "player": "Mike Morgan",
    "number": "32",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1776202444335x513022625575920960/resize",
    "sha256": "27909147ea25ff021659fe6e6f2398ab3f06422fd193471af45787de01cb0c1f"
  },
  {
    "cardId": "cb4c5b1c-8c35-4b72-9969-77b52ad15432",
    "player": "Wes Gardner",
    "number": "189",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1729864127730x371427387579281100/crop_image",
    "sha256": "da947079d8ad93d9c3db35917b6bb048e18381c42eefdbd610b9cd9a2abe10f1"
  },
  {
    "cardId": "ccc6d1db-d6c9-4196-a465-ac31f8551ecf",
    "player": "Pete Rose",
    "number": "475",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1722829756170x128453522227234270/crop_image",
    "sha256": "564a030554d739f38622013fec2b7558f3594f470948fc444c339813be742219"
  },
  {
    "cardId": "cce4bf67-75a8-4112-b9be-1440f115ffea",
    "player": "Benny Santiago",
    "number": "693",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1752167791716x631156863361372200/crop_image",
    "sha256": "aa2d66f8ddf505c1a0403f119ed7127dd09897cbb0377318771b499d93c950c8"
  },
  {
    "cardId": "cd00618a-96fa-4619-a04b-dffe7647ffee",
    "player": "Dave Schmidt",
    "number": "214",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781088233023x397336331934506240/resize",
    "sha256": "6496ddc1094fe6f633c06f64e4cf7043bd6e6ea04ef956a7d7121baaed330132"
  },
  {
    "cardId": "cd88397e-6ce9-43b3-b669-f77f5ba1c7e5",
    "player": "Dave Meads",
    "number": "199",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1737578092224x640110653076491800/crop_image",
    "sha256": "96b16b64752bd701d75498f2f9f224cf3bb05d3b040e4de3d8a6f320be6941ab"
  },
  {
    "cardId": "ce0180a7-3511-4a55-8f61-45ac1e4dc3e6",
    "player": "Bruce Bochy",
    "number": "31",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1725481737359x782039630070301800/crop_image",
    "sha256": "be10c82b6dd6f6278b1c1117f427aac32ec7639f144711aa19546473b3de01b5"
  },
  {
    "cardId": "ceb5a4ba-ac35-4a07-a782-3c19d8c5844c",
    "player": "Ruben Sierra",
    "number": "771",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1729401415976x257268010573697760/crop_image",
    "sha256": "8326cfaa65e228c8de3eaf44472e52c7d3d51f7b4b51b584d927685603cb58b3"
  },
  {
    "cardId": "cec9c381-6890-4f3f-99ce-94a459400cf0",
    "player": "Bill Doran",
    "number": "745",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633994268x100864702612244220/crop_image",
    "sha256": "6e3b0e4d00a1b61d17ecb008f72eaf45f0ab4361647788221ecd5fb0cb202054"
  },
  {
    "cardId": "cee5c095-4577-4ca9-b3bb-b2bdadc7e398",
    "player": "Mike Maddux",
    "number": "756",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781463930124x677942064461410000/resize",
    "sha256": "2e18c5c3fd8a046fd2a5ab275d9770c450dbc77a50fefa54fa12cce5cad34c53"
  },
  {
    "cardId": "cf5a9eca-144b-49b1-96e9-7acabd971176",
    "player": "Kent Hrbek",
    "number": "45",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1739940463493x279929863574988740/crop_image",
    "sha256": "bddb891853adb52a6207ecb07d8eed4b321227834524a4f096d258afe11cacd5"
  },
  {
    "cardId": "cf848dc3-36d5-432b-b0c5-dddde7a44f2c",
    "player": "Gary Pettis",
    "number": "71",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1776202446624x515879337260096700/resize",
    "sha256": "771ba1c11d97cab5470e8d3ce5b9e06cf51bbf8b27eb11af6acdf44681ee58e2"
  },
  {
    "cardId": "d021b068-0569-4ef0-9730-5542db03a182",
    "player": "Will Clark",
    "number": "350",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1725389594669x813928184547572700/crop_image",
    "sha256": "aefe56a7b7792019f071ba6951befe73fb0c2fb88f53dc80ed96bdfd87387d6a"
  },
  {
    "cardId": "d049c512-232c-45a7-aecd-1e7269b0ff7a",
    "player": "Alfredo Griffin",
    "number": "726",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1725886153656x341899390529277950/crop_image",
    "sha256": "906e7db2125583a5710a0eb6b19db7d4164073b149969acc6a8a05a9600e7060"
  },
  {
    "cardId": "d0595ce6-8e2f-431e-924c-44cb9112694c",
    "player": "Mike Smithson",
    "number": "554",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1720304725115x485530685631633000/crop_image",
    "sha256": "eceda7984c548f4c4cfb9d89cca2ba5dee5fef6d98888642300cddd1649bd597"
  },
  {
    "cardId": "d07f8614-60c2-43d7-9b84-8f1afa1f6d31",
    "player": "Butch Wynegar",
    "number": "737",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1733407522491x313473193668302400/crop_image",
    "sha256": "338a9dd09a6510116e9603ed9d57589464d4797c453e3e76515baedf9415fae2"
  },
  {
    "cardId": "d0e6da4a-7aa4-4952-b32e-fcb981077f6d",
    "player": "Mark McLemore",
    "number": "162",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1733278951106x786080575584508400/crop_image",
    "sha256": "58631c8d52f2601f00b5e84541cc9966ac9f24aa48265efcc757de3daf4ad0b0"
  },
  {
    "cardId": "d1ac2429-2c94-4d1b-b524-32359d0e013b",
    "player": "Mike Henneman",
    "number": "582",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726282381207x687387410928301300/crop_image",
    "sha256": "b0a64a60e336aea17ca9968a1871aa9adb0615ac61af7f536c3fa180cb0e7367"
  },
  {
    "cardId": "d2105b06-35cc-4e0a-976c-f1a6bd59de30",
    "player": "Bob Patterson",
    "number": "522",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1741981278244x937771916937961800/crop_image",
    "sha256": "f2d7ec4eb3e74e2e20ef801e80533b4fd42d1295487a2679e097db59bae3f801"
  },
  {
    "cardId": "d225d4fa-c941-4c81-be5e-287b901920a5",
    "player": "Bert Blyleven",
    "number": "295",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1730911748111x392571596622151230/crop_image",
    "sha256": "5ba3853782dae27aabf8161d059d1f8a4d8579cd7754199b98e40002cdac40e5"
  },
  {
    "cardId": "d2261e31-f00b-4821-a829-202b49225535",
    "player": "Johnny Ray",
    "number": "115",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779168112831x517936271217551040/resize",
    "sha256": "7a51a5efa2f6613a78616ee8857446973f0bce3a61bb6db30b94ae9b592ffa5c"
  },
  {
    "cardId": "d25f9422-ff9b-412a-bf90-d2929c58e37c",
    "player": "Juan Berenguer",
    "number": "526",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633996397x557163878329976400/crop_image",
    "sha256": "c5efe4109d4b38b015f9e179dfee18cc8afc6088fb2a79da6d1f3752b1e9358f"
  },
  {
    "cardId": "d26307f5-fb3d-4a20-a53e-b8b33f3c97bb",
    "player": "Tom Brunansky",
    "number": "375",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633991917x898629466553145600/crop_image",
    "sha256": "e199c5ec827bf2873d6b5c7ad3681eda9b504e5dcc5cd5a43a339e40f4f6ecf2"
  },
  {
    "cardId": "d38c6dc8-cc9d-4c5a-a2dd-076a6271048b",
    "player": "Claudell Washington",
    "number": "335",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1789987411350x587246255737143400/resize",
    "sha256": "e2f365a744a0f7f0d0ba608dd020d913984dd14ec2d9f73046b642a63d9aa95d"
  },
  {
    "cardId": "d419df7a-314f-428c-bfb9-6b88dfb03f2e",
    "player": "Jimmy Key",
    "number": "682",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1733280558309x821868380048198600/crop_image",
    "sha256": "e5a8ef366e229904be2cd9de49c0af20a2cff80d49cc8a96e098fe30b6d5a0bc"
  },
  {
    "cardId": "d48a0690-d9aa-4801-a289-3a390a821cd1",
    "player": "Lee Elia",
    "number": "254",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633993497x221564034340356400/crop_image",
    "sha256": "20a5ce181ea3008dff5e6ceb5e2e0ff6b9a5dff7d56cd277d2d8b95db0924159"
  },
  {
    "cardId": "d49008ef-1d3b-4d09-8d57-de349aca2e95",
    "player": "Tim Leary",
    "number": "367",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726520708426x146604096961894700/crop_image",
    "sha256": "b2323b538f80b58ad18c2d6a980e08ed966ad6f9fa524880a6828eb5e356344a"
  },
  {
    "cardId": "d4f7abb1-35a1-4226-ae91-83ecb4f804cb",
    "player": "Tony LaRussa",
    "number": "344",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1756859183201x649144051566410000/crop_image",
    "sha256": "852286ce77f7b4b1a3d1df342baa2e0361973e94537bc623dc1e387e3c6becd8"
  },
  {
    "cardId": "d53c2196-5916-4761-8fab-ef94832b6254",
    "player": "Darryl Strawberry",
    "number": "710",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1720636155404x735134394964155500/crop_image",
    "sha256": "99e1087268e5e0e11e7b76efd2e0af43d54ea82f5af001246635cfa742ea0f2b"
  },
  {
    "cardId": "d5706b90-38df-4802-9f5e-18536a1c0d2d",
    "player": "Bob Knepper",
    "number": "151",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633993348x206166227746352960/crop_image",
    "sha256": "b599c649a3d1aeb4c81f11f0a42f5302db3538bd55e1ef306be0722742077e40"
  },
  {
    "cardId": "d5a0bcc8-8a18-48a1-b97b-fb62c4be414e",
    "player": "Tony Bernazard",
    "number": "122",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779168107173x794496446745416700/resize",
    "sha256": "cae8f489f59dbf3a98f8d3a98a73c7c8b848e311f5c288eb12dfeb127ee0b4a9"
  },
  {
    "cardId": "d5b2823a-9d3e-473d-8383-a9548ffa5bed",
    "player": "Cal Ripken Jr.",
    "number": "650",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1737674044106x292022720577779900/crop_image",
    "sha256": "89d815793e793a9c736b0552b024f3748da2da26bfc902554e82fa9a907630ec"
  },
  {
    "cardId": "d74dd8b8-297e-4053-8d42-d4aebbbb4c15",
    "player": "Doug Jones",
    "number": "293",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1729438387843x861022263898539600/crop_image",
    "sha256": "c5d5d8d0848652ba02488b252769025db4e022c66ed22464fb126fba97facf15"
  },
  {
    "cardId": "d77109e6-aade-4412-94a3-94fe128ba014",
    "player": "John Marzano",
    "number": "757",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779165531182x693654657562691200/resize",
    "sha256": "0a8c6e271a2d24ae9457c0afc11335feb46c0d58ceaa33ebda43d5c8676da168"
  },
  {
    "cardId": "d7de9fec-1545-42e9-8e1b-ee51262b5ff5",
    "player": "Joe Niekro",
    "number": "473",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1736709685399x577096503270516600/crop_image",
    "sha256": "bfb85365a12130cd8dec56fa744043a54c764f3982663b07583ea3dc7832ac1d"
  },
  {
    "cardId": "d7fd6c9f-a0ac-4641-85f8-601a1cf1ee40",
    "player": "Frank Tanana",
    "number": "177",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1722912347336x463512296032622800/crop_image",
    "sha256": "80f9810f806908816e5e635b946f13cd78775f36d0c0275b57560eafe05038e5"
  },
  {
    "cardId": "d825fa98-748e-49d7-b470-c4356485e943",
    "player": "Dwight Evans",
    "number": "470",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1721862544991x847413004498822600/crop_image",
    "sha256": "7eb43ffeb2fc986efd934b08c2b11173db9acff9662fe43a5db7e8fb21b19679"
  },
  {
    "cardId": "d912f018-ac99-48f8-858e-095631ccec14",
    "player": "Steve Shields",
    "number": "632",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779168792730x464824939847267460/resize",
    "sha256": "8a3186e96ba5cb5cab5402feded62f838ea16d334d700b21f5257ca5c85f33af"
  },
  {
    "cardId": "d91be162-5398-46f8-90b9-85304dea4b9c",
    "player": "Jerry Don Gleaton",
    "number": "116",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633999415x936127401545071400/crop_image",
    "sha256": "03fe87b792bc8afc911988118fb5216f6de12180324914133c776b1fcb75e83a"
  },
  {
    "cardId": "d955181a-5161-475d-a1d9-4f8e7c8d1ecf",
    "player": "Danny Gladden",
    "number": "502",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1731178883381x323462875889871000/crop_image",
    "sha256": "b42239d0f9feac80b9194325189e9a08258230f414c44d0371debd497f84491d"
  },
  {
    "cardId": "d9a240e7-47e3-445e-8834-f64b84481249",
    "player": "Ozzie Guillen",
    "number": "585",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633991146x692747902903895000/crop_image",
    "sha256": "0e76f0681d8d05a3723a6e0a4fa72d1905a0a993ce7e91c6661d2d3afebe2bb7"
  },
  {
    "cardId": "da1ca89c-402c-428c-a4db-a216d3508fdd",
    "player": "Manny Lee",
    "number": "722",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1776202546985x375671621354325400/resize",
    "sha256": "279e182b5d47a1b11eb37f65bdc8c2f621e670d14626d1cdc4a09b25b19ef52d"
  },
  {
    "cardId": "da491611-2672-4f50-91ed-10e126212acb",
    "player": "Mike Trujillo",
    "number": "307",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779167053061x122830903342749490/resize",
    "sha256": "d620ecbedc7ac13dbff034d990f70fb367784850a0cbc384c29157128193b6b8"
  },
  {
    "cardId": "dab2dc0c-774f-4c6a-a5dc-385fbcda1e54",
    "player": "Rey Quinones",
    "number": "358",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633996705x184839065212287780/crop_image",
    "sha256": "b416131ec4b9eb51bfc2fba19cca1157797b2bfe1b8ee4cb0d6b7ae64ccffe0a"
  },
  {
    "cardId": "db725ec9-4026-4aff-9197-91a0ced5b930",
    "player": "Charlie Leibrandt",
    "number": "569",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1752281242775x520598935814412100/crop_image",
    "sha256": "e8c8bcf1cf2bdea90544f67aa341c1694073644e0a6ddc711cd98b86417479bd"
  },
  {
    "cardId": "dc640cb9-4b00-4853-93ca-61e6ec90f0e1",
    "player": "Terry Leach",
    "number": "457",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1754436010352x484304233834797100/crop_image",
    "sha256": "7c05dd41ce104efca1a1b21d2e9335a655b3c346e176c49bdac58ae653f9f864"
  },
  {
    "cardId": "dc7d749b-0ad5-46b9-a222-e3f8868be0c6",
    "player": "Brian Dayett",
    "number": "136",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779157382466x490552401522479800/resize",
    "sha256": "8cab33c38eb86f94492c58bb688a4bdbc0ac5032ea6955ef81b44b376ac9b064"
  },
  {
    "cardId": "dcb221c1-db15-4916-881f-16d0819d3dd0",
    "player": "Kevin Gross",
    "number": "20",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1785969853404x794216069105554200/resize",
    "sha256": "73b320716fdaef02351f8a9ea6f3e542189cb7bfb5b170d1d8243461949eb4bd"
  },
  {
    "cardId": "dcc6cd46-70d4-4c7a-9897-b5db2412c243",
    "player": "Paul Noce",
    "number": "542",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1778602005819x558442539724319550/resize",
    "sha256": "c1638516994e13b3367856e1cc27400890230ecf7ea103f014f48e34f95a4780"
  },
  {
    "cardId": "dd17667c-25c0-4fa9-a863-be57b96f3c49",
    "player": "Bill Landrum",
    "number": "42",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779165942450x385781733869970300/resize",
    "sha256": "cddaaca5f3bde3a09d989ea8378956102a97a6b366d311ae7dd9e7da7eb8a291"
  },
  {
    "cardId": "dd2dd7ef-9808-49ff-9984-e17bbf876505",
    "player": "Larry Andersen",
    "number": "342",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1782560629671x779588651864126600/resize",
    "sha256": "7e19c38f1846d01078695d4a5ebdd0c856042798e4759eddd1bd24be895bf5ad"
  },
  {
    "cardId": "dd94c4af-251f-40e3-9778-71e0ebb2128c",
    "player": "Jeff Dedmon",
    "number": "469",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1733280068453x804644007314761900/crop_image",
    "sha256": "4afb832c2234ebbe80be5113f512e4e04445ed9f5e911721c11a9cbeca1308b1"
  },
  {
    "cardId": "ddc3a1e6-0cab-469f-bde1-7b009abe3dec",
    "player": "Mike Scott",
    "number": "760",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1756559025790x613085645503513500/crop_image",
    "sha256": "2b855a8e6a61db237192e49438cf6b6d7e30302eb2096eeb6cbb7d827c0f3651"
  },
  {
    "cardId": "de26b1cd-33b0-4786-b243-1af4da07eb1d",
    "player": "Dave Concepcion",
    "number": "422",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1747532707089x673102321901892700/crop_image",
    "sha256": "160726dd1f5cbe26eef7743d24cc54a69aa6843b0a5f22b25c507880c05a8694"
  },
  {
    "cardId": "e065bc47-d234-4537-90c3-510de06b8599",
    "player": "Jay Baller",
    "number": "717",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1725035841013x143868394521980530/crop_image",
    "sha256": "1b68cf2111ff8646a96166fa3f50af11809674dae5ae61afd00563d94458f132"
  },
  {
    "cardId": "e08c0619-2413-4be5-97e8-0f9c180e9bb8",
    "player": "Ed Nunez",
    "number": "258",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726337593086x203446670648679700/crop_image",
    "sha256": "217f8b1cfa580ab065ef753464e9e5fe9f9ef675273e940ab79d0975e9563e0a"
  },
  {
    "cardId": "e13f64b2-5f35-40af-9133-ab050e3bb9a6",
    "player": "Julio Franco",
    "number": "683",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1786671538271x746978548530312400/resize",
    "sha256": "a1a50cd8e16cdea100641addf18f5e25ed411aa777b1074037971a0666206f0c"
  },
  {
    "cardId": "e2e1ea21-c927-4673-9497-9ec14942ae42",
    "player": "Willie Upshaw",
    "number": "505",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779206426626x897888763502517000/resize",
    "sha256": "6f77b262b2efe4b8e3a5706e0fa49fcb4ca01d8ef9c017c26d3eafc34ea2ed65"
  },
  {
    "cardId": "e308a344-ff7c-403c-bfab-cdc8c2e90b89",
    "player": "Jim Rice",
    "number": "675",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1721911737953x808455785115925800/crop_image",
    "sha256": "338c07103268e7465fa52a2eae6f341da57054489e23cba1e0c5c8f3b1b392e9"
  },
  {
    "cardId": "e35b2403-f71f-4ef9-be6c-656b74ce01d8",
    "player": "Bob Boone",
    "number": "498",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779859800946x448368307242819700/resize",
    "sha256": "8ec2d5537d4a94e5e72e57aa3652ddde977f7d9c3ab8b48992ef648c8fafeb94"
  },
  {
    "cardId": "e4400393-cbd6-4fb5-a2e7-3a1d18bafb90",
    "player": "Don Schulze",
    "number": "131",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779167009942x947342394230491500/resize",
    "sha256": "f0f66382456185f72ad7f8d8376fad88339911e1b308bbbf5dfa1e73c6445936"
  },
  {
    "cardId": "e48685d2-9a29-428b-9352-8e4461f15cb4",
    "player": "Mike Flanagan",
    "number": "623",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1780709735513x563295844124680500/resize",
    "sha256": "1f24b50eb3f254f6d8180768ad2f4d16f4cf1b0ab28ef1ffd8e975d35f3b1342"
  },
  {
    "cardId": "e63228c8-e9fa-4503-9974-0e0f729071eb",
    "player": "Mike Pagliarulo",
    "number": "435",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1782263110225x475450279125171300/resize",
    "sha256": "d5d20e26610bdafb7e5414b5c0d5beddb062bbe18bea989a34cac8196d8618b5"
  },
  {
    "cardId": "e63e014c-6022-4ca4-b6b2-e7bb79870d3b",
    "player": "Joel Youngblood",
    "number": "418",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1733407522799x456218129340502100/crop_image",
    "sha256": "41c7ee778c0d6de964edf9b71d71f08c39105166d50df273382060e5b3e2c08e"
  },
  {
    "cardId": "e6a50153-ef69-4ba7-ae96-a324987f5516",
    "player": "Jeff Montgomery",
    "number": "447",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1723953445871x295151717421870500/crop_image",
    "sha256": "144e08386ad9e001b65588cf722c33c4150a2afbf378903b55c2e6bc064c85ac"
  },
  {
    "cardId": "e705318f-3038-4163-b740-1785d2046a69",
    "player": "Jose DeLeon",
    "number": "634",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1752281537774x136424062747921860/crop_image",
    "sha256": "6914a927c8d4a2fd0453e637aaa76791332697c715f2a0ad54ba7135344fe33e"
  },
  {
    "cardId": "e7b6692d-c403-4868-9dc8-b589039aa213",
    "player": "Junior Ortiz",
    "number": "274",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1724625662677x805284494504611000/crop_image",
    "sha256": "5dda2a3c9860559ef6d0fb2a6ec4339fab53236adef5ec3fa37b5045ba70626b"
  },
  {
    "cardId": "e7e33457-42c4-42dd-9200-37ae9e01010c",
    "player": "Jose Nunez",
    "number": "28",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1723816865084x566496341890260200/crop_image",
    "sha256": "b2b4cb3bd9521bab6676dae293a6a515a99057fa4981f726bf875d80b9ae3c62"
  },
  {
    "cardId": "e80263c0-68ef-4fc8-abc4-51cb7a8198e9",
    "player": "Mark Davidson",
    "number": "19",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1783605871726x198967287145147780/resize",
    "sha256": "48fbb56defe970f0899482b2d05d35719575437151ed1fb6d62bb4947421c1a9"
  },
  {
    "cardId": "e808f6f8-f6a4-4fd7-8c69-d26905d1b1da",
    "player": "Greg Maddux",
    "number": "361",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1721404616526x279996345658076060/crop_image",
    "sha256": "7dc94270c45cae960ee01d6dfa3b2a85645d82bbf4c4381291422335368321e9"
  },
  {
    "cardId": "e84ccc37-6bf2-413f-bda6-e4febbbf2e0a",
    "player": "Ed Romero",
    "number": "37",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1782053370600x296407054162075560/resize",
    "sha256": "9b2810edeb1167abae9ef98cd67bbed8ba3c24589ab982659da39eb83a2c8c87"
  },
  {
    "cardId": "e88d7df9-4374-42f1-832f-84b00e27832f",
    "player": "Tom Brookens",
    "number": "474",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726282383027x992580030676936800/crop_image",
    "sha256": "6217639b39c8b44319081657bf1d9a3ca4d3ba33fa839b78a8bb0669d2d75340"
  },
  {
    "cardId": "e8ace47e-3730-4318-b404-2f8d46acc9b2",
    "player": "Walt Terrell",
    "number": "668",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1722912353477x820672802098580100/crop_image",
    "sha256": "8b99c4046c9a75253011aab38555d04f931a48ccd37cc56210f12b1adec52ac7"
  },
  {
    "cardId": "e8ba1d8c-0ddf-43e1-a651-be1811006cb3",
    "player": "Charlie O'Brien",
    "number": "566",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1776202514562x245889904577089250/resize",
    "sha256": "5c14433e2e6c4f6bf80464e3cab35fe6ff822e5562e84b1f384f46cb3192bd39"
  },
  {
    "cardId": "e8ecdde4-ca7b-4b7d-967d-266149761971",
    "player": "Jim Winn",
    "number": "688",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779157969268x443932828367667600/resize",
    "sha256": "c52f987ae5446ded8825817f2089f99117fa5d39835104d2895b13ae16380a82"
  },
  {
    "cardId": "e8f0f3da-9258-4609-a69c-5768f4e72529",
    "player": "Mike Jackson",
    "number": "651",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1778867918703x976654798991466000/resize",
    "sha256": "c3f1cc9ca6abf34187eac744c1073494a201d824213acb8cd05ba90d525475fe"
  },
  {
    "cardId": "e9363191-6e8b-4e03-b27d-9f7bbd1b9892",
    "player": "John Shelby",
    "number": "428",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633996842x512924588412982100/crop_image",
    "sha256": "3b53cae6dbb7298b98379c3e39f9c4ae98c2937774332dab4cab52fa0bfd3908"
  },
  {
    "cardId": "e97d30f5-b4f7-47fb-96a3-eb5c4743ec6b",
    "player": "Carmen Castillo",
    "number": "341",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1780114896616x960709286868213900/resize",
    "sha256": "1049e5e7a2535591c6f2b41010ce1641c9d4f5c2abfac22209e8eea39e8c6466"
  },
  {
    "cardId": "e9cd4348-843c-4475-ace9-901f4dbfaa44",
    "player": "Jesse Orosco",
    "number": "105",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1730128629188x678522555625589000/crop_image",
    "sha256": "3d2a1f8c2e53c331a43856d1d6a425bf25f1d7e5c5c5ba7cf501970f53240efc"
  },
  {
    "cardId": "ea5fe65c-14bc-4f8e-a4de-44306be7b1ce",
    "player": "Bill Gullickson",
    "number": "711",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779165542231x952514334766074900/resize",
    "sha256": "4a547575ec8e08064f035d68ebacf0e1deb5a402ecae37ecd3a540d53adae679"
  },
  {
    "cardId": "ee748543-fd7f-4b83-8221-ec0d7f45529e",
    "player": "Rick Rodriguez",
    "number": "166",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1728178414305x685545361755695700/crop_image",
    "sha256": "cccc7816b7c1b1ff5548e75b98509f65d185fe6d5e1554f3edee6e9f8f19dfcc"
  },
  {
    "cardId": "f098b8d9-7d51-4f77-a303-243434fcf33e",
    "player": "Tom Candiotti",
    "number": "123",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633999298x815084860257918800/crop_image",
    "sha256": "bd372dbb9f0edc05809cf59d976dc320d4bc93a3b8b9e116a9ef8bf7ca10f3bb"
  },
  {
    "cardId": "f0d47232-e6ed-4277-bbe3-823d8913a837",
    "player": "Andy Hawkins",
    "number": "9",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779157137892x462303103821464450/resize",
    "sha256": "193276db908b0078d60d25d6731a659474f20a9bb4401a4b0695dd885b89275e"
  },
  {
    "cardId": "f291cc47-f89f-4461-b357-59bfccefb221",
    "player": "Mike Kingery",
    "number": "532",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1720464539107x157921304882555620/crop_image",
    "sha256": "4c09b86a8a8cc24863d480e003250ecf3aa0f7bd413511d7068b9450d2b19992"
  },
  {
    "cardId": "f2d8670e-a4fb-458f-95a2-53bb1f8a66a9",
    "player": "Ted Power",
    "number": "236",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779168943627x733020898862911200/resize",
    "sha256": "94252b10d4dcee9c69af3eaf6a49b17189b6732b67a5e4beadd54d7cf324428d"
  },
  {
    "cardId": "f33791f5-5f68-44a8-9065-de4cab0477d7",
    "player": "Pat Clements",
    "number": "484",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1722917819538x519300231728011800/crop_image",
    "sha256": "bf1e30a0d9ec575583b59947160d0cb6e39faa2ea7bc371eb5925abe1b2ed717"
  },
  {
    "cardId": "f34fb9c2-1b62-4796-a722-c92429f2f2d6",
    "player": "Vince Coleman",
    "number": "260",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1735381022344x396265997792040640/crop_image",
    "sha256": "471f0997776bc171d31d2025456d36a213e27e0390f9a01aa5014ac1942f5975"
  },
  {
    "cardId": "f3aaf508-82fa-43de-a863-f28e5e626cfd",
    "player": "Dave Winfield",
    "number": "510",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726596062077x180935874987704360/crop_image",
    "sha256": "d572dcb5e8a48d71e3830ae2c23479212ce44b96a1cefabeab3c08fc9d5ad1fe"
  },
  {
    "cardId": "f3fef49f-78e8-484e-b1da-0f5d55d23695",
    "player": "Scott Sanderson",
    "number": "311",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781463873317x616799198778099800/resize",
    "sha256": "64d6abf07a33f4a29d0f98d227adcf5c82f69a0d02357d6c14680ce52971288f"
  },
  {
    "cardId": "f4757863-7c54-4541-97e6-fd6dd9129c8f",
    "player": "Mike Mason",
    "number": "87",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1723304962532x897734326724563800/crop_image",
    "sha256": "6951f37015bb0490a7f55d8837ed9a64d682d5c1ffcb9429241aeb7c3582e65c"
  },
  {
    "cardId": "f48b60e5-8579-40ea-9360-7c213d274cf0",
    "player": "Matt Nokes",
    "number": "645",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1722912353682x357785594541947900/crop_image",
    "sha256": "faac8745b2ed125578da849a3a58aa02d3bead84df3cf47aae98439cd50348c2"
  },
  {
    "cardId": "f48b9dc3-b4aa-4415-b006-f7b61f01ca24",
    "player": "Lee Guetterman",
    "number": "656",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1783579223700x377954181708014100/resize",
    "sha256": "60bab3cb45bada47bdab9acafa1649780557e68c249c0538e37fa751493fbd49"
  },
  {
    "cardId": "f4b8f6b9-e88e-4bac-bc97-79f66e688f97",
    "player": "Mike Birkbeck",
    "number": "692",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1752281895775x937561176033635700/crop_image",
    "sha256": "954927bea012aad9bbe9887a549e9ce37bbac57309755d0b5dbb8f5ce62c4250"
  },
  {
    "cardId": "f4cd9517-012c-4002-9691-e1caac2a1909",
    "player": "Greg Cadaret",
    "number": "328",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1785223553117x426531587638495400/resize",
    "sha256": "574314a1559b3182a396a361cb8464493f5ed43e9ebcfaba8e388711e70cfc33"
  },
  {
    "cardId": "f5d2b251-e61e-41c4-bc5f-058deeb265e7",
    "player": "Tom Foley",
    "number": "251",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1778601727445x161633106498575200/resize",
    "sha256": "5af96d2ffadb59546c76a2bdde4e39434a75a811f86999044e6acc27ae40a7b5"
  },
  {
    "cardId": "f602eb28-ee37-4fe2-9202-8f64ee7bf32a",
    "player": "Rick Aguilera",
    "number": "434",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781420263316x783262702923538200/resize",
    "sha256": "f2dda451cb11db19f8a462a08b7ba772d8f23c28c2f6ff6953eb1129f161d67f"
  },
  {
    "cardId": "f650f498-1ee4-4500-89cd-38619dacf0a5",
    "player": "Phil Garner",
    "number": "174",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1749761357695x524890344710309950/crop_image",
    "sha256": "7e8247f61545e0b3139e70b5137cfc62d736777ccc35fb230b01f9b5fc9c39cc"
  },
  {
    "cardId": "f6c9a996-f71a-4418-bdbf-11ef1afc72f6",
    "player": "Mike Gallego",
    "number": "702",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1789998633497x863417301716247700/resize",
    "sha256": "05a741fdfc51ee178d24e65c82f99f41fdf164410d3ef343dcb797c728b1061a"
  },
  {
    "cardId": "f7666dd6-4753-42c8-a9cc-05243552828a",
    "player": "Milt Thompson",
    "number": "298",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633998997x630822882898817700/crop_image",
    "sha256": "f4c5bb08fc1d2ccf18c7ae38e4c236d25faab150463900b93fc56c3cc6823265"
  },
  {
    "cardId": "f785859f-b8c8-45ed-b0f4-81879f876cda",
    "player": "Luis Aguayo",
    "number": "356",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1785969848503x866736316883181400/resize",
    "sha256": "2c72e915988705ba70f4dfeb261ee7e31d7821178ff08234d4a734d88f90108a"
  },
  {
    "cardId": "f7e71d08-4c1c-48fe-8660-eb0f26917b9d",
    "player": "Jeff Parrett",
    "number": "588",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1726633995835x864261754137944000/crop_image",
    "sha256": "a49cb1c6b3598de7f8eeaa8435fa99df3268f5c852506616bf954dc395a95f73"
  },
  {
    "cardId": "f87e1879-66d6-49a5-a2a7-5f486da8b92b",
    "player": "Bob Stanley",
    "number": "573",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781602919751x475940504670879800/resize",
    "sha256": "bfd19271e87e7923607c5efe9d168e173adb6ca4387a41601da20445cce6b23e"
  },
  {
    "cardId": "f8ca2267-ea42-460a-9531-c18687363787",
    "player": "Bob Welch",
    "number": "118",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779219642966x963442726053565800/resize",
    "sha256": "5ab75b20383b0b678df76bdf1c2a909b8c8ef8d42e3501a689997add0bf9ef75"
  },
  {
    "cardId": "fb534821-ace9-4961-8c35-e98dca9276ab",
    "player": "Bo Jackson",
    "number": "750",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1720377194150x533921097163179100/crop_image",
    "sha256": "370d75a8921c4a9aa69367d76320bbc13cacdf7b77ce32af20e141ba294cc2fb"
  },
  {
    "cardId": "fbab4223-bfb7-4e6d-ad2d-b39eb262fecb",
    "player": "Paul Kilgus",
    "number": "427",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781419634434x342863999659434700/resize",
    "sha256": "c64b39cf2ae62faedeeadd68c6946cffc5ee9ee8b8c69214c4f6ca48a5c34fae"
  },
  {
    "cardId": "fbbf2c86-0c85-4458-9481-b78c65d9babe",
    "player": "Doug Drabek",
    "number": "591",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1721013696212x516809838254451900/crop_image",
    "sha256": "35ac54c19299c4420790d4c55c864a26cd7d540a772da0103e039e31104287be"
  },
  {
    "cardId": "fc002d13-4914-4e93-b7a4-0c8e436b98fb",
    "player": "Scott Garrelts",
    "number": "97",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1785035481095x630971729477365360/resize",
    "sha256": "edc30d8dc9dccb39d85455c26ebffe2608ec6636bb7281d43c0e9b953be8803f"
  },
  {
    "cardId": "fc440551-583f-447c-b69d-d427475c0cb3",
    "player": "Larry Sheets",
    "number": "327",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779167066670x625057708799865000/resize",
    "sha256": "73cd76409462484baae7cb5bfb4d689e31c65ad86ed538bd8608d030cfcbc0b8"
  },
  {
    "cardId": "fcaf4f05-704e-4a45-92cc-803c7d7576e3",
    "player": "Lonnie Smith",
    "number": "777",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1779165583140x130898504167810350/resize",
    "sha256": "165ee3e8496e512550d221b6be03540ef193a0ab323e17521e5d7cb275edf775"
  },
  {
    "cardId": "fd5b9211-eb50-4c09-bf65-853ad6646353",
    "player": "Brian Fisher",
    "number": "193",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1764169281566x285207530756900400/crop_image",
    "sha256": "ec2d18c7081948a17c7b033f1168d03ead3d5d47372e9f01756249120c310f6a"
  },
  {
    "cardId": "fe739f08-4d25-4c14-b352-d1c743bb8d9f",
    "player": "Kurt Stillwell",
    "number": "339",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1781611043226x644084483135638700/resize",
    "sha256": "7aaf82f6419da1e89fc26d2930d28a20507f0e516ffeddc30635e63810b58cc2"
  },
  {
    "cardId": "ff9aa828-85da-4b61-8f5f-707a3e240aef",
    "player": "Dan Quisenberry",
    "number": "195",
    "imageUrl": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1785547687783x556748692832975700/resize",
    "sha256": "b807a6813b511a819377c32d25ac5b36f51a89f664b71a8113c8e4283410c8c8"
  }
];
export function isTopps1988Plan(plan: unknown): boolean {
  if (!plan || typeof plan !== "object") return false;
  const p = plan as { layoutClass?: string; regions?: MaskRegion[] };
  return p.layoutClass === "BOTTOM_PLAQUE" && Array.isArray(p.regions)
    && p.regions.length === TOPPS_1988_REGIONS.length
    && p.regions.every((r, i) => {
      const expected = TOPPS_1988_REGIONS[i];
      return r.type === expected.type && r.radiusPct === 0
        && ["xPct", "yPct", "wPct", "hPct"].every((key) =>
          Math.abs(Number(r[key as keyof MaskRegion]) - Number(expected[key as keyof MaskRegion])) < 1e-8);
    });
}
