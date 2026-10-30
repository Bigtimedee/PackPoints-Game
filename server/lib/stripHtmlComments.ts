/**
 * Remove HTML comments from served markup (developer notes must not ship to
 * visitors or crawlers). Leaves <script>/<style>/<textarea> bodies and IE
 * conditional comments untouched. Run after marker replacement.
 */
export function stripHtmlComments(html: string): string {
  return html
    .split(/(<(script|style|textarea)\b[\s\S]*?<\/\2\s*>)/i)
    .map((part, i) => {
      if (i % 3 === 1) return part; // raw-text element, keep verbatim
      if (i % 3 === 2) return ""; // captured tag name
      return part.replace(/<!--(?!\[if)[\s\S]*?-->[ \t]*(\r?\n)?/g, "");
    })
    .join("");
}
