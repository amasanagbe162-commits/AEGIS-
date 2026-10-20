import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "../src/index.js";

describe("@aegis/core scaffold", () => {
  it("exports its package name", () => {
    expect(PACKAGE_NAME).toBe("@aegis/core");
  });
});
