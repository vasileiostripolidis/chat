/* global sb, CHAT_CONFIG, esc, initials, hue, callFn */
const $ = (id) => document.getElementById(id);
const S = {
  me: null, access: null, profiles: new Map(), convs: [], active: null,
  msgs: new Map(), hasMore: new Map(), online: new Set(), search: "",
  pushOn: false, audio: null,
};

/* ---------- helpers ---------- */
const fmtTime = (d) => new Date(d).toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit" });
function fmtDay(d) {
  const x = new Date(d), t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
  if (x.toDateString() === t.toDateString()) return "Σήμερα";
  if (x.toDateString() === y.toDateString()) return "Χθες";
  return x.toLocaleDateString("el-GR", { weekday: "long", day: "numeric", month: "long" });
}
function fmtShort(d) {
  const x = new Date(d), t = new Date();
  if (x.toDateString() === t.toDateString()) return fmtTime(d);
  return x.toLocaleDateString("el-GR", { day: "numeric", month: "short" });
}
function lastSeenText(id) {
  if (S.online.has(id)) return "Συνδεδεμένος/η τώρα";
  const p = S.profiles.get(id); if (!p?.last_seen) return "";
  const mins = Math.round((Date.now() - new Date(p.last_seen)) / 60000);
  if (mins < 60) return `Ενεργός/ή πριν ${Math.max(mins, 1)}′`;
  if (mins < 1440) return `Ενεργός/ή πριν ${Math.round(mins / 60)} ώρ.`;
  return `Ενεργός/ή ${fmtShort(p.last_seen)}`;
}
const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
const nameOf = (id) => S.profiles.get(id)?.display_name || "Άγνωστος";
function avatarHtml(id, name, cls = "", online = false) {
  return `<div class="avatar ${cls}" style="background:hsl(${hue(id)} 55% 48%)">${esc(initials(name))}${online ? '<span class="dot"></span>' : ""}</div>`;
}
function convTitle(c) { return c.kind === "dm" ? nameOf(c.other_user) : c.name; }
function convAvatar(c, cls = "") {
  if (c.kind === "channel") return `<div class="avatar chan-ico ${cls}">#</div>`;
  if (c.kind === "group") return `<div class="avatar ${cls}" style="background:hsl(${hue(c.id)} 35% 45%)">${esc(initials(c.name))}</div>`;
  return avatarHtml(c.other_user, nameOf(c.other_user), cls, S.online.has(c.other_user));
}
function toast(msg, ms = 2800) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}
function modal(html, onMount) {
  const root = $("modalRoot");
  root.innerHTML = `<div class="modal-bg"><div class="modal">${html}</div></div>`;
  const bg = root.firstElementChild;
  bg.addEventListener("click", (e) => { if (e.target === bg) closeModal(); });
  onMount?.(bg.firstElementChild);
}
function closeModal() { $("modalRoot").innerHTML = ""; }
function show(id) { for (const x of ["auth", "denied", "app"]) $(x).classList.toggle("hidden", x !== id); }

/* ---------- auth ---------- */
let regMode = false;
function setMode(r) {
  regMode = r;
  $("tabLogin").classList.toggle("on", !r); $("tabReg").classList.toggle("on", r);
  $("fName").classList.toggle("hidden", !r); $("regHint").classList.toggle("hidden", !r);
  $("loginHint").classList.toggle("hidden", r);
  $("authBtn").textContent = r ? "Δημιουργία λογαριασμού" : "Σύνδεση";
  $("fPass").autocomplete = r ? "new-password" : "current-password";
  $("authErr").textContent = "";
}
$("tabLogin").onclick = () => setMode(false);
$("tabReg").onclick = () => setMode(true);
$("authForm").onsubmit = async (e) => {
  e.preventDefault();
  const email = $("fEmail").value.trim().toLowerCase(), password = $("fPass").value, name = $("fName").value.trim();
  $("authErr").textContent = ""; $("authBtn").disabled = true;
  try {
    if (regMode) {
      if (!name) throw new Error("Γράψε το όνομά σου.");
      await callFn("register", { email, password, name });
    }
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(/invalid/i.test(error.message) ? "Λάθος email ή κωδικός." : /banned/i.test(error.message) ? "Η πρόσβασή σου έχει ανακληθεί." : error.message);
    await start();
  } catch (err) { $("authErr").textContent = err.message; }
  finally { $("authBtn").disabled = false; }
};
async function logout() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    if (sub) { await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint); await sub.unsubscribe(); }
  } catch {}
  await sb.auth.signOut(); location.href = location.pathname;
}
window.logout = logout;

