import { meta } from "@/config/constants";

export default function Manifest() {
  return {
    lang: 'en',
    name: meta.name,
    short_name: meta.name,
    description: meta.description,
    theme_color: meta.themeColor,
    background_color: meta.backgroundColor,
    display: 'standalone',
    scope: '/',
    start_url: '/',
    icons: [
      {
        src: 'icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: 'icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  };
};
