/* Minimal ESLint flat config used ONLY to measure cyclomatic-complexity debt of the
   shipped runtime for the quality reports (see report.mjs). Syntax-only, so it runs
   fast against any tree; the threshold matches the real config (10), so a finding
   here is exactly a finding there. `warn` keeps the exit code 0 for the JSON parse. */
export default [
  {
    files: ["runtime/**/*.js"],
    // The runtime files are IIFE body fragments with top-level `return`, as in the main config.
    languageOptions: { ecmaVersion: "latest", sourceType: "script", parserOptions: { ecmaFeatures: { globalReturn: true } } },
    rules: { complexity: ["warn", 10] },
  },
];
