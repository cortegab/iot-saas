import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  { ignores: ["src/types/api.ts", ".next/**", "next-build-tmp-verify*/**", "node_modules/**"] },
];

export default eslintConfig;
