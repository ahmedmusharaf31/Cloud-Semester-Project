// Resolves the ALB API base URL at runtime.
//
// Resolution order (first hit wins):
//   1. ?api=<dns>            - query string override (handy for demos)
//   2. window.__CE408_CONFIG__.apiBase - injected by public/config.js at deploy
//   3. localStorage          - remembered from a previous visit / prompt
//   4. prompt()              - last-resort, same as the original storefront
//
// The backend contract is untouched: every call still goes to http://<dns>/...

const STORAGE_KEY = "ce-408_api";
const PLACEHOLDER = "__ALB_DNS__";

function fromQuery(): string | null {
  const m = window.location.search.match(/[?&]api=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function fromConfigFile(): string | null {
  const v = window.__CE408_CONFIG__?.apiBase?.trim();
  if (!v || v === PLACEHOLDER) return null;
  return v;
}

function resolveDns(): string {
  const candidate =
    fromQuery() ||
    fromConfigFile() ||
    localStorage.getItem(STORAGE_KEY) ||
    window.prompt("Enter ALB DNS (no http://, no trailing slash):", "") ||
    "";

  const clean = candidate.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (clean) localStorage.setItem(STORAGE_KEY, clean);
  return clean;
}

export const API_DNS = resolveDns();
export const API_BASE = API_DNS ? `http://${API_DNS}` : "";
