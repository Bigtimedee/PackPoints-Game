export interface TikTokConfig {
  enabled: boolean;
  mode: "manual" | "off";
}

export function getTikTokConfig(): TikTokConfig {
  const enabled = process.env.GROWTH_TIKTOK_ENABLED === "true";
  const rawMode = (process.env.GROWTH_TIKTOK_MODE || "manual").toLowerCase();
  const mode = rawMode === "off" ? "off" : "manual";

  return {
    enabled: enabled && mode !== "off",
    mode: enabled ? mode : "off",
  };
}

export function isTikTokEnabled(): boolean {
  return getTikTokConfig().enabled;
}
