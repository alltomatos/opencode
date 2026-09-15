import { describe, expect, it } from "vitest";
import { sanitizeEmailHtml } from "./sanitize.js";

describe("sanitizeEmailHtml", () => {
  it("remove tags <script>", () => {
    const dirty = '<p>Olá</p><script>alert("hackeado")</script>';
    const clean = sanitizeEmailHtml(dirty);
    expect(clean).not.toContain("<script>");
    expect(clean).not.toContain("alert(");
  });

  it("remove handlers de evento inline (onerror, onclick, ...)", () => {
    const dirty = '<img src="x" onerror="alert(1)"><a href="#" onclick="evil()">clique</a>';
    const clean = sanitizeEmailHtml(dirty);
    expect(clean).not.toContain("onerror");
    expect(clean).not.toContain("onclick");
  });

  it("mantém formatação básica (parágrafos, negrito)", () => {
    const clean = sanitizeEmailHtml("<p>Olá <b>mundo</b></p>");
    expect(clean).toContain("<p>");
    expect(clean).toContain("<b>mundo</b>");
  });

  it("bloqueia esquema javascript: em links", () => {
    const clean = sanitizeEmailHtml('<a href="javascript:alert(1)">clique</a>');
    expect(clean).not.toContain("javascript:");
  });
});
