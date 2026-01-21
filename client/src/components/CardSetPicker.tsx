import { useState } from "react";
import { Shuffle, Loader2 } from "lucide-react";
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
  isLoading?: boolean;
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
  isLoading = false,
}: CardSetPickerProps) {
  const [open, setOpen] = useState(false);

  // Ensure sets is always an array
  const safeSets = sets || [];
  const hasOptions = safeSets.length > 0 || showRandomOption;

  // Show loading state
  if (isLoading) {
    return (
      <div 
        className="flex items-center gap-2 min-h-9 w-full rounded-md border border-input bg-background text-sm px-3"
        data-testid={testId ? `${testId}-loading` : undefined}
      >
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-muted-foreground">Loading sets...</span>
      </div>
    );
  }

  // Show empty state if no options
  if (!hasOptions) {
    return (
      <div 
        className="flex items-center min-h-9 w-full rounded-md border border-input bg-background text-sm px-3 text-muted-foreground"
        data-testid={testId ? `${testId}-empty` : undefined}
      >
        No card sets available
      </div>
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
        {safeSets.map((set) => (
          <SelectItem key={set.id} value={set.id} data-testid={`option-set-${set.id}`}>
            {formatSetLabel(set)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
