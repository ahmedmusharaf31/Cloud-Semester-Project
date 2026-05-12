// Runtime configuration for the GIKI Mart storefront.
//
// This file is intentionally NOT bundled — Vite copies it verbatim into dist/.
// The deploy step replaces the __ALB_DNS__ token with the live ALB DNS name,
// e.g.  sed "s/__ALB_DNS__/$ALB_DNS/g" ...  — identical to the original
// single-file storefront's deploy flow. No AWS or backend changes required.
//
// If the token is left unreplaced (local dev), the app falls back to
// localStorage and finally a one-time prompt, just like before.
window.__CE408_CONFIG__ = {
  apiBase: "__ALB_DNS__",
};
