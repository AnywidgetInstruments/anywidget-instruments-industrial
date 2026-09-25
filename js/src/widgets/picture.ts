// PictureControl (SPEC-005..007): display list drawn on a canvas.
import { hostOwnsState } from "../contract/derived.js";
import { html, safeColor, setAttr } from "../core/dom.js";
import type { AnyModel } from "../core/model.js";
import { BaseView } from "../core/view.js";
import type { PictureControlTraits } from "../generated/contract.js";

/** A drawing command of a draw message (fields checked when drawn). */
export type DrawCommand = Record<string, unknown>;
type Picture = ImageBitmap | ImageData;

const num = (v: unknown, d = 0): number => (v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);

/** Bytes of a message buffer: ArrayBuffer (AFM hosts), DataView or typed array (Jupyter). */
export function bytesOf(buf: ArrayBuffer | ArrayBufferView): Uint8Array {
  return ArrayBuffer.isView(buf) ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : new Uint8Array(buf);
}

export class PictureView extends BaseView<PictureControlTraits> {
  readonly canvas: HTMLCanvasElement;
  commands: DrawCommand[] = [];
  /** Decoded image of each image command. */
  readonly images = new Map<DrawCommand, Picture>();

  constructor(model: AnyModel<PictureControlTraits>, el: HTMLElement) {
    super(model, el, ["background"]);
    this.canvas = html("canvas", { cls: "awi-canvas" });
    this.body.appendChild(this.canvas);
    this.body.setAttribute("role", "img");
    this.listen("msg:custom", (msg: unknown, buffers: unknown) => this.onMessage(msg, (buffers as Array<ArrayBuffer | ArrayBufferView>) || []));
    this.canvas.addEventListener("pointerdown", (e) => {
      if (!this.interactive) return;
      const r = this.canvas.getBoundingClientRect();
      const [w, h] = this.get("size");
      const click = { x: ((e.clientX - r.left) * w) / (r.width || w), y: ((e.clientY - r.top) * h) / (r.height || h), button: e.button };
      this.model.send({ type: "click", ...click });
      // HOST-004: without a host owning the state, the front end records the click
      if (!hostOwnsState(this.model as unknown as AnyModel)) {
        this.model.set("value", click);
        this.model.save_changes();
      }
    });
    this.canvas.addEventListener("contextmenu", (e) => this.interactive && e.preventDefault());
    this.model.send({ type: "sync_request" });
  }

  onMessage(msg: unknown, buffers: Array<ArrayBuffer | ArrayBufferView>): void {
    if (!msg || typeof msg !== "object" || (msg as { type?: unknown }).type !== "draw") return;
    const m = msg as { clear?: unknown; commands?: unknown };
    if (m.clear) {
      this.commands = [];
      this.images.clear();
    }
    const cmds = Array.isArray(m.commands) ? (m.commands as unknown[]) : [];
    const loading: Array<Promise<void>> = [];
    for (const c of cmds) {
      if (!c || typeof c !== "object") continue;
      const cmd = c as DrawCommand;
      const buf = typeof cmd.buffer === "number" ? buffers[cmd.buffer] : undefined;
      if (cmd.op === "image" && buf) loading.push(this.decode(cmd, buf));
      this.commands.push(cmd);
    }
    // SPEC-007: the whole batch is rendered in one frame, once images are decoded
    void Promise.all(loading).then(() => this.schedule());
  }

  async decode(c: DrawCommand, buf: ArrayBuffer | ArrayBufferView): Promise<void> {
    const bytes = bytesOf(buf);
    try {
      if (c.mime === "rgba") {
        const data = new ImageData(new Uint8ClampedArray(bytes.slice()), num(c.pw, 1), num(c.ph, 1));
        this.images.set(c, typeof createImageBitmap === "function" ? await createImageBitmap(data) : data);
      } else if (c.mime === "image/png" || c.mime === "image/jpeg") {
        this.images.set(c, await createImageBitmap(new Blob([bytes.slice()], { type: c.mime })));
      }
    } catch {
      // undecodable image: skipped
    }
  }

  override draw(): void {
    const [w, h] = this.get("size");
    const dpr = (typeof devicePixelRatio !== "undefined" && devicePixelRatio) || 1;
    const c = this.canvas;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    setAttr(this.body, "aria-label", this.get("label") || "Picture");
    const ctx = c.getContext?.("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const fg = getComputedStyle(this.root).getPropertyValue("--awi-fg").trim() || "#000";
    const color = (v: unknown): string => (v === "currentColor" ? fg : safeColor(v));
    const bg = color(this.get("background"));
    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
    }
    for (const cmd of this.commands) this.drawCommand(ctx, cmd, color);
  }

  drawCommand(ctx: CanvasRenderingContext2D, c: DrawCommand, color: (v: unknown) => string): void {
    const stroke = c.stroke ? color(c.stroke) : "";
    const fill = c.fill ? color(c.fill) : "";
    ctx.lineWidth = num(c.width, 1);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const strokeIt = (): void => {
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.stroke();
      }
    };
    const paint = (): void => {
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      strokeIt();
    };
    switch (c.op) {
      case "line":
        ctx.beginPath();
        ctx.moveTo(num(c.x0), num(c.y0));
        ctx.lineTo(num(c.x1), num(c.y1));
        strokeIt();
        break;
      case "rect":
        ctx.beginPath();
        ctx.rect(num(c.x), num(c.y), num(c.w), num(c.h));
        paint();
        break;
      case "arc": {
        const a0 = (num(c.start) * Math.PI) / 180;
        const a1 = (num(c.end) * Math.PI) / 180;
        ctx.beginPath();
        const full = Math.abs(num(c.end) - num(c.start)) >= 360;
        if (fill && !full) ctx.moveTo(num(c.cx), num(c.cy));
        ctx.arc(num(c.cx), num(c.cy), Math.max(0, num(c.r)), a0, a1);
        if (fill && !full) ctx.closePath();
        paint();
        break;
      }
      case "polygon": {
        const pts = (Array.isArray(c.points) ? c.points : []).filter((p): p is unknown[] => Array.isArray(p));
        if (pts.length < 2) break;
        ctx.beginPath();
        ctx.moveTo(num(pts[0][0]), num(pts[0][1]));
        for (const p of pts.slice(1)) ctx.lineTo(num(p[0]), num(p[1]));
        if (c.closed) {
          ctx.closePath();
          paint();
        } else strokeIt();
        break;
      }
      case "text":
        ctx.fillStyle = fill || color("currentColor");
        ctx.font = `${num(c.size, 12)}px system-ui, sans-serif`;
        ctx.textAlign = ({ start: "left", middle: "center", end: "right" } as Record<string, CanvasTextAlign>)[String(c.anchor)] || "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(String(c.text ?? ""), num(c.x), num(c.y)); // canvas text: never parsed as HTML
        break;
      case "image": {
        const img = this.images.get(c);
        if (!img) break;
        if (img instanceof ImageData) ctx.putImageData(img, num(c.x), num(c.y));
        else ctx.drawImage(img, num(c.x), num(c.y), num(c.w, img.width), num(c.h, img.height));
        break;
      }
      default:
        break;
    }
  }
}