/* ---------- boot ---------- */
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { show("auth"); return; }
  await start();
}
let started = false;
async function start() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { show("auth"); return; }
  S.me = user;
  const { data: acc } = await sb.rpc("my_access");
  S.access = acc;
  if (!acc || acc.status !== "active") { show("denied"); return; }
  if (started) return; started = true;
  show("app");
  $("adminLink").classList.toggle("hidden", acc.role !== "admin");
  await loadProfiles();
  renderMe();
  await loadConvs();
  setupRealtime();
  heartbeat(); setInterval(heartbeat, 120000);
  setupNotifications();
  const c = new URLSearchParams(location.search).get("c");
  if (c && S.convs.some((x) => x.id === c)) openConv(c);
  else if (window.innerWidth > 760 && S.convs.length) openConv(S.convs.find((x) => x.kind === "channel")?.id || S.convs[0].id);
}
sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") { started = false; show("auth"); } });

async function loadProfiles() {
  const { data } = await sb.from("profiles").select("id, display_name, email, last_seen").order("display_name");
  S.profiles = new Map((data || []).map((p) => [p.id, p]));
}
function renderMe() {
  const p = S.profiles.get(S.me.id) || { display_name: S.me.email };
  $("meName").textContent = p.display_name;
  $("meAvatar").outerHTML = avatarHtml(S.me.id, p.display_name, "sm").replace('class="avatar sm"', 'class="avatar sm" id="meAvatar"');
}
async function heartbeat() { await sb.from("profiles").update({ last_seen: new Date().toISOString() }).eq("id", S.me.id); }

/* ---------- conversations ---------- */
async function loadConvs() {
  const { data, error } = await sb.rpc("my_conversations");
  if (error) { toast("Σφάλμα φόρτωσης: " + error.message); return; }
  S.convs = data || [];
  const unknown = S.convs.some((c) => c.other_user && !S.profiles.has(c.other_user));
  if (unknown) await loadProfiles();
  renderList(); updateBadge();
}
function renderList() {
  const q = S.search.toLowerCase();
  const items = S.convs.filter((c) => !q || convTitle(c).toLowerCase().includes(q));
  const chans = items.filter((c) => c.kind === "channel");
  const rest = items.filter((c) => c.kind !== "channel");
  const row = (c) => {
    const last = c.last_body ? `${c.last_user === S.me.id ? "Εσύ: " : c.kind !== "dm" ? esc(nameOf(c.last_user).split(" ")[0]) + ": " : ""}${esc(c.last_body)}` : '<span class="muted">Κανένα μήνυμα ακόμα</span>';
    return `<button class="conv ${c.id === S.active ? "on" : ""} ${c.unread > 0 ? "unread" : ""}" data-id="${c.id}">
      ${convAvatar(c)}
      <div class="meta"><div class="row"><div class="name" style="flex:1">${esc(convTitle(c))}${c.muted ? " 🔕" : ""}</div><span class="muted" style="font-size:12px">${c.last_body ? fmtShort(c.last_message_at) : ""}</span></div>
      <div class="row"><div class="last" style="flex:1">${last}</div>${c.unread > 0 ? `<span class="badge">${c.unread > 99 ? "99+" : c.unread}</span>` : ""}</div></div>
    </button>`;
  };
  let html = "";
  if (chans.length) html += `<div class="section-label">Κανάλια</div>` + chans.map(row).join("");
  html += `<div class="section-label">Μηνύματα</div>`;
  html += rest.length ? rest.map(row).join("") : `<div class="muted" style="padding:8px;font-size:14px">Πάτα <b>+</b> για να στείλεις μήνυμα σε κάποιον ή να φτιάξεις ομάδα.</div>`;
  $("list").innerHTML = html;
}
$("list").onclick = (e) => { const b = e.target.closest(".conv"); if (b) openConv(b.dataset.id); };
$("search").oninput = (e) => { S.search = e.target.value; renderList(); };
function updateBadge() {
  const n = S.convs.filter((c) => !c.muted).reduce((a, c) => a + Number(c.unread || 0), 0);
  document.title = n ? `(${n}) ${CHAT_CONFIG.appName}` : CHAT_CONFIG.appName;
  try { n ? navigator.setAppBadge?.(n) : navigator.clearAppBadge?.(); } catch {}
}

