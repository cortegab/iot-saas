/** Unit tests (CLAUDE.md §7): jest-expo runs them with React Native's
 * transforms, so @iodriven/shared's TypeScript source is compiled too. */
module.exports = {
  preset: "jest-expo",
  testMatch: ["<rootDir>/src/**/*.test.ts?(x)"],
};
