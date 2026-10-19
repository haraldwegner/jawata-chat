//@ts-check
'use strict';

const { resolve } = require('path');

const dist = resolve(__dirname, 'dist');

/**
 * Both bundles are built the same way except for where they run: the extension in the editor's node,
 * the page in a webview. What differs is passed in; what does not is written once.
 * @param {{ entry: string, file: string, target: 'node' | 'web', test: RegExp, extensions: string[], loaderOptions?: object, extra?: object }} part
 * @returns {import('webpack').Configuration}
 */
function bundle({ entry, file, target, test, extensions, loaderOptions, extra }) {
  return {
    mode: 'none',
    target,
    entry,
    output: { path: dist, filename: file },
    resolve: { extensions },
    module: {
      rules: [{ test, exclude: /node_modules/, loader: 'ts-loader', options: loaderOptions }],
    },
    devtool: 'nosources-source-map',
    infrastructureLogging: { level: 'log' },
    ...extra,
  };
}

/** The extension: loaded by the editor, which provides the `vscode` module itself. */
const extension = bundle({
  entry: './src/extension.ts',
  file: 'extension.js',
  target: 'node',
  test: /\.ts$/,
  extensions: ['.ts', '.js'],
  extra: {
    output: { path: dist, filename: 'extension.js', libraryTarget: 'commonjs2' },
    externals: { vscode: 'commonjs vscode' },
  },
});

/**
 * The chat's page: the view from chat-view, run in the webview. A webview is a browser page with no
 * `process`, so the libraries' NODE_ENV checks are decided here, at build time.
 */
const page = bundle({
  entry: './src/webview/main.ts',
  file: 'webview.js',
  target: 'web',
  test: /\.tsx?$/,
  extensions: ['.ts', '.tsx', '.js'],
  loaderOptions: { configFile: resolve(__dirname, 'tsconfig.webview.json') },
  extra: {
    resolve: { extensions: ['.ts', '.tsx', '.js'], extensionAlias: { '.js': ['.ts', '.tsx', '.js'] } },
    optimization: { nodeEnv: 'production' },
  },
});

module.exports = [extension, page];