/* ---------- chat ---------- */
async function openConv(id) {
  const c = S.convs.find((x) => x.id === id); if (!c) return;
  S.active = id;
  $("app").classList.add("in-chat");
  $("placeholder").classList.add("hidden"); $("chat").classList.remove("hidden");
  renderHead(); renderList();
  history.replaceState(null, "", "?c=" + id);
  if (!S.msgs.has(id)) {
    $("msgs").innerHTML = `<div class="empty">Φόρτωση…</div>`;
    await loadMessages(id);
  }
  if (S.active !== id) return;
  renderMsgs(true);
  markRead(id);
  if (window.innerWidth > 760) $("text").focus();
}
function renderHead() {
  const c = S.convs.find((x) => x.id === S.active); if (!c) return;
  $("chatAvatar").outerHTML = convAvatar(c).replace('class="avatar', 'id="chatAvatar" class="avatar');
  $("chatTitle").textContent = (c.kind === "channel" ? "# " : "") + convTitle(c);
  $("chatSub").textContent = c.kind === "dm" ? lastSeenText(c.other_user) : c.kind === "channel" ? "Κανάλι για όλους" : "Ομάδα";
}
async function loadMessages(id, before) {
  let q = sb.from("messages").select("id, conversation_id, user_id, body, created_at").eq("conversation_id", id).order("created_at", { ascending: false }).limit(50);
  if (before) q = q.lt("created_at", before);
  const { data, error } = await q;
  if (error) { toast(error.message); return; }
  const rows = (data || []).reverse();
  const cur = S.msgs.get(id) || [];
  S.msgs.set(id, before ? [...rows, ...cur] : rows);
  S.hasMore.set(id, (data || []).length === 50);
  if (rows.some((m) => !S.profiles.has(m.user_id))) await loadProfiles();
}
function renderMsgs(scrollBottom) {
  const box = $("msgs"); const list = S.msgs.get(S.active) || [];
  const c = S.convs.find((x) => x.id === S.active);
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  if (!list.length) { box.innerHTML = `<div class="empty">Δεν υπάρχουν μηνύματα ακόμα.<br>Πες ένα γεια! 👋</div>`; return; }
  let html = S.hasMore.get(S.active) ? `<button class="btn ghost sm older" id="olderBtn">Παλαιότερα μηνύματα</button>` : "";
  let lastDay = "";
  list.forEach((m, i) => {
    const day = new Date(m.created_at).toDateString();
    if (day !== lastDay) { html += `<div class="day">${fmtDay(m.created_at)}</div>`; lastDay = day; }
    const prev = list[i - 1], next = list[i + 1];
    const same = (a, b) => a && b && a.user_id === b.user_id && Math.abs(new Date(a.created_at) - new Date(b.created_at)) < 300000 && new Date(a.created_at).toDateString() === new Date(b.created_at).toDateString();
    const first = !same(prev, m), last = !same(m, next);
    const mine = m.user_id === S.me.id;
    const canDel = mine || S.access?.role === "admin";
    html += `<div class="m ${mine ? "mine" : ""} ${first ? "first" : ""} ${last ? "last" : ""} ${m.pending ? "pending" : ""}" data-id="${m.id}">
      ${mine ? "" : avatarHtml(m.user_id, nameOf(m.user_id), "sm")}
      <div class="bubble">${first && !mine && c?.kind !== "dm" ? `<div class="who" style="color:hsl(${hue(m.user_id)} 55% 50%)">${esc(nameOf(m.user_id))}</div>` : ""}${linkify(m.body)}<span class="time">${fmtTime(m.created_at)}</span></div>
      ${canDel && !m.pending ? `<button class="del" data-del="${m.id}" title="Διαγραφή">✕</button>` : ""}
    </div>`;
  });
  box.innerHTML = html;
  if (scrollBottom || nearBottom) box.scrollTop = box.scrollHeight;
  const ob = $("olderBtn");
  if (ob) ob.onclick = async () => {
    const h = box.scrollHeight; await loadMessages(S.active, list[0].created_at);
    renderMsgs(false); box.scrollTop = box.scrollHeight - h;
  };
}
$("msgs").onclick = async (e) => {
  const d = e.target.closest("[data-del]"); if (!d) return;
  if (!confirm("Διαγραφή μηνύματος;")) return;
  const { error } = await sb.from("messages").delete().eq("id", d.dataset.del);
  if (error) toast(error.message); else removeMessage(Number(d.dataset.del));
};
function removeMessage(id) {
  for (const [cid, list] of S.msgs) {
    const i = list.findIndex((m) => m.id === id);
    if (i >= 0) { list.splice(i, 1); if (cid === S.active) renderMsgs(false); }
  }
}
async function markRead(id) {
  const c = S.convs.find((x) => x.id === id); if (!c) return;
  const now = new Date().toISOString();
  c.unread = 0; renderList(); updateBadge();
  const { data } = await sb.from("conversation_members").update({ last_read_at: now }).eq("conversation_id", id).eq("user_id", S.me.id).select("user_id");
  if (!data?.length && c.kind === "channel") await sb.from("conversation_members").insert({ conversation_id: id, user_id: S.me.id, last_read_at: now });
}
const ta = $("text");
ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 140) + "px"; });
ta.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && window.innerWidth > 760) { e.preventDefault(); $("composer").requestSubmit(); }
});
$("composer").onsubmit = async (e) => {
  e.preventDefault();
  const body = ta.value.trim(); if (!body || !S.active) return;
  const cid = S.active;
  ta.value = ""; ta.style.height = "auto";
  const temp = { id: "tmp" + Date.now(), conversation_id: cid, user_id: S.me.id, body, created_at: new Date().toISOString(), pending: true };
  S.msgs.get(cid)?.push(temp); renderMsgs(true);
  const { data, error } = await sb.from("messages").insert({ conversation_id: cid, body }).select("id, conversation_id, user_id, body, created_at").single();
  const list = S.msgs.get(cid) || [];
  const i = list.indexOf(temp);
  if (error) {
    if (i >= 0) list.splice(i, 1);
    ta.value = body; toast("Δεν στάλθηκε: " + error.message);
  } else if (i >= 0) {
    if (list.some((m) => m.id === data.id)) list.splice(i, 1); else list[i] = data;
    bumpConv(data);
  }
  if (S.active === cid) renderMsgs(true);
};
function bumpConv(m) {
  const c = S.convs.find((x) => x.id === m.conversation_id); if (!c) return;
  c.last_body = m.body; c.last_user = m.user_id; c.last_message_at = m.created_at;
  S.convs.sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));
  renderList();
}
$("backBtn").onclick = () => { $("app").classList.remove("in-chat"); S.active = null; history.replaceState(null, "", location.pathname); renderList(); };

