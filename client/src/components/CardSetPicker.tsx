import { useState } from "react";
import { Shuffle } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PlayableSet } from "@shared/schema";

interface CardSetPickerProps {
  sets: PlayableSet[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  "data-testid"?: string;
  showRandomOption?: boolean;
  randomOptionLabel?: string;
}

function formatSetLabel(set: PlayableSet): string {
  const parts = [];
  if (set.year) parts.push(set.year);
  if (set.brand) parts.push(set.brand);
  if (set.sport) parts.push(set.sport);
  parts.push(`(${set.cardsImportedCount} cards)`);
  return parts.join(" ");
}

export function CardSetPicker({
  sets,
  value,
  onValueChange,
  placeholder = "Select a card set",
  disabled = false,
  id,
  "data-testid": testId,
  showRandomOption = false,
  randomOptionLabel = "Let PackPTS Choose",
}: CardSetPickerProps) {
  const [open, setOpen] = useState(false);

  // Build options array for native select
  const nativeOptions = [
    ...(showRandomOption ? [{ id: "random", label: randomOptionLabel }] : []),
    ...sets.map(set => ({ id: set.id, label: formatSetLabel(set) })),
  ];

  return (
    <>
      {/* Native select - shown on touch devices via CSS */}
      <select
        key={`native-select-${sets.length}`}
        id={id ? `${id}-native` : undefined}
        data-testid={testId ? `${testId}-native` : undefined}
        value={value || ""}
        onChange={(e) => onValueChange(e.target.value)}
        disabled={disabled}
        className="touch-only-select min-h-9 w-full rounded-md border border-input bg-background text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        style={{
          WebkitAppearance: "none",
          appearance: "none",
          backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
          backgroundPosition: "right 0.5rem center",
          backgroundRepeat: "no-repeat",
          backgroundSize: "1.5em 1.5em",
          paddingRight: "2.5rem",
          paddingLeft: "0.75rem",
        }}
      >
        <option value="">{placeholder}</option>
        {nativeOptions.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>

      {/* Radix select - shown on desktop via CSS */}
      <div className="desktop-only">
        <Select
          open={open}
          onOpenChange={setOpen}
          value={value}
          onValueChange={(v) => {
            onValueChange(v);
            setOpen(false);
          }}
          disabled={disabled}
        >
          <SelectTrigger
            id={id}
            data-testid={testId}
          >
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent
            position="popper"
            sideOffset={8}
            className="z-[9999] max-h-[60vh] overflow-y-auto"
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            {showRandomOption && (
              <SelectItem value="random" data-testid="option-set-random">
                <div className="flex items-center gap-2">
                  <Shuffle className="h-4 w-4" />
                  <span>{randomOptionLabel}</span>
                </div>
              </SelectItem>
            )}
            {sets.map((set) => (
              <SelectItem key={set.id} value={set.id} data-testid={`option-set-${set.id}`}>
                {formatSetLabel(set)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}
