import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

// An underscore at the start of a name says it is deliberately not used.
const deliberatelyUnused = { argsIgnorePattern: "^_", varsIgnorePattern: "^_" };

// What is only a warning in the editor is a failure here: the lint script allows no warnings.
const style = {
	curly: "warn",
	eqeqeq: "warn",
	semi: "warn",
	"no-throw-literal": "warn",
};

export default defineConfig({
	files: ["**/*.ts"],
	extends: tseslint.configs.recommended,
	rules: {
		...style,
		"@typescript-eslint/no-explicit-any": "off",
		"@typescript-eslint/no-unused-vars": ["error", deliberatelyUnused],
		"@typescript-eslint/naming-convention": ["warn", { selector: "import", format: ["camelCase", "PascalCase"] }],
	},
});
