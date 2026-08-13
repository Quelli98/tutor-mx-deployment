import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createApp: vi.fn(),
  listen: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("dotenv/config", () => ({}));

vi.mock("./app.js", () => ({
  createApp: mocks.createApp,
}));

vi.mock("./database.js", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
  },
}));

const originalPort = process.env.PORT;

beforeEach(() => {
  vi.resetModules();
  mocks.createApp.mockReset();
  mocks.listen.mockReset();
  mocks.queryRaw.mockReset();

  mocks.createApp.mockReturnValue({
    listen: mocks.listen,
  });
});

afterEach(() => {
  vi.restoreAllMocks();

  if (originalPort === undefined) {
    delete process.env.PORT;
  } else {
    process.env.PORT = originalPort;
  }
});

describe("server startup", () => {
  it("uses the default port and connects the Prisma readiness check", async () => {
    delete process.env.PORT;
    const consoleLog = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);

    await import("./server.js");

    expect(mocks.createApp).toHaveBeenCalledOnce();

    const checkReadiness = mocks.createApp.mock.calls[0][0] as () => Promise<void>;
    await checkReadiness();

    expect(mocks.queryRaw).toHaveBeenCalledOnce();
    expect(mocks.listen).toHaveBeenCalledWith(3000, expect.any(Function));

    const onListening = mocks.listen.mock.calls[0][1] as () => void;
    onListening();

    expect(consoleLog).toHaveBeenCalledWith(
      "Tutor Mx API listening on http://localhost:3000",
    );
  });

  it("uses the configured PORT", async () => {
    process.env.PORT = "4100";
    const consoleLog = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);

    await import("./server.js");

    expect(mocks.listen).toHaveBeenCalledWith(4100, expect.any(Function));

    const onListening = mocks.listen.mock.calls[0][1] as () => void;
    onListening();

    expect(consoleLog).toHaveBeenCalledWith(
      "Tutor Mx API listening on http://localhost:4100",
    );
  });
});