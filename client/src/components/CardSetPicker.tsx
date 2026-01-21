import { useState } from "react";
import { Shuffle } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface CardSet {
  id: string;
  name?: string;
  year: number | null;
  brand: string | null;
  sport: string | null;
  cardsImportedCount: number;
}

interface CardSetPickerProps {
  sets: CardSet[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  "data-testid"?: string;
  showRandomOption?: boolean;
  randomOptionLabel?: string;
}

function isIOSSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|Chrome/.test(ua);
  return isIOS && isSafari;
}

function formatSetLabel(set: CardSet): string {
  return `${set.year || ""} ${set.brand || ""} ${set.sport || ""} (${set.cardsImportedCount} cards)`.trim();
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

  if (isIOSSafari()) {
    return (
      <select
        id={id}
        data-testid={testId}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        disabled={disabled}
        className="flex min-h-9 w-full items-center justify-between rounded-md border border-input bg-background text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 appearance-none"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
          backgroundPosition: "right 0.5rem center",
          backgroundRepeat: "no-repeat",
          backgroundSize: "1.5em 1.5em",
          paddingRight: "2.5rem",
          paddingLeft: "0.75rem",
        }}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {showRandomOption && (
          <option value="random">
            {randomOptionLabel}
          </option>
        )}
        {sets.map((set) => (
          <option key={set.id} value={set.id}>
            {formatSetLabel(set)}
          </option>
        ))}
      </select>
    );
  }

  return (
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
        onTouchStart={() => {
          if (!disabled) setOpen(true);
        }}
        onClick={() => {
          if (!disabled) setOpen(true);
        }}
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
  );
}
