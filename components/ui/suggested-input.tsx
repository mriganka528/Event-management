import type { InputHTMLAttributes } from "react";
import { Input } from "@/components/ui/input";

type SuggestedInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "list"> & {
  list: string;
  suggestions: readonly string[];
};

export function SuggestedInput({ list, suggestions, ...props }: SuggestedInputProps) {
  const uniqueSuggestions = Array.from(
    new Set(suggestions.map((suggestion) => suggestion.trim()).filter(Boolean)),
  );

  return (
    <>
      <Input list={list} {...props} />
      <datalist id={list}>
        {uniqueSuggestions.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>
    </>
  );
}
