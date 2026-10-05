/* Marketing Admin Web Push — owner notifications only. */

self.addEventListener("push", (event) => {
  let data = {
    title: "Twilight Feather Marketing",
    body: "You have a new marketing notification.",
    destination: "/admin/marketing",
    notificationId: null,
  };
  try {
    if (event.data) {
      const parsed = event.data.json();
      if (parsed && typeof parsed === "object") {
        data = { ...data, ...parsed };
      }
    }
  } catch {
    // use defaults
  }

  const destination =
    typeof data.destination === "string" && data.destination.startsWith("/admin/marketing")
      ? data.destination
      : "/admin/marketing";

  event.waitUntil(
    self.registration.showNotification(data.title || "Twilight Feather Marketing", {
      body: data.body || "",
      data: { destination, notificationId: data.notificationId ?? null },
      tag: data.notificationId ? `tf-marketing-${data.notificationId}` : "tf-marketing",
      renotify: true,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destination =
    event.notification?.data?.destination &&
    typeof event.notification.data.destination === "string" &&
    event.notification.data.destination.startsWith("/admin/marketing")
      ? event.notification.data.destination
      : "/admin/marketing";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes("/admin/marketing") && "focus" in client) {
          client.navigate(destination);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(destination);
      }
      return undefined;
    }),
  );
});
