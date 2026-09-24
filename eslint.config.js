import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["src/**", "node_modules/**"] },
  js.configs.recommended,
  {
    files: ["js/**/*.js", "js/**/*.mjs", "e2e/**/*.js", "e2e-site/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: { ...globals.browser } },
    rules: {
      // SEC-001: no dynamic code evaluation and no HTML injection from trait data
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
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  { files: ["js/test/**/*.js", "js/build.mjs", "js/scripts/**/*.mjs", "e2e/**/*.js", "e2e-site/**/*.js", "*.config.js"], languageOptions: { globals: { ...globals.node } } },
];
