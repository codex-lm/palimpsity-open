import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { cpus, totalmem, tmpdir } from "node:os";
import path from "node:path";

export const FAMILIES = ["banks", "works", "gardens"];
export const VIEWPORTS = [
  { id: "1280x720", width: 1280, height: 720, dpr: 1 },
  { id: "1920x1080-high", width: 1920, height: 1080, dpr: 2 },
  { id: "390x844-high", width: 390, height: 844, dpr: 2 },
  { id: "3840x2160", width: 3840, height: 2160, dpr: 1 },
];

export function expectedModuleKeys() {
  const keys = ["base_civic", "conversion_workshop_repair", "conversion_warehouse_hall"];
  for (const family of FAMILIES) {
    keys.push(`base_warehouse_${family}`, `base_shop_${family}`, `roof_garden_${family}`, `roof_productive_${family}`);
    for (let variant = 0; variant < 3; variant++) {
      keys.push(`base_house_${family}_${variant}`, `floor_${family}_${variant}`);
      if (variant < 2) keys.push(`base_workshop_${family}_${variant}`, `roof_traditional_${family}_${variant}`);
    }
  }
  return keys.sort();
}

export function validateArchitecture(profile) {
  return !!profile && ["residential", "shop", "workshop", "warehouse", "civic"].includes(profile.base)
    && Number.isInteger(profile.floors) && profile.floors >= 1 && profile.floors <= 4
    && ["traditional", "garden", "productive"].includes(profile.roof)
    && FAMILIES.includes(profile.family) && [0, 1, 2].includes(profile.variant);
}

