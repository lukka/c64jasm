'use strict';

import {
	createConnection,
	TextDocuments,
	Diagnostic,
	DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	TextDocumentChangeEvent,
	TextDocumentSyncKind,
	Hover,
	MarkupKind,
	Location,
	SymbolInformation,
	SymbolKind,
	WorkspaceSymbolParams
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument'

import { URI } from 'vscode-uri'
import * as fs from 'fs';
import * as path from 'path';

import { instructions6502, InstructionInfo } from './instructions6502';
import { c64Hardware, HardwareRegister, normalizeHexAddress } from './c64hardware';

// Create a connection for the server. The connection uses Node's IPC as a transport.
// Also include all preview / proposed LSP features.
let connection = createConnection(ProposedFeatures.all);

let c64jasm: any;
try {
	// Try to load local build first (assuming server is running from server/out/)
	const localBuildPath = path.resolve(__dirname, '../../../build/src/index.js');
	if (fs.existsSync(localBuildPath)) {
		c64jasm = require(localBuildPath);
		connection.console.log(`Loaded local c64jasm build from ${localBuildPath}`);
	} else {
		// Fallback to node_modules
		c64jasm = require('c64jasm');
		connection.console.log("c64jasm module loaded from node_modules.");
	}
} catch (e: any) {
	connection.console.error(`Failed to load c64jasm: ${e.message}`);
}

// Create a simple text document manager. The text document manager
// supports full document sync only
let documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);;

let hasConfigurationCapability: boolean = false;
let hasWorkspaceFolderCapability: boolean = false;
//let hasDiagnosticRelatedInformationCapability: boolean = false;

connection.onInitialize((params: InitializeParams) => {
	let capabilities = params.capabilities;

	// Does the client support the `workspace/configuration` request?
	// If not, we will fall back using global settings
	hasConfigurationCapability =
		capabilities.workspace && !!capabilities.workspace.configuration;
	hasWorkspaceFolderCapability =
		capabilities.workspace && !!capabilities.workspace.workspaceFolders;

	// hasDiagnosticRelatedInformationCapability =
	// 	capabilities.textDocument &&
	// 	capabilities.textDocument.publishDiagnostics &&
	// 	capabilities.textDocument.publishDiagnostics.relatedInformation;

	return {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Full,
			// Tell the client that the server supports code completion
			completionProvider: {
				resolveProvider: true
			},
			// Tell the client that the server supports hover
			hoverProvider: true,
			// Tell the client that the server supports go to definition
			definitionProvider: true,
			// Tell the client that the server supports references
			referencesProvider: true,
			// Tell the client that the server supports workspace symbol search
			workspaceSymbolProvider: true
		}
	};
});

connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(
			DidChangeConfigurationNotification.type,
			undefined
		);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			connection.console.log('Workspace folder change event received.');
		});
	}
});

// The example settings
interface C64jasmSettings {
	maxNumberOfProblems: number;
}

// The global settings, used when the `workspace/configuration` request is not supported by the client.
// Please note that this is not the case when using this server with the client provided in this example
// but could happen with other clients.
const defaultSettings: C64jasmSettings = { maxNumberOfProblems: 1000 };
let globalSettings: C64jasmSettings = defaultSettings;

// Cache the settings of all open documents
let documentSettings: Map<string, Promise<C64jasmSettings>> = new Map();

// Cache symbols per document for completion
interface DocumentSymbols {
	labels: Array<{name: string, addr: number, kind: 'label', uri: string, line: number, range: any}>;
	macros: Array<{name: string, kind: 'macro', loc: any}>;
	variables: Array<{name: string, kind: 'variable', value: any, uri: string, line: number, loc: any}>;
	references: Array<{name: string, loc: any, defLoc: any, usageType: string}>;
}
let documentSymbols: Map<string, DocumentSymbols> = new Map();

