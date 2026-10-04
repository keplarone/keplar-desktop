/**
 * Preload for the small "finish signing in with your browser" window only. The page has no script of its own (its CSP
 * forbids it): this file receives a ready-made view from the main process and draws it with textContent, and sends back
 * one of three fixed action ids. It exposes nothing to the page.
 */
import { ipcRenderer } from "electron";

interface ViewAction {
  id: "cancel" | "retry" | "reopen";
  label: string;
  primary?: boolean;
}
interface View {
  phase: string;
  title: string;
  message: string;
  code?: string;
  actions: ViewAction[];
}

const ACTIONS = new Set(["cancel", "retry", "reopen"]);

function draw(view: View): void {
  const doc = document;
  const main = doc.querySelector("main");
  if (!main) return;
  main.setAttribute("data-phase", String(view.phase));
  if (view.code) main.setAttribute("data-has-code", "");
  else main.removeAttribute("data-has-code");
  const set = (id: string, text: string): void => {
    const el = doc.getElementById(id);
    if (el) el.textContent = text;
  };
  set("t", String(view.title));
  set("m", String(view.message));
  set("c", view.code ? String(view.code) : "");
  const box = doc.getElementById("a");
  if (!box) return;
  box.textContent = "";
  for (const action of view.actions) {
    if (!ACTIONS.has(action.id)) continue;
    const b = doc.createElement("button");
    b.type = "button";
    b.textContent = String(action.label);
    if (action.primary) b.setAttribute("data-primary", "");
    b.addEventListener("click", () => ipcRenderer.send("signin:action", action.id));
    box.appendChild(b);
  }
  ((box.querySelector("button[data-primary]") ?? box.querySelector("button")) as { focus(): void } | null)?.focus();
}

ipcRenderer.on("signin:view", (_event, view: View) => {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => draw(view), { once: true });
  else draw(view);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") ipcRenderer.send("signin:action", "cancel");
});
ipcRenderer.send("signin:ready");
