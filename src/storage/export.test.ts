// @vitest-environment jsdom
// Export must never silently no-op: on desktop it goes through the native Save dialog and a
// real fs write (blob-anchor downloads in webviews save silently or not at all — found on
// WebView2); on the web preview it keeps the browser download. These pin both paths and the
// cancel behavior.
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyPortfolio } from "../domain/types";

const { saveMock, writeMock } = vi.hoisted(() => ({
  saveMock: vi.fn(),
  writeMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: saveMock }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile: writeMock }));

import { exportPortfolio } from "./store";

const asDesktop = () => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
};

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  saveMock.mockReset();
  writeMock.mockClear();
  vi.restoreAllMocks();
});

describe("exportPortfolio on desktop", () => {
  it("writes the full portfolio JSON to the dialog-chosen path", async () => {
    asDesktop();
    saveMock.mockResolvedValue("C:\\Users\\someone\\Desktop\\backup.json");
    const p = emptyPortfolio();

    const dest = await exportPortfolio(p);

    expect(dest).toBe("C:\\Users\\someone\\Desktop\\backup.json");
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: expect.stringMatching(/^sampatti-portfolio-\d{4}-\d{2}-\d{2}\.json$/),
      }),
    );
    const [path, json] = writeMock.mock.calls[0];
    expect(path).toBe("C:\\Users\\someone\\Desktop\\backup.json");
    expect(JSON.parse(json)).toEqual(p); // a faithful, re-importable copy
  });

  it("cancelling the dialog writes nothing and returns null", async () => {
    asDesktop();
    saveMock.mockResolvedValue(null);
    const dest = await exportPortfolio(emptyPortfolio());
    expect(dest).toBeNull();
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("surfaces a write failure instead of swallowing it (UI shows it)", async () => {
    asDesktop();
    saveMock.mockResolvedValue("D:\\nope.json");
    writeMock.mockRejectedValueOnce(new Error("disk full"));
    await expect(exportPortfolio(emptyPortfolio())).rejects.toThrow("disk full");
  });
});

describe("exportPortfolio on the web preview", () => {
  it("falls back to an anchor download with a dated .json name", async () => {
    // jsdom lacks URL.createObjectURL — stub the pieces the fallback touches.
    const create = vi.fn().mockReturnValue("blob:fake");
    const revoke = vi.fn();
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const dest = await exportPortfolio(emptyPortfolio());

    expect(dest).toMatch(/^sampatti-portfolio-.*\.json$/);
    expect(create).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(saveMock).not.toHaveBeenCalled(); // no Tauri APIs touched on web
    expect(revoke).not.toHaveBeenCalled(); // deferred — revoking synchronously races the download
  });
});
