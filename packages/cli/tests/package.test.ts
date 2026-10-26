import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "../src/index.js";

describe("aegis-engineering package", () => {
  it("exports its package name", () => {
    expect(PACKAGE_NAME).toBe("aegis-engineering");
  });
});

describe("release safety of the package metadata", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    name: string;
    private?: boolean;
    bin: Record<string, string>;
  };

  it("uses the chosen npm name, offers both command names, and stays private until a deliberate release", () => {
    expect(pkg.name).toBe("aegis-engineering");
    expect(pkg.bin).toEqual({ aegis: "bin/aegis.js", "aegis-engineering": "bin/aegis.js" });
    expect(pkg.private).toBe(true);
  });

  it("no workspace package can be published by accident", () => {
    for (const dir of ["core", "rules", "integrations", "cli"]) {
      const p = JSON.parse(
        readFileSync(new URL(`../../${dir}/package.json`, import.meta.url), "utf8"),
      ) as { private?: boolean };
      expect(p.private, `${dir} must stay private`).toBe(true);
    }
    const root = JSON.parse(
      readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
    ) as {
      private?: boolean;
    };
    expect(root.private).toBe(true);
  });
});
