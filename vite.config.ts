import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Wibble PWA — mobile-first, installable to her home screen.
// Output goes to dist/, which firebase.json already serves as Hosting public.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.png", "apple-touch-icon.png"],
      workbox: {
        // Firebase Auth serves its sign-in handler/iframe under /__/. The
        // default SPA navigation fallback would serve index.html for those
        // routes, so the real handler never loads and sign-in hangs on a blank
        // page / loops. Let anything under /__/ go to the network.
        navigateFallbackDenylist: [/^\/__\//],
      },
      manifest: {
        name: "Wibble",
        short_name: "Wibble",
        description: "A gentle daily companion for T1D.",
        theme_color: "#4f8a8b",
        background_color: "#fbf7f0",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
});
