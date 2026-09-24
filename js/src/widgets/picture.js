// PictureControl (SPEC-005..007): display list drawn on a canvas.
import { html, safeColor } from "../core/dom.js";
import { BaseView } from "../core/view.js";

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

export class PictureView extends BaseView {
  constructor(model, el) {
    super(model, el, ["background"]);
    this.canvas = html("canvas", { cls: "awi-canvas" });
    this.body.appendChild(this.canvas);
    this.body.setAttribute("role", "img");
    this.commands = [];
    this.images = new Map(); // command -> CanvasImageSource
    this.listen("msg:custom", (msg, buffers) => this.onMessage(msg, buffers || []));
    this.canvas.addEventListener("pointerdown", (e) => {
      if (!this.interactive) return;
      const r = this.canvas.getBoundingClientRect();
      const [w, h] = this.get("size");
      this.model.send({ type: "click", x: ((e.clientX - r.left) * w) / r.width, y: ((e.clientY - r.top) * h) / r.height, button: e.button });
    });
    this.canvas.addEventListener("contextmenu", (e) => this.interactive && e.preventDefault());
    this.model.send({ type: "sync_request" });
  }

  onMessage(msg, buffers) {
    if (!msg || msg.type !== "draw") return;
    if (msg.clear) {
      this.commands = [];
      this.images.clear();
    }
    const cmds = Array.isArray(msg.commands) ? msg.commands : [];
    const loading = [];
    for (const c of cmds) {
      if (c && c.op === "image" && buffers[c.buffer]) loading.push(this.decode(c, buffers[c.buffer]));
      this.commands.push(c);
    }
    // SPEC-007: the whole batch is rendered in one frame, once images are decoded
    Promise.all(loading).then(() => this.schedule());
  }

  async decode(c, buf) {
    const bytes = buf.buffer ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : new Uint8Array(buf);
    try {
      if (c.mime === "rgba") {
        const data = new ImageData(new Uint8ClampedArray(bytes.slice()), num(c.pw, 1), num(c.ph, 1));
        this.images.set(c, typeof createImageBitmap === "function" ? await createImageBitmap(data) : data);
      } else if (c.mime === "image/png" || c.mime === "image/jpeg") {
        this.images.set(c, await createImageBitmap(new Blob([bytes], { type: c.mime })));
      }
    } catch {
      // undecodable image: skipped
    }
  }

  draw() {
    const [w, h] = this.get("size");
    const dpr = (typeof devicePixelRatio !== "undefined" && devicePixelRatio) || 1;
    const c = this.canvas;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    const ctx = c.getContext?.("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const fg = getComputedStyle(this.root).getPropertyValue("--awi-fg").trim() || "#000";
    const color = (v) => (v === "currentColor" ? fg : safeColor(v));
    const bg = color(this.get("background"));
    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
    }
    for (const cmd of this.commands) this.drawCommand(ctx, cmd, color);
    this.body.setAttribute("aria-label", this.get("label") || "Picture");
  }

  drawCommand(ctx, c, color) {
    if (!c || typeof c !== "object") return;
    const stroke = c.stroke ? color(c.stroke) : "";
    const fill = c.fill ? color(c.fill) : "";
    ctx.lineWidth = num(c.width, 1);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const paint = () => {
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
    };
    switch (c.op) {
      case "line":
        ctx.beginPath();
        ctx.moveTo(num(c.x0), num(c.y0));
        ctx.lineTo(num(c.x1), num(c.y1));
        if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
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
        const pts = Array.isArray(c.points) ? c.points : [];
        if (pts.length < 2) break;
        ctx.beginPath();
        ctx.moveTo(num(pts[0][0]), num(pts[0][1]));
        for (const p of pts.slice(1)) ctx.lineTo(num(p[0]), num(p[1]));
        if (c.closed) ctx.closePath();
        if (c.closed) paint();
        else if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
        break;
      }
      case "text":
        ctx.fillStyle = fill || color("currentColor");
        ctx.font = `${num(c.size, 12)}px system-ui, sans-serif`;
        ctx.textAlign = { start: "left", middle: "center", end: "right" }[c.anchor] || "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(String(c.text ?? ""), num(c.x), num(c.y)); // canvas text: never parsed as HTML
        break;
      case "image": {
        const img = this.images.get(c);
        if (!img) break;
        const iw = c.w ?? img.width;
        const ih = c.h ?? img.height;
        if (img instanceof ImageData) ctx.putImageData(img, num(c.x), num(c.y));
        else ctx.drawImage(img, num(c.x), num(c.y), num(iw, img.width), num(ih, img.height));
        break;
      }
      default:
        break;
    }
  }
}