/* ---------- realtime ---------- */
function setupRealtime() {
  sb.channel("db")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) => onNewMessage(p.new))
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "messages" }, (p) => removeMessage(p.old.id))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "conversation_members", filter: `user_id=eq.${S.me.id}` }, () => loadConvs())
    .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, (p) => { if (p.eventType !== "UPDATE") loadConvs(); })
    .subscribe((status) => { if (status === "SUBSCRIBED" && S.wasDown) { S.wasDown = false; resync(); } if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") S.wasDown = true; });

  const pres = sb.channel("online", { config: { presence: { key: S.me.id } } });
  pres.on("presence", { event: "sync" }, () => {
    S.online = new Set(Object.keys(pres.presenceState()));
    renderList(); if (S.active) renderHead();
  }).subscribe(async (st) => { if (st === "SUBSCRIBED") await pres.track({ at: Date.now() }); });
}
async function resync() {
  await loadConvs();
  S.msgs.clear();
  if (S.active) { await loadMessages(S.active); renderMsgs(true); }
}
async function onNewMessage(m) {
  let c = S.convs.find((x) => x.id === m.conversation_id);
  if (!c) { await loadConvs(); c = S.convs.find((x) => x.id === m.conversation_id); if (!c) return; }
  if (!S.profiles.has(m.user_id)) await loadProfiles();
  const list = S.msgs.get(m.conversation_id);
  if (list && !list.some((x) => x.id === m.id)) {
    if (m.user_id === S.me.id && list.some((x) => x.pending && x.body === m.body)) { /* our own, handled by send */ }
    else list.push(m);
  }
  bumpConv(m);
  if (m.user_id === S.me.id) return;
  const viewing = S.active === m.conversation_id && document.visibilityState === "visible";
  if (viewing) { renderMsgs(false); markRead(m.conversation_id); return; }
  if (S.active === m.conversation_id) renderMsgs(false);
  c.unread = Number(c.unread || 0) + 1; renderList(); updateBadge();
  if (c.muted) return;
  ping();
  if (document.visibilityState !== "visible" && !S.pushOn && Notification?.permission === "granted") {
    try {
      const n = new Notification(c.kind === "dm" ? nameOf(m.user_id) : `${convTitle(c)} · ${nameOf(m.user_id)}`, { body: m.body.slice(0, 180), tag: c.id, icon: "icon-192.png" });
      n.onclick = () => { window.focus(); openConv(c.id); n.close(); };
    } catch {}
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && S.active) { renderMsgs(false); markRead(S.active); heartbeat(); }
});
function ping() {
  try {
    S.audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const a = S.audio, t = a.currentTime;
    [880, 1320].forEach((f, i) => {
      const o = a.createOscillator(), g = a.createGain();
      o.frequency.value = f; o.type = "sine";
      g.gain.setValueAtTime(0.0001, t + i * 0.12); g.gain.exponentialRampToValueAtTime(0.15, t + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.12 + 0.18);
      o.connect(g).connect(a.destination); o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.2);
    });
  } catch {}
}
document.addEventListener("click", () => { try { S.audio ||= new (window.AudioContext || window.webkitAudioContext)(); S.audio.resume(); } catch {} }, { once: true });

