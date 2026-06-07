# Copilot Instructions

## Branch Roles

- `main`: primary branch of the `lukka/c64jasm` repository.
- `nurpax-master`: local integration branch for work intended to be contributed to `nurpax/c64jasm`.

## Commit Rules

- Keep commit scope single-domain.
- VS Code extension changes must be in extension-only commits.
- c64jasm assembler/core changes must be in core-only commits.
- Never mix extension and core assembler changes in the same commit.

## Contribution Intent

- Any core changes that may be proposed upstream must be isolated in commits based on `nurpax-master`.
