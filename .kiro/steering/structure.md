# Project Structure: vde-layout

## Root Directory Organization

```
vde-layout/
├── .claude/                    # Claude Code configuration and commands
├── .kiro/                      # Kiro methodology files
├── .serena/                    # Serena project files and memories
├── bin/                        # CLI entry point
├── src/                        # TypeScript source code
├── examples/                   # Usage examples
├── CLAUDE.md                   # Claude Code project instructions
├── README.md                   # Project documentation
├── package.json                # npm package configuration
├── tsconfig.json               # TypeScript configuration
├── tsconfig.test.json          # TypeScript test configuration
├── vitest.config.ts            # Vitest test configuration
├── eslint.config.mjs           # ESLint configuration
├── .prettierrc                 # Prettier configuration
├── .gitignore                  # Git ignore patterns
├── .mcp.json                   # MCP configuration
├── bun.lock                    # Bun lockfile
└── mise.toml                   # mise environment manager config
```

### Directory Descriptions

- **`.claude/`**: Contains Claude Code specific configurations and slash commands
- **`.kiro/`**: Houses all Kiro methodology related files including specifications and steering documents
- **`bin/`**: CLI executable entry point
- **`src/`**: TypeScript source code with tests co-located
- **`examples/`**: Example configurations and usage
- **Root files**: Project and tool configurations

## Subdirectory Structures

### `.claude/commands/kiro/`
All Kiro methodology slash commands:
```
kiro/
├── spec-design.md              # Technical design generation command
├── spec-init.md                # Specification initialization command
├── spec-requirements.md        # Requirements generation command
├── spec-status.md              # Status checking command
├── spec-tasks.md               # Task generation command
├── steering-custom.md          # Custom steering document creation
└── steering.md                 # Main steering management command
```

### `.kiro/`
Kiro methodology workspace:
```
.kiro/
├── steering/                   # Project steering documents
│   ├── product.md              # Product overview (always included)
│   ├── tech.md                 # Technology decisions (always included)
│   └── structure.md            # This file (always included)
└── specs/                      # Feature specifications (future)
    └── [feature-name]/         # Individual feature specs
        ├── spec.json           # Specification metadata
        ├── requirements.md     # Phase 1: Requirements
        ├── design.md           # Phase 2: Technical design
        └── tasks.md            # Phase 3: Implementation tasks
```

### `bin/`
CLI entry point:
```
bin/
└── vde-layout                  # Executable script (#!/usr/bin/env node)
```

### `src/`
TypeScript source modules with co-located tests:
```
src/
├── index.ts                    # Main entry point
├── cli.ts                      # CLI interface and argument parsing
├── __tests__/                  # Top-level test files
│   ├── cli.test.ts
│   ├── e2e.test.ts
│   ├── index.test.ts
│   ├── helpers/
│   │   └── test-utils.ts       # Test utilities and console capture
│   └── mocks/
│       ├── layout-engine-mock.ts
│       ├── preset-manager-mock.ts
│       └── tmux-mock.ts
├── config/
│   ├── loader.ts               # Configuration file loading (XDG support)
│   ├── validator.ts            # YAML schema validation with Zod
│   └── __tests__/
│       ├── loader.test.ts
│       └── validator.test.ts
├── executor/                   # Command execution strategies
│   ├── index.ts                # Executor exports
│   ├── real-executor.ts        # Real tmux command execution
│   ├── dry-run-executor.ts     # Dry-run mode implementation
│   └── mock-executor.ts        # Mock executor for testing
├── interfaces/                 # TypeScript interfaces for DI
│   ├── index.ts                # Interface exports
│   └── command-executor.ts     # ICommandExecutor interface
├── layout/
│   ├── engine.ts               # Layout reproduction logic
│   ├── preset.ts               # Preset management
│   └── __tests__/
│       ├── engine.test.ts
│       └── preset.test.ts
├── models/
│   ├── schema.ts               # Zod schemas for configuration
│   ├── types.ts                # TypeScript type definitions
│   └── __tests__/
│       └── schema.test.ts
├── tmux/
│   ├── commands.ts             # tmux command generation
│   ├── executor.ts             # Command execution wrapper
│   └── __tests__/
│       ├── commands.test.ts
│       └── executor.test.ts
└── utils/
    ├── errors.ts               # Custom error classes
    ├── logger.ts               # Logger implementation with levels
    ├── ratio.ts                # Ratio calculation utilities
    └── __tests__/
        ├── errors.test.ts
        └── ratio.test.ts
```

