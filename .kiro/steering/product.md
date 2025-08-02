# Product Overview: vde-layout

## Product Overview

vde-layout is a terminal multiplexer layout management tool for the VDE (Vibe Coding Development Environment). It enables developers to efficiently manage and reproduce tmux pane layouts defined in YAML configuration files, streamlining the setup of terminal-based development environments for Vibe Coding workflows.

## Core Features

- **YAML-Based Layout Definition**: Define tmux pane layouts using human-readable YAML configuration
- **Preset Management**: Support for multiple layout presets following XDG Base Directory specification
- **Command Line Interface**: Simple `vde-layout [preset]` command for quick layout execution
- **tmux Integration**: Seamless integration with tmux for pane creation and arrangement
- **Layout Reproduction**: Accurately reproduce complex terminal layouts from configuration
- **Flexible Pane Settings**: Configure commands, working directories, environment variables per pane
- **Ratio-Based Splitting**: Intuitive ratio specification (e.g., [3, 2] for 60:40 split) with automatic normalization
- **Nested Layouts**: Freely combine horizontal and vertical splits at any depth
- **Single Pane Support**: Simple presets for single command execution without layout definition
- **Dry-Run Mode**: Preview tmux commands without execution using `--dry-run`
- **Cross-Platform Support**: Works with Node.js and Bun runtime environments
- **XDG Compliance**: Follows XDG Base Directory specification for configuration storage
- **Interface-Based Architecture**: Modular design with dependency injection for enhanced testability
- **Advanced Logging**: Structured logging system with configurable verbosity levels
- **Mock Testing Support**: Built-in mock implementations for comprehensive testing

## Target Use Case

This project addresses the following scenarios:

- **Vibe Coding Setup**: Quickly set up optimal terminal layouts for Vibe Coding sessions
- **Consistent Environments**: Reproduce the same terminal layout across different machines
- **Workflow Optimization**: Switch between different layouts for various development tasks
- **Team Standardization**: Share layout configurations among team members
- **Quick Recovery**: Restore complex layouts after terminal restarts or system reboots

## Key Value Proposition

- **Time Savings**: Eliminate manual tmux pane arrangement with single command execution
- **Consistency**: Ensure identical development environments across sessions and machines
- **Flexibility**: Support multiple presets for different workflows and projects
- **Simplicity**: Use familiar YAML syntax for layout configuration
- **Developer Experience**: Provide intuitive CLI interface for terminal-centric developers

## Project Status

In initial development phase, building on the foundation of the ccde project implementation. The project will provide an npm package that can be installed globally for system-wide availability.
