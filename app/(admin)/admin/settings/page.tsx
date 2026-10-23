import Link from "next/link";
import type { Metadata } from "next";
import { Building2, LockKeyhole, MailCheck, Save, Settings as SettingsIcon, TriangleAlert } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { isMailConfigured } from "@/lib/mailer";
import { maxDevices } from "@/lib/auth/session";
import { saveBusinessSettingsFormAction } from "@/lib/form-actions";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SubmitButton } from "@/components/forms/submit-button";
import { ActionForm } from "@/components/forms/action-form";
import { ImageUploader } from "@/components/admin/image-uploader";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings",
  description: "Business details, tax rate, currency, and the mail configuration.",
  robots: { index: false, follow: false, nocache: true },
};

const defaults = { businessName: "", email: "", phone: "", address: "", city: "", taxRate: 0.18, currency: "INR", logoUrl: null as string | null, logoPublicId: null as string | null };

export default async function SettingsPage() {
  let settings = defaults;
  try {
    const saved = await prisma.businessSetting.findUnique({ where: { id: "default" } });
    if (saved) settings = { ...defaults, ...saved, taxRate: Number(saved.taxRate) };
  } catch {
    // Settings preview works before the database is pushed.
  }
  return (
    <main className="space-y-6">
      <section className="rounded-[32px] border border-[var(--line)] bg-[var(--card)] p-6 shadow-sm sm:p-8"><p className="text-sm font-semibold uppercase tracking-[0.25em] text-amber-700">Workspace settings</p><h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">Make the system yours.</h1><p className="mt-3 max-w-2xl text-[var(--muted)]">Keep public business details and tax settings consistent across booking, invoices, and reports.</p></section>
      <Card><CardHeader><CardTitle className="flex items-center gap-2">{isMailConfigured() ? <MailCheck className="h-5 w-5 text-emerald-600" /> : <TriangleAlert className="h-5 w-5 text-amber-600" />}Email delivery</CardTitle><CardDescription>Staff invitations and access-request alerts are sent with Nodemailer.</CardDescription></CardHeader><CardContent className="text-sm">{isMailConfigured() ? <p className="text-emerald-700">SMTP is configured. Invitations and request alerts will be emailed automatically.</p> : <div className="space-y-2 text-[var(--muted)]"><p>SMTP is not configured yet, so emails are skipped and invite links must be shared manually.</p><p className="rounded-2xl bg-stone-50 p-3 font-mono text-xs">Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and SMTP_FROM in your environment, then restart the app.</p></div>}</CardContent></Card>
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]"><Card><CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5 text-amber-700" />Business profile</CardTitle><CardDescription>These details appear in customer-facing experiences.</CardDescription></CardHeader><CardContent><ActionForm action={saveBusinessSettingsFormAction} className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm font-medium sm:col-span-2">Business name<Input name="businessName" defaultValue={settings.businessName} required /></label><div className="sm:col-span-2"><ImageUploader folder="business" name="logoUrl" publicIdName="logoPublicId" label="Business logo" defaultUrl={settings.logoUrl} defaultPublicId={settings.logoPublicId} /></div><label className="grid gap-2 text-sm font-medium">Email<Input name="email" type="email" defaultValue={settings.email} required /></label><label className="grid gap-2 text-sm font-medium">Phone<Input name="phone" defaultValue={settings.phone} required /></label><label className="grid gap-2 text-sm font-medium sm:col-span-2">Address<Input name="address" defaultValue={settings.address} required /></label><label className="grid gap-2 text-sm font-medium">City<Input name="city" defaultValue={settings.city} required /></label><label className="grid gap-2 text-sm font-medium">Currency<Input name="currency" maxLength={3} defaultValue={settings.currency} required /></label><label className="grid gap-2 text-sm font-medium">Tax rate <span className="font-normal text-[var(--muted)]">(0–1)</span><Input name="taxRate" type="number" min="0" max="1" step="0.01" defaultValue={settings.taxRate} required /></label><div className="flex items-end sm:col-span-2"><SubmitButton><Save className="mr-2 h-4 w-4" />Save settings</SubmitButton></div></ActionForm></CardContent></Card><div className="space-y-6"><Card><CardHeader><CardTitle className="flex items-center gap-2"><SettingsIcon className="h-5 w-5 text-amber-700" />Operational defaults</CardTitle></CardHeader><CardContent className="grid gap-3 text-sm"><div className="flex justify-between gap-3"><span className="text-[var(--muted)]">Booking currency</span><span className="font-semibold">{settings.currency}</span></div><div className="flex justify-between gap-3"><span className="text-[var(--muted)]">Default tax</span><span className="font-semibold">{Math.round(settings.taxRate * 100)}%</span></div><div className="flex justify-between gap-3"><span className="text-[var(--muted)]">Public booking</span><span className="font-semibold text-emerald-700">Enabled</span></div></CardContent></Card><Card><CardHeader><CardTitle className="flex items-center gap-2"><LockKeyhole className="h-5 w-5 text-amber-700" />Security</CardTitle><CardDescription>Authentication is handled entirely by this application.</CardDescription></CardHeader><CardContent className="space-y-4 text-sm text-[var(--muted)]"><p>Every session is an opaque server-side token stored only as a hash. Admin and super admin accounts must also complete a one-time code sent by email or SMS, and no account may stay signed in on more than {maxDevices()} devices at a time.</p><p>Team access is never self-service: a request from the public <Link href="/join-the-team" className="font-medium text-amber-800 hover:underline">join the team</Link> page is granted only by a super admin.</p><Link href="/admin/security" className="inline-block font-medium text-amber-800 hover:underline">Review the security log</Link></CardContent></Card></div></div>
    </main>
  );
}
