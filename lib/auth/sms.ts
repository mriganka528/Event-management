import "server-only";

/**
 * Pluggable SMS delivery.
 *
 * Phone 2FA must not silently appear to work when no provider is configured, so
 * the default provider *fails loudly* and the UI reads `isPhoneOtpEnabled()` to
 * hide the phone option instead of offering something broken.
 *
 * To add a provider, implement `SmsProvider` and register it below. Nothing else
 * in the application needs to change.
 */

export type SmsResult = { sent: boolean; provider: string; reason?: string };

export interface SmsProvider {
  readonly name: string;
  isConfigured(): boolean;
  send(input: { to: string; message: string }): Promise<SmsResult>;
}
/**
 * Generic HTTP gateway driven by environment variables. Works with most Indian
 * transactional providers and any provider that accepts
 * `POST <url> { "to", "message", "<tokenVar>" }`:
 *
 *   SMS_PROVIDER_URL, SMS_PROVIDER_TOKEN, SMS_SENDER_ID
 *
 * If the chosen provider expects a different payload, add a dedicated provider
 * below rather than bending this one.
 */
class HttpSmsProvider implements SmsProvider {
  readonly name = "http";

  isConfigured() {
    return Boolean(process.env.SMS_PROVIDER_URL && process.env.SMS_PROVIDER_TOKEN);
  }

  async send({ to, message }: { to: string; message: string }) {
    if (!this.isConfigured()) return { sent: false, provider: this.name, reason: "No SMS provider is configured." };
    try {
      const response = await fetch(process.env.SMS_PROVIDER_URL!, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${process.env.SMS_PROVIDER_TOKEN}`,
        },
        body: JSON.stringify({
          to,
          message,
          sender_id: process.env.SMS_SENDER_ID ?? undefined,
          route: process.env.SMS_ROUTE ?? "transactional",
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return { sent: false, provider: this.name, reason: `SMS gateway returned ${response.status}.` };
      return { sent: true, provider: this.name };
    } catch {
      return { sent: false, provider: this.name, reason: "SMS gateway could not be reached." };
    }
  }
}

/** MSG91 transactional OTP, selected with `SMS_PROVIDER=msg91`. */
class Msg91Provider implements SmsProvider {
  readonly name = "msg91";

  isConfigured() {
    return Boolean(process.env.MSG91_AUTH_KEY);
  }

  async send({ to, message }: { to: string; message: string }) {
    if (!this.isConfigured()) return { sent: false, provider: this.name, reason: "MSG91 is not configured." };
    try {
      const template = process.env.MSG91_TEMPLATE_ID ?? "eventotp";
      const url = `https://control.msg91.com/api/v5/flow/?authkey=${encodeURIComponent(process.env.MSG91_AUTH_KEY!)}&template_id=${encodeURIComponent(template)}&recipients=${encodeURIComponent(to)}&message=${encodeURIComponent(message)}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return { sent: false, provider: this.name, reason: `MSG91 returned ${response.status}.` };
      return { sent: true, provider: this.name };
    } catch {
      return { sent: false, provider: this.name, reason: "MSG91 could not be reached." };
    }
  }
}

const providers: Record<string, SmsProvider> = {
  http: new HttpSmsProvider(),
  msg91: new Msg91Provider(),
};

function activeProvider(): SmsProvider {
  const key = (process.env.SMS_PROVIDER ?? "http").toLowerCase();
  return providers[key] ?? providers.http;
}

/** True when a phone can actually receive a code. Drives the 2FA channel picker. */
export function isPhoneOtpEnabled(): boolean {
  return activeProvider().isConfigured();
}

export async function sendSms(to: string, message: string): Promise<SmsResult> {
  const normalised = normalisePhone(to);
  if (!normalised) return { sent: false, provider: activeProvider().name, reason: "That phone number is not valid." };
  return activeProvider().send({ to: normalised, message });
}

/**
 * Normalises a phone number to digits with a leading country code. OTP delivery
 * needs an unambiguous international form, so a bare 10-digit Indian number is
 * expanded using `SMS_DEFAULT_COUNTRY_CODE`.
 */
export function normalisePhone(input: string, countryCode = process.env.SMS_DEFAULT_COUNTRY_CODE ?? "91"): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length < 8 || digits.length > 15) return null;

  if (hasPlus) return digits;
  const code = countryCode.replace(/\D/g, "");
  if (digits.startsWith(code) && digits.length > code.length + 6) return digits;
  return `${code}${digits.replace(/^0+/, "")}`;
}

export function isValidPhone(input: string): boolean {
  return normalisePhone(input) !== null;
}

/** Masks a number for display, e.g. `+919876543210` -> `+91 98765 43210`. */
export function maskPhone(input: string): string {
  const normalised = normalisePhone(input);
  if (!normalised) return input;
  const tail = normalised.slice(-5);
  const head = normalised.slice(0, Math.max(normalised.length - 5, 0));
  return head ? `+${head} ${tail}` : `••• ${tail}`;
}

export function maskEmail(input: string): string {
  const [local, domain] = input.split("@");
  if (!local || !domain) return input;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(local.length - visible.length, 1))}@${domain}`;
}
