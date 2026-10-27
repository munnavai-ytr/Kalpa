import { defineConfig } from "eslint/config";
import next from "eslint-config-next";

export default defineConfig([
  {
    extends: [...next],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@next/next/no-img-element": "off",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);
