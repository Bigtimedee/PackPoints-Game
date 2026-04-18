export interface MaskProfile {
  topBandPct: number;
  bottomBandPct: number;
  leftBandPct: number;
  rightBandPct: number;
  blurSigma?: number;
}

const defaultProfile: MaskProfile = {
  topBandPct: 0.0,
  bottomBandPct: 0.18,
  leftBandPct: 0.0,
  rightBandPct: 0.0,
  blurSigma: 25,
};

const setProfiles: Record<string, MaskProfile> = {
  "1987 Topps": {
    topBandPct: 0.0,
    bottomBandPct: 0.22,
    leftBandPct: 0.0,
    rightBandPct: 0.0,
    blurSigma: 25,
  },
  "1989 Upper Deck": {
    topBandPct: 0.0,
    bottomBandPct: 0.18,
    leftBandPct: 0.0,
    rightBandPct: 0.0,
    blurSigma: 25,
  },
  "1952 Topps": {
    topBandPct: 0.0,
    bottomBandPct: 0.28,
    leftBandPct: 0.0,
    rightBandPct: 0.0,
    blurSigma: 25,
  },
};

export function getMaskProfile(setName: string | null | undefined): MaskProfile {
  if (!setName) return defaultProfile;
  
  const normalizedSetName = setName.trim();
  
  if (setProfiles[normalizedSetName]) {
    return setProfiles[normalizedSetName];
  }
  
  for (const [key, profile] of Object.entries(setProfiles)) {
    if (normalizedSetName.toLowerCase().includes(key.toLowerCase())) {
      return profile;
    }
  }
  
  return defaultProfile;
}

export const CURRENT_MASK_VERSION = "v3.0";
