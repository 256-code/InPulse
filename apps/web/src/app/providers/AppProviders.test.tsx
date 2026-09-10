import { afterEach, describe, expect, it } from "vitest";

import { getCspNonce } from "./AppProviders";

const NONCE = "0123456789abcdef0123456789abcdef";

function appendNonceMeta(nonce: string): void {
  const meta = document.createElement("meta");
  meta.setAttribute("property", "csp-nonce");
  meta.setAttribute("nonce", nonce);
  document.head.appendChild(meta);
}

afterEach(() => {
  for (const meta of document.querySelectorAll('meta[property="csp-nonce"]')) {
    meta.remove();
  }
});

describe("getCspNonce", () => {
  it("reads the per-response nonce injected by Vite or Nginx", () => {
    appendNonceMeta(NONCE);
    expect(getCspNonce()).toBe(NONCE);
  });

  it("returns undefined when the bootstrap meta tag is absent", () => {
    expect(getCspNonce()).toBeUndefined();
  });
});
