# C64jasm assembler VSCode extension

This extension adds syntax, build + run and compile-check on save functionality to VSCode.  

## Extension Settings

This extension contributes the following settings:

* `c64jasm-client.useEmbeddedCompiler`: Enable/disable using the bundled `c64jasm` compiler. Defaults to `true`. If set to `false`, the extension will try to run the `c64jasm` executable from your system PATH.
* `c64jasm-client.vicePath`: Specifies the path to the VICE executable used when starting a debug session. Defaults to `x64`.

