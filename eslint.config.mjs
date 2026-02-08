import eslint from "@eslint/js"
import eslintConfigPrettier from "eslint-config-prettier"
import globals from "globals"
import tseslint from "typescript-eslint"

const RELATIVE_TS_IMPORT_PATTERNS = ["./**/*.ts", "../**/*.ts"]

export default [
  {
    files: ["src/**/*.ts"],
  },
  {
    languageOptions: {
      globals: {
        ...globals.esnext,
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    rules: {
      "@typescript-eslint/strict-boolean-expressions": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/explicit-function-return-type": "warn",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      eqeqeq: ["error", "smart"],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: RELATIVE_TS_IMPORT_PATTERNS,
              message: "Use extensionless relative imports.",
            },
          ],
        },
      ],
      "func-style": [
        "error",
        "expression",
        {
          allowArrowFunctions: true,
        },
      ],
      "no-restricted-syntax": ["error"],
    },
  },
  {
    ignores: [
      "**/*.js",
      "**/*.mjs",
      "vitest.config.*",
      "dist",
      "node_modules",
      "coverage",
      "src/**/__tests__/**/*",
      "src/**/*.test.ts",
    ],
  },
]