/* ---------- notifications (Web Push) ---------- */
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
function b64ToU8(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
async function setupNotifications() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("message", (e) => { if (e.data?.type === "open" && e.data.conv) openConv(e.data.conv); });
  }
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") await subscribePush(true);
  else if (Notification.permission === "default") $("notifBanner").classList.remove("hidden");
}
async function subscribePush(silent) {
  try {
    if (!pushSupported()) {
      if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
      return Notification.permission === "granted";
    }
    const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    $("notifBanner").classList.toggle("hidden", perm !== "default");
    if (perm !== "granted") { if (!silent) toast("Οι ειδοποιήσεις είναι μπλοκαρισμένες από τον browser."); return false; }
    const reg = await navigator.serviceWorker.register("sw.js"); await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(CHAT_CONFIG.vapidPublic) });
    const j = sub.toJSON();
    const { error } = await sb.from("push_subscriptions").upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_id: S.me.id }, { onConflict: "endpoint" });
    if (error) throw error;
    S.pushOn = true;
    if (!silent) toast("Οι ειδοποιήσεις ενεργοποιήθηκαν ✓");
    return true;
  } catch (err) {
    if (!silent) toast("Δεν ενεργοποιήθηκαν οι ειδοποιήσεις: " + (err.message || err));
    return false;
  }
}
$("notifBtn").onclick = () => subscribePush(false);

