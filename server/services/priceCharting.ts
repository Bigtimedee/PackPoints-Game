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
  "Wade Boggs": "https://i.ebayimg.com/images/g/nNkAAOSwqHJlGK0~/s-l400.jpg",
  "Ryne Sandberg": "https://i.ebayimg.com/images/g/xCEAAOSwYEZkh1yT/s-l400.jpg",
  "Tony Gwynn": "https://i.ebayimg.com/images/g/0iMAAOSwYNNlGLBK/s-l400.jpg",
  "Nolan Ryan": "https://i.ebayimg.com/images/g/fFoAAOSwSfFlGK9g/s-l400.jpg",
  "Ozzie Smith": "https://i.ebayimg.com/images/g/ywoAAOSwKh1lGLEz/s-l400.jpg",
  "Mike Schmidt": "https://i.ebayimg.com/images/g/TxMAAOSwuT9lGK8O/s-l400.jpg",
  "Rickey Henderson": "https://i.ebayimg.com/images/g/pKQAAOSwYCRlGLGJ/s-l400.jpg",
  "George Brett": "https://i.ebayimg.com/images/g/cL0AAOSwIk1lGK1j/s-l400.jpg",
  "Eddie Murray": "https://i.ebayimg.com/images/g/T-oAAOSwWVhlGLCq/s-l400.jpg",
  "Dave Winfield": "https://i.ebayimg.com/images/g/9IgAAOSwvt9lGLH7/s-l400.jpg",
  "Gary Carter": "https://i.ebayimg.com/images/g/nMUAAOSwUallGK0B/s-l400.jpg",
  "Andre Dawson": "https://i.ebayimg.com/images/g/r5UAAOSwRmVlGLAh/s-l400.jpg",
  "Eric Davis": "https://i.ebayimg.com/images/g/H3kAAOSwl1FlGLBu/s-l400.jpg",
  "Robin Yount": "https://i.ebayimg.com/images/g/JlcAAOSwD~llGLHR/s-l400.jpg",
  "Carlton Fisk": "https://i.ebayimg.com/images/g/I-UAAOSwkBBlGLGy/s-l400.jpg",
  "Reggie Jackson": "https://i.ebayimg.com/images/g/dckAAOSwM~tlGK2B/s-l400.jpg",
  "Pete Rose": "https://i.ebayimg.com/images/g/hLQAAOSwbFBlGK0m/s-l400.jpg",
  "Paul Molitor": "https://i.ebayimg.com/images/g/C~UAAOSwqnJlGLFN/s-l400.jpg",
  "Alan Trammell": "https://i.ebayimg.com/images/g/5HIAAOSwC-BlGLIR/s-l400.jpg",
  "Steve Carlton": "https://i.ebayimg.com/images/g/aVMAAOSwBRJlGK13/s-l400.jpg",
  "Tom Seaver": "https://i.ebayimg.com/images/g/nKAAAOSwGrRlGLII/s-l400.jpg",
  "Will Clark": "https://i.ebayimg.com/images/g/jvMAAOSw6ullGLAH/s-l400.jpg",
  "Barry Larkin": "https://i.ebayimg.com/images/g/XqsAAOSwO3FlGLBB/s-l400.jpg",
  "Rafael Palmeiro": "https://i.ebayimg.com/images/g/0hYAAOSwJbNlGLBX/s-l400.jpg",
  "Keith Hernandez": "https://i.ebayimg.com/images/g/lkkAAOSwS5llGLDq/s-l400.jpg",
  "Dale Murphy": "https://i.ebayimg.com/images/g/kpEAAOSwwC5lGLCO/s-l400.jpg",
  "Fernando Valenzuela": "https://i.ebayimg.com/images/g/bS8AAOSwI4RlGLDC/s-l400.jpg",
  "Dennis Eckersley": "https://i.ebayimg.com/images/g/gZ8AAOSwjJ5lGLB6/s-l400.jpg",
  "Jack Morris": "https://i.ebayimg.com/images/g/5zYAAOSwOHJlGLEH/s-l400.jpg",
  "Lou Whitaker": "https://i.ebayimg.com/images/g/bYAAAOSwy3RlGLEd/s-l400.jpg",
  "Tim Raines": "https://i.ebayimg.com/images/g/SH4AAOSwYDJlGLG5/s-l400.jpg",
  "Orel Hershiser": "https://i.ebayimg.com/images/g/C04AAOSw8CplGLDE/s-l400.jpg",
  "Harold Baines": "https://i.ebayimg.com/images/g/BbQAAOSwNhJlGK~~/s-l400.jpg",
  "Jim Rice": "https://i.ebayimg.com/images/g/mBYAAOSwO6plGLEm/s-l400.jpg",
  "Dave Parker": "https://i.ebayimg.com/images/g/x4EAAOSwPcxlGLFa/s-l400.jpg",
  "Bret Saberhagen": "https://i.ebayimg.com/images/g/BjQAAOSwx69lGLCc/s-l400.jpg",
  "Jesse Barfield": "https://i.ebayimg.com/images/g/YloAAOSwvMBlGK~8/s-l400.jpg",
  "Juan Samuel": "https://i.ebayimg.com/images/g/lBgAAOSwUH1lGLFC/s-l400.jpg",
  "Kevin Bass": "https://i.ebayimg.com/images/g/kAsAAOSwB1BlGLAT/s-l400.jpg",
  "Bobby Bonilla": "https://i.ebayimg.com/images/g/7gQAAOSwDrdlGK~j/s-l400.jpg",
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
    { cardNumber: "320", playerName: "Barry Bonds", team: "Pirates", popularity: 95 },
    { cardNumber: "366", playerName: "Mark McGwire", team: "Athletics", popularity: 92 },
    { cardNumber: "170", playerName: "Bo Jackson", team: "Royals", popularity: 88 },
    { cardNumber: "340", playerName: "Roger Clemens", team: "Red Sox", popularity: 85 },
    { cardNumber: "450", playerName: "Kirby Puckett", team: "Twins", popularity: 82 },
    { cardNumber: "784", playerName: "Cal Ripken Jr", team: "Orioles", popularity: 90 },
    { cardNumber: "500", playerName: "Don Mattingly", team: "Yankees", popularity: 78 },
    { cardNumber: "130", playerName: "Dwight Gooden", team: "Mets", popularity: 75 },
    { cardNumber: "620", playerName: "Jose Canseco", team: "Athletics", popularity: 80 },
    { cardNumber: "460", playerName: "Darryl Strawberry", team: "Mets", popularity: 72 },
    { cardNumber: "150", playerName: "Wade Boggs", team: "Red Sox", popularity: 77 },
    { cardNumber: "680", playerName: "Ryne Sandberg", team: "Cubs", popularity: 76 },
    { cardNumber: "530", playerName: "Tony Gwynn", team: "Padres", popularity: 79 },
    { cardNumber: "757", playerName: "Nolan Ryan", team: "Astros", popularity: 91 },
    { cardNumber: "749", playerName: "Ozzie Smith", team: "Cardinals", popularity: 74 },
    { cardNumber: "430", playerName: "Mike Schmidt", team: "Phillies", popularity: 83 },
    { cardNumber: "735", playerName: "Rickey Henderson", team: "Yankees", popularity: 86 },
    { cardNumber: "400", playerName: "George Brett", team: "Royals", popularity: 84 },
    { cardNumber: "120", playerName: "Eddie Murray", team: "Orioles", popularity: 81 },
    { cardNumber: "770", playerName: "Dave Winfield", team: "Yankees", popularity: 80 },
    { cardNumber: "20", playerName: "Gary Carter", team: "Mets", popularity: 70 },
    { cardNumber: "345", playerName: "Andre Dawson", team: "Cubs", popularity: 68 },
    { cardNumber: "412", playerName: "Eric Davis", team: "Reds", popularity: 67 },
    { cardNumber: "773", playerName: "Robin Yount", team: "Brewers", popularity: 73 },
    { cardNumber: "756", playerName: "Carlton Fisk", team: "White Sox", popularity: 71 },
    { cardNumber: "300", playerName: "Reggie Jackson", team: "Angels", popularity: 69 },
    { cardNumber: "30", playerName: "Pete Rose", team: "Reds", popularity: 66 },
    { cardNumber: "741", playerName: "Paul Molitor", team: "Brewers", popularity: 72 },
    { cardNumber: "687", playerName: "Alan Trammell", team: "Tigers", popularity: 65 },
    { cardNumber: "718", playerName: "Steve Carlton", team: "Phillies", popularity: 64 },
    { cardNumber: "425", playerName: "Tom Seaver", team: "Red Sox", popularity: 63 },
    { cardNumber: "420", playerName: "Will Clark", team: "Giants", popularity: 70 },
    { cardNumber: "648", playerName: "Barry Larkin", team: "Reds", popularity: 65 },
    { cardNumber: "634", playerName: "Rafael Palmeiro", team: "Cubs", popularity: 62 },
    { cardNumber: "350", playerName: "Keith Hernandez", team: "Mets", popularity: 60 },
    { cardNumber: "490", playerName: "Dale Murphy", team: "Braves", popularity: 68 },
    { cardNumber: "410", playerName: "Fernando Valenzuela", team: "Dodgers", popularity: 66 },
    { cardNumber: "459", playerName: "Dennis Eckersley", team: "Cubs", popularity: 64 },
    { cardNumber: "250", playerName: "Jack Morris", team: "Tigers", popularity: 61 },
    { cardNumber: "661", playerName: "Lou Whitaker", team: "Tigers", popularity: 58 },
    { cardNumber: "565", playerName: "Tim Raines", team: "Expos", popularity: 67 },
    { cardNumber: "385", playerName: "Orel Hershiser", team: "Dodgers", popularity: 63 },
    { cardNumber: "515", playerName: "Harold Baines", team: "White Sox", popularity: 55 },
    { cardNumber: "480", playerName: "Jim Rice", team: "Red Sox", popularity: 62 },
    { cardNumber: "690", playerName: "Dave Parker", team: "Reds", popularity: 57 },
    { cardNumber: "140", playerName: "Bret Saberhagen", team: "Royals", popularity: 60 },
    { cardNumber: "285", playerName: "Jesse Barfield", team: "Blue Jays", popularity: 52 },
    { cardNumber: "281", playerName: "Juan Samuel", team: "Phillies", popularity: 48 },
    { cardNumber: "99", playerName: "Kevin Bass", team: "Astros", popularity: 45 },
    { cardNumber: "163", playerName: "Bobby Bonilla", team: "Pirates", popularity: 55 },
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
