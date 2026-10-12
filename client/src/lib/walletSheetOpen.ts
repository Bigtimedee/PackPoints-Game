import { useSyncExternalStore } from "react";
// Lets the app shell hide the feedback chat bubble while the wallet sheet is open.
let open = false;
const listeners = new Set<() => void>();
export function setWalletSheetOpen(next: boolean) { open = next; listeners.forEach((l) => l()); }
export function useWalletSheetOpen(): boolean {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => open, () => false);
}
