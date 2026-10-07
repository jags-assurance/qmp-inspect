"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/observability/report-client-error";

// Catches an error thrown in the root layout itself (or by something it mounts), where app/error.tsx
// cannot render. Must define its own <html>/<body>, and uses inline styles because the app's
// stylesheet may be the thing that failed.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#f9f7f4", color: "#1c1c1e", margin: 0 }}>
        <div
          role="alert"
          style={{ maxWidth: 440, margin: "80px auto", padding: 24, background: "#fff", border: "1px solid #b3a993", borderRadius: 8, textAlign: "center" }}
        >
          <h1 style={{ fontSize: 20, margin: 0 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: "#5c5648" }}>The application could not load. Your data is safe. Try again.</p>
          {error.digest && <p style={{ fontSize: 12, color: "#5c5648" }}>Error ID: {error.digest}</p>}
          <button
            type="button"
            onClick={() => reset()}
            style={{ minHeight: 44, padding: "0 20px", background: "#6b1e2c", color: "#fff", border: 0, borderRadius: 6, fontSize: 14, cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
