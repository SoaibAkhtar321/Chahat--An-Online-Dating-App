export const meta = (title: string, description: string) => ({
  meta: [
    { title: `${title} — Milo` },
    { name: "description", content: description },
    { property: "og:title", content: `${title} — Milo` },
    { property: "og:description", content: description },
  ],
});