export function findChrome() {
  return process.env.CHROME_EXE || [
    path.join(process.env.PROGRAMFILES || "C:/Program Files", "Google/Chrome/Application/chrome.exe"),
    path.join(process.env.LOCALAPPDATA || "C:/Users/Default/AppData/Local", "Google/Chrome/Application/chrome.exe"),
    path.join(process.env.PROGRAMFILES || "C:/Program Files", "Microsoft/Edge/Application/msedge.exe"),
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find(existsSync);
}

export function machineInfo() {
  const processor = cpus()[0];
  return {
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    processor: processor?.model || "unknown",
    logicalProcessors: cpus().length,
    totalMemoryBytes: totalmem(),
  };
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export class LivingLayersBrowser {
  constructor({ dist, captures, frames = 60 }) {
    assert.equal(typeof WebSocket, "function", "Node 22+ is required for the built-in WebSocket client.");
    assert.ok(existsSync(dist), `Standalone game not found: ${dist}`);
    this.dist = dist;
    this.captures = captures;
    this.sampleFrames = frames;
    this.profile = mkdtempSync(path.join(tmpdir(), "palimpsity-living-layers-"));
    this.pending = new Map();
    this.serial = 0;
    this.exceptions = [];
    this.pageErrors = [];
    this.blocked = [];
    this.requests = [];
    this.scenario = "launch";
    this.interrupted = false;
    this.exited = false;
    this.stderr = "";
    this.screenshots = [];
    this.abort = () => {
      this.interrupted = true;
      this.rejectPending(new Error("Living Layers browser recipe interrupted"));
    };
    process.once("SIGINT", this.abort);
    process.once("SIGTERM", this.abort);
    mkdirSync(captures, { recursive: true });
  }

  rejectPending(error) {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  async connect() {
    const chrome = findChrome();
    assert.ok(chrome, "Chrome/Chromium not found; set CHROME_EXE.");
    this.chrome = chrome;
    this.child = spawn(chrome, [
      "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
      "--disable-background-networking", "--disable-component-update", "--disable-sync",
      "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--remote-allow-origins=*",
      "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0",
      `--user-data-dir=${this.profile}`, "--window-size=1280,720", "about:blank",
    ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    this.child.once("error", error => { this.launchError = error; });
    this.child.once("exit", () => { this.exited = true; });
    this.child.stderr.on("data", data => { this.stderr = (this.stderr + data).slice(-8000); });
    let target;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (this.interrupted) throw new Error("Browser recipe interrupted");
      if (this.launchError) throw new Error(`Cannot launch ${chrome}: ${this.launchError.message}`);
      if (this.exited) throw new Error(`Chrome exited before CDP connected. ${this.stderr}`);
      try {
        const port = Number(readFileSync(path.join(this.profile, "DevToolsActivePort"), "utf8").split("\n")[0]);
        const targets = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) }).then(response => response.json());
        target = targets.find(item => item.type === "page");
        if (target) break;
      } catch {}
      await delay(250);
    }
    assert.ok(target, `Chrome did not expose a CDP page. ${this.stderr}`);
    this.ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP WebSocket connection timed out")), 10000);
      this.ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP WebSocket connection failed")); }, { once: true });
    });
    this.ws.addEventListener("close", () => this.rejectPending(new Error("CDP connection closed")));
    this.ws.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const request = this.pending.get(message.id);
        if (!request) return;
        this.pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
        else request.resolve(message.result);
      } else if (message.method === "Runtime.exceptionThrown") {
        const details = message.params.exceptionDetails;
        this.exceptions.push(details.exception?.description || details.text);
      } else if (message.method === "Network.requestWillBeSent") {
        const url = message.params.request.url;
        this.requests.push(/^(data|blob):/.test(url) ? `${url.split(":")[0]}:` : url);
      } else if (message.method === "Fetch.requestPaused") {
        this.blocked.push(message.params.request.url);
        void this.send("Fetch.failRequest", { requestId: message.params.requestId, errorReason: "InternetDisconnected" })
          .catch(error => this.pageErrors.push(error.message));
      }
    });
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Network.enable");
    await this.send("Performance.enable");
    await this.send("Network.setCacheDisabled", { cacheDisabled: true });
    await this.send("Network.setBypassServiceWorker", { bypass: true });
    await this.send("Fetch.enable", { patterns: [{ urlPattern: "http://*" }, { urlPattern: "https://*" }] });
    await this.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await this.send("Page.addScriptToEvaluateOnNewDocument", { source: `
      window.__livingLayersPageErrors = [];
      addEventListener("error", event => window.__livingLayersPageErrors.push(event.error?.stack || event.message));
      addEventListener("unhandledrejection", event => window.__livingLayersPageErrors.push(String(event.reason?.stack || event.reason)));
    ` });
    const version = await this.send("Browser.getVersion");
    this.browserInfo = { executable: chrome, ...version };
  }

  send(method, params = {}, timeout = 20000) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error(`${method}: CDP is closed`));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: CDP timeout during ${this.scenario}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, timeout = 240000) {
    const response = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeout);
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result.value;
  }

  page(fn, ...args) {
    return this.evaluate(`(${fn.toString()})(${args.map(arg => JSON.stringify(arg)).join(",")})`);
  }

  async waitFor(expression, label, timeout = 45000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (this.interrupted) throw new Error("Browser recipe interrupted");
      if (this.exceptions.length) throw new Error(`${label}: ${this.exceptions.join("\n")}`);
      if (await this.evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(`${this.scenario}: timeout waiting for ${label}`);
  }

  async frames(count = 3) {
    await this.page(async n => {
      for (let i = 0; i < n; i++) await new Promise(requestAnimationFrame);
    }, count);
  }

  async viewport({ width, height, dpr }) {
    await this.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
    await delay(250);
    await this.frames(5);
  }

  async boot(url) {
    await this.send("Page.navigate", { url });
    await this.waitFor("window.PALIMPSITY?.renderer?.getDebugInfo()?.loaded && document.querySelector('#palette .build')", "standalone game and assets");
    await this.click("#speed button:first-child");
    await this.frames(3);
  }

  async point(selector) {
    return this.page(selector => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`${selector}: missing control`);
      element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (rect.width < 1 || rect.height < 1 || x < 0 || x >= innerWidth || y < 0 || y >= innerHeight || !element.contains(hit)) {
        throw new Error(`${selector}: clipped or covered (${JSON.stringify({ x, y, width: rect.width, height: rect.height, viewport: [innerWidth, innerHeight] })})`);
      }
      return { x, y };
    }, selector);
  }

  async clickPoint({ x, y }, button = "left") {
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, buttons: button === "left" ? 1 : 2, clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, buttons: 0, clickCount: 1 });
    await this.frames();
  }

  async click(selector) {
    await this.clickPoint(await this.point(selector));
  }

  async key(key, code, virtualKey) {
    await this.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: virtualKey });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: virtualKey });
    await this.frames();
  }

  async dismissReports() {
    for (let attempt = 0; attempt < 12; attempt++) {
      await delay(280);
      if (await this.evaluate("document.querySelector('#modal').classList.contains('on')")) await this.key("Escape", "Escape", 27);
      else if (await this.evaluate("!PALIMPSITY.engine.state.reports.some(report => !report._shown)")) return;
    }
    throw new Error("Reports did not drain through Escape");
  }

  async screenshot(name, viewport = null) {
    const result = await this.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false }, 90000);
    const bytes = Buffer.from(result.data, "base64");
    assert.equal(bytes.toString("ascii", 1, 4), "PNG", `${name}: native capture is not a PNG`);
    const actual = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    if (viewport) {
      const expected = { width: Math.round(viewport.width * viewport.dpr), height: Math.round(viewport.height * viewport.dpr) };
      assert.deepEqual(actual, expected, `${name}: capture must retain native device pixels`);
    }
    const file = path.join(this.captures, `${name}.png`);
    writeFileSync(file, bytes);
    const record = { name, file, bytes: bytes.length, ...actual };
    this.screenshots.push(record);
    return record;
  }

  async measure(label, viewport, quality = "high") {
    const sample = await this.page(async count => {
      const renderer = PALIMPSITY.renderer.renderer;
      const gl = renderer.getContext();
      for (let i = 0; i < 15; i++) await new Promise(requestAnimationFrame);
      const deltas = [];
      let previous = await new Promise(requestAnimationFrame);
      for (let i = 0; i < count; i++) {
        const now = await new Promise(requestAnimationFrame);
        deltas.push(now - previous);
        previous = now;
      }
      const sorted = [...deltas].sort((a, b) => a - b);
      const mean = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
      const canvas = renderer.domElement;
      return {
        frames: deltas.length,
        meanFrameMs: mean,
        fps: 1000 / mean,
        p50FrameMs: sorted[Math.floor((sorted.length - 1) * 0.5)],
        p95FrameMs: sorted[Math.floor((sorted.length - 1) * 0.95)],
        maxFrameMs: sorted.at(-1),
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        rendererMemory: { ...renderer.info.memory, programs: renderer.info.programs?.length || 0 },
        jsHeap: performance.memory ? {
          usedBytes: performance.memory.usedJSHeapSize,
          totalBytes: performance.memory.totalJSHeapSize,
          limitBytes: performance.memory.jsHeapSizeLimit,
        } : null,
        css: { width: innerWidth, height: innerHeight },
        canvasCss: { width: canvas.getBoundingClientRect().width, height: canvas.getBoundingClientRect().height },
        devicePixelRatio,
        quality: PALIMPSITY.renderer.quality,
        rendererPixelRatio: renderer.getPixelRatio(),
        drawingBuffer: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight },
      };
    }, this.sampleFrames);
    assert.equal(sample.quality, quality, `${label}: renderer quality must match the requested fixture`);
    const expectedRatio = quality === "high" ? viewport.dpr : quality === "balanced" ? Math.min(viewport.dpr, 1.5) : 1;
    assert.equal(sample.rendererPixelRatio, expectedRatio, `${label}: renderer pixel ratio must follow the ${quality} policy`);
    assert.equal(sample.drawingBuffer.width, Math.round(sample.canvasCss.width * expectedRatio), `${label}: drawing buffer width`);
    assert.equal(sample.drawingBuffer.height, Math.round(sample.canvasCss.height * expectedRatio), `${label}: drawing buffer height`);
    const metrics = await this.send("Performance.getMetrics");
    const cdpMetrics = Object.fromEntries(metrics.metrics.filter(metric => ["JSHeapUsedSize", "JSHeapTotalSize", "Nodes", "Documents"].includes(metric.name)).map(metric => [metric.name, metric.value]));
    return { label, viewport, ...sample, cdpMetrics };
  }

  async close() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try { await this.send("Browser.close", {}, 3000); } catch {}
    }
    for (let i = 0; this.child && !this.exited && !this.launchError && i < 30; i++) await delay(100);
    if (this.child && !this.exited && !this.launchError) {
      this.child.kill();
      for (let i = 0; !this.exited && i < 30; i++) await delay(100);
    }
    this.ws?.close();
    this.rejectPending(new Error("Browser recipe finished"));
    process.removeListener("SIGINT", this.abort);
    process.removeListener("SIGTERM", this.abort);
    assert.equal(path.dirname(this.profile), path.resolve(tmpdir()));
    assert.ok(path.basename(this.profile).startsWith("palimpsity-living-layers-"));
    await rm(this.profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
  }
}
