/** Inline validation message tied to the field above it via aria-describedby. */
export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <span role="alert" className="text-xs font-medium text-[var(--danger-text)]">
      {message}
    </span>
  );
}
