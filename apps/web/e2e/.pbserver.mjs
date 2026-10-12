// Local interactive driver for the playbook run: one persistent signed-in page per role.
import { chromium } from "@playwright/test";
import http from "node:http";
import fs from "node:fs";
const B = "https://jags-qmp-client-dev.vercel.app";
const OUT = process.env.PB_OUT || new URL("./.state/playbook/", import.meta.url).pathname;
const EMAILS = { admin: "admin@jagsassurance.local", inspector: "inspector@jagsassurance.local", scoped: "inspector.scoped@jagsassurance.local", client: "client@meridian.demo", sub: "subcontractor@voltway.demo", mc: "contractor@gfl.demo", tpi: "tpi@bureauveritas.demo" };
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const pages = {};
const creds = {}; // role -> {email,password} override
async function pageFor(role) {
  if (pages[role]) return pages[role];
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.setDefaultTimeout(30000);
  p.on("dialog", (d) => d.accept().catch(() => {}));
  const c = creds[role] || { email: EMAILS[role], password: "DemoPass123!" };
  await p.goto(B + "/login");
  await p.fill('input[type="email"]', c.email);
  await p.fill('input[type="password"]', c.password);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 }), p.click('button[type="submit"]')]);
  // dismiss terms banner
  await p.getByRole("button", { name: "I accept" }).click({ timeout: 3000 }).catch(() => {});
  pages[role] = p;
  return p;
}
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
http.createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  const { role = "admin", code, shot, setCreds, reset } = JSON.parse(body || "{}");
  try {
    if (setCreds) { creds[role] = setCreds; }
    if (reset && pages[role]) { await pages[role].context().close(); delete pages[role]; }
    let result = null;
    if (code) {
      const p = await pageFor(role);
      const fn = new AsyncFunction("page", "B", "fs", "OUT", "pageFor", code);
      result = await fn(p, B, fs, OUT, pageFor);
      if (shot) await p.screenshot({ path: OUT + shot + ".png", fullPage: true });
    }
    res.end(JSON.stringify({ ok: true, url: pages[role]?.url(), result }, null, 1));
  } catch (e) {
    if (shot && pages[role]) await pages[role].screenshot({ path: OUT + shot + "-err.png", fullPage: true }).catch(() => {});
    res.end(JSON.stringify({ ok: false, url: pages[role]?.url(), error: String(e.message || e).split("\n").slice(0, 6).join("\n") }));
  }
}).listen(Number(process.env.PB_PORT || 4555), () => console.log("ready"));
