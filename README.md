# tad

Tad is a VS Code extension that leverages AI to assist with code editing. It uses Claude Sonnet and Llama 3.1 80B to provide intelligent code suggestions and transformations directly within your editor.

## How It Works

Tad reads the `AI.md` file in your workspace root to understand your project context and preferences. This file acts as a guide for the AI, allowing you to customize its behavior and provide project-specific information.

Experiment with different content in your `AI.md` file to fine-tune Tad's performance and tailor it to your specific needs.

## Features

- AI-powered code rewriting
- Option to display diffs before applying changes
- Seamless integration with VS Code
- Support for multiple AI models (Claude Sonnet and Llama 3.1 80B)

## Requirements

- VS Code version 1.81.0 or higher
- An Anthropic API key (set as the ANTHROPIC_API_KEY environment variable)
- A Groq API key (set as the GROQ_API_KEY environment variable) for Llama 3.1 80B support
- Active internet connection for AI communication

## Known Issues

## Release Notes

### 0.0.3
- Support logging prompt inputs and outputs to a json file

### 0.0.2

- Added support for Llama 3.1 80B via Groq API
- Enhanced AI capabilities with multiple model options

### 0.0.1

Initial release of Tad:
- Basic AI-powered code editing functionality
- Option to view diffs before applying changes