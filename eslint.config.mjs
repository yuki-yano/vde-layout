import eslint from "@eslint/js"
import eslintConfigPrettier from "eslint-config-prettier"
import globals from "globals"
import tseslint from "typescript-eslint"

const RELATIVE_TS_IMPORT_PATTERNS = ["./**/*.ts", "../**/*.ts"]

const LEGACY_BACKEND_IMPORT_PATTERNS = [
  "../tmux/**",
  "../../tmux/**",
  "../wezterm/**",
  "../../wezterm/**",
  "./backends/**",
  "../executor/backends/**",
  "../../executor/backends/**",
]

const CORE_LAYER_IMPORT_PATTERNS = [
  ...LEGACY_BACKEND_IMPORT_PATTERNS,
  "../executor/**",
  "../backends/**",
  "../cli/**",
  "../config/**",
]

const EXECUTOR_LAYER_IMPORT_PATTERNS = [
  ...LEGACY_BACKEND_IMPORT_PATTERNS,
  "../cli/**",
  "../config/**",
]

const CONFIG_LAYER_IMPORT_PATTERNS = [
  ...LEGACY_BACKEND_IMPORT_PATTERNS,
  "../executor/**",
  "../backends/**",
  "../cli/**",
]

const BACKENDS_LAYER_IMPORT_PATTERNS = [
  ...LEGACY_BACKEND_IMPORT_PATTERNS,
  "../../cli/**",
  "../../config/**",
]

const createRestrictedImportRule = (patterns) => {
  const normalizePattern = (pattern) => {
    if (typeof pattern === "string") {
      return {
        group: [pattern],
      }
    }
    return pattern
  }

  return [
    "error",
    {
      patterns: [
        {
          group: RELATIVE_TS_IMPORT_PATTERNS,
          message: "Use extensionless relative imports.",
        },
        ...patterns.map(normalizePattern),
      ],
    },
  ]
}

const boundaryRules = [
  {
    files: ["src/**/*.ts"],
    patterns: LEGACY_BACKEND_IMPORT_PATTERNS,
  },
  {
    files: ["src/core/**/*.ts"],
    patterns: CORE_LAYER_IMPORT_PATTERNS,
  },
  {
    files: ["src/executor/**/*.ts"],
    patterns: EXECUTOR_LAYER_IMPORT_PATTERNS,
  },
  {
    files: ["src/config/**/*.ts"],
    patterns: CONFIG_LAYER_IMPORT_PATTERNS,
  },
  {
    files: ["src/backends/**/*.ts"],
    patterns: BACKENDS_LAYER_IMPORT_PATTERNS,
  },
]

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
  ...boundaryRules.map(({ files, patterns }) => ({
    files,
    rules: {
      "no-restricted-imports": createRestrictedImportRule(patterns),
    },
  })),
  {
    ignores: [
      "**/*.js",
      "**/*.mjs",
      "vitest.config.*",
      "dist",
      "node_modules",
      "coverage",
      "src/**/*.test.ts",
    ],
  },
]
