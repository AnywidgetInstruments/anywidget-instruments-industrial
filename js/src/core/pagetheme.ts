// Light / dark theme of the host page (STYLE-007, STYLE-008).

const DARK_HOST = '[data-jp-theme-light="false"], .vscode-dark, .vscode-high-contrast, [data-theme="dark"], .dark-mode, .dark-theme';
const LIGHT_HOST = '[data-jp-theme-light="true"], .vscode-light, [data-theme="light"], .light-theme';

const osDark = (): boolean => typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;

/**
 * True when the host around `el` shows a dark theme: the nearest host theme
 * marker (JupyterLab, VS Code, marimo...), crossing shadow roots, or else
 * the operating system preference.
 */
export function hostIsDark(el: Node | null): boolean {
  let node: Node | null = el;
  while (node) {
    if (node.nodeType === 1) {
      if ((node as Element).matches(DARK_HOST)) return true;
      if ((node as Element).matches(LIGHT_HOST)) return false;
    }
    node = node.parentNode || (node as ShadowRoot).host || null; // a shadow root continues at its host
  }
  return osDark();
}

/**
 * Apply `theme` ("light", "dark" or "system") to the notebook page itself.
 *
 * marimo marks its theme with classes and a data attribute on <body>
 * ("light light-theme" / "dark dark-theme"); swapping them switches the
 * whole page ("system" follows the operating system). Other hosts keep their
 * own theme setting: returns false.
 */
export function applyPageTheme(doc: Document | null | undefined, theme: string): boolean {
  const body = doc && doc.body;
  if (!body) return false;
  const cl = body.classList;
  if (!cl.contains("light-theme") && !cl.contains("dark-theme")) return false;
  const dark = theme === "system" ? osDark() : theme === "dark";
  const [from, to] = dark ? ["light", "dark"] : ["dark", "light"];
  cl.remove(from, `${from}-theme`);
  cl.add(to, `${to}-theme`);
  body.dataset.theme = to;
  return true;
}
