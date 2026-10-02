import { defineConfig } from "vitepress";

const base = "/deckforge/";
const site = "https://ludovic.rivallain.fr/deckforge/";

export default defineConfig({
  base,
  lang: "en",
  title: "deckforge",
  description: "Presentations as YAML: themes, templates, a live editor and GitHub Copilot. Static HTML decks with no network requests.",
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ["link", { rel: "icon", href: `${base}logo.svg`, type: "image/svg+xml" }],
    ["link", { rel: "icon", href: `${base}favicon.ico`, sizes: "48x48" }],
    ["link", { rel: "apple-touch-icon", href: `${base}apple-touch-icon.png` }],
    ["meta", { name: "theme-color", content: "#0F6CBD" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:site_name", content: "deckforge" }],
    ["meta", { property: "og:image", content: `${site}og-image.png` }],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    ["meta", { name: "twitter:image", content: `${site}og-image.png` }],
  ],
  sitemap: { hostname: site },
  themeConfig: {
    logo: "/logo.svg",
    nav: [
      { text: "Guide", link: "/guide/getting-started", activeMatch: "/guide/" },
      { text: "Reference", link: "/reference/cli", activeMatch: "/reference/" },
      { text: "Live demo", link: "/demo/aurora.html", target: "_blank" },
      { text: "Changelog", link: "https://github.com/lrivallain/deckforge/blob/master/CHANGELOG.md" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "Write a deck", link: "/guide/writing-decks" },
          { text: "Themes", link: "/guide/themes" },
          { text: "Templates", link: "/guide/templates" },
          { text: "Editor", link: "/guide/editor" },
          { text: "Copilot assistant", link: "/guide/copilot" },
          { text: "Present and share", link: "/guide/presenting" },
          { text: "Copilot skill", link: "/guide/copilot-skill" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "CLI", link: "/reference/cli" },
          { text: "deck.yaml", link: "/reference/deck-yaml" },
          { text: "Theme files", link: "/reference/themes" },
          { text: "Template files", link: "/reference/templates" },
          { text: "Security model", link: "/reference/security" },
        ],
      },
      {
        text: "Project",
        items: [
          { text: "Contributing", link: "/contributing" },
          { text: "Limitations", link: "/reference/limitations" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/lrivallain/deckforge" }],
    editLink: { pattern: "https://github.com/lrivallain/deckforge/edit/master/docs/:path", text: "Edit this page on GitHub" },
    search: { provider: "local" },
    outline: { level: [2, 3] },
    footer: { message: "Released under the MIT License.", copyright: "© Ludovic Rivallain" },
  },
});
