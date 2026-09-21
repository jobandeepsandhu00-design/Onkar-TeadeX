self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = event.notification.data && typeof event.notification.data.href === "string"
    ? event.notification.data.href
    : "/onkar-ai/scanner";
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows[0];
    if (existing) {
      await existing.navigate(href);
      return existing.focus();
    }
    return self.clients.openWindow(href);
  })());
});
