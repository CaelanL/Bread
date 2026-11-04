// https://docs.expo.dev/guides/using-eslint/
import { defineConfig } from "eslint/config";
import expoConfig from "eslint-config-expo/flat.js";
import kit, { address } from "./eslint.kit.mjs";

// Standard UI values only: the tokens in constants/theme.ts.
const RADIUS_KEY = "/^border(TopLeft|TopRight|BottomLeft|BottomRight|Top|Bottom|Left|Right|TopStart|TopEnd|BottomStart|BottomEnd)?Radius$/";
const RADII = "4|8|10|12|14|16|20|24|999";
const DURATIONS = "100|150|200|300";
const uiRule = (selector) => ({ selector, message: "Use the standard UI values from constants/theme.ts." });
const notIn = (values) => `[value.type='Literal'][value.raw!=/^(${values})$/]`;

export default defineConfig([
  expoConfig,
  ...kit,
  {
    files: ["app/**/*.tsx", "components/**/*.tsx", "hooks/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...address,
        uiRule(`Property[key.name=${RADIUS_KEY}]${notIn(RADII)}`),
        uiRule(`Property[key.name='duration']${notIn(DURATIONS)}`),
        uiRule(`Property[key.name='scale']${notIn("0\\.96|1")}`),
      ],
    },
  },
  {
    // Deno imports (npm:, https:) that ESLint can't resolve.
    files: ["supabase/functions/**"],
    rules: { "import/no-unresolved": "off" },
  },
  {
    files: ["scripts/**"],
    languageOptions: { globals: { __dirname: "readonly" } },
  },
  {
    ignores: ["dist/*"],
  },
]);
