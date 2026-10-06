window.CHAT_CONFIG = {
  url: "https://gznpkxqftoqapkbydnzx.supabase.co",
  key: "sb_publishable_Bu0nNehpWZ2dXFtJc7wm7w_QU73JkTn",
  vapidPublic: "BHOU5VyUO6CT9xrekJXRlRGdq2erY7i0KTaOUg2LruEjvLEVFhfsQME0Bxuy3Vjn11fVviAdUqQzQmxaZU5j0yA",
  appName: "Συνομιλίες",
};
window.sb = window.supabase.createClient(CHAT_CONFIG.url, CHAT_CONFIG.key, {
  auth: { persistSession: true, autoRefreshToken: true },
  realtime: { params: { eventsPerSecond: 20 } },
});
window.callFn = async function (name, body) {
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(`${CHAT_CONFIG.url}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: CHAT_CONFIG.key,
      Authorization: `Bearer ${session?.access_token ?? CHAT_CONFIG.key}`,
    },
    body: JSON.stringify(body),
  });
  let out = {};
  try { out = await res.json(); } catch {}
  if (!res.ok) throw new Error(out.error || `Σφάλμα ${res.status}`);
  return out;
};
window.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
window.initials = (n) => String(n || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
window.hue = (id) => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
