import eslint from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import eslintConfigPrettier from "eslint-config-prettier";

export default [
    eslint.configs.recommended,
    eslintConfigPrettier,
    {
        ignores: ["node_modules/**", "dist/**", "ui/**", "data/**", "memory/**", "skills/**"],
    },
    {
        files: [
            "src/**/*.ts",
            "tests/**/*.ts",
            "scripts/**/*.ts",
            "apps/mobile/App.tsx",
            "apps/mobile/src/**/*.{ts,tsx}",
        ],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: "latest",
                sourceType: "module",
                ecmaFeatures: {
                    jsx: true,
                },
            },
            globals: {
                Bun: "readonly",
                console: "readonly",
                process: "readonly",
                crypto: "readonly",
                fetch: "readonly",
                Request: "readonly",
                Response: "readonly",
                Headers: "readonly",
                URL: "readonly",
                URLSearchParams: "readonly",
                setTimeout: "readonly",
                setInterval: "readonly",
                clearTimeout: "readonly",
                clearInterval: "readonly",
                Buffer: "readonly",
            },
        },
        plugins: {
            "@typescript-eslint": tsPlugin,
        },
        rules: {
            // Disable base rules that TypeScript handles
            "no-unused-vars": "off",
            "no-undef": "off",

            // TypeScript rules
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],

            // Best practices
            "prefer-const": "error",
            "no-var": "error",
            "no-duplicate-imports": "error",
        },
    },
];
