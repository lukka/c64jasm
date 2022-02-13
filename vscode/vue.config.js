module.exports = {
  publicPath: process.env.NODE_ENV === "production" ? "./" : "/",
  // webpack
  configureWebpack: {
    resolve: {
      extensions: [".js", ".vue", ".json", ".ts"]
    },
    devtool: 'source-map',
    optimization: {
      splitChunks: {
        cacheGroups: {
          vendor: {
            chunks: "all",
            test: /node_modules/,
            name: "vendor",
            minChunks: 1,
            maxInitialRequests: 5,
            minSize: 0,
            priority: 100
          },
          common: {
            chunks: "all",
            test: /[\\/]src[\\/]js[\\/]/,
            name: "common",
            minChunks: 2,
            maxInitialRequests: 5,
            minSize: 0,
            priority: 60
          },
          styles: {
            name: "styles",
            test: /\.(sa|sc|c)ss$/,
            chunks: "all",
            enforce: true
          },
          runtimeChunk: {
            name: "manifest"
          }
        }
      }
    },
    performance: {
      hints: "warning",
      maxEntrypointSize: 50000000,
      maxAssetSize: 30000000,
      assetFilter: function (assetFilename) {
        return assetFilename.endsWith(".js");
      }
    }
  },
  productionSourceMap: false,
  parallel: require("os").cpus().length > 1,
  css: {
    // css: ExtractTextPlugin
    extract: true,
    // CSS source maps?
    sourceMap: false,
    // css
    loaderOptions: {}
    // CSS modules for all css / pre-processor files.
    //modules: false
  },
  //http
  devServer: {
    open: true,
    host: "localhost",
    port: 8080
  }
};
