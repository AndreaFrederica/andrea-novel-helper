/**
 * Webpack configuration for Andrea Novel Helper Extension
 * 主扩展的webpack配置文件
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');

/**
 * @type {import('webpack').Configuration}
 */
const extensionConfig = {
  target: 'node', // VSCode扩展运行在Node.js环境
  mode: 'none', // 在package.json脚本中通过--mode指定
  entry: './src/extension.ts', // 扩展入口文件
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
    devtoolModuleFilenameTemplate: '../[resource-path]'
  },
  devtool: 'nosources-source-map', // 生成sourcemap但不包含源代码
  externals: {
    vscode: 'commonjs vscode', // vscode模块是外部依赖，不打包
    '@vscode/sqlite3': 'commonjs @vscode/sqlite3' // SQLite原生模块不打包
  },
  resolve: {
    extensions: ['.ts', '.js', '.json'],
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              transpileOnly: true, // 加快编译速度
              compilerOptions: {
                module: 'esnext'
              }
            }
          }
        ]
      },
      {
        test: /\.node$/,
        loader: 'node-loader'
      }
    ]
  },
  optimization: {
    minimize: false // 保持代码可读性，便于调试
  },
  // 忽略某些警告
  ignoreWarnings: [
    {
      module: /node_modules/
    },
    /export.*was not found/,
    /Can't resolve/
  ]
};

/**
 * Worker文件配置
 * 为Worker文件单独打包
 */
const workerConfig = {
  target: 'node',
  mode: 'none',
  entry: {
    commentsWorker: './src/workers/commentsWorker.ts',
    wordCountWorker: './src/workers/wordCountWorker.ts',
    'persistentCache.worker': './src/workers/persistentCache.worker.ts',
    roleAcWorker: './src/workers/roleAcWorker.ts',
    syncWorker: './src/workers/syncWorker.ts'
  },
  output: {
    path: path.resolve(__dirname, 'dist/workers'),
    filename: '[name].js',
    libraryTarget: 'commonjs2'
  },
  devtool: 'nosources-source-map',
  externals: {
    vscode: 'commonjs vscode'
  },
  resolve: {
    extensions: ['.ts', '.js', '.json'],
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              transpileOnly: true,
              compilerOptions: {
                module: 'esnext'
              }
            }
          }
        ]
      }
    ]
  },
  optimization: {
    minimize: false
  }
};

module.exports = [extensionConfig, workerConfig];
