import { afterEach, describe, expect, it, vi } from "vitest";
import { run, VERSION } from "../src/cli.js";

function captureOutput() {
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  return { stdout, stderr };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("placeholder CLI", () => {
  it("prints help and exits 0 for --help", () => {
    const { stdout } = captureOutput();
    expect(run(["--help"])).toBe(0);
    const output = stdout.mock.calls.map((call) => call[0]).join("");
    expect(output).toContain("resonance");
    expect(output).toContain("Usage:");
  });

  it("prints help and exits 0 when called without arguments", () => {
    const { stdout } = captureOutput();
    expect(run([])).toBe(0);
    expect(stdout.mock.calls.length).toBeGreaterThan(0);
  });

  it("prints the version and exits 0 for --version", () => {
    const { stdout } = captureOutput();
    expect(run(["--version"])).toBe(0);
    const output = stdout.mock.calls.map((call) => call[0]).join("");
    expect(output).toBe(`${VERSION}\n`);
  });

  it("reports unknown commands on stderr and exits 1", () => {
    const { stdout, stderr } = captureOutput();
    expect(run(["scan"])).toBe(1);
    expect(stdout.mock.calls.length).toBe(0);
    const output = stderr.mock.calls.map((call) => call[0]).join("");
    expect(output).toContain("unknown command");
  });
});
