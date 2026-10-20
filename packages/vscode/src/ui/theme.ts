/**
 * The editor's theme, handed to the view. The view reads neutral inputs, `--jc-host-<name>`, and knows no
 * editor; this is the one place that says which of the editor's own theme variables each input is.
 */
const INPUTS: Record<string, string> = {
	font: '--vscode-font-family',
	size: '--vscode-font-size',
	text: '--vscode-foreground',
	ground: '--vscode-sideBar-background',
	raised: '--vscode-editorWidget-background',
	edge: '--vscode-panel-border',
	field: '--vscode-input-background',
	'field-text': '--vscode-input-foreground',
	accent: '--vscode-button-background',
	'on-accent': '--vscode-button-foreground',
	ok: '--vscode-testing-iconPassed',
	bad: '--vscode-errorForeground',
	warn: '--vscode-editorWarning-foreground',
	mine: '--vscode-button-secondaryBackground',
	'mine-text': '--vscode-button-secondaryForeground',
	mono: '--vscode-editor-font-family',
	link: '--vscode-textLink-foreground',
};

/**
 * The names of the inputs the editor supplies.
 * @public read by the theme test, which compares it with what the built view reads
 */
export const THEME_INPUTS: string[] = Object.keys(INPUTS).map(name => `--jc-host-${name}`);

/** A stylesheet, as text, that sets every input from the editor's variable of the same meaning. */
export const themeCss = (): string => `:root { ${Object.entries(INPUTS).map(([name, variable]) => `--jc-host-${name}: var(${variable});`).join(' ')} }`;
