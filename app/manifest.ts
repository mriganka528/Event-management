import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Event Management",
    short_name: "Events",
    description: "Plan, manage, and deliver memorable events.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f1e8",
    theme_color: "#d38a16",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
