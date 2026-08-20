(() => {
  const leftForPdfKey = "whizzup-pdf-opening-left";

  if (sessionStorage.getItem(leftForPdfKey) === "1") {
    sessionStorage.removeItem(leftForPdfKey);
    window.setTimeout(() => window.close(), 0);
    return;
  }

  window.addEventListener("pagehide", () => {
    sessionStorage.setItem(leftForPdfKey, "1");
  }, { once: true });

  window.addEventListener("pageshow", (event) => {
    if (!event.persisted || sessionStorage.getItem(leftForPdfKey) !== "1") return;
    sessionStorage.removeItem(leftForPdfKey);
    window.setTimeout(() => window.close(), 0);
  });
})();
