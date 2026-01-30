export interface MaskProfile {
  topBandPct: number;
  bottomBandPct: number;
  leftBandPct: number;
  rightBandPct: number;
  blurSigma?: number;
}

const defaultProfile: MaskProfile = {
  topBandPct: 0.18,
  bottomBandPct: 0.22,
  leftBandPct: 0.0,
  rightBandPct: 0.0,
  blurSigma: 15,
};

const setProfiles: Record<string, MaskProfile> = {
  "1987 Topps": {
    topBandPct: 0.20,
    bottomBandPct: 0.25,
    leftBandPct: 0.0,
    rightBandPct: 0.0,
    blurSigma: 15,
  },
  "1989 Upper Deck": {
    topBandPct: 0.15,
    bottomBandPct: 0.20,
    leftBandPct: 0.0,
    rightBandPct: 0.0,
    blurSigma: 15,
  },
  "1952 Topps": {
    topBandPct: 0.12,
    bottomBandPct: 0.35,
    leftBandPct: 0.0,
    rightBandPct: 0.0,
    blurSigma: 15,
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

export const CURRENT_MASK_VERSION = "v2.0";
