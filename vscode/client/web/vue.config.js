// vue.config.js
const chunkPrefix = "[name]";

module.exports = {
  publicPath: "./",
  chainWebpack: (config) => {
    config.plugin("html").tap((args) => {
      args[0].minify = {
        ...args[0].minify,
        removeAttributeQuotes: true,
      };
      return args;
    });
  },
  css: {
    extract: {
      filename: `${chunkPrefix}.css`,
      chunkFilename: `${chunkPrefix}.css`,
    },
  },
  configureWebpack: {
    output: {
      filename: `${chunkPrefix}.js`,
      chunkFilename: `${chunkPrefix}.js`,
    },
  },
};