/* ---------- modals ---------- */
$("newBtn").onclick = () => {
  const people = [...S.profiles.values()].filter((p) => p.id !== S.me.id).sort((a, b) => a.display_name.localeCompare(b.display_name, "el"));
  let mode = "dm";
  const draw = (m) => {
    const q = (m.querySelector("#pq")?.value || "").toLowerCase();
    const shown = people.filter((p) => !q || p.display_name.toLowerCase().includes(q) || p.email.includes(q));
    m.querySelector("#plist").innerHTML = shown.length ? shown.map((p) => `<label class="pick" data-id="${p.id}">
        ${mode === "group" ? `<input type="checkbox" value="${p.id}">` : ""}
        ${avatarHtml(p.id, p.display_name, "sm", S.online.has(p.id))}
        <div style="min-width:0"><div style="font-weight:600">${esc(p.display_name)}</div><div class="muted" style="font-size:12.5px">${esc(p.email)}</div></div></label>`).join("")
      : `<div class="muted" style="padding:8px">Δεν βρέθηκαν άτομα. Μόνο όσοι έχουν κάνει εγγραφή εμφανίζονται εδώ.</div>`;
  };
  modal(`<h3>Νέα συνομιλία</h3>
    <div class="tabs" style="margin:0 0 12px"><button id="tDm" class="on">Προσωπικό μήνυμα</button><button id="tGr">Ομάδα</button></div>
    <input id="gname" class="input hidden" placeholder="Όνομα ομάδας" maxlength="80" style="margin-bottom:8px">
    <input id="pq" class="input" placeholder="Αναζήτηση ατόμων…">
    <div id="plist" class="pick-list"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn ghost" id="mClose">Άκυρο</button><button class="btn hidden" id="mCreate">Δημιουργία ομάδας</button></div>`, (m) => {
    const setM = (x) => { mode = x; m.querySelector("#tDm").classList.toggle("on", x === "dm"); m.querySelector("#tGr").classList.toggle("on", x === "group");
      m.querySelector("#gname").classList.toggle("hidden", x !== "group"); m.querySelector("#mCreate").classList.toggle("hidden", x !== "group"); draw(m); };
    m.querySelector("#tDm").onclick = () => setM("dm");
    m.querySelector("#tGr").onclick = () => setM("group");
    m.querySelector("#pq").oninput = () => draw(m);
    m.querySelector("#mClose").onclick = closeModal;
    m.querySelector("#plist").onclick = async (e) => {
      if (mode !== "dm") return;
      const p = e.target.closest(".pick"); if (!p) return;
      const { data, error } = await sb.rpc("get_or_create_dm", { other: p.dataset.id });
      if (error) return toast(error.message);
      closeModal(); await loadConvs(); openConv(data);
    };
    m.querySelector("#mCreate").onclick = async () => {
      const name = m.querySelector("#gname").value.trim();
      const ids = [...m.querySelectorAll("#plist input:checked")].map((i) => i.value);
      if (!name) return toast("Δώσε όνομα στην ομάδα.");
      if (!ids.length) return toast("Διάλεξε τουλάχιστον ένα άτομο.");
      const { data, error } = await sb.rpc("create_group", { group_name: name, member_ids: ids });
      if (error) return toast(error.message);
      closeModal(); await loadConvs(); openConv(data);
    };
    draw(m);
  });
};

