/** Unit tests (CLAUDE.md §7): jest-expo runs them with React Native's
 * transforms, so @iodriven/shared's TypeScript source is compiled too. */
module.exports = {
  preset: "jest-expo",
  testMatch: ["<rootDir>/src/**/*.test.ts?(x)"],
  setupFiles: ["<rootDir>/jest.setup.js"],
  moduleNameMapper: { "^lucide-react-native$": "<rootDir>/jest/lucide-stub.js" },
  // jest-expo's list, matching pnpm's node_modules/.pnpm/<pkg>@… paths too.
  transformIgnorePatterns: [
    "node_modules/(?!(?:\\.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|react-native-svg))",
  ],
};
