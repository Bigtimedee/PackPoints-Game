import { formatTodaysSetLabel } from "@/lib/daily5SetLabel";

/** Small-caps set line. Renders nothing when the status API sent no name. */
export function Daily5SetLabel({ setName }: { setName: string | null | undefined }) {
  const name = setName?.trim();
  if (!name) return null;
  return (
    <p
      data-testid="text-d5-todays-set"
      className="mx-auto mb-3 w-full max-w-[320px] text-center text-[11px] font-medium uppercase leading-snug tracking-[0.18em] whitespace-pre-wrap break-words"
      style={{ color: "#8F96A3", fontVariant: "all-small-caps" }}
    >
      {formatTodaysSetLabel(name)}
    </p>
  );
}
