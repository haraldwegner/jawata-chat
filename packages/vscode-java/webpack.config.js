//@ts-check
'use strict';

const { resolve } = require('path');

/** The extension: loaded by the editor's node, which provides the `vscode` module itself. */
/** @type {import('webpack').Configuration} */
module.exports = {
  mode: 'none',
  target: 'node',
  entry: './src/extension.ts',
  output: { path: resolve(__dirname, 'dist'), filename: 'extension.js', libraryTarget: 'commonjs2' },
  resolve: { extensions: ['.ts', '.js'] },
  module: { rules: [{ test: /\.ts$/, exclude: /node_modules/, loader: 'ts-loader' }] },
  externals: { vscode: 'commonjs vscode' },
  devtool: 'nosources-source-map',
  infrastructureLogging: { level: 'log' },
};
