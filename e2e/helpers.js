import { expect } from "@playwright/test";

/** Widget root whose own label is `label` (not a container holding it). */
export const widget = (page, label) => {
  const exact = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  return page.locator(".awi-root", { has: page.locator(":scope > .awi-label", { hasText: exact }) });
};

/**
 * Open a notebook in JupyterLab and run all its cells.
 *
 * Specs run one at a time: kernels of other notebooks are shut down first,
 * so JupyterLab does not ask which kernel to use; if it still does (slow
 * runners), the dialog is answered whenever it shows up.
 */
export async function runNotebook(page, name) {
  const sessions = await (await page.request.get("/api/sessions")).json();
  for (const s of sessions) {
    if (s.path !== name) await page.request.delete(`/api/sessions/${s.id}`);
  }
  await page.goto(`/lab/tree/${name}?reset`);
  await page.locator(".jp-Notebook").waitFor();
  const select = page.locator(".jp-Dialog").getByRole("button", { name: "Select", exact: true });
  const idle = page.locator(".jp-Notebook-ExecutionIndicator[data-status='idle']");
  await expect
    .poll(
      async () => {
        if (await select.isVisible().catch(() => false)) await select.click();
        return idle.isVisible();
      },
      { timeout: 90_000, intervals: [250, 500, 1000] },
    )
    .toBe(true);
  // On a freshly started server, "Run All Cells" can be issued before the
  // kernel accepts it (or a late kernel dialog swallows it): nothing runs.
  // Check that execution started and issue it again otherwise.
  const prompts = page.locator(".jp-CodeCell .jp-InputPrompt");
  const started = async () => (await prompts.allTextContents()).some((t) => /\[(\d+|\*)\]/.test(t));
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.locator(".jp-Notebook").click();
    await page.keyboard.press("Escape");
    await page.getByRole("menuitem", { name: "Run", exact: true }).click();
    await page.getByRole("menuitem", { name: "Run All Cells", exact: true }).click();
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (await select.isVisible().catch(() => false)) await select.click();
      if (await started()) return;
      await page.waitForTimeout(250);
    }
  }
  throw new Error(`runNotebook: cells of ${name} never started running`);
}

/**
 * Execute `code` in the kernel of notebook `path` through the Jupyter
 * WebSocket API (a second client of the same kernel) and return its text
 * output (stream + execute_result). Throws on Python errors.
 *
 * One persistent connection per page, warmed up with kernel_info requests
 * until iopub messages flow (ZeroMQ subscriptions join asynchronously).
 */
export async function kernelExec(page, path, code) {
  return page.evaluate(
    async ({ path, code }) => {
      const uuid = () => crypto.randomUUID();
      const connect = async () => {
        const sessions = await (await fetch("/api/sessions")).json();
        const session = sessions.find((s) => s.path === path || s.path.endsWith(`/${path}`));
        if (!session) throw new Error(`no kernel session for ${path}`);
        const sid = uuid();
        const proto = location.protocol === "https:" ? "wss" : "ws";
        const ws = new WebSocket(`${proto}://${location.host}/api/kernels/${session.kernel.id}/channels?session_id=${sid}`);
        const handlers = new Map();
        ws.onmessage = (ev) => {
          if (typeof ev.data !== "string") return;
          const msg = JSON.parse(ev.data);
          handlers.get(msg.parent_header?.msg_id)?.(msg);
        };
        await new Promise((resolve, reject) => {
          ws.onopen = resolve;
          ws.onerror = reject;
        });
        const send = (msgType, content, onMsg) => {
          const msgId = uuid();
          handlers.set(msgId, onMsg);
          ws.send(JSON.stringify({
            header: { msg_id: msgId, username: "e2e", session: sid, msg_type: msgType, version: "5.3", date: new Date().toISOString() },
            parent_header: {}, metadata: {}, content, channel: "shell", buffers: [],
          }));
          return msgId;
        };
        // warm up: repeat kernel_info_request until an iopub status arrives
        for (let i = 0; i < 50; i++) {
          const ok = await new Promise((resolve) => {
            send("kernel_info_request", {}, (m) => m.channel === "iopub" && resolve(true));
            setTimeout(() => resolve(false), 200);
          });
          if (ok) break;
        }
        return { send, path };
      };
      if (!window.__awiKernel || window.__awiKernel.path !== path) window.__awiKernel = await connect();
      const { send } = window.__awiKernel;
      const out = [];
      await new Promise((resolve, reject) => {
        let replied = false;
        let idle = false;
        const timer = setTimeout(() => reject(new Error(`kernelExec timeout: ${code}`)), 30_000);
        const finish = () => {
          if (replied && idle) {
            clearTimeout(timer);
            resolve();
          }
        };
        send("execute_request", { code, silent: false, store_history: false, user_expressions: {}, allow_stdin: false, stop_on_error: true }, (msg) => {
          const t = msg.header.msg_type;
          if (t === "stream") out.push(msg.content.text);
          else if (t === "execute_result") out.push(msg.content.data["text/plain"]);
          else if (t === "error") reject(new Error(`${msg.content.ename}: ${msg.content.evalue}`));
          else if (t === "execute_reply") {
            replied = true;
            // iopub idle may have been lost: do not wait for it forever
            setTimeout(() => { idle = true; finish(); }, 1000);
            finish();
          } else if (t === "status" && msg.content.execution_state === "idle") {
            idle = true;
            finish();
          }
        });
      });
      return out.join("").trim();
    },
    { path, code },
  );
}
