interface PriceChartingProduct {
  id: string;
  "product-name": string;
  "console-name": string;
  "loose-price"?: number;
  "cib-price"?: number;
  "new-price"?: number;
}

interface PriceChartingSearchResponse {
  status: string;
  products?: PriceChartingProduct[];
  error?: string;
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

const BASE_URL = "https://www.pricecharting.com/api/";

function buildCardImageUrl(cardNumber: string, playerName: string): string {
  // Use placeholder images with card styling
  // The actual 1987 Topps cards have a distinctive wood-grain border
  const encodedName = encodeURIComponent(playerName);
  
  // Use picsum for placeholder baseball card images
  // Seed based on card number for consistent images per card
  const seed = parseInt(cardNumber, 10) || 1;
  return `https://picsum.photos/seed/${seed}/300/420`;
}

function extractCardNumber(productName: string): string | null {
  const match = productName.match(/#(\d+)/);
  return match ? match[1] : null;
}

function extractPlayerName(productName: string): string {
  return productName.replace(/#\d+\s*-?\s*/, "").trim();
}

function calculatePopularity(productName: string, loosePrice?: number, newPrice?: number): number {
  const starPlayers = [
    "barry bonds", "mark mcgwire", "bo jackson", "roger clemens",
    "kirby puckett", "cal ripken", "don mattingly", "dwight gooden",
    "jose canseco", "darryl strawberry", "wade boggs", "ryne sandberg",
    "tony gwynn", "nolan ryan", "ozzie smith", "andre dawson",
    "mike schmidt", "gary carter", "rickey henderson", "greg maddux",
    "barry larkin", "rafael palmeiro", "robin yount", "eric davis"
  ];
  
  const lowerName = productName.toLowerCase();
  
  for (const star of starPlayers) {
    if (lowerName.includes(star)) {
      return 70 + Math.floor(Math.random() * 28);
    }
  }
  
  if (newPrice && newPrice > 50000) {
    return 80 + Math.floor(Math.random() * 18);
  }
  if (loosePrice && loosePrice > 5000) {
    return 60 + Math.floor(Math.random() * 25);
  }
  
  return 25 + Math.floor(Math.random() * 40);
}

export async function fetch1987ToppsCards(): Promise<CardData[]> {
  const token = process.env.PRICECHARTING_API_TOKEN;
  
  if (!token) {
    console.log("PriceCharting API token not configured, using fallback data");
    return getFallbackCards();
  }
  
  try {
    const response = await fetch(
      `${BASE_URL}products?t=${token}&q=1987+topps+baseball`,
      {
        method: "GET",
        headers: {
          "Accept": "application/json",
        },
      }
    );
    
    if (!response.ok) {
      console.error("PriceCharting API error:", response.status);
      return getFallbackCards();
    }
    
    const data: PriceChartingSearchResponse = await response.json();
    
    if (data.status !== "success" || !data.products) {
      console.error("PriceCharting API returned error:", data.error);
      return getFallbackCards();
    }
    
    const cards: CardData[] = [];
    
    for (const product of data.products) {
      if (!product["console-name"]?.includes("1987") || 
          !product["console-name"]?.toLowerCase().includes("topps")) {
        continue;
      }
      
      const cardNumber = extractCardNumber(product["product-name"]);
      if (!cardNumber) continue;
      
      const playerName = extractPlayerName(product["product-name"]);
      if (!playerName) continue;
      
      cards.push({
        cardNumber,
        playerName,
        popularity: calculatePopularity(
          product["product-name"], 
          product["loose-price"],
          product["new-price"]
        ),
        imageUrl: buildCardImageUrl(cardNumber, playerName),
        priceUngraded: product["loose-price"],
        pricePSA10: product["new-price"],
      });
    }
    
    console.log(`Fetched ${cards.length} cards from PriceCharting API`);
    return cards.length > 0 ? cards : getFallbackCards();
    
  } catch (error) {
    console.error("Error fetching from PriceCharting:", error);
    return getFallbackCards();
  }
}

function getFallbackCards(): CardData[] {
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
  
  return cards1987Topps.map(card => ({
    ...card,
    imageUrl: buildCardImageUrl(card.cardNumber, card.playerName),
  }));
}
