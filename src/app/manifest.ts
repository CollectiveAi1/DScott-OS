import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DScott OS",
    short_name: "DScott OS",
    start_url: "/",
    display: "standalone",
    background_color: "#050a18",
    theme_color: "#050a18",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
