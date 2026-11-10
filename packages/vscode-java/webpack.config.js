//@ts-check
'use strict';

const { resolve } = require('path');

const dist = resolve(__dirname, 'dist');

/** The extension: loaded by the editor's node, which provides the `vscode` module itself. */
/** @type {import('webpack').Configuration} */
const extension = {
  mode: 'none',
  target: 'node',
  entry: './src/extension.ts',
  output: { path: dist, filename: 'extension.js', libraryTarget: 'commonjs2' },
  resolve: { extensions: ['.ts', '.js'] },
  module: { rules: [{ test: /\.ts$/, exclude: /node_modules/, loader: 'ts-loader' }] },
  externals: { vscode: 'commonjs vscode' },
  devtool: 'nosources-source-map',
  infrastructureLogging: { level: 'log' },
};

/**
 * The profile page: the host-neutral view, run in a webview. A webview is a browser page with no `process`, so the libraries' NODE_ENV checks are
 * decided here, at build time; it has its own compiler settings because it is a browser program.
 * @type {import('webpack').Configuration}
 */
const page = {
  mode: 'none',
  target: 'web',
  entry: './src/webview/profile.ts',
  output: { path: dist, filename: 'profile.js' },
  resolve: { extensions: ['.ts', '.js'], extensionAlias: { '.js': ['.ts', '.js'] } },
  module: { rules: [{ test: /\.ts$/, exclude: /node_modules/, loader: 'ts-loader', options: { configFile: resolve(__dirname, 'tsconfig.webview.json') } }] },
  optimization: { nodeEnv: 'production' },
  devtool: 'nosources-source-map',
  infrastructureLogging: { level: 'log' },
};

module.exports = [extension, page];
