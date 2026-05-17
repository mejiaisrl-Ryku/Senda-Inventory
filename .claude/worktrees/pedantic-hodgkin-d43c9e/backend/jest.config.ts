import type { Config } from "jest";

const config: Config = {
  testEnvironment: "node",
  roots: ["<rootDir>/src/__tests__"],
  setupFiles: ["<rootDir>/jest.setup.ts"],
  resetMocks: true,
  testTimeout: 15000,
  // Transpile-only via ts-jest — type errors are caught by `tsc --noEmit`, not Jest.
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { isolatedModules: true }],
  },
};

export default config;
