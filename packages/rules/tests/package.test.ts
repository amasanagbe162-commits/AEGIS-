import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "../src/index.js";

describe("@aegis/rules scaffold", () => {
  it("exports its package name", () => {
    expect(PACKAGE_NAME).toBe("@aegis/rules");
  });
});
