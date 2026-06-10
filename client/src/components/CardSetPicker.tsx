import { useState, useEffect } from "react";
import { Shuffle, Loader2, ChevronDown } from "lucide-react";
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

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const isAndroid = /Android/.test(navigator.userAgent);
      const isSmallScreen = window.innerWidth < 768;
      
      setIsMobile(hasTouch && (isIOS || isAndroid || isSmallScreen));
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return isMobile;
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
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const safeSets = sets || [];
  const hasOptions = safeSets.length > 0 || showRandomOption;

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

  // Native HTML select for iOS/mobile - works reliably on all touch devices
  if (isMobile) {
    const selectedSet = safeSets.find(s => s.id === value);
    const displayValue = value === "random" 
      ? randomOptionLabel 
      : selectedSet 
        ? formatSetLabel(selectedSet) 
        : placeholder;

    return (
      <div className="relative w-full">
        <select
          id={id}
          data-testid={testId}
          value={value || ""}
          onChange={(e) => onValueChange(e.target.value)}
          disabled={disabled}
          className="w-full min-h-9 appearance-none rounded-md border border-input bg-background px-3 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ WebkitAppearance: 'none', MozAppearance: 'none' }}
        >
          <option value="" disabled>
            {placeholder}
          </option>
          {showRandomOption && (
            <option value="random">
              {randomOptionLabel}
            </option>
          )}
          {safeSets.map((set) => (
            <option key={set.id} value={set.id}>
              {formatSetLabel(set)}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-50 pointer-events-none" />
      </div>
    );
  }

  // Radix Select for desktop browsers
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
        aria-label={placeholder}
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
