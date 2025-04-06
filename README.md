# Code Studio - Interactive Code Playground

Code Studio is a modern, feature-rich web-based code playground that combines AI-powered code generation, real-time collaborative editing, and multi-language support. It provides a seamless environment for coding, testing, and sharing code.

## Features

### Core Features
- **AI Code Generation**: Get instant code suggestions and explanations
- **Multi-language Support**:
  - Python
  - Java
  - JavaScript
  - C++
  - HTML/CSS
- **Real-time Code Execution**: Run code directly in the browser
- **Interactive Terminal**: Built-in terminal for command-line operations
- **File Explorer**: Manage multiple files and folders
- **Dark/Light Theme**: Customizable interface themes

### Advanced Features
- **Real-time Collaborative Editing**: Share your code and work together
- **Git Integration**: Version control for your code
- **Code Quality Tools**:
  - Syntax highlighting
  - Code formatting
  - Linting
- **Chat History**: Save and manage your AI interactions
- **Code Snippets**: Quick access to common code patterns

## Prerequisites

Before running the application, ensure you have:
- Node.js (v14 or higher)
- Git (for version control features)
- Python (for Python code execution)
- Java JDK (for Java code execution)
- C++ compiler (for C++ code execution)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd f4
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
node server.js
```

4. Open your browser and navigate to:
```
http://localhost:3000
```

## Usage

### Code Generation
1. Type your request in the chat interface
2. The AI will generate code based on your description
3. Click "Copy to Playground" to use the generated code

### Code Playground
1. Select your programming language
2. Write or paste your code
3. Click "Run" to execute
4. View output in the terminal or preview pane

### Collaborative Editing
1. Click the "Collaborative" button
2. Share the generated link with others
3. Work together in real-time

### Git Integration
1. Click the "Git" button to initialize a repository
2. Use Git commands through the interface
3. Track changes and manage versions

## Security Features

- Rate limiting to prevent abuse
- Input validation and sanitization
- Secure session management
- XSS protection
- CSRF protection

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- CodeMirror for the code editor
- XTerm.js for the terminal
- Simple Git for Git integration
- All other open-source libraries used in this project 