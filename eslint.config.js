import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// SEC-001: no dynamic code evaluation and no HTML injection from trait data
const security = {
  "no-eval": "error",
  "no-implied-eval": "error",
  "no-new-func": "error",
  "no-restricted-properties": [
    "error",
    { property: "innerHTML", message: "SEC-001: use textContent / DOM APIs." },
    { property: "outerHTML", message: "SEC-001: use textContent / DOM APIs." },
    { property: "insertAdjacentHTML", message: "SEC-001: use DOM APIs." },
    { object: "document", property: "write", message: "SEC-001" },
  ],
};

export default [
  { ignores: ["src/**", "node_modules/**", "js/src/generated/**"] },
  js.configs.recommended,
  {
    files: ["js/**/*.js", "js/**/*.mjs", "e2e/**/*.js", "e2e-site/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: { ...globals.browser } },
    rules: { ...security, "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }] },
  },
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: ["js/**/*.ts"] })),
  {
    files: ["js/**/*.ts"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: { ...globals.browser } },
    rules: {
      ...security,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // the AFM model is untyped at the host boundary
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  { files: ["js/test/**/*.js", "js/test/**/*.ts", "js/build.mjs", "js/scripts/**/*.mjs", "e2e/**/*.js", "e2e-site/**/*.js", "*.config.js"], languageOptions: { globals: { ...globals.node } } },
];
