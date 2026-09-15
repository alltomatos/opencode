import sanitizeHtml from "sanitize-html";

/**
 * Sanitiza HTML de email (conteúdo não confiável): remove scripts, iframes,
 * handlers de evento inline (onclick, onerror, ...) e schemes perigosos em
 * links/imagens, mantendo formatação básica.
 */
export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
    allowedAttributes: {
      "*": ["class", "align", "width", "height"],
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "width", "height"],
    },
    allowedSchemes: ["http", "https", "mailto", "cid"],
    disallowedTagsMode: "discard",
  });
}
