/**
 * Supplier-image GET used by the held exact-source import.
 * Host allowlist, DNS private-address refusal, no redirects, and a streaming
 * byte cap. The body is not buffered past the cap.
 */
import { lookup as dnsLookup } from "dns/promises";
import { withSourceFetchTimeout } from "./sourceFetch";

export const IMPORT_IMAGE_MAX_BYTES = 2_000_000;

/** Same hosts the image proxy already trusts. Match is exact or a subdomain. */
export const APPROVED_SUPPLIER_IMAGE_HOSTS = [
  "s3.amazonaws.com",
  "cdn.bubble.io",
  "bubble.io",
  "cardhedger.com",
  "comc.com",
  "ebayimg.com",
] as const;

export function isApprovedSupplierImageHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, "");
  return APPROVED_SUPPLIER_IMAGE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function ipv4Private(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

export function isPrivateAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (ip === "localhost" || ip.endsWith(".localhost")) return true;
  if (ip === "::1" || ip === "::") return true;
  if (ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) return true;
  const v4 = ip.startsWith("::ffff:") ? ip.slice("::ffff:".length) : ip;
  return ipv4Private(v4);
}

export interface ImportFetchDeps {
  lookup?: (hostname: string) => Promise<{ address: string }[]>;
  fetchImpl?: typeof fetch;
}

async function readCapped(response: Response): Promise<Buffer | null> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > IMPORT_IMAGE_MAX_BYTES) return null;
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const step = await reader.read();
      if (step.done) break;
      total += step.value.byteLength;
      if (total > IMPORT_IMAGE_MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(step.value));
    }
  } catch {
    return null;
  }
  if (total < 1) return null;
  return Buffer.concat(chunks);
}

export async function fetchImportImage(url: string, deps?: ImportFetchDeps): Promise<Buffer | null> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== "https:") return null;
  const hostname = parsed.hostname.toLowerCase();
  if (!isApprovedSupplierImageHost(hostname) || isPrivateAddress(hostname)) return null;
  const lookup = deps?.lookup ?? (async (host: string) => {
    const rows = await dnsLookup(host, { all: true, verbatim: true });
    return rows.map((row) => ({ address: row.address }));
  });
  let addresses: { address: string }[];
  try { addresses = await lookup(hostname); } catch { return null; }
  if (addresses.length === 0 || addresses.some((row) => isPrivateAddress(row.address))) return null;
  const fetchImpl = deps?.fetchImpl ?? fetch;
  try {
    return await withSourceFetchTimeout(async (signal) => {
      const response = await fetchImpl(url, { signal, redirect: "manual", headers: { "User-Agent": "PackPTS/1.0" } });
      if (!response.ok || response.status >= 300) return null;
      return readCapped(response);
    }, 10_000);
  } catch {
    return null;
  }
}