$("infoBtn").onclick = async () => {
  const c = S.convs.find((x) => x.id === S.active); if (!c) return;
  let members = [];
  if (c.kind !== "channel") {
    const { data } = await sb.from("conversation_members").select("user_id").eq("conversation_id", c.id);
    members = (data || []).map((x) => x.user_id);
  }
  const isAdmin = S.access?.role === "admin";
  modal(`<h3>${c.kind === "channel" ? "# " : ""}${esc(convTitle(c))}</h3>
    <div class="stack">
      <label class="row" style="justify-content:space-between"><span>Σίγαση ειδοποιήσεων</span><input type="checkbox" id="mute" ${c.muted ? "checked" : ""} style="width:20px;height:20px"></label>
      ${c.kind === "channel" ? `<div class="muted">Όλοι οι χρήστες βλέπουν και γράφουν σε αυτό το κανάλι.</div>` : `<div class="section-label" style="padding-left:0">Μέλη (${members.length})</div>
      <div>${members.map((id) => `<div class="pick">${avatarHtml(id, nameOf(id), "sm", S.online.has(id))}<div>${esc(nameOf(id))}${id === S.me.id ? ' <span class="muted">(εσύ)</span>' : ""}</div></div>`).join("")}</div>`}
      ${c.kind === "group" ? `<div class="row"><button class="btn ghost sm" id="addM">+ Προσθήκη μελών</button><button class="btn ghost sm" id="leave" style="color:var(--danger)">Αποχώρηση</button></div>` : ""}
      ${c.kind === "channel" && isAdmin ? `<button class="btn danger sm" id="delChan">Διαγραφή καναλιού</button>` : ""}
      <div class="row" style="justify-content:flex-end"><button class="btn ghost" id="mClose">Κλείσιμο</button></div>
    </div>`, (m) => {
    m.querySelector("#mClose").onclick = closeModal;
    m.querySelector("#mute").onchange = async (e) => {
      const muted = e.target.checked;
      const { data } = await sb.from("conversation_members").update({ muted }).eq("conversation_id", c.id).eq("user_id", S.me.id).select("user_id");
      if (!data?.length) await sb.from("conversation_members").insert({ conversation_id: c.id, user_id: S.me.id, muted });
      c.muted = muted; renderList(); updateBadge();
    };
    m.querySelector("#leave")?.addEventListener("click", async () => {
      if (!confirm("Αποχώρηση από την ομάδα;")) return;
      const { error } = await sb.from("conversation_members").delete().eq("conversation_id", c.id).eq("user_id", S.me.id);
      if (error) return toast(error.message);
      closeModal(); S.active = null; $("chat").classList.add("hidden"); $("placeholder").classList.remove("hidden"); $("app").classList.remove("in-chat"); loadConvs();
    });
    m.querySelector("#delChan")?.addEventListener("click", async () => {
      if (!confirm("Να διαγραφεί το κανάλι και όλα τα μηνύματά του;")) return;
      const { error } = await sb.from("conversations").delete().eq("id", c.id);
      if (error) return toast(error.message);
      closeModal(); S.active = null; $("chat").classList.add("hidden"); $("placeholder").classList.remove("hidden"); loadConvs();
    });
    m.querySelector("#addM")?.addEventListener("click", () => {
      const cand = [...S.profiles.values()].filter((p) => !members.includes(p.id));
      modal(`<h3>Προσθήκη μελών</h3><div class="pick-list">${cand.map((p) => `<label class="pick"><input type="checkbox" value="${p.id}">${avatarHtml(p.id, p.display_name, "sm")}<div>${esc(p.display_name)}</div></label>`).join("") || '<div class="muted" style="padding:8px">Όλοι είναι ήδη μέλη.</div>'}</div>
        <div class="row" style="justify-content:flex-end"><button class="btn ghost" id="x">Άκυρο</button><button class="btn" id="ok">Προσθήκη</button></div>`, (m2) => {
        m2.querySelector("#x").onclick = closeModal;
        m2.querySelector("#ok").onclick = async () => {
          const ids = [...m2.querySelectorAll("input:checked")].map((i) => i.value);
          if (!ids.length) return closeModal();
          const { error } = await sb.rpc("add_group_members", { conv: c.id, member_ids: ids });
          if (error) return toast(error.message);
          closeModal(); toast("Προστέθηκαν ✓");
        };
      });
    });
  });
};

