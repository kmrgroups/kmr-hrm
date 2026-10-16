/* KMR step guide (all apps): when a field is completed, a small bubble points at the next place to look and says what to do.
   One switch (bottom-left "Guide") turns it off for good once the user knows the screens; the choice is remembered on this device.
   Pages can add their own wording with data-guide="text" on any field/button, or call KMRGuide.say(element, text). */
(function () {
  if (window.KMRGuide) return;
  const KEY = "kmr-guide";
  const on = () => { try { return localStorage.getItem(KEY) !== "off"; } catch (e) { return true; } };
  const save = (v) => { try { localStorage.setItem(KEY, v ? "on" : "off"); } catch (e) {} };
  let bub = null, tmr = null, last = 0, swt = null;
  const css = document.createElement("style");
  css.textContent = ".kg-b{position:fixed;z-index:2147483000;max-width:260px;background:#1d4ed8;color:#fff;border-radius:10px;padding:8px 12px 8px 12px;font:600 12.5px/1.35 system-ui,Segoe UI,Arial,sans-serif;box-shadow:0 10px 28px #0007;pointer-events:auto;animation:kgin .18s ease-out}.kg-b small{display:block;font-weight:500;opacity:.9;margin-top:2px}.kg-b i{position:absolute;width:12px;height:12px;background:#1d4ed8;transform:rotate(45deg)}.kg-b u{display:block;margin-top:5px;font:500 11px system-ui;text-decoration:underline;cursor:pointer;opacity:.9}@keyframes kgin{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}.kg-ring{outline:3px solid #60a5fa!important;outline-offset:2px;transition:outline-color .3s}.kg-sw{position:fixed;left:10px;bottom:10px;z-index:2147482000;background:#0f172acc;color:#cbd5e1;border:1px solid #334155;border-radius:999px;padding:4px 10px;font:600 11.5px system-ui;cursor:pointer;opacity:.75;backdrop-filter:blur(4px)}.kg-sw:hover{opacity:1}.kg-sw b{color:#4ade80}.kg-sw.off b{color:#94a3b8}@media print{.kg-b,.kg-sw{display:none!important}}@media(max-width:700px){.kg-sw{bottom:64px}}";
  document.head.appendChild(css);

  const vis = (el) => { if (!el || el.disabled || el.readOnly || el.type === "hidden") return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 4 && r.height > 4 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const skip = (el) => !el || !!el.closest("[data-noguide],.cx-in,.cx-lbox,.cx-side,.cx-tg,.cx-status,.kg-b,.kg-sw");
  const labelOf = (el) => {
    const g = el.getAttribute("data-guide-name") || el.getAttribute("aria-label"); if (g) return g;
    if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) return l.textContent.trim(); }
    const p = el.closest("label"); if (p) { const t = p.cloneNode(true); t.querySelectorAll("input,select,textarea").forEach((x) => x.remove()); const s = t.textContent.trim(); if (s) return s; }
    const prev = el.previousElementSibling; if (prev && /^(LABEL|SPAN|B|DIV)$/.test(prev.tagName) && prev.textContent.trim().length < 40) return prev.textContent.trim();
    return el.placeholder || el.title || el.name || "";
  };
  const isAction = (b) => b.matches('button,[type=submit],[type=button],a.btn,[role=button]') && vis(b);
  const colName = (cell) => { const tb = cell.closest("table"); if (!tb) return ""; const i = [...cell.parentElement.children].indexOf(cell); const th = tb.querySelectorAll("thead th")[i]; return th ? th.textContent.trim() : ""; };
  const tableNext = (cur) => {
    const td = cur.closest("td"), tr = cur.closest("tr"); if (!td || !tr || !cur.closest("tbody")) return null;
    const ctl = (r) => [...r.querySelectorAll("td input,td select")].filter((e) => vis(e) && e.dataset.f !== "unit" && e.dataset.f !== "cls" && e.dataset.f !== "gaugeAdd" && !e.disabled);
    const row = ctl(tr), i = row.indexOf(cur);
    for (let k = i + 1; k < row.length; k++) { const e = row[k]; if (e.tagName === "SELECT" || !String(e.value || "").trim()) return { el: e, kind: "field", col: colName(e.closest("td")) }; }
    const nr = tr.nextElementSibling; if (nr) { const c = ctl(nr)[0]; if (c) return { el: c, kind: "field", col: colName(c.closest("td")), row: true }; }
    return null;
  };
  const nextTarget = (cur) => {
    const tn = tableNext(cur); if (tn) return tn;
    const scope = cur.closest("form,dialog,.modal,.dlg,[role=dialog],.card,.panel,section,main") || document.body;
    const all = [...scope.querySelectorAll("input,select,textarea")].filter((e) => vis(e) && !e.closest("[data-noguide]") && !/^(hidden|file)$/.test(e.type));
    const i = all.indexOf(cur);
    for (let k = i + 1; k < all.length; k++) { const e = all[k]; if (e.type === "checkbox" || e.type === "radio") continue; if (e.tagName === "SELECT" || !String(e.value || "").trim()) return { el: e, kind: "field" }; }
    for (let k = i + 1; k < all.length; k++) { const e = all[k]; if (e.type !== "checkbox" && e.type !== "radio") return { el: e, kind: "field", filled: true }; }
    const btns = [...scope.querySelectorAll('button[type=submit],button.pri,button.primary,button.btn-primary,.btn.pri,.btn.primary,button.save,[data-guide-primary]')].filter(isAction);
    if (btns.length) return { el: btns[0], kind: "action" };
    const bs = [...scope.querySelectorAll("button")].filter(isAction).filter((b) => !/^(×|✕|x|close|cancel|back)$/i.test(b.textContent.trim()));
    if (bs.length) { const after = bs.filter((b) => cur.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); if (after.length) return { el: after[0], kind: "action" }; }
    return null;
  };
  const hide = () => { clearTimeout(tmr); if (bub) { bub.remove(); bub = null; } document.querySelectorAll(".kg-ring").forEach((e) => e.classList.remove("kg-ring")); };
  const say = (el, title, sub, ms) => {
    hide(); if (!on() || !el) return;
    el.scrollIntoView && el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    bub = document.createElement("div"); bub.className = "kg-b"; bub.setAttribute("role", "status");
    bub.innerHTML = '<i></i><span></span><small></small><u>Got it · turn guide off</u>';
    bub.querySelector("span").textContent = title; const sm = bub.querySelector("small"); if (sub) sm.textContent = sub; else sm.remove();
    bub.querySelector("u").onclick = () => { set(false); };
    document.body.appendChild(bub); el.classList.add("kg-ring");
    const place = () => { if (!bub) return; const r = el.getBoundingClientRect(), bw = bub.offsetWidth, bh = bub.offsetHeight, ar = bub.querySelector("i");
      let top = r.bottom + 10, left = Math.max(8, Math.min(r.left, innerWidth - bw - 8)), above = false;
      if (top + bh > innerHeight - 8) { top = r.top - bh - 10; above = true; }
      if (top < 8) top = Math.min(innerHeight - bh - 8, r.bottom + 10);
      bub.style.top = top + "px"; bub.style.left = left + "px";
      ar.style.left = Math.max(10, Math.min(bw - 22, r.left + Math.min(r.width / 2, 40) - left - 6)) + "px"; ar.style[above ? "bottom" : "top"] = "-5px"; ar.style[above ? "top" : "bottom"] = "auto"; };
    place(); setTimeout(place, 220);
    tmr = setTimeout(hide, ms || 7000);
  };
  const nextText = (n) => {
    if (n.el.getAttribute("data-guide")) return [n.el.getAttribute("data-guide")];
    if (n.kind === "action") { const t = (n.el.textContent || n.el.value || "").trim().replace(/\s+/g, " ").slice(0, 30); return ["All set here — now click “" + t + "”", "That is the next step."]; }
    const nm = (n.col || labelOf(n.el)).replace(/[:*]\s*$/, "").trim();
    if (n.row) return ["Next row: " + nm, "This row is done — carry on with the next one."];
    const what = n.el.tagName === "SELECT" ? "choose an option" : n.el.type === "number" || /num|qty|amount/i.test(n.el.name || "") ? "enter the number" : n.el.type === "date" ? "pick the date" : "type it in";
    return [nm ? "Next: " + nm : "Next field", n.filled ? "Already filled — check it, or move on." : "Look here and " + what + "."];
  };
  const onDone = (ev) => {
    if (!on()) return; let el = ev.target; if (!el || !el.matches || !el.matches("input,select,textarea") || skip(el)) return;
    if (el.type === "search" || el.type === "file" || el.type === "range" || el.type === "color") return;
    if ((el.tagName !== "SELECT" && el.type !== "checkbox" && el.type !== "radio") && !String(el.value || "").trim()) return;
    if (el.closest("table") && el.closest("tbody") && el.closest("tr")) { /* table cells: point at the next cell in the same row only */ }
    const now = Date.now(); if (now - last < 500) return; last = now;
    const trId = el.closest("tr") && el.closest("tr").dataset.id, fld = el.dataset && el.dataset.f, eid = el.id, enm = el.name;
    setTimeout(() => {
      if (!on()) return;
      if (!el.isConnected) { const q = trId && fld ? 'tr[data-id="' + trId + '"] [data-f="' + fld + '"]' : eid ? "#" + CSS.escape(eid) : enm ? '[name="' + enm + '"]' : ""; const f = q && document.querySelector(q); if (!f) return; el = f; }
      const n = nextTarget(el); if (!n) return;
      const [t, s] = nextText(n); say(n.el, t, s);
    }, 420);
  };
  document.addEventListener("change", onDone, true);
  document.addEventListener("pointerdown", (e) => { if (bub && !e.target.closest(".kg-b")) hide(); }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); }, true);
  const set = (v) => { save(v); if (!v) hide(); draw(); if (v) say(swt, "Guide is ON", "You will see a hint after each completed field.", 3500); };
  const draw = () => { if (!swt) return; swt.className = "kg-sw" + (on() ? "" : " off"); swt.innerHTML = "💡 Guide: <b>" + (on() ? "ON" : "OFF") + "</b>"; swt.title = on() ? "Step guide is ON — click to turn it off" : "Step guide is OFF — click to turn it on"; };
  const mount = () => { if (swt || !document.body) return; swt = document.createElement("button"); swt.type = "button"; swt.setAttribute("data-noguide", ""); swt.onclick = () => set(!on()); document.body.appendChild(swt); draw(); };
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
  window.KMRGuide = { say: (el, t, s) => say(el, t, s), hide, on, set, point: (el, text) => say(el, text) };
})();
