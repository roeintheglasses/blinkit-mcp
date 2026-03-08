import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Base ESLint recommended rules
  eslint.configs.recommended,

  // TypeScript ESLint recommended rules
  ...tseslint.configs.recommendedTypeChecked,

  // Project-specific configuration
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Custom rules based on project requirements
  {
    rules: {
      // Disallow usage of the any type
      "@typescript-eslint/no-explicit-any": "error",

      // Disallow unused variables
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // Enforce consistent usage of type imports
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
        },
      ],

      // Disallow console.log statements (use logger instead)
      "no-console": "error",

      // Enforce consistent import extensions
      "@typescript-eslint/consistent-type-exports": "error",
    },
  },

  // Ignore patterns
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      ".auto-claude/**",
      "*.config.js",
      "*.config.ts",
    ],
  }
);
