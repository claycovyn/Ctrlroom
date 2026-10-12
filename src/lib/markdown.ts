import "server-only";
import { Marked } from "marked";

export const headingId = (text: string) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// Docs are our own trusted content, so rendered HTML is used as-is.
const md = new Marked({ gfm: true });
md.use({
  renderer: {
    heading({ tokens, depth }) {
      const inner = this.parser.parseInline(tokens);
      return `<h${depth} id="${headingId(inner)}">${inner}</h${depth}>\n`;
    },
  },
});

export function renderMarkdown(src: string): string {
  return md.parse(src, { async: false }) as string;
}
