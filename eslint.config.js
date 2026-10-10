import js from "@eslint/js";

export default [
  { ignores: ["dist", ".output", ".vinxi", "node_modules", ".expo", "mobile", "src", "supabase", "drizzle"] },
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        module: "readonly",
        require: "readonly",
        __dirname: "readonly",
        process: "readonly",
        console: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "off",
    },
  },
];
