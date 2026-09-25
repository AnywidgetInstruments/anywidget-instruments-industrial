// Safe DOM helpers. Text always goes through textContent, never innerHTML
// (SEC-001, SEC-002); attributes are set one by one.

export const SVG_NS = "http://www.w3.org/2000/svg";

/** Attribute values; null, undefined and false remove the attribute. */
export type Attrs = Record<string, string | number | boolean | null | undefined>;
type Child = Node | null | undefined | false;

/** Create an SVG element with attributes and optional children. */
export function svg(tag: string, attrs: Attrs = {}, children: Child[] = []): SVGElement {
  const node = document.createElementNS(SVG_NS, tag) as SVGElement;
  setAttrs(node, attrs);
  for (const c of children) if (c) node.appendChild(c);
  return node;
}

export interface HtmlOptions {
  cls?: string;
  text?: string;
  attrs?: Attrs;
}

/** Create an HTML element with attributes, class name and text. */
export function html<K extends keyof HTMLElementTagNameMap>(tag: K, options?: HtmlOptions, children?: Child[]): HTMLElementTagNameMap[K];
export function html(tag: string, options?: HtmlOptions, children?: Child[]): HTMLElement;
export function html(tag: string, { cls, text, attrs }: HtmlOptions = {}, children: Child[] = []): HTMLElement {
  const node = document.createElement(tag);
  // focusable controls: host shortcuts must not steal their keys (Lumino
  // checks this attribute starting from the focused element itself)
  if (tag === "button") node.setAttribute("data-lm-suppress-shortcuts", "true");
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  if (attrs) setAttrs(node, attrs);
  for (const c of children) if (c) node.appendChild(c);
  return node;
}

// Views redraw on every trait change: the writers below leave the DOM alone
// when the value is unchanged, so that a redraw only touches what changed
// (fewer style invalidations and mutation records, PERF-002).

/** Set or remove (null, undefined, false) attributes, each only if it changes. */
export function setAttrs(node: Element, attrs: Attrs): void {
  for (const [k, v] of Object.entries(attrs)) setAttr(node, k, v === null || v === undefined || v === false ? null : String(v));
}

/** Set an attribute, or remove it (null), only if it changes. */
export function setAttr(node: Element, name: string, value: string | null): void {
  if (value === null) {
    if (node.hasAttribute(name)) node.removeAttribute(name);
  } else if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

/** Set the text content only if it changes. */
export function setText(node: Node, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** Show or hide an element only if its state changes. */
export function setHidden(node: HTMLElement, hidden: boolean): void {
  if (node.hidden !== hidden) node.hidden = hidden;
}

/** SVG <text> node with plain text content. */
export function svgText(content: string, attrs: Attrs = {}): SVGElement {
  const node = svg("text", attrs);
  node.textContent = content;
  return node;
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Only accept CSS colors made of safe characters (no url(), no expressions). */
export function safeColor(c: unknown): string {
  return typeof c === "string" && /^[#a-zA-Z0-9(),.%\s-]{1,64}$/.test(c) && !/url/i.test(c) ? c : "";
}

const FORBIDDEN = new Set(["script", "foreignobject", "iframe", "object", "embed", "audio", "video"]);

/**
 * Parse a skin SVG (already sanitized by the kernel) and sanitize it again on
 * the client (defense in depth, STYLE-006). Returns an <svg> element or null.
 */
export function parseSkin(source: unknown): SVGElement | null {
  if (typeof source !== "string" || !source) return null;
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.nodeName.toLowerCase() !== "svg" || doc.querySelector("parsererror")) return null;
  const walk = (el: Element): void => {
    for (const child of Array.from(el.children)) {
      if (FORBIDDEN.has(child.nodeName.toLowerCase())) child.remove();
      else walk(child);
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on")) el.removeAttribute(attr.name);
      else if ((name === "href" || name.endsWith(":href") || name === "src") && !(value.startsWith("#") || value.startsWith("data:image/png") || value.startsWith("data:image/jpeg"))) {
        el.removeAttribute(attr.name);
      } else if (/url\(\s*['"]?\s*[^#'"\s]/.test(value)) el.removeAttribute(attr.name);
    }
  };
  walk(root);
  return document.importNode(root, true) as unknown as SVGElement;
}
