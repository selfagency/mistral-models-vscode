# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.4] - 2026-02-28

- Forked archived project from <https://github.com/OEvortex/vscode-mistral-copilot-chat>
- Fixed failing tool calls
- Added support for all available Mistral models
- Added `@mistral` chat participant
- Added full test suite

## [0.1.3] - 2025-12-31

### Fixed

- Fixed API error with tool call IDs containing underscores - generate valid 9-character alphanumeric IDs when VS Code tool call IDs don't have an existing mapping

## [0.1.2] - 2025-12-23

### Added

- Vision support for Devstral Small 2 model - can now process and analyze images
- Tool call ID mapping system to ensure compatibility with VS Code's Language Model API

### Fixed

- Fixed tool call ID validation error - Mistral API returns IDs like `call_70312205` which don't meet VS Code's requirements for alphanumeric 9-character IDs. Now properly maps between Mistral and VS Code ID formats.

## [0.1.1] - Previous Release

### Features

- Integration with Mistral AI models including Devstral, Mistral Large
- GitHub Copilot Chat compatibility
- Tool calling support
- API key management
