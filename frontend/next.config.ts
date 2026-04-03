import type { NextConfig } from "next";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

// Extract origin from API_BASE for CSP connect-src
function apiOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

const nextConfig: NextConfig = {
  output: "standalone",
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        // Prevent clickjacking
        { key: "X-Frame-Options", value: "DENY" },
        // Stop MIME sniffing
        { key: "X-Content-Type-Options", value: "nosniff" },
        // Force HTTPS in production
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
        // Control referrer leakage
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        // Restrict browser feature access
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=()",
        },
        // Content Security Policy
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            // Next.js inline scripts + Google OAuth
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com https://challenges.cloudflare.com",
            // Styles: self + inline (Tailwind injects inline)
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            // Fonts
            "font-src 'self' https://fonts.gstatic.com",
            // Images: self + data URIs (avatars)
            "img-src 'self' data: https://lh3.googleusercontent.com",
            // API calls + Google OAuth
            `connect-src 'self' ${apiOrigin(API_BASE)} https://accounts.google.com`,
            // iframes: Google OAuth popup
            "frame-src https://accounts.google.com https://challenges.cloudflare.com",
            // No object/embed
            "object-src 'none'",
            // Upgrade insecure requests in prod
            ...(process.env.NODE_ENV === "production"
              ? ["upgrade-insecure-requests"]
              : []),
          ].join("; "),
        },
      ],
    },
  ],
};

export default nextConfig;
