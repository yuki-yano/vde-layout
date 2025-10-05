import eslint from "@eslint/js"
import eslintConfigPrettier from "eslint-config-prettier"
import globals from "globals"
import tseslint from "typescript-eslint"

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
      "eqeqeq": ["error", "smart"],
    },
  },
  {
    files: ["src/cli.ts", "src/executor/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ClassDeclaration",
          message: "Use factory functions instead of class declarations in boundary adapters.",
        },
        {
          selector: "ClassExpression",
          message: "Use factory functions instead of class declarations in boundary adapters.",
        },
      ],
    },
  },
  {
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/cli", "@/cli/*", "@/executor", "@/executor/*", "@/tmux", "@/tmux/*", "@/layout", "@/layout/*"],
              message: "Functional Core must not depend on boundary adapters.",
            },
            {
              group: ["../cli", "../cli/*", "../executor", "../executor/*", "../tmux", "../tmux/*", "../layout", "../layout/*"],
              message: "Functional Core must not import boundary adapters via relative paths.",
            },
          ],
        },
      ],
    },
  },
  {
    ignores: [
      "**/*.js", 
      "**/*.mjs", 
      "vitest.config.ts", 
      "dist", 
      "node_modules", 
      "coverage",
      "src/**/__tests__/**/*",
      "src/**/*.test.ts"
    ],
  },
]
