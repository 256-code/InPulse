import { describe, it, expect } from "vitest";

describe("frontend test setup", () => {
  it("vitest and dom setup are functional", () => {
    const div = document.createElement("div");
    div.textContent = "InPulse Web Ready";
    document.body.appendChild(div);
    expect(div).toBeInTheDocument();
  });
});
