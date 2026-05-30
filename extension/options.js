const DEFAULT_BACKEND = "http://127.0.0.1:8765";

async function load() {
  const s = await chrome.storage.local.get(["backendUrl", "token"]);
  document.getElementById("backendUrl").value = s.backendUrl || DEFAULT_BACKEND;
  document.getElementById("token").value = s.token || "";
}

document.getElementById("save").addEventListener("click", async () => {
  const backendUrl = document.getElementById("backendUrl").value.trim() || DEFAULT_BACKEND;
  const token = document.getElementById("token").value.trim();
  await chrome.storage.local.set({ backendUrl, token });
  const el = document.getElementById("saved");
  el.textContent = "✓ saved";
  setTimeout(() => (el.textContent = ""), 1500);
});

load();
