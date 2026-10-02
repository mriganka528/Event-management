"use client";

import { Toaster } from "react-hot-toast";

export function AppToaster() {
  return (
    <Toaster
      position="top-right"
      gutter={10}
      toastOptions={{
        duration: 3500,
        className: "app-toast",
        success: {
          iconTheme: { primary: "#16803c", secondary: "#ffffff" },
        },
        error: {
          iconTheme: { primary: "#b42318", secondary: "#ffffff" },
          duration: 5000,
        },
        style: {
          background: "var(--card-elevated)",
          color: "var(--foreground)",
          border: "1px solid var(--line-strong)",
          borderRadius: "16px",
          boxShadow: "0 18px 48px rgba(53, 41, 26, 0.18)",
          fontSize: "0.875rem",
          fontWeight: 600,
          padding: "12px 16px",
        },
      }}
    />
  );
}
