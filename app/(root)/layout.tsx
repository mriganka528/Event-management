import type { ReactNode } from "react";
import { getBusinessSettings } from "@/lib/settings";
import { SiteFooter } from "@/components/layout/site-footer";

/**
 * Chrome for the public marketing pages.
 *
 * The footer lives here rather than on each page, so the terms, the contact
 * details, and the business address are on every public page without each one
 * having to remember to add them — and a page added later cannot forget.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const settings = await getBusinessSettings();

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex-1">{children}</div>
      <SiteFooter
        businessName={settings.businessName}
        email={settings.email}
        phone={settings.phone}
        address={settings.address}
        city={settings.city}
      />
    </div>
  );
}
