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

interface CardData {
  cardNumber: string;
  playerName: string;
  team?: string;
  popularity: number;
  imageUrl: string;
  priceUngraded?: number;
  pricePSA10?: number;
}

const ZYLA_BASE_URL = "https://zylalabs.com/api/2511/sports+card+and+trading+card+api/2494/card+search";

let cachedZylaCards: Map<string, string> = new Map();
let lastZylaFetch = 0;
const ZYLA_CACHE_DURATION = 3600000;

async function fetchZylaCardImage(playerName: string, cardNumber: string): Promise<string | null> {
  const apiKey = process.env.ZYLA_API_KEY;
  
  if (!apiKey) {
    return null;
  }
  
  const cacheKey = `${playerName}-${cardNumber}`;
  if (cachedZylaCards.has(cacheKey)) {
    return cachedZylaCards.get(cacheKey) || null;
  }
  
  try {
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
      console.error(`Zyla API error for ${playerName}:`, response.status);
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

function calculatePopularity(playerName: string): number {
  const starPlayers = [
    "barry bonds", "mark mcgwire", "bo jackson", "roger clemens",
    "kirby puckett", "cal ripken", "don mattingly", "dwight gooden",
    "jose canseco", "darryl strawberry", "wade boggs", "ryne sandberg",
    "tony gwynn", "nolan ryan", "ozzie smith", "andre dawson",
    "mike schmidt", "gary carter", "rickey henderson", "greg maddux",
    "barry larkin", "rafael palmeiro", "robin yount", "eric davis"
  ];
  
  const lowerName = playerName.toLowerCase();
  
  for (const star of starPlayers) {
    if (lowerName.includes(star)) {
      return 70 + Math.floor(Math.random() * 28);
    }
  }
  
  return 25 + Math.floor(Math.random() * 40);
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
  
  const apiKey = process.env.ZYLA_API_KEY;
  
  if (!apiKey) {
    console.log("Zyla API key not configured, using placeholder images");
    return cards1987Topps.map(card => ({
      ...card,
      imageUrl: `https://placehold.co/300x420/d4a574/333333?text=1987+Topps%0A%23${card.cardNumber}`,
    }));
  }
  
  console.log("Fetching 1987 Topps card images from Zyla API...");
  
  const cardsWithImages: CardData[] = [];
  
  for (const card of cards1987Topps.slice(0, 10)) {
    const imageUrl = await fetchZylaCardImage(card.playerName, card.cardNumber);
    
    cardsWithImages.push({
      ...card,
      imageUrl: imageUrl || `https://placehold.co/300x420/d4a574/333333?text=1987+Topps%0A%23${card.cardNumber}`,
    });
  }
  
  for (const card of cards1987Topps.slice(10)) {
    cardsWithImages.push({
      ...card,
      imageUrl: `https://placehold.co/300x420/d4a574/333333?text=1987+Topps%0A%23${card.cardNumber}`,
    });
  }
  
  console.log(`Loaded ${cardsWithImages.length} cards, ${cardsWithImages.filter(c => !c.imageUrl.includes('placehold')).length} with real images`);
  
  return cardsWithImages;
}
