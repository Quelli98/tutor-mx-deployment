import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdapter: vi.fn(),
  createClient: vi.fn(),
  createPool: vi.fn(),
}));

vi.mock("dotenv/config", () => ({}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class {
    constructor(options: unknown) {
      mocks.createAdapter(options);
    }
  },
}));

vi.mock("pg", () => ({
  default: {
    Pool: class {
      query = vi.fn();

      constructor(options: unknown) {
        mocks.createPool(options);
      }
    },
  },
}));

vi.mock("./generated/prisma/client.js", () => ({
  PrismaClient: class {
    constructor(options: unknown) {
      mocks.createClient(options);
    }
  },
}));

const originalDatabaseUrl = process.env.DATABASE_URL;

beforeEach(() => {
  vi.resetModules();
  mocks.createAdapter.mockClear();
  mocks.createClient.mockClear();
  mocks.createPool.mockClear();
});

afterEach(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

describe("database configuration", () => {
  it("rejects startup when DATABASE_URL is missing", async () => {
    delete process.env.DATABASE_URL;

    await expect(import("./database.js")).rejects.toThrow(
      "DATABASE_URL is not configured",
    );

    expect(mocks.createAdapter).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.createPool).not.toHaveBeenCalled();
  });

  it("creates Prisma using the configured database URL", async () => {
    process.env.DATABASE_URL = "postgresql://test.example/tutor_mx";

    const database = await import("./database.js");

    expect(mocks.createPool).toHaveBeenCalledWith({
      connectionString: "postgresql://test.example/tutor_mx",
    });
    expect(mocks.createAdapter).toHaveBeenCalledWith(expect.anything());
    expect(mocks.createClient).toHaveBeenCalledWith({
      adapter: expect.anything(),
    });
    expect(database.prisma).toBeDefined();
    expect(database.databasePool).toBeDefined();
    expect(database.queryClient).toBeDefined();
  });
});
