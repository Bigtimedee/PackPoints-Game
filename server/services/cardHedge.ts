import { VERIFIED_1987_TOPPS_IMAGES } from "./priceCharting";

const CARDHEDGE_BASE_URL = "https://api.cardhedger.com/v1/cards";

interface CardHedgeCard {
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
  rookie?: boolean;
  prices?: Array<{ grade: string; price: string }>;
}

interface CardHedgeSearchResponse {
  cards: CardHedgeCard[];
}

export interface CardImageResult {
  playerName: string;
  imageUrl: string | null;
  source: "cardhedge" | "verified" | "fallback";
  verified: boolean;
}

function normalizeImageUrl(url: string | undefined): string | null {
  if (!url) return null;
  return url.startsWith("//") ? `https:${url}` : url;
}

function isStableCdnUrl(url: string): boolean {
  const stablePatterns = [
    "s3.amazonaws.com/appforest_uf",
    "cdn.bubble.io",
    "bubble.io/d112",
  ];
  return stablePatterns.some(pattern => url.includes(pattern));
}

export async function searchCardHedge(
  playerName: string,
  setName: string = "1987 Topps Baseball"
): Promise<CardHedgeCard[]> {
  const apiKey = process.env.CARDHEDGE_API_KEY;
  
  if (!apiKey) {
    console.log("CARDHEDGE_API_KEY not set, skipping Card Hedge search");
    return [];
  }
  
  try {
    const response = await fetch(`${CARDHEDGE_BASE_URL}/card-search`, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        search: playerName,
        set: setName,
        category: "Baseball",
        page_size: 10,
      }),
    });
    
    if (!response.ok) {
      console.error(`Card Hedge API error: ${response.status} ${response.statusText}`);
      return [];
    }
    
    const data: CardHedgeSearchResponse = await response.json();
    return data.cards || [];
  } catch (error) {
    console.error(`Error searching Card Hedge for ${playerName}:`, error);
    return [];
  }
}

export async function getCardImage(
  playerName: string,
  cardNumber: string
): Promise<CardImageResult> {
  if (VERIFIED_1987_TOPPS_IMAGES[playerName]) {
    return {
      playerName,
      imageUrl: VERIFIED_1987_TOPPS_IMAGES[playerName],
      source: "verified",
      verified: true,
    };
  }
  
  const apiKey = process.env.CARDHEDGE_API_KEY;
  
  if (apiKey) {
    const cards = await searchCardHedge(playerName, "1987 Topps Baseball");
    
    for (const card of cards) {
      const imageUrl = normalizeImageUrl(card.image);
      if (imageUrl && isStableCdnUrl(imageUrl)) {
        console.log(`Found stable Card Hedge image for ${playerName}: ${imageUrl}`);
        return {
          playerName,
          imageUrl,
          source: "cardhedge",
          verified: true,
        };
      }
    }
    
    if (cards.length > 0 && cards[0].image) {
      const imageUrl = normalizeImageUrl(cards[0].image);
      console.log(`Found Card Hedge image for ${playerName} (unverified CDN): ${imageUrl}`);
      return {
        playerName,
        imageUrl,
        source: "cardhedge",
        verified: false,
      };
    }
  }
  
  return {
    playerName,
    imageUrl: null,
    source: "fallback",
    verified: false,
  };
}

export async function fetch1987ToppsFromCardHedge(
  players: Array<{ playerName: string; cardNumber: string }>
): Promise<Map<string, CardImageResult>> {
  const results = new Map<string, CardImageResult>();
  
  console.log(`Fetching images for ${players.length} players...`);
  
  for (const player of players) {
    const result = await getCardImage(player.playerName, player.cardNumber);
    results.set(player.playerName, result);
    
    if (process.env.CARDHEDGE_API_KEY) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  
  const verified = Array.from(results.values()).filter(r => r.verified).length;
  const fromCardHedge = Array.from(results.values()).filter(r => r.source === "cardhedge").length;
  
  console.log(`Fetched ${results.size} cards: ${verified} verified, ${fromCardHedge} from Card Hedge`);
  
  return results;
}

export function isCardHedgeConfigured(): boolean {
  return !!process.env.CARDHEDGE_API_KEY;
}
