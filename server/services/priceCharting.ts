interface CardData {
  cardNumber: string;
  playerName: string;
  team?: string;
  popularity: number;
  imageUrl: string;
  priceUngraded?: number;
  pricePSA10?: number;
}

const KNOWN_1987_TOPPS_IMAGES: Record<string, string> = {
  "Barry Bonds": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1714517605533x170588580984074580/resized_20240430_225325.jpeg",
  "Mark McGwire": "https://s3.amazonaws.com/appforest_uf/f1605713458475x258158576803796380/1987-Mark-McGwire-Topps-366.jpg",
  "Bo Jackson": "https://s3.amazonaws.com/appforest_uf/f1624996844812x333042354901292200/1987-Bo-Jackson-Topps-170.jpg",
  "Roger Clemens": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1682894394939x310405002857845320/s-l500%20%2881%29.jpg?q=75",
  "Kirby Puckett": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1725339986881x466426243871636030/resized_20240903_050626.jpeg",
  "Cal Ripken Jr": "https://s3.amazonaws.com/appforest_uf/f1635617781278x125903191489265870/Cal-Ripken-1987-Topps-784.jpg",
  "Don Mattingly": "https://s3.amazonaws.com/appforest_uf/f1635044481954x343967285250973900/Don-Mattingly-1988-Topps-500.jpg",
  "Dwight Gooden": "https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/d112/f1698068218701x647996274860716000/resized_20231023_133658.jpeg",
  "Jose Canseco": "https://s3.amazonaws.com/appforest_uf/d112/f1661918158802x393434757784570700/1987-Jose-Canseco-Topps.jpg",
  "Darryl Strawberry": "https://s3.amazonaws.com/appforest_uf/f1635617599853x915699631198391200/Darryl-Strawberry-1987-Topps-460.jpg",
};

const ZYLA_BASE_URL = "https://zylalabs.com/api/2511/sports+card+and+trading+card+api/2494/card+search";

interface ZylaCardResponse {
  description?: string;
  player?: string;
  set?: string;
  number?: string;
  variant?: string;
  card_id?: string;
  image?: string;
  category?: string;
  category_group?: string;
  set_type?: string;
}

let cachedZylaCards: Map<string, string> = new Map();

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchZylaCardImage(playerName: string, cardNumber: string): Promise<string | null> {
  if (KNOWN_1987_TOPPS_IMAGES[playerName]) {
    return KNOWN_1987_TOPPS_IMAGES[playerName];
  }
  
  const apiKey = process.env.ZYLA_API_KEY;
  
  if (!apiKey) {
    return null;
  }
  
  const cacheKey = `${playerName}-${cardNumber}`;
  if (cachedZylaCards.has(cacheKey)) {
    return cachedZylaCards.get(cacheKey) || null;
  }
  
  try {
    await sleep(500);
    
    const searchQuery = encodeURIComponent(`1987 Topps ${playerName}`);
    const response = await fetch(
      `${ZYLA_BASE_URL}?search=${searchQuery}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Accept": "application/json",
        },
      }
    );
    
    if (!response.ok) {
      if (response.status === 429) {
        console.log(`Zyla API rate limited for ${playerName}, using placeholder`);
      } else {
        console.error(`Zyla API error for ${playerName}:`, response.status);
      }
      return null;
    }
    
    const data: ZylaCardResponse[] = await response.json();
    
    if (Array.isArray(data) && data.length > 0) {
      for (const card of data) {
        if (card.image && card.set?.includes("1987") && card.set?.includes("Topps")) {
          const imageUrl = card.image.startsWith("//") 
            ? `https:${card.image}` 
            : card.image;
          cachedZylaCards.set(cacheKey, imageUrl);
          return imageUrl;
        }
      }
      if (data[0].image) {
        const imageUrl = data[0].image.startsWith("//") 
          ? `https:${data[0].image}` 
          : data[0].image;
        cachedZylaCards.set(cacheKey, imageUrl);
        return imageUrl;
      }
    }
    
    return null;
  } catch (error) {
    console.error(`Error fetching Zyla image for ${playerName}:`, error);
    return null;
  }
}

export async function fetch1987ToppsCards(): Promise<CardData[]> {
  const cards1987Topps = [
    { cardNumber: "320", playerName: "Barry Bonds", popularity: 95 },
    { cardNumber: "366", playerName: "Mark McGwire", popularity: 92 },
    { cardNumber: "170", playerName: "Bo Jackson", popularity: 88 },
    { cardNumber: "340", playerName: "Roger Clemens", popularity: 85 },
    { cardNumber: "450", playerName: "Kirby Puckett", popularity: 82 },
    { cardNumber: "784", playerName: "Cal Ripken Jr", popularity: 90 },
    { cardNumber: "500", playerName: "Don Mattingly", popularity: 78 },
    { cardNumber: "130", playerName: "Dwight Gooden", popularity: 75 },
    { cardNumber: "620", playerName: "Jose Canseco", popularity: 80 },
    { cardNumber: "460", playerName: "Darryl Strawberry", popularity: 72 },
    { cardNumber: "150", playerName: "Wade Boggs", popularity: 77 },
    { cardNumber: "680", playerName: "Ryne Sandberg", popularity: 76 },
    { cardNumber: "530", playerName: "Tony Gwynn", popularity: 79 },
    { cardNumber: "757", playerName: "Nolan Ryan", popularity: 91 },
    { cardNumber: "749", playerName: "Ozzie Smith", popularity: 74 },
    { cardNumber: "345", playerName: "Andre Dawson", popularity: 68 },
    { cardNumber: "430", playerName: "Mike Schmidt", popularity: 83 },
    { cardNumber: "20", playerName: "Gary Carter", popularity: 70 },
    { cardNumber: "735", playerName: "Rickey Henderson", popularity: 86 },
    { cardNumber: "648", playerName: "Barry Larkin", popularity: 65 },
    { cardNumber: "634", playerName: "Rafael Palmeiro", popularity: 62 },
    { cardNumber: "718", playerName: "Steve Carlton", popularity: 71 },
    { cardNumber: "380", playerName: "Rich Gossage", popularity: 55 },
    { cardNumber: "790", playerName: "Julio Franco", popularity: 52 },
    { cardNumber: "115", playerName: "Mookie Wilson", popularity: 48 },
    { cardNumber: "281", playerName: "Juan Samuel", popularity: 42 },
    { cardNumber: "186", playerName: "Bruce Hurst", popularity: 38 },
    { cardNumber: "355", playerName: "Don Carman", popularity: 35 },
    { cardNumber: "412", playerName: "Eric Davis", popularity: 67 },
    { cardNumber: "773", playerName: "Robin Yount", popularity: 73 },
  ];
  
  console.log("Loading 1987 Topps cards with cached and API images...");
  
  const cardsWithImages: CardData[] = [];
  let realImageCount = 0;
  
  for (const card of cards1987Topps) {
    const imageUrl = await fetchZylaCardImage(card.playerName, card.cardNumber);
    
    if (imageUrl) {
      realImageCount++;
      cardsWithImages.push({
        ...card,
        imageUrl,
      });
    } else {
      cardsWithImages.push({
        ...card,
        imageUrl: `https://placehold.co/300x420/d4a574/333333?text=1987+Topps%0A%23${card.cardNumber}`,
      });
    }
  }
  
  console.log(`Loaded ${cardsWithImages.length} cards, ${realImageCount} with real images`);
  
  return cardsWithImages;
}
