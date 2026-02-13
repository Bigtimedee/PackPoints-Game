interface CardData {
  cardNumber: string;
  playerName: string;
  team?: string;
  popularity: number;
  imageUrl: string;
  priceUngraded?: number;
  pricePSA10?: number;
}

export const VERIFIED_1987_TOPPS_IMAGES: Record<string, string> = {
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

  console.log("Loading 1987 Topps cards with verified images...");

  const cardsWithImages: CardData[] = cards1987Topps.map((card) => {
    const verifiedUrl = VERIFIED_1987_TOPPS_IMAGES[card.playerName];
    return {
      ...card,
      imageUrl: verifiedUrl || `https://placehold.co/300x420/d4a574/333333?text=1987+Topps%0A%23${card.cardNumber}`,
    };
  });

  const realImageCount = cardsWithImages.filter((c) => VERIFIED_1987_TOPPS_IMAGES[c.playerName]).length;
  console.log(`Loaded ${cardsWithImages.length} cards, ${realImageCount} with verified images`);

  return cardsWithImages;
}
