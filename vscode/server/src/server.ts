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
	MarkupKind
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument'

import { URI } from 'vscode-uri'

import { instructions6502, InstructionInfo } from './instructions6502';
import { c64Hardware, HardwareRegister, normalizeHexAddress } from './c64hardware';

var c64jasm = require('c64jasm');

// Create a connection for the server. The connection uses Node's IPC as a transport.
// Also include all preview / proposed LSP features.
let connection = createConnection(ProposedFeatures.all);
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
			hoverProvider: true
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
	labels: Array<{name: string, addr: number, kind: 'label'}>;
	macros: Array<{name: string, kind: 'macro'}>;
	variables: Array<{name: string, kind: 'variable'}>;
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
documents.onDidChangeContent((_change: TextDocumentChangeEvent<TextDocument>) => {
	//	validateTextDocument(change.document);
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

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
	// In this simple example we get the settings for every validate run.
	await getDocumentSettings(textDocument.uri);

	const sourceFname = URI.parse(textDocument.uri).fsPath;
	const { errors, labels, debugInfo } = c64jasm.assemble(sourceFname);

	// Extract symbols for completion
	const symbols: DocumentSymbols = {
		labels: labels ? labels.map((l: any) => ({ name: l.name, addr: l.addr, kind: 'label' as const })) : [],
		macros: [],
		variables: []
	};

	// Extract macros and variables from debugInfo if available
	if (debugInfo && debugInfo.scopes) {
		const extractSymbols = (scope: any) => {
			if (scope.syms) {
				for (const [name, sym] of Object.entries(scope.syms)) {
					const s = sym as any;
					if (s.type === 'macro') {
						symbols.macros.push({ name, kind: 'macro' });
					} else if (s.type === 'var') {
						symbols.variables.push({ name, kind: 'variable' });
					}
				}
			}
			if (scope.children) {
				for (const child of Object.values(scope.children)) {
					extractSymbols(child);
				}
			}
		};
		extractSymbols(debugInfo.scopes);
	}

	documentSymbols.set(textDocument.uri, symbols);

	let diagnostics: Diagnostic[] = [];
	for (let errIdx = 0; errIdx < errors.length; errIdx++) {
		if (errIdx >= 10 /*settings.maxNumberOfProblems*/) {
			break;
		}
		const err = errors[errIdx];
		connection.console.log(`error from asm=${JSON.stringify(err)}`);

		const loc = err.loc
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
	
	while (start > 0 && /[a-zA-Z]/.test(text[start - 1])) {
		start--;
	}
	
	// Search forwards for word end (or line end)
	while (end < text.length && /[a-zA-Z]/.test(text[end])) {
		end++;
	}
	
	const word = text.substring(start, end);
	
	connection.console.log(`[Hover] Extracted word: "${word}" at position ${position.line}:${position.character}`);
	
	if (!word || word.length === 0) {
		connection.console.log('[Hover] No word found');
		return null;
	}
	
	// Look up the instruction
	const instruction = instructions6502[word.toLowerCase()];
	if (!instruction) {
		connection.console.log(`[Hover] "${word}" not found in instruction set`);
		return null;
	}
	
	connection.console.log(`[Hover] Found instruction: ${instruction.name}`);
	return {
		contents: {
			kind: MarkupKind.Markdown,
			value: formatInstructionHover(instruction)
		}
	};
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
