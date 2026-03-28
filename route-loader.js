(function () {
  const source = String(window.__POLLY_SOURCE__ || "").trim();
  if (!source) {
    document.body.textContent = "Route loader is missing source mapping.";
    return;
  }

  const sourcePath = `../${source}`;
  fetch(sourcePath, { cache: "no-store" })
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load ${source}`);
      return res.text();
    })
    .then((html) => {
      const withBase = html.replace("<head>", '<head>\n  <base href="../" />');
      document.open();
      document.write(withBase);
      document.close();
    })
    .catch((error) => {
      document.body.innerHTML = `<main style="font-family:Arial,sans-serif;padding:1rem;"><h1>Route failed to load</h1><p>${String(error.message || error)}</p></main>`;
    });
})();
