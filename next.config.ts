import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const config: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // Schedule imports post a PDF or an image through a server action. The default cap is 1 MB,
    // which rejects most real documents; the importer refuses anything over 8 MB itself, with a
    // message that says so.
    serverActions: { bodySizeLimit: "8mb" },
  },
  // PGlite ships WASM and must stay a plain Node require, not a bundled module.
  serverExternalPackages: ["@electric-sql/pglite"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
