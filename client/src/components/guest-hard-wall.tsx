import { AnonGatePlaque } from "@/components/anon-gate-plaque";
import { useGuestWallChrome } from "@/lib/guestWallChrome";

/**
 * Guest hard wall shown in place of a setup form or start button.
 * The page renders this instead of the form, so the Register CTA sits near
 * the top of the screen and is reachable without scrolling at 375x667.
 * Hides the chat bubble and the static legal footer while mounted.
 * Bottom padding clears the iPhone home indicator.
 */
export function GuestHardWall({
  escrowPoints,
  onCreate,
  onSignIn,
  className = "",
}: {
  escrowPoints: number;
  onCreate: () => void;
  onSignIn: () => void;
  className?: string;
}) {
  useGuestWallChrome(true);
  return (
    <div
      className={`flex w-full justify-center ${className}`.trim()}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      data-testid="wall-anon-hard-gate"
    >
      <AnonGatePlaque variant="hard" escrowPoints={escrowPoints} onCreate={onCreate} onSignIn={onSignIn} />
    </div>
  );
}
