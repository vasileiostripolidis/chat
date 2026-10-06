self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: "Νέο μήνυμα", body: event.data?.text() }; }
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    // If the app is open and in front, it already shows the message + plays a sound.
    if (d.tag !== "test" && wins.some((w) => w.visibilityState === "visible" && w.focused)) return;
    await self.registration.showNotification(d.title || "Νέο μήνυμα", {
      body: d.body || "",
      icon: "icon-192.png",
      badge: "icon-192.png",
      tag: d.tag || "chat",
      renotify: true,
      data: { conv: d.conv || null },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const conv = event.notification.data?.conv;
  const url = new URL(conv ? `./?c=${conv}` : "./", self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope) && !w.url.includes("admin.html")) {
        await w.focus();
        w.postMessage({ type: "open", conv });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
