import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useState } from "react";

import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";

export interface DropwaveSelectOption<T extends string = string> {
  readonly value: T;
  readonly label: string;
  readonly hint?: string;
}

export function DropwaveSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  compact = false,
  align = "start",
}: {
  value: T;
  options: ReadonlyArray<DropwaveSelectOption<T>>;
  onChange: (next: T) => void;
  ariaLabel: string;
  compact?: boolean;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((opt) => opt.value === value) ?? options[0];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        data-dw-select-trigger={compact ? "compact" : ""}
        aria-label={ariaLabel}
      >
        <span>{current?.label ?? value}</span>
        <ChevronDownIcon className="size-3.5 shrink-0 opacity-65" />
      </PopoverTrigger>
      <PopoverPopup align={align} width="sm" padding="compact" data-dropwave-popover="">
        <div data-dw-select-list="" role="listbox" aria-label={ariaLabel}>
          {options.map((opt) => {
            const selected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={selected}
                data-dw-select-opt=""
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                <span data-dw-select-opt-text="">
                  <strong>{opt.label}</strong>
                  {opt.hint ? <small>{opt.hint}</small> : null}
                </span>
                {selected ? (
                  <CheckIcon className="size-3.5 shrink-0" data-dw-icon="indigo" />
                ) : null}
              </button>
            );
          })}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
