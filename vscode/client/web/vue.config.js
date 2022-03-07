module.exports = {
    chainWebpack: (config) => {
        config.plugin('html').tap((args) => {
            args[0].minify = {
                ...args[0].minify,
                removeAttributeQuotes: true,
            }
            return args
        })
    }
}