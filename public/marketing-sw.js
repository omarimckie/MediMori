/* Marketing Admin Web Push — owner notifications only. */

function isOrderDestination(path) {
  return /^\/admin\/orders\/(physical|digital)\/[0-9a-fA-F-]{36}$/.test(path);
}

function safeDestination(value) {
  if (typeof value !== "string") return "/admin/marketing";
  const path = value.split("?")[0].split("#")[0];
  if (path.startsWith("/admin/marketing") && !path.startsWith("//") && !path.includes("://")) {
    return path;
  }
  if (isOrderDestination(path)) return path;
  return "/admin/marketing";
}

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

  const destination = safeDestination(data.destination);
  const tag = isOrderDestination(destination)
    ? data.notificationId
      ? `tf-order-${data.notificationId}`
      : "tf-order"
    : data.notificationId
      ? `tf-marketing-${data.notificationId}`
      : "tf-marketing";

  event.waitUntil(
    self.registration.showNotification(data.title || "Twilight Feather Marketing", {
      body: data.body || "",
      data: { destination, notificationId: data.notificationId ?? null },
      tag,
      renotify: true,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destination = safeDestination(event.notification?.data?.destination);

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      if (isOrderDestination(destination)) {
        for (const client of clientList) {
          if (client.url.includes(destination) && "focus" in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(destination);
        }
        return undefined;
      }

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
