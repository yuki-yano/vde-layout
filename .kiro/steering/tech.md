# Technology Stack: vde-layout

## Architecture

The project follows a CLI tool architecture designed for terminal multiplexer integration:

- **CLI Interface**: Command-line tool distributed as an npm package
- **YAML Configuration**: Layout definitions follow XDG Base Directory specification
- **tmux Integration**: Direct interaction with tmux for pane management
- **Preset System**: Support for multiple named layout configurations
- **Modular Design**: Separation between configuration parsing and tmux commands
- **Interface-Based Architecture**: Dependency injection pattern with TypeScript interfaces
- **Strategy Pattern**: Multiple executor implementations (Real, DryRun, Mock)
- **Logger System**: Centralized logging with configurable verbosity levels

## CLI Tool

Primary command-line interface built with Node.js:
- **Runtime Support**: Both Node.js and Bun compatibility
- **Global Installation**: Available system-wide via npm/yarn/pnpm
- **Command Structure**: `vde-layout --preset <preset-name>`
- **Configuration Loading**: Reads from XDG config directory ($XDG_CONFIG_HOME/vde or ~/.config/vde)
- **Error Handling**: Clear messages for missing presets or tmux issues

## Core Library

Internal modules for layout management:
- **Config Loader**: XDG-compliant configuration discovery and loading
- **YAML Parser**: Configuration file parsing and validation with Zod schemas
- **tmux Interface**: Command generation and execution
- **Layout Engine**: Logic for reproducing pane arrangements
- **Preset Manager**: Handling multiple layout configurations
- **Executor Pattern**: Command execution abstraction (Real, DryRun, Mock)
- **Logger Module**: Structured logging with LogLevel enum
- **Error System**: Custom error classes with error codes
- **Type System**: TypeScript interfaces for dependency injection
- **Validation Layer**: Zod-based schema validation for type safety

## Development Environment

### Required Tools
- **Node.js**: v22+ for package development and runtime
- **Bun**: Alternative runtime (optional)
- **tmux**: Terminal multiplexer v2.0+ (required for functionality)
- **Git**: Version control system
- **npm/yarn/pnpm/bun**: Package manager
- **TypeScript**: v5.3.3+ - Primary development language (100% TypeScript codebase)

### Development Tools
- **ESLint**: Code linting (configured)
- **Prettier**: Code formatting (configured)
- **Vitest**: Testing framework
- **TypeScript ESLint**: TypeScript-specific linting

## Common Commands

### Package Management
```bash
# Install all dependencies from package.json
bun install

# Add new dependencies
bun add commander js-yaml execa chalk fs-extra

# Add dev dependencies
bun add -d typescript jest eslint prettier

# Build the package
bun run build

# Run tests
bun test

# Link for local development
bun link

# Publish to npm registry
npm publish
```

### Usage Commands
```bash
# Install globally
npm install -g vde-layout
# or
bun add -g vde-layout
# or
pnpm add -g vde-layout

# List available presets
vde-layout list

# Run with specific preset
vde-layout dev

# Run with default preset
vde-layout

# Dry-run mode (preview commands)
vde-layout dev --dry-run

# Verbose output
vde-layout dev --verbose

# Show help
vde-layout --help

# Show version
vde-layout --version
```

### Development Commands
```bash
# Build TypeScript
bun run build

# Watch mode for development
bun run dev

# Run tests
bun test
bun run test:watch
bun run test:coverage

# Run linting
bun run lint

# Format code
bun run format

# Type checking
bun run typecheck

# Clean build artifacts
bun run clean

# Prepare for publishing
bun run prepublishOnly
```

## Environment Variables

### Runtime Variables
- `XDG_CONFIG_HOME`: Standard XDG config directory (default: `~/.config`)
- `VDE_CONFIG_PATH`: Override default config path (default: `$XDG_CONFIG_HOME/vde`)
- `VDE_DEBUG`: Enable debug logging (set to "true" for stack traces)
- `VDE_VERBOSE`: Enable info-level logging (set to "true")
- `TMUX`: Automatically set by tmux when running inside a session
- `VDE_TEST_MODE`: Test environment flag (set automatically)

### Development Variables
- `NODE_ENV`: Development/production mode
- `NPM_TOKEN`: For automated publishing

## Port Configuration

No ports are required for this CLI tool.

## Dependencies

### Core Dependencies
- **commander**: v14.0.0 - CLI argument parsing
- **yaml**: v2.3.4 - YAML configuration parsing
- **execa**: v9.6.0 - Process execution for tmux commands
- **chalk**: v5.4.1 - Terminal output styling
- **fs-extra**: v11.2.0 - Enhanced file system operations
- **zod**: v3.22.4 - Schema validation for configurations

### Development Dependencies
- **typescript**: v5.3.3 - Primary development language
- **@types/node**: v20.11.5 - Node.js type definitions
- **@types/fs-extra**: v11.0.4 - fs-extra type definitions
- **vitest**: v1.2.1 - Testing framework
- **@vitest/coverage-v8**: v1.2.1 - Code coverage
- **eslint**: v9.32.0 - Code linting
- **typescript-eslint**: v8.38.0 - TypeScript ESLint integration
- **prettier**: v3.2.4 - Code formatting
- **eslint-config-prettier**: v9.1.0 - ESLint/Prettier compatibility

### Runtime Requirements
- **tmux**: Must be installed on the system
- **Node.js/Bun**: JavaScript runtime

## Build Process

The project uses standard npm package build process:
1. **Source Code**: Written in TypeScript (100% type coverage)
2. **Compilation**: TypeScript compilation to CommonJS
3. **Type Definitions**: Auto-generated .d.ts files
4. **Testing**: Vitest test suite execution with coverage
5. **Publishing**: npm publish workflow with prepublishOnly hook

### Build Steps
```bash
# Clean previous builds
bun run clean

# Compile TypeScript
bun run compile
# or
bun run build

# Run tests
bun test

# Type checking
bun run typecheck

# Build distributable (includes compilation)
bun run build
```

## Testing Strategy

### Test Categories
- **Unit Tests**: Core logic testing
  - YAML parsing with Zod validation
  - Configuration validation
  - Command generation
  - Interface implementations
  - Logger behavior
- **Integration Tests**: Module interaction
  - Layout engine with executors
  - Preset manager with config loader
  - Error handling across modules
- **E2E Tests**: Full command execution
  - CLI interface testing
  - Preset loading and execution
  - Dry-run mode verification

### Test Tools
- **Vitest**: Primary testing framework with coverage reporting
- **Mock Implementations**: Built-in mocks for all interfaces
- **Test Utils**: Centralized test helpers and console capture
- **Co-located Tests**: `__tests__/` directories next to source files

## Configuration Management

### XDG Base Directory Specification

The project follows XDG Base Directory specification for configuration files:

1. **Primary Config Location**: `$XDG_CONFIG_HOME/vde/layout.yml`
   - Falls back to `~/.config/vde/layout.yml` if XDG_CONFIG_HOME is not set

2. **Config Search Order**:
   - `$VDE_CONFIG_PATH/layout.yml` (if VDE_CONFIG_PATH is set)
   - `$XDG_CONFIG_HOME/vde/layout.yml`
   - `~/.config/vde/layout.yml`

3. **Benefits**:
   - Clean home directory (no dotfiles pollution)
   - Standard location for user configurations
   - Consistent with modern Linux/Unix applications
   - Easy backup and synchronization of configs
