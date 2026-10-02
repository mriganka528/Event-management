import type { ComponentProps } from "react";
import type { ClerkProvider } from "@clerk/nextjs";

/**
 * Makes the provider's own UI follow the application's theme.
 *
 * The customer sign-in and email-verification screens are rendered by Clerk, not
 * by this codebase, so they ignored the theme entirely: a light card sitting
 * inside a dark page after the switch. These variables point Clerk's palette at
 * the `--clerk-*` aliases declared in `globals.css`, which resolve to the same
 * semantic tokens the rest of the application uses. Because the aliases change
 * with `data-theme`, one toggle now moves both UIs together.
 *
 * Clerk's own dark-mode switch is deliberately left alone. It keys off the OS
 * preference, which is not the same thing as this application's manual toggle,
 * and forcing it would fight the user. The aliases resolve against the page
 * theme, so the colours are correct either way.
 */
type ClerkAppearance = NonNullable<ComponentProps<typeof ClerkProvider>["appearance"]>;

export const clerkAppearance: ClerkAppearance = {
  variables: {
    colorBackground: "var(--clerk-surface)",
    colorForeground: "var(--clerk-ink)",
    colorMutedForeground: "var(--clerk-ink-muted)",
    colorInput: "var(--clerk-field)",
    colorPrimary: "var(--clerk-accent)",
    colorNeutral: "var(--clerk-ink-muted)",
    colorDanger: "var(--clerk-danger)",
    colorSuccess: "var(--clerk-success)",
    colorWarning: "var(--clerk-warning)",
    borderRadius: "1rem",
    fontFamily: "var(--font-sans), system-ui, sans-serif",
  },
};