$("settingsBtn").onclick = () => {
  const p = S.profiles.get(S.me.id);
  const perm = "Notification" in window ? Notification.permission : "unsupported";
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.navigator.standalone;
  modal(`<h3>Ρυθμίσεις</h3>
    <div class="stack">
      <div class="muted" style="font-size:13px">${esc(S.me.email)}</div>
      <label>Όνομα εμφάνισης<input id="sName" class="input" value="${esc(p?.display_name)}" maxlength="60"></label>
      <button class="btn sm" id="sSave">Αποθήκευση ονόματος</button>
      <hr style="border:0;border-top:1px solid var(--line)">
      <label>Νέος κωδικός<input id="sPass" class="input" type="password" minlength="8" autocomplete="new-password" placeholder="τουλάχιστον 8 χαρακτήρες"></label>
      <button class="btn sm ghost" id="sPw">Αλλαγή κωδικού</button>
      <hr style="border:0;border-top:1px solid var(--line)">
      <div><b>Ειδοποιήσεις:</b> ${perm === "granted" ? (S.pushOn ? "ενεργές ✓" : "επιτρέπονται") : perm === "denied" ? "μπλοκαρισμένες — άλλαξέ το από τις ρυθμίσεις του browser (εικονίδιο κλειδαριάς δίπλα στη διεύθυνση)." : perm === "unsupported" ? "δεν υποστηρίζονται εδώ." : "ανενεργές"}</div>
      ${isIOS ? `<div class="muted" style="font-size:13px">Σε iPhone/iPad: πάτα <b>Κοινοποίηση → Προσθήκη στην οθόνη Αφετηρίας</b>, άνοιξε την εφαρμογή από εκεί και ενεργοποίησε τις ειδοποιήσεις.</div>` : ""}
      <div class="row">${perm !== "granted" || !S.pushOn ? `<button class="btn sm" id="sNotif">Ενεργοποίηση</button>` : ""}${perm === "granted" ? `<button class="btn sm ghost" id="sTest">Δοκιμή</button>` : ""}</div>
      <hr style="border:0;border-top:1px solid var(--line)">
      <div class="row" style="justify-content:space-between"><button class="btn ghost" id="sOut" style="color:var(--danger)">Αποσύνδεση</button><button class="btn ghost" id="mClose">Κλείσιμο</button></div>
    </div>`, (m) => {
    m.querySelector("#mClose").onclick = closeModal;
    m.querySelector("#sOut").onclick = logout;
    m.querySelector("#sSave").onclick = async () => {
      const name = m.querySelector("#sName").value.trim(); if (!name) return;
      const { error } = await sb.from("profiles").update({ display_name: name }).eq("id", S.me.id);
      if (error) return toast(error.message);
      S.profiles.get(S.me.id).display_name = name; renderMe(); toast("Αποθηκεύτηκε ✓");
    };
    m.querySelector("#sPw").onclick = async () => {
      const pw = m.querySelector("#sPass").value; if (pw.length < 8) return toast("Τουλάχιστον 8 χαρακτήρες.");
      const { error } = await sb.auth.updateUser({ password: pw });
      toast(error ? error.message : "Ο κωδικός άλλαξε ✓");
    };
    m.querySelector("#sNotif")?.addEventListener("click", async () => { await subscribePush(false); closeModal(); });
    m.querySelector("#sTest")?.addEventListener("click", async () => {
      const reg = await navigator.serviceWorker?.getRegistration();
      const opts = { body: "Έτσι θα εμφανίζονται τα νέα μηνύματα.", icon: "icon-192.png", tag: "test" };
      if (reg) reg.showNotification("Δοκιμαστική ειδοποίηση", opts); else new Notification("Δοκιμαστική ειδοποίηση", opts);
    });
  });
};

boot();