connection.onDidChangeConfiguration(change => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	} else {
		globalSettings = <C64jasmSettings>(
			(change.settings.languageServerC64jasm || defaultSettings)
		);
	}

	// Revalidate all open text documents
	documents.all().forEach(validateTextDocument);
});

function getDocumentSettings(resource: string): Promise<C64jasmSettings> {
	return new Promise<C64jasmSettings>(async (resolve) => {
		if (!hasConfigurationCapability) {
			return resolve(globalSettings);
		}
		let result = await documentSettings.get(resource);
		if (!result) {
			result = await connection.workspace.getConfiguration({
				scopeUri: resource,
				section: 'languageServerC64jasm'
			});
			documentSettings.set(resource, Promise.resolve(result));
		}
		resolve(result);
	});
}

// Only keep settings for open documents
documents.onDidClose(e => {
	documentSettings.delete(e.document.uri);
	documentSymbols.delete(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent((change: TextDocumentChangeEvent<TextDocument>) => {
	validateTextDocument(change.document);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidOpen((change: TextDocumentChangeEvent<TextDocument>) => {
	validateTextDocument(change.document);
});

documents.onDidSave((event) => {
	// TODO settings onSave vs onChange
	validateTextDocument(event.document);
});

	type SymbolSearchResult = 
	| { type: 'label', symbol: {name: string, addr: number, kind: 'label', uri: string, line: number} }
	| { type: 'macro', symbol: {name: string, kind: 'macro'} }
	| { type: 'variable', symbol: {name: string, kind: 'variable', value: any, uri: string, line: number} }
	| { type: 'property', parent: {name: string, kind: 'variable', value: any, uri: string, line: number}, value: any, name: string }
	| null;

function findSymbol(symbols: DocumentSymbols, word: string): SymbolSearchResult {
    // 1. Try to find the full word as a top-level symbol first (e.g. labels with dots)
    const label = symbols.labels.find(l => l.name === word || l.name.endsWith(`::${word}`));
    if (label) return { type: 'label', symbol: label };

    const macro = symbols.macros.find(m => m.name === word);
    if (macro) return { type: 'macro', symbol: macro };

    const variable = symbols.variables.find(v => v.name === word || v.name.endsWith(`::${word}`));
    if (variable) return { type: 'variable', symbol: variable };

    // 2. If no direct match, try to interpret as object property access (e.g. zp.tmp1)
    if (word.includes('.')) {
        const parts = word.split('.');
        // We need to handle nested properties, so we try to find the longest possible
        // prefix that matches a variable.
        // E.g. for "obj.prop1.prop2", we might match "obj" or "obj.prop1".
        
        // Simple case: Try the first part as the variable name
        const varName = parts[0];
        const props = parts.slice(1);

        const parentVariable = symbols.variables.find(v => v.name === varName || v.name.endsWith(`::${varName}`));

        if (parentVariable && parentVariable.value) {
            let current = parentVariable.value;
            let found = true;
            for (const prop of props) {
                if (current && typeof current === 'object' && prop in current) {
                    current = current[prop];
                } else {
                    found = false;
                    break;
                }
            }
            if (found) {
                return { type: 'property', parent: parentVariable, value: current, name: word };
            }
        }
    }
    return null;
}


function resolveEntryPoint(sourceFname: string): string {
	let currentDir = path.dirname(sourceFname);
	// Search up for c64jasm.json
	const parseConfig = (dir: string): string | null => {
		const configPath = path.join(dir, 'c64jasm.json');
		if (fs.existsSync(configPath)) {
			try {
				const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
				if (config.source) {
					return path.resolve(dir, config.source);
				}
			} catch (e: any) {
				connection.console.error(`Error reading c64jasm.json: ${e.message}`);
			}
		}
		return null;
	};

	// Walk up looking for config
	let entryPoint: string | null = null;
	let depth = 0;
	while (currentDir && depth < 20) {
		entryPoint = parseConfig(currentDir);
		if (entryPoint) break;
		const parent = path.dirname(currentDir);
		if (parent === currentDir) break;
		currentDir = parent;
		depth++;
	}

	return entryPoint || sourceFname;
}

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
	// In this simple example we get the settings for every validate run.
	await getDocumentSettings(textDocument.uri);

	const sourceFname = URI.parse(textDocument.uri).fsPath;
	const entryPoint = resolveEntryPoint(sourceFname);
	
	if (entryPoint !== sourceFname) {
		connection.console.log(`Compiling project via entry point: ${entryPoint} (for ${path.basename(sourceFname)})`);
	} else {
		connection.console.log(`Compiling file: ${sourceFname}`);
	}

	// Verify entry point exists
	if (!fs.existsSync(entryPoint)) {
		const diagnostic: Diagnostic = {
			severity: DiagnosticSeverity.Error,
			range: {
				start: { line: 0, character: 0 },
				end: { line: 0, character: 0 }
			},
			message: `Project entry point not found: ${entryPoint}\nPlease check your c64jasm.json configuration.`,
			source: 'c64jasm'
		};
		connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [diagnostic] });
		return;
	}

	const readFileSync = (filename: string, encoding?: string | null): string | Buffer => {
		const uri = URI.file(filename).toString();
		const doc = documents.get(uri);
		if (doc) {
			if (encoding) {
				return doc.getText();
			} else {
				return Buffer.from(doc.getText());
			}
		}
		if (encoding) {
			return fs.readFileSync(filename, encoding as BufferEncoding);
		} else {
			return fs.readFileSync(filename);
		}
	};

	let assembleResult;
	try {
		assembleResult = c64jasm.assemble(entryPoint, { readFileSync });
	} catch (e: any) {
		connection.console.error(`c64jasm.assemble error: ${e.message}`);
		const diagnostic: Diagnostic = {
			severity: DiagnosticSeverity.Error,
			range: {
				start: { line: 0, character: 0 },
				end: { line: 0, character: 0 }
			},
			message: `Assembler error via entry point '${path.basename(entryPoint)}': ${e.message}`,
			source: 'c64jasm'
		};
		connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [diagnostic] });
		return;
	}
	const { errors, labels, variables, references, macros } = assembleResult;

	if (labels) {
		connection.console.log(`[Compile] Found ${labels.length} labels.`);
		// Log a sample of proper labels from other files to verify
		const externalLabels = labels.filter((l: any) => l.source && l.source !== entryPoint);
		if (externalLabels.length > 0) {
			connection.console.log(`[Compile] Sample external label: ${externalLabels[0].name} from ${externalLabels[0].source}`);
		}
	} else {
		connection.console.log(`[Compile] No labels returned.`);
	}

	// Extract symbols for completion
	const symbols: DocumentSymbols = {
		// We want ALL labels from the project available for completion/go-to-def in ALL files
		labels: labels ? labels.map((l: any) => ({
			name: l.name,
			addr: l.addr,
			kind: 'label' as const,
			uri: l.source ? URI.file(l.source).toString() : textDocument.uri,
			line: (l.line || 1) - 1,
			range: l.loc
		})) : [],
		macros: macros ? macros.map((m: any) => ({
			name: m.name,
			kind: 'macro' as const,
			loc: m.loc
		})) : [],
		variables: variables ? variables.map((v: any) => ({ 
			name: v.name, 
			kind: 'variable' as const, 
			value: v.value,
			uri: v.loc ? URI.file(path.resolve(v.loc.source)).toString() : textDocument.uri,
			line: v.loc ? Math.max(0, v.loc.start.line - 1) : 0,
			loc: v.loc
		})) : [],
		references: references || []
	};

	documentSymbols.set(textDocument.uri, symbols);

	let diagnostics: Diagnostic[] = [];
	for (let errIdx = 0; errIdx < errors.length; errIdx++) {
		if (errIdx >= 10 /*settings.maxNumberOfProblems*/) {
			break;
		}
		const err = errors[errIdx];
		const loc = err.loc;

		// Filter diagnostics: only show errors if they belong to the current file
		// Note: we need to handle path case sensitivity and normalization
		const errorSourcePath = path.resolve(loc.source);
		if (errorSourcePath !== sourceFname) {
			continue;
		}

		connection.console.log(`error from asm=${JSON.stringify(err)}`);

		let diagnostic: Diagnostic = {
			severity: DiagnosticSeverity.Error,
			range: {
				start: textDocument.positionAt(loc.start.offset),
				end: textDocument.positionAt(loc.end.offset)
			},
			message: err.msg,
			source: 'c64jasm'
		};
		diagnostics.push(diagnostic);
		/*
		if (hasDiagnosticRelatedInformationCapability) {
			diagnosic.relatedInformation = [
				{
					location: {
						uri: textDocument.uri,
						range: Object.assign({}, diagnosic.range)
					},
					message: 'Spelling matters'
				},
				{
					location: {
						uri: textDocument.uri,
						range: Object.assign({}, diagnosic.range)
					},
					message: 'Particularly for names'
				}
			];
		}
*/
	}

	// Send the computed diagnostics to VSCode.
	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles(_change => {
	// Monitored files have change in VSCode
	connection.console.log('We received an file change event');
});

// Helper function to format instruction info as markdown
function formatInstructionHover(info: InstructionInfo): string {
	let markdown = `## 📋 ${info.name} — *${info.fullName}*\n\n`;
	
	if (info.formula) {
		markdown += `\`\`\`asm\n${info.formula}\n\`\`\`\n\n`;
	}
	
	markdown += `${info.description}\n\n`;
	
	// Addressing Modes section - most important for assembly programming
	if (info.addressingModes && info.addressingModes.length > 0) {
		markdown += `---\n\n### 🎯 Addressing Modes\n\n`;
		markdown += `| Mode | Opcode | Bytes | Cycles |\n`;
		markdown += `|:-----|:------:|:-----:|:-------|\n`;
		info.addressingModes.forEach(mode => {
			markdown += `| **${mode.mode}** | \`${mode.opcode}\` | ${mode.bytes} | ${mode.cycles} |\n`;
		});
		markdown += `\n`;
	}
	
	// Processor flags section
	if (info.flags && info.flags.length > 0) {
		markdown += `---\n\n### ⚙️ Processor Status Flags\n\n`;
		markdown += `| Flag | Name | Effect |\n`;
		markdown += `|:----:|:-----|:-------|\n`;
		info.flags.forEach(flag => {
			markdown += `| **${flag.flag}** | *${flag.name}* | ${flag.description} |\n`;
		});
		markdown += `\n`;
	}
	
	// Notes section with emphasis
	if (info.notes) {
		markdown += `---\n\n### ⚠️ Important Note\n\n`;
		markdown += `> ${info.notes}\n\n`;
	}
	
	// See also section
	if (info.seeAlso && info.seeAlso.length > 0) {
		markdown += `---\n\n**See also:** `;
		markdown += info.seeAlso.map(inst => `\`${inst}\``).join(' • ');
		markdown += `\n\n`;
	}
	
	markdown += `---\n\n*📖 [6502 Reference Guide](https://www.nesdev.org/obelisk-6502-guide/reference.html)*`;
	
	return markdown;
}

// Helper function to format hardware register info as markdown
function formatHardwareRegisterHover(addr: string, register: HardwareRegister): string {
	const chipEmoji = {
		'VIC-II': '🎨',
		'SID': '🔊',
		'CIA1': '⌨️',
		'CIA2': '🔌'
	};

	let markdown = `## ${chipEmoji[register.chip]} ${addr.toUpperCase()} — ${register.name}\n\n`;
	markdown += `**Chip:** ${register.chip} | **Access:** ${register.access}\n\n`;
	markdown += `---\n\n`;
	markdown += `${register.description}\n\n`;

	// Bit configuration section
	if (register.bits && register.bits.length > 0) {
		markdown += `---\n\n### 🔧 Bit Configuration\n\n`;
		register.bits.forEach(bit => {
			markdown += `- **${bit.range}:** ${bit.description}\n`;
		});
		markdown += `\n`;
	}

	markdown += `---\n\n*📖 [C64 Memory Map Reference](https://sta.c64.org/cbm64mem.html)*`;

	return markdown;
}

// Handle hover requests
connection.onHover((textDocumentPosition: TextDocumentPositionParams): Hover | null => {
	const document = documents.get(textDocumentPosition.textDocument.uri);
	if (!document) {
		connection.console.log('[Hover] Document not found');
		return null;
	}
	
	const position = textDocumentPosition.position;
	const offset = document.offsetAt(position);
	const text = document.getText();
	
	// Find word boundaries - search backwards and forwards from cursor position
	let start = offset;
	let end = offset;
	
	// Extended pattern to match hex addresses like $d000 or instructions
	// First, try to match a hex address pattern ($xxxx or $xx)
	const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
	const lineEnd = text.indexOf('\n', offset);
	const line = text.substring(lineStart, lineEnd === -1 ? text.length : lineEnd);
	const posInLine = offset - lineStart;
	
	// Try to find a hex address at cursor position
	const hexPattern = /\$[0-9a-fA-F]+/g;
	let hexMatch: RegExpExecArray | null;
	let foundHexAddr: string | null = null;
	
	while ((hexMatch = hexPattern.exec(line)) !== null) {
		const matchStart = hexMatch.index;
		const matchEnd = matchStart + hexMatch[0].length;
		if (posInLine >= matchStart && posInLine <= matchEnd) {
			foundHexAddr = hexMatch[0].toLowerCase();
			break;
		}
	}
	
	// If we found a hex address, check if it's a hardware register
	if (foundHexAddr) {
		connection.console.log(`[Hover] Found hex address: "${foundHexAddr}"`);
		
		// Normalize to 4-digit format (e.g., $d0 -> $d000, $D000 -> $d000)
		const normalizedAddr = normalizeHexAddress(foundHexAddr);
		
		connection.console.log(`[Hover] Normalized address: "${normalizedAddr}"`);
		
		const register = c64Hardware[normalizedAddr];
		if (register) {
			connection.console.log(`[Hover] Found hardware register: ${register.name}`);
			return {
				contents: {
					kind: MarkupKind.Markdown,
					value: formatHardwareRegisterHover(normalizedAddr, register)
				}
			};
		}
		connection.console.log(`[Hover] "${normalizedAddr}" is not a known hardware register`);
		// Don't return null yet - might still be an instruction
	}
	
	// If not a hardware register, try to match an instruction mnemonic
	// Search backwards for word start (or line start)
	start = offset;
	end = offset;
	
	while (start > 0 && /[a-zA-Z0-9_:\.]/.test(text[start - 1])) {
		start--;
	}
	
	// Search forwards for word end (or line end)
	while (end < text.length && /[a-zA-Z0-9_:\.]/.test(text[end])) {
		end++;
	}
	
	let word = text.substring(start, end);
	
	// Strip trailing colons (e.g. from label definitions "label:")
	if (word.endsWith(':')) {
		word = word.replace(/:+$/, '');
	}
	
	connection.console.log(`[Hover] Extracted word: "${word}" at position ${position.line}:${position.character}`);
	
	if (!word || word.length === 0) {
		connection.console.log('[Hover] No word found');
		return null;
	}

	// Check if it is a defined symbol (Label, Macro, Variable)
	const symbols = documentSymbols.get(textDocumentPosition.textDocument.uri);
	if (symbols) {
		const result = findSymbol(symbols, word);
		if (result) {
			if (result.type === 'label') {
				const label = result.symbol;
				connection.console.log(`[Hover] Found label: ${label.name}`);
				return {
					contents: {
						kind: MarkupKind.Markdown,
						value: `**Label** \`${label.name}\`\n\nAddress: \`$${label.addr.toString(16).toUpperCase().padStart(4, '0')}\`\n\nDefined in: ${URI.parse(label.uri).fsPath}:${label.line + 1}`
					}
				};
			} else if (result.type === 'macro') {
				const macro = result.symbol;
				connection.console.log(`[Hover] Found macro: ${macro.name}`);
				return {
					contents: {
						kind: MarkupKind.Markdown,
						value: `**Macro** \`${macro.name}\``
					}
				};
			} else if (result.type === 'variable') {
				const variable = result.symbol;
				connection.console.log(`[Hover] Found variable: ${variable.name}`);
				
				let valStr = JSON.stringify(variable.value);
				if (typeof variable.value === 'number') {
					valStr = `$${variable.value.toString(16).toUpperCase()}`;
				} else if (typeof variable.value === 'string') {
					valStr = `"${variable.value}"`;
				}

				return {
					contents: {
						kind: MarkupKind.Markdown,
						value: `**Variable** \`${variable.name}\`\n\nValue: \`${valStr}\`\n\nDefined in: ${URI.parse(variable.uri).fsPath}:${variable.line + 1}`
					}
				};
			} else if (result.type === 'property') {
				connection.console.log(`[Hover] Found variable property: ${word}`);
				let valStr = JSON.stringify(result.value);
				if (typeof result.value === 'number') {
					valStr = `$${result.value.toString(16).toUpperCase()}`;
				} else if (typeof result.value === 'string') {
					valStr = `"${result.value}"`;
				}
				
				return {
					contents: {
						kind: MarkupKind.Markdown,
						value: `**Variable Field** \`${result.name}\`\n\nValue: \`${valStr}\``
					}
				};
			}
		}
	}
	
	// Look up the instruction
	const instruction = instructions6502[word.toLowerCase()];
	if (instruction) {
		connection.console.log(`[Hover] Found instruction: ${instruction.name}`);
		return {
			contents: {
				kind: MarkupKind.Markdown,
				value: formatInstructionHover(instruction)
			}
		};
	}

	connection.console.log(`[Hover] "${word}" not found in symbols or instruction set`);
	return null;
});

// Handle definition requests
connection.onDefinition((textDocumentPosition: TextDocumentPositionParams): Location[] | null => {
	const document = documents.get(textDocumentPosition.textDocument.uri);
	const symbols = documentSymbols.get(textDocumentPosition.textDocument.uri);
	
	if (!document || !symbols) {
		return null;
	}
	
	const position = textDocumentPosition.position;
	const offset = document.offsetAt(position);
	const text = document.getText();
	
	// Find word boundaries including colons for namespace support
	let start = offset;
	let end = offset;
	
	// Search backwards
	while (start > 0) {
		if (/[a-zA-Z0-9_\.]/.test(text[start - 1])) {
			start--;
		} else if (text[start - 1] === ':' && start > 1 && text[start - 2] === ':') {
			start -= 2;
		} else {
			break;
		}
	}
	
	// Search forwards
	while (end < text.length) {
		if (/[a-zA-Z0-9_\.]/.test(text[end])) {
			end++;
		} else if (text[end] === ':' && end + 1 < text.length && text[end + 1] === ':') {
			end += 2;
		} else {
			break;
		}
	}
	
	const word = text.substring(start, end);
	
	if (!word || word.length === 0) {
		return null;
	}

	// Try to find the symbol
	const result = findSymbol(symbols, word);
	if (result && result.type === 'label') {
		const label = result.symbol;
		connection.console.log(`[Def] Found ${word} -> ${label.name} at ${label.uri}:${label.line}`);
		return [{
			uri: label.uri,
			range: {
				start: { line: label.line, character: 0 },
				end: { line: label.line, character: 0 }
			}
		}];
	} else if (result && (result.type === 'variable' || result.type === 'property')) {
		const symbol = result.type === 'variable' ? result.symbol : result.parent;
		connection.console.log(`[Def] Found variable ${symbol.name} at ${symbol.uri}:${symbol.line}`);
		return [{
			uri: symbol.uri,
			range: {
				start: { line: symbol.line, character: 0 },
				end: { line: symbol.line, character: 0 }
			}
		}];
	} else if (result) {
		connection.console.log(`[Def] Symbol '${word}' found but definition not available (kind: ${result.type})`);
	} else {
		connection.console.log(`[Def] Symbol '${word}' not found in ${symbols.labels.length} labels.`);
	}
	
	return null;
});

connection.onReferences((textDocumentPosition: TextDocumentPositionParams): Location[] | null => {
    const symbols = documentSymbols.get(textDocumentPosition.textDocument.uri);
    if (!symbols) return null;

    const document = documents.get(textDocumentPosition.textDocument.uri);
    if (!document) return null;

    const offset = document.offsetAt(textDocumentPosition.position);
    const currentDocPath = URI.parse(textDocumentPosition.textDocument.uri).fsPath;

    const areLocsEqual = (a: any, b: any) => {
        if (!a || !b) return false;
        const pA = path.resolve(a.source);
        const pB = path.resolve(b.source);
        // Relax strict equality for now, assuming if file+line+col match, it's the same symbol
        return pA === pB &&
            a.start.line === b.start.line &&
            a.start.column === b.start.column;
    };

    const isAtLoc = (loc: any) => {
        if (!loc) return false;
        const locPath = path.resolve(loc.source);
        if (locPath !== currentDocPath) return false;
        return offset >= loc.start.offset && offset <= loc.end.offset;
    };

    let targetDefLoc: any = null;

    // 1. Check references (cursor on usage)
    const ref = symbols.references.find(r => isAtLoc(r.loc));
    if (ref) {
        targetDefLoc = ref.defLoc;
    }

    // 2. Check definitions (cursor on definition)
    if (!targetDefLoc) {
        const label = symbols.labels.find(l => isAtLoc(l.range));
        if (label) {
            targetDefLoc = label.range;
        }
    }
    if (!targetDefLoc) {
         const variable = symbols.variables.find(v => isAtLoc(v.loc));
         if (variable) {
            targetDefLoc = variable.loc;
         }
    }
    
    // 3. Check macros
    if (!targetDefLoc) {
         const macro = symbols.macros.find(m => isAtLoc(m.loc));
         if (macro) {
            targetDefLoc = macro.loc;
         }
    }

    if (targetDefLoc) {
        const results: Location[] = [];

        // Add the Definition itself
        const defUri = URI.file(path.resolve(targetDefLoc.source)).toString();
        results.push({
            uri: defUri,
            range: {
                start: { line: Math.max(0, targetDefLoc.start.line - 1), character: Math.max(0, targetDefLoc.start.column - 1) },
                end: { line: Math.max(0, targetDefLoc.end.line - 1), character: Math.max(0, targetDefLoc.end.column - 1) }
            }
        });

        // Add all references
        const matchingRefs = symbols.references.filter(r => areLocsEqual(r.defLoc, targetDefLoc));
        
        matchingRefs.forEach(r => {
             const uri = URI.file(path.resolve(r.loc.source)).toString();
             // Ensure line/character aren't negative
             const startLine = Math.max(0, r.loc.start.line - 1);
             const startChar = Math.max(0, r.loc.start.column - 1);
             const endLine = Math.max(0, r.loc.end.line - 1);
             const endChar = Math.max(0, r.loc.end.column - 1);
             
             results.push({
                 uri,
                 range: {
                     start: { line: startLine, character: startChar },
                     end: { line: endLine, character: endChar }
                 }
             });
        });

        return results;
    }

    return null;
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
	(textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
		const symbols = documentSymbols.get(textDocumentPosition.textDocument.uri);
		if (!symbols) {
			return [];
		}

		const completions: CompletionItem[] = [];

		// Add labels
		symbols.labels.forEach((label, idx) => {
			completions.push({
				label: label.name,
				kind: CompletionItemKind.Constant,
				detail: `Label at $${label.addr.toString(16).toUpperCase().padStart(4, '0')}`,
				data: { type: 'label', index: idx, uri: textDocumentPosition.textDocument.uri }
			});
		});

		// Add macros
		symbols.macros.forEach((macro, idx) => {
			completions.push({
				label: macro.name,
				kind: CompletionItemKind.Function,
				detail: 'Macro',
				data: { type: 'macro', index: idx, uri: textDocumentPosition.textDocument.uri }
			});
		});

		// Add variables
		symbols.variables.forEach((variable, idx) => {
			completions.push({
				label: variable.name,
				kind: CompletionItemKind.Variable,
				detail: 'Variable',
				data: { type: 'variable', index: idx, uri: textDocumentPosition.textDocument.uri }
			});
		});

		return completions;
	}
);

// This handler resolve additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
	(item: CompletionItem): CompletionItem => {
		if (item.data && item.data.type && item.data.uri) {
			const symbols = documentSymbols.get(item.data.uri);
			if (symbols) {
				const { type, index } = item.data;
				if (type === 'label' && symbols.labels[index]) {
					const label = symbols.labels[index];
					item.documentation = `Label defined at address $${label.addr.toString(16).toUpperCase().padStart(4, '0')}`;
				} else if (type === 'macro' && symbols.macros[index]) {
					item.documentation = 'User-defined macro';
				} else if (type === 'variable' && symbols.variables[index]) {
					item.documentation = 'Assembler variable (constant)';
				}
			}
		}
		return item;
	}
);

/*
connection.onDidOpenTextDocument((params) => {
	// A text document got opened in VSCode.
	// params.uri uniquely identifies the document. For documents store on disk this is a file URI.
	// params.text the initial full content of the document.
	connection.console.log(`${params.textDocument.uri} opened.`);
});
connection.onDidChangeTextDocument((params) => {
	// The content of a text document did change in VSCode.
	// params.uri uniquely identifies the document.
	// params.contentChanges describe the content changes to the document.
	connection.console.log(`${params.textDocument.uri} changed: ${JSON.stringify(params.contentChanges)}`);
});
connection.onDidCloseTextDocument((params) => {
	// A text document got closed in VSCode.
	// params.uri uniquely identifies the document.
	connection.console.log(`${params.textDocument.uri} closed.`);
});
*/

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();

connection.onWorkspaceSymbol((params: WorkspaceSymbolParams): SymbolInformation[] => {
	const query = params.query.toLowerCase();
	const results: SymbolInformation[] = [];

	// Iterate over all cached documents
	for (const [uri, symbols] of documentSymbols.entries()) {
		// Add matching labels
		symbols.labels.forEach(label => {
			if (label.name.toLowerCase().includes(query)) {
				results.push({
					name: label.name,
					kind: SymbolKind.Constant,
					location: {
						uri: label.uri,
						range: {
							start: { line: label.line, character: 0 },
							end: { line: label.line, character: 0 }
						}
					}
				});
			}
		});

		// Add matching macros
		symbols.macros.forEach(macro => {
			if (macro.name.toLowerCase().includes(query)) {
				results.push({
					name: macro.name,
					kind: SymbolKind.Function,
					location: {
						uri: uri, // Macros don't currently store their URI in the symbol cache, assuming current doc
						range: {
							start: { line: Math.max(0, macro.loc.start.line - 1), character: Math.max(0, macro.loc.start.column - 1) },
							end: { line: Math.max(0, macro.loc.end.line - 1), character: Math.max(0, macro.loc.end.column - 1) }
						}
					}
				});
			}
		});

		// Add matching variables
		symbols.variables.forEach(variable => {
			if (variable.name.toLowerCase().includes(query)) {
				results.push({
					name: variable.name,
					kind: SymbolKind.Variable,
					location: {
						uri: variable.uri,
						range: {
							start: { line: variable.line, character: 0 },
							end: { line: variable.line, character: 0 }
						}
					}
				});
			}
		});
	}

	return results;
});
