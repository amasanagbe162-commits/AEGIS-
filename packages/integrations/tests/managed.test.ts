import { describe, expect, it } from "vitest";
import { inspectBlock, inspectOwned, renderBlock, renderOwned } from "../src/managed.js";

describe("owned files", () => {
  it("round-trips: what AEGIS writes is recognized as intact", () => {
    const text = renderOwned("", "# Rules\n\nBe careful.\n");
    const state = inspectOwned(text);
    expect(state.kind).toBe("intact");
    expect(state.kind === "intact" && state.content).toBe("# Rules\n\nBe careful.\n");
  });

  it("keeps front matter first, and a change to it counts as an edit", () => {
    const text = renderOwned('---\napplyTo: "**"\n---\n', "body\n");
    expect(text.startsWith('---\napplyTo: "**"\n---\n')).toBe(true);
    expect(inspectOwned(text).kind).toBe("intact");
    expect(inspectOwned(text.replace('"**"', '"src/**"')).kind).toBe("edited");
  });

  it("detects a hand edit and a foreign file", () => {
    const text = renderOwned("", "line one\n");
    expect(inspectOwned(text.replace("line one", "line two")).kind).toBe("edited");
    expect(inspectOwned("# written by someone else\n").kind).toBe("none");
  });

  it("is not fooled by Git converting line endings to CRLF", () => {
    const text = renderOwned("", "a\nb\n").replace(/\n/g, "\r\n");
    expect(inspectOwned(text).kind).toBe("intact");
  });
});

describe("blocks inside user files", () => {
  it("finds an intact block and its exact position", () => {
    const block = renderBlock("hello\nworld");
    const file = `# mine\n\n${block}\nafter\n`;
    const state = inspectBlock(file);
    expect(state.kind).toBe("intact");
    if (state.kind === "intact") {
      expect(file.slice(0, state.start)).toBe("# mine\n\n");
      expect(file.slice(state.end)).toBe("\nafter\n");
      expect(state.inner).toBe("hello\nworld");
    }
  });

  it("reports edited, missing, and ambiguous blocks without guessing", () => {
    const block = renderBlock("hello");
    expect(inspectBlock(block.replace("hello", "tampered")).kind).toBe("edited");
    expect(inspectBlock("# nothing here\n").kind).toBe("none");
    expect(inspectBlock(block + block).kind).toBe("ambiguous");
    expect(inspectBlock("<!-- aegis:begin sha256=" + "a".repeat(64) + " -->\nno end\n").kind).toBe(
      "ambiguous",
    );
  });

  it("keeps byte positions valid in files that use CRLF", () => {
    const block = renderBlock("x").replace(/\n/g, "\r\n");
    const file = `top\r\n${block}bottom\r\n`;
    const state = inspectBlock(file);
    expect(state.kind).toBe("intact");
    if (state.kind === "intact") {
      expect(file.slice(0, state.start)).toBe("top\r\n");
      expect(file.slice(state.end)).toBe("bottom\r\n");
    }
  });
});
