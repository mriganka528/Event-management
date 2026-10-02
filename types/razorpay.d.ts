export {};

declare global {
  interface RazorpayPaymentResponse {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  }

  interface RazorpayOptions {
    key: string;
    amount: number;
    currency: string;
    name: string;
    description: string;
    order_id: string;
    prefill?: { name?: string; email?: string; phone?: string };
    notes?: Record<string, string>;
    handler: (response: RazorpayPaymentResponse) => void;
    modal?: { ondismiss?: () => void };
    theme?: { color?: string };
  }

  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void };
  }
}