### `examples/`
Example configurations:
```
examples/
└── basic-layout.yml            # Simple example layout configuration
```

## Code Organization Patterns

### Established Patterns
- **CLI-First Design**: Primary interface through command-line tool
- **Modular Architecture**: Clear separation between CLI, config, tmux, and layout modules
- **Configuration-Driven**: YAML files define all layout behavior
- **Error Handling**: Comprehensive error classes for different failure modes
- **Interface-Based Design**: All major components defined by TypeScript interfaces

### Implementation Patterns
- **Single Responsibility**: Each module handles one specific aspect
- **Dependency Injection**: Core modules accept dependencies as parameters via interfaces
- **Async/Await**: Modern async patterns for file I/O and process execution
- **Functional Approach**: Prefer pure functions for transformations
- **Strategy Pattern**: Multiple executor implementations selected at runtime
- **Logger Pattern**: Centralized logging with configurable verbosity
- **Type Safety**: Full TypeScript coverage with strict mode enabled

## File Naming Conventions

### Existing Conventions
- **Slash Commands**: Kebab-case with `.md` extension (e.g., `spec-init.md`)
- **Steering Documents**: Lowercase with descriptive names (e.g., `product.md`)
- **Specifications**: Feature names in kebab-case for directories
- **Source Files**: camelCase for TypeScript files (e.g., `loader.ts`, `validator.ts`)
- **Test Files**: `*.test.ts` pattern co-located with source files
- **Configuration Files**: Various conventions (`.prettierrc`, `tsconfig.json`, `vitest.config.ts`)

### TypeScript Conventions
- **Modules**: camelCase (e.g., `commands.ts`, `executor.ts`)
- **Type Files**: camelCase with descriptive names (e.g., `types.ts`, `schema.ts`)
- **Test Files**: Mirror source file name with `.test.ts` suffix
- **Mock Files**: Kebab-case in mocks directory (e.g., `tmux-mock.ts`)
- **Utility Files**: Descriptive camelCase (e.g., `test-utils.ts`)

## Import Organization

### Current Pattern
TypeScript imports follow a consistent order:

```typescript
// External dependencies
import { Command } from 'commander';
import chalk from 'chalk';
import { z } from 'zod';

// Internal modules (relative imports)
import { loadConfig } from './config/loader';
import { validateConfig } from './config/validator';

// Type imports
import type { Config, Preset } from './models/types';
```

### Import Guidelines
- **Module Resolution**: Node module resolution with TypeScript
- **Path Style**: Relative imports for internal modules (e.g., `'./config/loader'`)
- **Type Imports**: Use `import type` for type-only imports
- **Dependency Order**:
  1. External npm dependencies
  2. Internal module imports
  3. Type imports
  4. Side-effect imports (if any)

## Key Architectural Principles

### Established Principles
1. **Spec-Driven Development**: All features start with specifications
2. **Human-in-the-Loop**: Approval gates at each development phase
3. **Living Documentation**: Steering documents updated with project evolution
4. **File-Based Simplicity**: State and configuration through files, not databases

### Design Guidelines
1. **Clarity Over Cleverness**: Readable code and clear file organization
2. **Progressive Enhancement**: Start simple, add complexity only when needed
3. **Convention Over Configuration**: Follow established patterns
4. **Separation of Concerns**: Clear boundaries between different aspects

### Future Considerations
- **Scalability**: Structure should support growth without major refactoring
- **Testability**: Organization should facilitate easy testing
- **Modularity**: Components should be loosely coupled
- **Discoverability**: Developers should easily find what they need

## Extension Points

Places where the structure is designed to grow:

1. **New Modules**: Additional directories under `src/` for new functionality
2. **Additional Tests**: Co-located `__tests__/` directories with new modules
3. **Documentation**: `docs/` directory for extended documentation (when needed)
4. **More Examples**: Additional YAML files in `examples/` for different use cases
5. **Custom Steering**: Additional steering documents under `.kiro/steering/` as needed
6. **Feature Specifications**: New features under `.kiro/specs/[feature-name]/`
7. **Plugin System**: Potential `src/plugins/` directory for extensibility
8. **Themes/Styles**: Potential `src/themes/` for terminal output customization
9. **New Executors**: Additional executor strategies in `src/executor/`
10. **Interface Extensions**: New interfaces in `src/interfaces/` for future components
11. **Logger Transports**: Potential logging backends beyond console output
12. **Configuration Sources**: Additional config loaders beyond YAML files
