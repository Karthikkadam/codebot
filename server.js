const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const WebSocket = require('ws');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const prettier = require('prettier');
const eslint = require('eslint');
const { ESLint } = eslint;
const simpleGit = require('simple-git');

const app = express();

// Theme constants
const THEMES = {
  LIGHT: 'light',
  DARK: 'dark',
  MONOKAI: 'monokai',
  GITHUB: 'github',
  SOLARIZED: 'solarized',
  DRACULA: 'dracula'
};

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "cdnjs.cloudflare.com", "cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com", "cdn.jsdelivr.net", "cdnjs.cloudflare.com", "unpkg.com"],
      fontSrc: ["'self'", "fonts.gstatic.com", "cdn.jsdelivr.net", "unpkg.com"],
      imgSrc: ["'self'", "data:", "cdn.jsdelivr.net", "unpkg.com"],
      connectSrc: ["'self'", "ws:", "wss:"],
      frameSrc: ["'self'"]
    }
  }
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Request logging
app.use(morgan('combined'));

// Middleware setup
app.use(express.static('public'));
app.use(bodyParser.json({ limit: '1mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '1mb' }));
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? process.env.ALLOWED_ORIGIN : '*',
  credentials: true
}));

// Session configuration with secure settings
const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'use-a-stronger-secret-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 10 * 60 * 1000, // 10 minutes
    sameSite: 'strict'
  }
};

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(session(sessionConfig));

// Middleware to log user data
app.use((req, res, next) => {
  const userAgent = req.headers['user-agent'] || 'Unknown';
  const accessTime = new Date().toISOString();
  console.log(`Access Time: ${accessTime}, Browser/User-Agent: ${userAgent}`);
  next();
});

// Create HTTP server and attach WebSocket server
const server = http.createServer(app);
const wss = new WebSocket.Server({ 
  server,
  path: '/ws',
  perMessageDeflate: {
    zlibDeflateOptions: {
      chunkSize: 1024,
      memLevel: 7,
      level: 3
    },
    zlibInflateOptions: {
      chunkSize: 10 * 1024
    },
    clientNoContextTakeover: true,
    serverNoContextTakeover: true,
    serverMaxWindowBits: 10,
    concurrencyLimit: 10,
    threshold: 1024
  }
});

// Collaborative editing functionality
const collaborativeSessions = {};

// Handle WebSocket connections for collaborative editing
wss.on('connection', (ws, req) => {
  // Parse session ID from URL query params
  const url = new URL(req.url, 'http://localhost');
  const sessionId = url.searchParams.get('sessionId');
  const userName = url.searchParams.get('userName') || 'Anonymous';
  const isCollaborative = url.searchParams.get('mode') === 'collaborative';
  
  // Store conversation context for AI chat
  ws.conversationContext = '';
  
  // If this is a collaborative session connection
  if (isCollaborative && sessionId) {
    // Set up collaborative session properties
    ws.isCollaborative = true;
    ws.sessionId = sessionId;
    ws.userName = userName;
    
    // Initialize session if it doesn't exist
    if (!collaborativeSessions[sessionId]) {
      collaborativeSessions[sessionId] = {
        users: [],
        document: '',
        language: 'javascript',
        lastActive: Date.now()
      };
    }
    
    // Add user to session
    collaborativeSessions[sessionId].users.push({
      ws,
      userName,
      id: uuidv4(),
      joinedAt: Date.now()
    });
    
    // Update session activity timestamp
    collaborativeSessions[sessionId].lastActive = Date.now();
    
    // Broadcast user joined message to all session participants
    broadcastToSession(sessionId, {
      type: 'user-joined',
      userName,
      usersCount: collaborativeSessions[sessionId].users.length
    }, ws); // Exclude current user
    
    // Send current document state to newly joined user
    ws.send(JSON.stringify({
      type: 'document-state',
      content: collaborativeSessions[sessionId].document,
      language: collaborativeSessions[sessionId].language,
      users: collaborativeSessions[sessionId].users.map(u => ({
        userName: u.userName,
        id: u.id
      }))
    }));
    
    // Handle disconnect
    ws.on('close', () => {
      if (collaborativeSessions[sessionId]) {
        // Remove user from session
        collaborativeSessions[sessionId].users = 
          collaborativeSessions[sessionId].users.filter(u => u.ws !== ws);
        
        // If session is empty, clean it up after delay
        if (collaborativeSessions[sessionId].users.length === 0) {
          setTimeout(() => {
            if (collaborativeSessions[sessionId] && 
                collaborativeSessions[sessionId].users.length === 0) {
              delete collaborativeSessions[sessionId];
            }
          }, 60000); // Keep session for 1 minute in case users reconnect
        } else {
          // Broadcast user left message
          broadcastToSession(sessionId, {
            type: 'user-left',
            userName,
            usersCount: collaborativeSessions[sessionId].users.length
          });
        }
      }
    });
    
    // Handle collaborative editing messages
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        
        // Normal AI message processing
        if (data.input && !data.type) {
          handleAIMessage(ws, data);
          return;
        }
        
        // Ensure session still exists
        if (!collaborativeSessions[sessionId]) {
          ws.send(JSON.stringify({ 
            type: 'error', 
            message: 'Session no longer exists' 
          }));
          return;
        }
        
        // Update last active timestamp
        collaborativeSessions[sessionId].lastActive = Date.now();
        
        switch (data.type) {
          case 'code-update':
            // Update document content
            collaborativeSessions[sessionId].document = data.content;
            
            // Broadcast changes to other users
            broadcastToSession(sessionId, {
              type: 'code-update',
              content: data.content,
              userName
            }, ws);
            break;
            
          case 'cursor-position':
            // Broadcast cursor position to other users
            broadcastToSession(sessionId, {
              type: 'cursor-position',
              userName,
              position: data.position,
              userId: data.userId
            }, ws);
            break;
            
          case 'language-change':
            // Update language
            collaborativeSessions[sessionId].language = data.language;
            
            // Broadcast language change
            broadcastToSession(sessionId, {
              type: 'language-change',
              language: data.language,
              userName
            }, ws);
            break;
            
          case 'chat-message':
            // Broadcast chat message to all users in session
            broadcastToSession(sessionId, {
              type: 'chat-message',
              message: data.message,
              userName,
              timestamp: Date.now()
            });
            break;
            
          default:
            console.log('Unknown message type:', data.type);
        }
      } catch (err) {
        console.error('Error handling collaborative message:', err);
        ws.send(JSON.stringify({ 
          type: 'error', 
          message: 'Invalid message format' 
        }));
      }
    });
  } else {
    // Handle regular non-collaborative WebSocket connections
    ws.on('message', (message) => {
      const data = JSON.parse(message);
      handleAIMessage(ws, data);
    });
  }
});

// Function to handle AI message processing
function handleAIMessage(ws, data) {
  const userInput = data.input;
  
  if (!userInput) {
    ws.send(JSON.stringify({ error: 'No input provided' }));
    return;
  }
  
  if (userInput.trim() === '>>>') {
    ws.conversationContext = '';
    ws.send(JSON.stringify({ output: 'Conversation context reset.' }));
    return;
  }
  
  ws.conversationContext += `\n>>> ${userInput}`;
  
  const process = spawn('ollama', ['run', 'deepseek-r1:14b'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: true,
  });
  
  let output = '';
  process.stdout.on('data', (data) => {
    const chunk = data.toString();
    output += chunk;
    ws.send(JSON.stringify({ chunk }));
  });
  
  process.stderr.on('data', (data) => {
    const errorOutput = data.toString();
    // Filter out spinner-like characters
    const filteredError = errorOutput.replace(/[\u2800-\u28FF]/g, '').trim();
    if (filteredError) {
      console.error(`Error: ${filteredError}`);
    }
  });
  
  process.on('exit', (code) => {
    console.log(`Process exited with code ${code}`);
    ws.conversationContext += `\n${output}`;
    if (/\n\s*>>>\s*$/.test(output)) {
      ws.conversationContext = '';
    }
    ws.send(JSON.stringify({ done: true }));
  });
  
  process.stdin.write(ws.conversationContext);
  process.stdin.end();
}

// Function to broadcast message to all users in a session except the sender
function broadcastToSession(sessionId, message, excludeWs = null) {
  if (!collaborativeSessions[sessionId]) return;
  
  collaborativeSessions[sessionId].users.forEach(user => {
    // Skip sender if provided
    if (excludeWs && user.ws === excludeWs) return;
    
    if (user.ws.readyState === WebSocket.OPEN) {
      user.ws.send(JSON.stringify(message));
    }
  });
}

// Create a new collaborative session
app.post('/collaborative/create', (req, res) => {
  const { userName } = req.body;
  const sessionId = uuidv4();
  
  // Initialize session structure (actual users will be added when they connect via WebSocket)
  collaborativeSessions[sessionId] = {
    users: [],
    document: '',
    language: 'javascript',
    createdAt: Date.now(),
    lastActive: Date.now(),
    createdBy: userName || 'Anonymous'
  };
  
  res.json({
    success: true,
    sessionId,
    joinUrl: `/join/${sessionId}`
  });
});

// Get collaborative session info
app.get('/collaborative/session/:id', (req, res) => {
  const { id } = req.params;
  
  if (!collaborativeSessions[id]) {
    return res.status(404).json({
      success: false,
      error: 'Session not found'
    });
  }
  
  // Return session info without exposing WebSocket objects
  res.json({
    success: true,
    session: {
      id,
      userCount: collaborativeSessions[id].users.length,
      language: collaborativeSessions[id].language,
      createdAt: collaborativeSessions[id].createdAt,
      lastActive: collaborativeSessions[id].lastActive,
      createdBy: collaborativeSessions[id].createdBy,
      users: collaborativeSessions[id].users.map(u => ({
        userName: u.userName,
        id: u.id,
        joinedAt: u.joinedAt
      }))
    }
  });
});

// API to get all active collaborative sessions
app.get('/collaborative/sessions', (req, res) => {
  const activeSessions = Object.entries(collaborativeSessions)
    .map(([id, session]) => ({
      id,
      userCount: session.users.length,
      language: session.language,
      createdAt: session.createdAt,
      lastActive: session.lastActive,
      createdBy: session.createdBy
    }))
    .filter(session => {
      // Filter sessions that have been active in the last 24 hours
      return (Date.now() - session.lastActive) < 24 * 60 * 60 * 1000;
    });
  
  res.json({
    success: true,
    sessions: activeSessions
  });
});

// Add periodical cleanup of stale collaborative sessions
setInterval(() => {
  const now = Date.now();
  
  Object.keys(collaborativeSessions).forEach(sessionId => {
    const session = collaborativeSessions[sessionId];
    const inactiveTime = now - session.lastActive;
    
    // Remove sessions inactive for more than 24 hours, or empty for more than 1 hour
    if (inactiveTime > 24 * 60 * 60 * 1000 || 
        (session.users.length === 0 && inactiveTime > 60 * 60 * 1000)) {
      delete collaborativeSessions[sessionId];
      console.log(`Removed stale collaborative session: ${sessionId}`);
    }
  });
}, 60 * 60 * 1000); // Run cleanup every hour

// Session directory middleware with improved security
app.use((req, res, next) => {
  try {
    if (!req.session.directory) {
      const sessionId = uuidv4();
      const sessionDir = path.join(__dirname, 'tmp', sessionId);

      // Create session directory securely
      fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });

      // Create a .gitignore file in the session directory
      fs.writeFileSync(path.join(sessionDir, '.gitignore'), '*\n');

      req.session.directory = sessionDir;
      req.session.createdAt = Date.now();

      console.log(`Created new session directory: ${sessionDir}`);
    } else {
      // Update directory's modification time
      fs.utimesSync(req.session.directory, new Date(), new Date());
    }
    next();
  } catch (error) {
    console.error('Session directory creation error:', error);
    res.status(500).json({ error: 'Failed to initialize session' });
  }
});

// Middleware to validate session directory
function validateSessionDir(req, res, next) {
  const sessionDir = req.session.directory;

  if (!sessionDir) {
    return res.status(401).json({ error: 'No active session' });
  }

  if (!fs.existsSync(sessionDir)) {
    try {
      fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
      console.log(`Recreated missing session directory: ${sessionDir}`);
      next();
    } catch (err) {
      console.error('Failed to recreate session directory:', err);
      return res.status(500).json({ error: 'Session directory unavailable' });
    }
  } else {
    next();
  }
}

// Process management maps
const shellProcesses = {};
const processInstances = {};

// Process timeouts map
const processTimeouts = {};

// Utility function to check for shell injection
function containsShellInjection(command) {
  const dangerousPatterns = [
    /\b(rm|mv|cp|chmod|chown|wget|curl)\b/,
    /[><|&;$]/,
    /\.\./,
    /^[~\/]/
  ];
  return dangerousPatterns.some(pattern => pattern.test(command));
}

// Execute code with timeout
async function executeWithTimeout(process, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      safelyKillProcess(process).then(() => {
        reject(new Error('Execution timed out'));
      });
    }, timeoutMs);

    let output = '';
    let errorOutput = '';

    process.stdout.on('data', (data) => {
      output += data.toString();
    });

    process.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    process.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ code, output, errorOutput });
    });

    process.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

// Function to detect and install dependencies
async function detectAndInstallDependencies(code, sessionDir) {
  // Regular expressions to detect imports
  const importRegex = /^\s*import\s+([a-zA-Z0-9_]+)/gm;
  const fromImportRegex = /^\s*from\s+([a-zA-Z0-9_]+)\s+import/gm;
  const pipRegex = /^\s*#\s*pip\s*:\s*([a-zA-Z0-9_\-,\s]+)/gm;
  
  // Standard library modules to ignore
  const stdLibModules = new Set([
    'sys', 'os', 'math', 'json', 'random', 'time', 'datetime', 're', 
    'collections', 'functools', 'itertools', 'typing', 'argparse', 
    'pathlib', 'string', 'csv', 'hashlib', 'uuid', 'logging'
  ]);
  
  // Function to extract module names from imports
  const extractModules = (regex, code) => {
    const modules = [];
    let match;
    while ((match = regex.exec(code)) !== null) {
      const moduleName = match[1].trim();
      if (!stdLibModules.has(moduleName) && !moduleName.includes('.')) {
        modules.push(moduleName);
      }
    }
    return modules;
  };
  
  // Collect all imports
  let modulesToInstall = new Set([
    ...extractModules(importRegex, code),
    ...extractModules(fromImportRegex, code)
  ]);
  
  // Check for explicit pip instructions
  let match;
  while ((match = pipRegex.exec(code)) !== null) {
    const pipModules = match[1].split(',').map(m => m.trim());
    pipModules.forEach(module => {
      if (module) modulesToInstall.add(module);
    });
  }
  
  // If there are modules to install
  if (modulesToInstall.size > 0) {
    console.log(`Installing dependencies: ${Array.from(modulesToInstall).join(', ')}`);
    
    // Create requirements.txt file
    const requirementsPath = path.join(sessionDir, 'requirements.txt');
    fs.writeFileSync(requirementsPath, Array.from(modulesToInstall).join('\n'));
    
    try {
      // Install using pip
      const installProcess = spawn('pip', ['install', '--user', '-r', requirementsPath], {
        stdio: 'pipe',
        shell: true
      });
      
      return new Promise((resolve, reject) => {
        let output = '';
        let errorOutput = '';
        
        installProcess.stdout.on('data', (data) => {
          output += data.toString();
        });
        
        installProcess.stderr.on('data', (data) => {
          errorOutput += data.toString();
        });
        
        installProcess.on('close', (code) => {
          if (code !== 0) {
            console.error(`Dependency installation failed: ${errorOutput}`);
            reject(new Error(`Failed to install dependencies: ${errorOutput}`));
          } else {
            console.log(`Successfully installed dependencies: ${output}`);
            resolve({
              success: true,
              message: `Installed dependencies: ${Array.from(modulesToInstall).join(', ')}`
            });
          }
        });
      });
    } catch (err) {
      console.error('Error installing dependencies:', err);
      throw err;
    }
  }
  
  return { success: true, message: 'No dependencies to install' };
}

// Function to detect and handle Java dependencies
async function detectAndHandleJavaDependencies(code, sessionDir) {
  // Check for Maven dependency comments in format: // maven: groupId:artifactId:version
  const mavenRegex = /\/\/\s*maven\s*:\s*([a-zA-Z0-9\._\-]+:[a-zA-Z0-9\._\-]+:[a-zA-Z0-9\._\-]+)/gm;
  
  let dependencies = [];
  let match;
  
  while ((match = mavenRegex.exec(code)) !== null) {
    dependencies.push(match[1].trim());
  }
  
  if (dependencies.length === 0) {
    return { success: true, message: 'No dependencies to install' };
  }
  
  // Create pom.xml file for Maven dependencies
  const pomContent = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    
    <groupId>com.example</groupId>
    <artifactId>java-dependencies</artifactId>
    <version>1.0-SNAPSHOT</version>
    
    <dependencies>
${dependencies.map(dep => {
    const [groupId, artifactId, version] = dep.split(':');
    return `        <dependency>
            <groupId>${groupId}</groupId>
            <artifactId>${artifactId}</artifactId>
            <version>${version}</version>
        </dependency>`;
}).join('\n')}
    </dependencies>
    
    <build>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-dependency-plugin</artifactId>
                <version>3.1.2</version>
                <executions>
                    <execution>
                        <id>copy-dependencies</id>
                        <phase>package</phase>
                        <goals>
                            <goal>copy-dependencies</goal>
                        </goals>
                        <configuration>
                            <outputDirectory>${sessionDir}/lib</outputDirectory>
                        </configuration>
                    </execution>
                </executions>
            </plugin>
        </plugins>
    </build>
</project>`;
  
  const pomPath = path.join(sessionDir, 'pom.xml');
  fs.writeFileSync(pomPath, pomContent);
  
  console.log(`Installing Java dependencies: ${dependencies.join(', ')}`);
  
  try {
    // Use Maven to download the dependencies
    const mvnProcess = spawn('mvn', ['dependency:copy-dependencies', '-f', pomPath], {
      stdio: 'pipe',
      shell: true
    });
    
    return new Promise((resolve, reject) => {
      let output = '';
      let errorOutput = '';
      
      mvnProcess.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      mvnProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      mvnProcess.on('close', (code) => {
        if (code !== 0) {
          console.error(`Maven dependency installation failed: ${errorOutput}`);
          reject(new Error(`Failed to install Java dependencies: ${errorOutput}`));
        } else {
          console.log(`Successfully installed Java dependencies: ${output}`);
          resolve({
            success: true,
            message: `Installed Java dependencies: ${dependencies.join(', ')}`
          });
        }
      });
    });
  } catch (err) {
    console.error('Error installing Java dependencies:', err);
    throw err;
  }
}

// Route to execute Python code with improved security and automatic dependency installation
app.post('/execute', validateSessionDir, async (req, res) => {
  const { code, userInput } = req.body;
  
  if (!code) {
    return res.status(400).json({ error: 'No code provided' });
  }

  const sessionDir = req.session.directory;
  const filePath = path.join(sessionDir, 'temp_code.py');

  try {
    // Check for dangerous imports
    const dangerousImports = ['subprocess', 'shutil'];
    const importCheck = new RegExp(`\\b(import\\s+(${dangerousImports.join('|')})|from\\s+(${dangerousImports.join('|')})\\s+import)\\b`);
    
    if (importCheck.test(code)) {
      return res.status(403).json({ error: 'Code contains restricted imports' });
    }

    // Save the code
    fs.writeFileSync(filePath, code);
    
    // Detect and install dependencies
    try {
      const installResult = await detectAndInstallDependencies(code, sessionDir);
      if (installResult.success) {
        console.log(installResult.message);
      }
    } catch (installError) {
      console.error('Error during dependency installation:', installError);
      // Continue with execution even if dependency installation fails
    }

    const process = spawn('python3', [filePath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: sessionDir,
      env: {
        PATH: process.env.PATH,
        PYTHONPATH: sessionDir
      }
    });

    if (userInput) {
      process.stdin.write(userInput + '\n');
      process.stdin.end();
    }

    const { code: exitCode, output, errorOutput } = await executeWithTimeout(process);
    
    if (errorOutput) {
      console.error('Execution Error:', errorOutput);
      return res.json({ error: errorOutput });
    }

    res.json({ output });
  } catch (err) {
    console.error('Execution error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    // Clean up temporary file
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      console.error('File cleanup error:', err);
    }
  }
});

// Modify the code saving endpoint to include additional languages
app.post('/code', (req, res) => {
  const { code, language, css } = req.body;
  const sessionDir = req.session.directory;

  if (language === 'python') {
    const filePath = path.join(sessionDir, 'code.py');
    fs.writeFileSync(filePath, code);
    res.json({ message: 'Code saved', filePath });
  } else if (language === 'java') {
    const filePath = path.join(sessionDir, 'Main.java');
    fs.writeFileSync(filePath, code);
    res.json({ message: 'Code saved', filePath });
  } else if (language === 'html') {
    const htmlPath = path.join(sessionDir, 'index.html');
    const cssPath = path.join(sessionDir, 'styles.css');
    fs.writeFileSync(htmlPath, code);
    fs.writeFileSync(cssPath, css);
    res.json({ message: 'Code saved', htmlPath, cssPath });
  } else if (language === 'javascript') {
    const filePath = path.join(sessionDir, 'script.js');
    fs.writeFileSync(filePath, code);
    res.json({ message: 'Code saved', filePath });
  } else if (language === 'cpp') {
    const filePath = path.join(sessionDir, 'main.cpp');
    fs.writeFileSync(filePath, code);
    res.json({ message: 'Code saved', filePath });
  }
});

// Enhance run functionality to support JavaScript
app.post('/run', (req, res) => {
  const { language } = req.body;
  const sessionDir = req.session.directory;
  let filePath = '';

  if (language === 'python') {
    filePath = path.join(sessionDir, 'code.py');
    const processInstance = spawn('python3', [filePath]);
    processInstances[sessionDir] = processInstance;

    res.setHeader('Content-Type', 'application/json');
    res.write(JSON.stringify({ message: 'Running...' }));

    processInstance.stdout.on('data', (data) => {
      res.write(JSON.stringify({ output: data.toString() }));
    });

    processInstance.stderr.on('data', (data) => {
      res.write(JSON.stringify({ error: data.toString() }));
    });

    processInstance.on('close', (code) => {
      if (code === 0) {
        res.write(JSON.stringify({ message: `Process completed successfully` }));
      } else {
        res.write(JSON.stringify({ message: `Process exited with code ${code}` }));
      }
      res.end();
      delete processInstances[sessionDir];
    });
  } else if (language === 'java') {
    filePath = path.join(sessionDir, 'Main.java');
    const compileCommand = `javac "${filePath}"`;

    exec(compileCommand, (error, stdout, stderr) => {
      if (error || stderr) {
        return res.write(JSON.stringify({ error: stderr || error.message }));
      }

      const runCommand = `java -cp "${sessionDir}" Main`;
      const processInstance = exec(runCommand);
      processInstances[sessionDir] = processInstance;

      res.setHeader('Content-Type', 'application/json');
      res.write(JSON.stringify({ message: 'Running Java code...\r\n' }));

      processInstance.stdout.on('data', (data) => {
        res.write(JSON.stringify({ output: data.toString() }));
      });

      processInstance.stderr.on('data', (data) => {
        res.write(JSON.stringify({ error: data.toString() }));
      });

      processInstance.on('close', (code) => {
        if (code === 0) {
          res.write(JSON.stringify({ message: `Process completed successfully` }));
        } else {
          res.write(JSON.stringify({ message: `Process exited with code ${code}` }));
        }
        res.end();
        delete processInstances[sessionDir];
      });
    });
  } else if (language === 'javascript') {
    filePath = path.join(sessionDir, 'script.js');
    const processInstance = spawn('node', [filePath]);
    processInstances[sessionDir] = processInstance;

    res.setHeader('Content-Type', 'application/json');
    res.write(JSON.stringify({ message: 'Running JavaScript...\r\n' }));

    processInstance.stdout.on('data', (data) => {
      res.write(JSON.stringify({ output: data.toString() }));
    });

    processInstance.stderr.on('data', (data) => {
      res.write(JSON.stringify({ error: data.toString() }));
    });

    processInstance.on('close', (code) => {
      if (code === 0) {
        res.write(JSON.stringify({ message: `Process completed successfully` }));
      } else {
        res.write(JSON.stringify({ message: `Process exited with code ${code}` }));
      }
      res.end();
      delete processInstances[sessionDir];
    });
  } else if (language === 'cpp') {
    filePath = path.join(sessionDir, 'main.cpp');
    const outputPath = path.join(sessionDir, process.platform === 'win32' ? 'main.exe' : 'main');
    
    const compileCommand = `g++ "${filePath}" -o "${outputPath}"`;
    
    exec(compileCommand, (error, stdout, stderr) => {
      if (error || stderr) {
        return res.write(JSON.stringify({ error: stderr || error.message }));
      }
      
      const processInstance = spawn(outputPath);
      processInstances[sessionDir] = processInstance;
      
      res.setHeader('Content-Type', 'application/json');
      res.write(JSON.stringify({ message: 'Running C++...\r\n' }));
      
      processInstance.stdout.on('data', (data) => {
        res.write(JSON.stringify({ output: data.toString() }));
      });
      
      processInstance.stderr.on('data', (data) => {
        res.write(JSON.stringify({ error: data.toString() }));
      });
      
      processInstance.on('close', (code) => {
        if (code === 0) {
          res.write(JSON.stringify({ message: `Process completed successfully` }));
        } else {
          res.write(JSON.stringify({ message: `Process exited with code ${code}` }));
        }
        res.end();
        delete processInstances[sessionDir];
      });
    });
  }
});

// Modify run-file endpoint to support JavaScript and C++ and include validateSessionDir
app.post('/run-file', validateSessionDir, (req, res) => {
  const { path: relPath, language } = req.body;
  const sessionDir = req.session.directory;
  const fullPath = path.join(sessionDir, relPath);

  // Kill any existing process for this session
  if (processInstances[sessionDir]) {
    try {
      processInstances[sessionDir].kill();
    } catch (err) {
      console.error('Error killing existing process:', err);
    }
    delete processInstances[sessionDir];
  }

  if (!fullPath.startsWith(sessionDir)) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  // Handle Python code execution
  if (language === 'python') {
    // Execute Python files
    const processInstance = spawn('python', [fullPath], { 
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: path.dirname(fullPath)
    });
    
    // Store the process instance for this session
    processInstances[sessionDir] = processInstance;

    res.setHeader('Content-Type', 'application/json');
    res.write(JSON.stringify({ message: 'Running Python code...\r\n' }));

    processInstance.stdout.on('data', (data) => {
      res.write(JSON.stringify({ output: data.toString() }));
    });

    processInstance.stderr.on('data', (data) => {
      res.write(JSON.stringify({ error: data.toString() }));
    });

    processInstance.on('close', (code) => {
      if (code === 0) {
        res.write(JSON.stringify({ message: `Process completed successfully` }));
      } else {
        res.write(JSON.stringify({ message: `Process exited with code ${code}` }));
      }
      res.end();
      delete processInstances[sessionDir];
    });
    
    processInstance.on('error', (err) => {
      res.write(JSON.stringify({ error: `Failed to start process: ${err.message}` }));
      res.end();
      delete processInstances[sessionDir];
    });

  } else if (language === 'java') {
    // Execute Java files - first compile then run
    const fileName = path.basename(fullPath);
    const className = fileName.replace('.java', '');
    const workingDir = path.dirname(fullPath);
    
    // Compile the Java file
    exec(`javac "${fullPath}"`, { cwd: workingDir }, (compileError, stdout, stderr) => {
      if (compileError || stderr) {
        res.setHeader('Content-Type', 'application/json');
        res.write(JSON.stringify({ error: stderr || compileError.message }));
        res.end();
        return;
      }
      
      // Run the compiled Java class
      const processInstance = spawn('java', ['-cp', workingDir, className], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: workingDir
      });
      
      // Store the process instance for this session
      processInstances[sessionDir] = processInstance;
      
      res.setHeader('Content-Type', 'application/json');
      res.write(JSON.stringify({ message: 'Running Java code...\r\n' }));
      
      processInstance.stdout.on('data', (data) => {
        res.write(JSON.stringify({ output: data.toString() }));
      });
      
      processInstance.stderr.on('data', (data) => {
        res.write(JSON.stringify({ error: data.toString() }));
      });
      
      processInstance.on('close', (code) => {
        if (code === 0) {
          res.write(JSON.stringify({ message: `Process completed successfully` }));
        } else {
          res.write(JSON.stringify({ message: `Process exited with code ${code}` }));
        }
        res.end();
        delete processInstances[sessionDir];
      });
      
      processInstance.on('error', (err) => {
        res.write(JSON.stringify({ error: `Failed to start process: ${err.message}` }));
        res.end();
        delete processInstances[sessionDir];
      });
    });
  } else if (language === 'javascript') {
    // Execute JavaScript files using Node.js
    const processInstance = spawn('node', [fullPath], { 
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: path.dirname(fullPath)
    });
    
    // Store the process instance for this session
    processInstances[sessionDir] = processInstance;

    res.setHeader('Content-Type', 'application/json');
    res.write(JSON.stringify({ message: 'Running JavaScript...\r\n' }));

    processInstance.stdout.on('data', (data) => {
      res.write(JSON.stringify({ output: data.toString() }));
    });

    processInstance.stderr.on('data', (data) => {
      res.write(JSON.stringify({ error: data.toString() }));
    });

    processInstance.on('close', (code) => {
      if (code === 0) {
        res.write(JSON.stringify({ message: `Process completed successfully` }));
      } else {
        res.write(JSON.stringify({ message: `Process exited with code ${code}` }));
      }
      res.end();
      delete processInstances[sessionDir];
    });
    
    processInstance.on('error', (err) => {
      res.write(JSON.stringify({ error: `Failed to start process: ${err.message}` }));
      res.end();
      delete processInstances[sessionDir];
    });
  } else if (language === 'cpp') {
    // Compile and execute C++ files
    const outputPath = fullPath.replace(/\.[^.]+$/, process.platform === 'win32' ? '.exe' : '');
    const compileCommand = `g++ "${fullPath}" -o "${outputPath}"`;
    
    exec(compileCommand, (error, stdout, stderr) => {
      if (error || stderr) {
        res.setHeader('Content-Type', 'application/json');
        res.write(JSON.stringify({ error: stderr || error.message }));
        res.end();
        return;
      }
      
      const processInstance = spawn(outputPath, { 
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: path.dirname(fullPath)
      });
      
      // Store the process instance for this session
      processInstances[sessionDir] = processInstance;
      
      res.setHeader('Content-Type', 'application/json');
      res.write(JSON.stringify({ message: 'Running C++...\r\n' }));
      
      processInstance.stdout.on('data', (data) => {
        res.write(JSON.stringify({ output: data.toString() }));
      });
      
      processInstance.stderr.on('data', (data) => {
        res.write(JSON.stringify({ error: data.toString() }));
      });
      
      processInstance.on('close', (code) => {
        if (code === 0) {
          res.write(JSON.stringify({ message: `Process completed successfully` }));
        } else {
          res.write(JSON.stringify({ message: `Process exited with code ${code}` }));
        }
        res.end();
        delete processInstances[sessionDir];
      });
      
      processInstance.on('error', (err) => {
        res.write(JSON.stringify({ error: `Failed to start process: ${err.message}` }));
        res.end();
        delete processInstances[sessionDir];
      });
    });
  } else {
    res.status(400).json({ error: `Unsupported language: ${language}` });
  }
});

// New endpoint for code formatting
app.post('/format-code', validateSessionDir, async (req, res) => {
  const { code, language } = req.body;
  
  if (!code) {
    return res.status(400).json({ error: 'No code provided' });
  }
  
  try {
    let formattedCode = code;
    
    // Format based on language
    if (language === 'javascript' || language === 'html' || language === 'css') {
      const parser = language === 'javascript' ? 'babel' : language;
      formattedCode = await prettier.format(code, {
        parser,
        semi: true,
        singleQuote: true,
        tabWidth: 2
      });
    } else if (language === 'python') {
      // For Python, use the black formatter if available
      const sessionDir = req.session.directory;
      const tempFile = path.join(sessionDir, 'temp_format.py');
      
      fs.writeFileSync(tempFile, code);
      
      try {
        await new Promise((resolve, reject) => {
          exec(`black "${tempFile}" -q`, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });
        
        formattedCode = fs.readFileSync(tempFile, 'utf8');
        fs.unlinkSync(tempFile);
      } catch (err) {
        // If black formatter is not available, return original code
        console.error('Python formatter error:', err);
        formattedCode = code;
      }
    } else if (language === 'java') {
      // For Java, we could implement a basic formatter or use google-java-format if available
      // Here we're using a simple approach
      const sessionDir = req.session.directory;
      const tempFile = path.join(sessionDir, 'temp_format.java');
      
      fs.writeFileSync(tempFile, code);
      
      try {
        await new Promise((resolve, reject) => {
          exec(`google-java-format -i "${tempFile}"`, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });
        
        formattedCode = fs.readFileSync(tempFile, 'utf8');
        fs.unlinkSync(tempFile);
      } catch (err) {
        // If formatter is not available, return original code
        console.error('Java formatter error:', err);
        formattedCode = code;
      }
    }
    
    res.json({ formattedCode });
  } catch (err) {
    console.error('Code formatting error:', err);
    res.status(500).json({ error: 'Failed to format code', details: err.message });
  }
});

// New endpoint for code linting
app.post('/lint-code', validateSessionDir, async (req, res) => {
  const { code, language } = req.body;
  
  if (!code) {
    return res.status(400).json({ error: 'No code provided' });
  }
  
  const sessionDir = req.session.directory;
  
  try {
    let lintResults = [];
    
    if (language === 'javascript') {
      // Setup ESLint
      const eslint = new ESLint({
        useEslintrc: false,
        overrideConfig: {
          env: {
            browser: true,
            es2021: true,
            node: true
          },
          extends: ['eslint:recommended'],
          parserOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module'
          },
          rules: {
            'no-unused-vars': 'warn',
            'no-undef': 'error'
          }
        }
      });
      
      // Create temporary file for linting
      const tempFile = path.join(sessionDir, 'temp_lint.js');
      fs.writeFileSync(tempFile, code);
      
      const results = await eslint.lintFiles([tempFile]);
      
      // Convert ESLint results to a simpler format
      lintResults = results[0].messages.map(msg => ({
        line: msg.line,
        column: msg.column,
        severity: msg.severity === 2 ? 'error' : 'warning',
        message: msg.message,
        ruleId: msg.ruleId
      }));
      
      fs.unlinkSync(tempFile);
    } else if (language === 'python') {
      // Use flake8 for Python linting if available
      const tempFile = path.join(sessionDir, 'temp_lint.py');
      fs.writeFileSync(tempFile, code);
      
      try {
        const { stdout } = await new Promise((resolve, reject) => {
          exec(`flake8 "${tempFile}" --format=json`, (error, stdout, stderr) => {
            if (stderr) reject(new Error(stderr));
            else resolve({ stdout });
          });
        });
        
        // Parse flake8 output
        if (stdout.trim()) {
          const flake8Results = JSON.parse(stdout);
          lintResults = Object.values(flake8Results).map(result => ({
            line: result.line_number,
            column: result.column_number,
            severity: result.code[0] === 'E' ? 'error' : 'warning',
            message: result.text,
            ruleId: result.code
          }));
        }
      } catch (err) {
        console.error('Python linting error:', err);
        // If flake8 is not available, return empty results
      }
      
      fs.unlinkSync(tempFile);
    }
    
    res.json({ lintResults });
  } catch (err) {
    console.error('Code linting error:', err);
    res.status(500).json({ error: 'Failed to lint code', details: err.message });
  }
});

// Add code execution for JavaScript files
app.post('/execute-js', validateSessionDir, async (req, res) => {
  const { code } = req.body;
  
  if (!code) {
    return res.status(400).json({ error: 'No code provided' });
  }
  
  const sessionDir = req.session.directory;
  const filePath = path.join(sessionDir, 'temp_code.js');
  
  try {
    // Check for dangerous operations
    const dangerousImports = ['child_process', 'fs', 'path', 'os'];
    const importCheck = new RegExp(`\\brequire\\(\\s*['"]\\s*(${dangerousImports.join('|')})\\s*['"]\\s*\\)`, 'g');
    
    if (importCheck.test(code)) {
      return res.status(403).json({ error: 'Code contains restricted modules' });
    }
    
    fs.writeFileSync(filePath, code);
    
    const process = spawn('node', [filePath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: sessionDir
    });
    
    const { code: exitCode, output, errorOutput } = await executeWithTimeout(process);
    
    if (errorOutput) {
      return res.json({ error: errorOutput });
    }
    
    res.json({ output });
  } catch (err) {
    console.error('JavaScript execution error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    // Clean up temporary file
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      console.error('File cleanup error:', err);
    }
  }
});

// New endpoint to support saving multiple files (file project)
app.post('/save-project', validateSessionDir, (req, res) => {
  const { files } = req.body;
  const sessionDir = req.session.directory;
  
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'No files provided' });
  }
  
  try {
    const savedFiles = [];
    
    for (const file of files) {
      if (!file.name || !file.content) {
        continue;
      }
      
      // Sanitize file name
      const sanitizedName = file.name.replace(/[\/\\?%*:|"<>\x7F\x00-\x1F]/g, '_');
      const relativePath = file.path || '';
      const fullPath = path.join(sessionDir, relativePath, sanitizedName);
      
      // Prevent path traversal
      if (!fullPath.startsWith(sessionDir)) {
        continue;
      }
      
      // Create parent directory if it doesn't exist
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      
      // Write file
      fs.writeFileSync(fullPath, file.content);
      
      savedFiles.push({
        name: sanitizedName,
        path: relativePath,
        fullPath
      });
    }
    
    res.json({
      message: `Saved ${savedFiles.length} files`,
      files: savedFiles
    });
  } catch (err) {
    console.error('Project save error:', err);
    res.status(500).json({ error: 'Failed to save project files: ' + err.message });
  }
});

// New file search endpoint
app.get('/search-files', validateSessionDir, (req, res) => {
  const { query } = req.query;
  const sessionDir = req.session.directory;
  
  if (!query) {
    return res.status(400).json({ error: 'Search query is required' });
  }
  
  try {
    // Function to recursively search for files
    const searchFiles = (dir, results = []) => {
      const files = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const file of files) {
        const fullPath = path.join(dir, file.name);
        const relativePath = path.relative(sessionDir, fullPath);
        
        // Skip hidden files and node_modules
        if (file.name.startsWith('.') || file.name === 'node_modules') {
          continue;
        }
        
        if (file.isDirectory()) {
          searchFiles(fullPath, results);
        } else if (file.name.toLowerCase().includes(query.toLowerCase())) {
          const stats = fs.statSync(fullPath);
          results.push({
            name: file.name,
            path: relativePath,
            size: stats.size,
            modified: stats.mtime
          });
        }
      }
      
      return results;
    };
    
    const searchResults = searchFiles(sessionDir);
    
    res.json({
      results: searchResults.slice(0, 50), // Limit results to prevent large responses
      count: searchResults.length,
      query
    });
  } catch (err) {
    console.error('File search error:', err);
    res.status(500).json({ error: 'Failed to search files: ' + err.message });
  }
});

// New endpoint for getting available themes
app.get('/themes', (req, res) => {
  res.json({
    themes: Object.values(THEMES),
    current: req.session.theme || THEMES.LIGHT
  });
});

// New endpoint for setting user theme preference
app.post('/set-theme', (req, res) => {
  const { theme } = req.body;
  
  if (!Object.values(THEMES).includes(theme)) {
    return res.status(400).json({ error: 'Invalid theme' });
  }
  
  req.session.theme = theme;
  res.json({ message: 'Theme updated', theme });
});

// Git integration endpoints
app.post('/git/init', validateSessionDir, async (req, res) => {
  const sessionDir = req.session.directory;
  
  try {
    // Check if Git is installed by testing a command
    try {
      require('child_process').execSync('git --version', { stdio: 'ignore' });
    } catch (gitCheckError) {
      console.error('Git is not installed or not in PATH:', gitCheckError);
      return res.status(400).json({ error: 'Git is not installed or not in the system PATH. Please install Git to use this feature.' });
    }
    
    const git = simpleGit(sessionDir);
    await git.init();
    
    // Create .gitignore if it doesn't exist
    const gitignorePath = path.join(sessionDir, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, '# Node modules\nnode_modules/\n\n# Environment files\n.env\n');
    }
    
    res.json({ message: 'Git repository initialized successfully' });
  } catch (err) {
    console.error('Git init error:', err);
    res.status(500).json({ error: 'Failed to initialize Git repository: ' + err.message });
  }
});

app.post('/git/status', validateSessionDir, async (req, res) => {
  const sessionDir = req.session.directory;
  
  try {
    const git = simpleGit(sessionDir);
    
    // Check if git repo exists
    if (!fs.existsSync(path.join(sessionDir, '.git'))) {
      return res.status(400).json({ error: 'Not a git repository' });
    }
    
    const status = await git.status();
    res.json(status);
  } catch (err) {
    console.error('Git status error:', err);
    res.status(500).json({ error: 'Failed to get Git status: ' + err.message });
  }
});

app.post('/git/add', validateSessionDir, async (req, res) => {
  const { files } = req.body;
  const sessionDir = req.session.directory;
  
  try {
    const git = simpleGit(sessionDir);
    
    if (!fs.existsSync(path.join(sessionDir, '.git'))) {
      return res.status(400).json({ error: 'Not a git repository' });
    }
    
    if (files && Array.isArray(files)) {
      await git.add(files);
    } else {
      await git.add('.');
    }
    
    const status = await git.status();
    res.json({ message: 'Files added to staging area', status });
  } catch (err) {
    console.error('Git add error:', err);
    res.status(500).json({ error: 'Failed to add files: ' + err.message });
  }
});

app.post('/git/commit', validateSessionDir, async (req, res) => {
  const { message } = req.body;
  const sessionDir = req.session.directory;
  
  if (!message) {
    return res.status(400).json({ error: 'Commit message is required' });
  }
  
  try {
    const git = simpleGit(sessionDir);
    
    if (!fs.existsSync(path.join(sessionDir, '.git'))) {
      return res.status(400).json({ error: 'Not a git repository' });
    }
    
    // Configure git user if not already set
    try {
      await git.addConfig('user.name', 'Code Studio User');
      await git.addConfig('user.email', 'user@codestudio.example.com');
    } catch (configErr) {
      console.warn('Git config warning:', configErr);
    }
    
    const commitResult = await git.commit(message);
    res.json({ message: 'Changes committed successfully', commitResult });
  } catch (err) {
    console.error('Git commit error:', err);
    res.status(500).json({ error: 'Failed to commit changes: ' + err.message });
  }
});

app.get('/git/log', validateSessionDir, async (req, res) => {
  const sessionDir = req.session.directory;
  
  try {
    const git = simpleGit(sessionDir);
    
    if (!fs.existsSync(path.join(sessionDir, '.git'))) {
      return res.status(400).json({ error: 'Not a git repository' });
    }
    
    const log = await git.log();
    res.json(log);
  } catch (err) {
    console.error('Git log error:', err);
    res.status(500).json({ error: 'Failed to get Git log: ' + err.message });
  }
});

// New endpoint for code snippets
app.get('/snippets', validateSessionDir, (req, res) => {
  const { language } = req.query;
  
  // Default snippets for common languages
  const snippets = {
    python: [
      {
        name: 'Hello World',
        code: 'print("Hello, World!")',
        description: 'Simple hello world program'
      },
      {
        name: 'File Reading',
        code: 'with open("file.txt", "r") as f:\n    content = f.read()\n    print(content)',
        description: 'Read content from a file'
      },
      {
        name: 'List Comprehension',
        code: 'numbers = [1, 2, 3, 4, 5]\nsquared = [x**2 for x in numbers]\nprint(squared)',
        description: 'Square numbers using list comprehension'
      }
    ],
    javascript: [
      {
        name: 'Hello World',
        code: 'console.log("Hello, World!");',
        description: 'Simple hello world program'
      },
      {
        name: 'Fetch API',
        code: 'fetch("https://api.example.com/data")\n  .then(response => response.json())\n  .then(data => console.log(data))\n  .catch(error => console.error("Error:", error));',
        description: 'Fetch data from an API'
      },
      {
        name: 'Array Methods',
        code: 'const numbers = [1, 2, 3, 4, 5];\nconst doubled = numbers.map(num => num * 2);\nconsole.log(doubled);',
        description: 'Map over an array to double values'
      }
    ],
    java: [
      {
        name: 'Hello World',
        code: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}',
        description: 'Simple hello world program'
      },
      {
        name: 'File Reading',
        code: 'import java.io.File;\nimport java.io.FileNotFoundException;\nimport java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        try {\n            File file = new File("file.txt");\n            Scanner scanner = new Scanner(file);\n            while (scanner.hasNextLine()) {\n                String line = scanner.nextLine();\n                System.out.println(line);\n            }\n            scanner.close();\n        } catch (FileNotFoundException e) {\n            System.out.println("File not found.");\n            e.printStackTrace();\n        }\n    }\n}',
        description: 'Read content from a file'
      }
    ],
    html: [
      {
        name: 'Basic Structure',
        code: '<!DOCTYPE html>\n<html lang="en">\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>Document</title>\n    <link rel="stylesheet" href="styles.css">\n</head>\n<body>\n    <h1>Hello, World!</h1>\n    <script src="script.js"></script>\n</body>\n</html>',
        description: 'Basic HTML5 document structure'
      },
      {
        name: 'Form',
        code: '<form action="/submit" method="post">\n    <div>\n        <label for="name">Name:</label>\n        <input type="text" id="name" name="name" required>\n    </div>\n    <div>\n        <label for="email">Email:</label>\n        <input type="email" id="email" name="email" required>\n    </div>\n    <button type="submit">Submit</button>\n</form>',
        description: 'HTML form with basic validation'
      }
    ],
    cpp: [
      {
        name: 'Hello World',
        code: '#include <iostream>\n\nint main() {\n    std::cout << "Hello, World!" << std::endl;\n    return 0;\n}',
        description: 'Simple hello world program'
      },
      {
        name: 'File Reading',
        code: '#include <iostream>\n#include <fstream>\n#include <string>\n\nint main() {\n    std::ifstream file("file.txt");\n    std::string line;\n    \n    if (file.is_open()) {\n        while (getline(file, line)) {\n            std::cout << line << std::endl;\n        }\n        file.close();\n    } else {\n        std::cout << "Unable to open file" << std::endl;\n    }\n    \n    return 0;\n}',
        description: 'Read content from a file'
      }
    ]
  };
  
  if (language && snippets[language]) {
    res.json({ snippets: snippets[language] });
  } else {
    res.json({ snippets: snippets });
  }
});

// Add autocomplete API endpoint
app.post('/autocomplete', validateSessionDir, async (req, res) => {
  const { code, language, position } = req.body;
  
  if (!code) {
    return res.status(400).json({ error: 'No code provided' });
  }
  
  try {
    let suggestions = [];
    
    // Simple autocomplete for different languages
    if (language === 'python') {
      // Simple Python keywords and standard library functions
      const pythonCompletions = [
        { text: 'def', displayText: 'def function_name():', description: 'Define a function' },
        { text: 'class', displayText: 'class ClassName:', description: 'Define a class' },
        { text: 'import', displayText: 'import module', description: 'Import a module' },
        { text: 'from', displayText: 'from module import name', description: 'Import specific item from module' },
        { text: 'if', displayText: 'if condition:', description: 'If statement' },
        { text: 'else', displayText: 'else:', description: 'Else statement' },
        { text: 'elif', displayText: 'elif condition:', description: 'Else if statement' },
        { text: 'for', displayText: 'for item in iterable:', description: 'For loop' },
        { text: 'while', displayText: 'while condition:', description: 'While loop' },
        { text: 'try', displayText: 'try:\n    # code\nexcept Exception as e:\n    # handle exception', description: 'Try-except block' },
        { text: 'print', displayText: 'print(value)', description: 'Print to console' },
        { text: 'len', displayText: 'len(object)', description: 'Get length of object' },
        { text: 'range', displayText: 'range(start, stop, step)', description: 'Create a range' },
        { text: 'list', displayText: 'list(iterable)', description: 'Create a list' },
        { text: 'dict', displayText: 'dict(mapping)', description: 'Create a dictionary' },
        { text: 'set', displayText: 'set(iterable)', description: 'Create a set' },
        { text: 'tuple', displayText: 'tuple(iterable)', description: 'Create a tuple' },
        { text: 'str', displayText: 'str(object)', description: 'Convert to string' },
        { text: 'int', displayText: 'int(value)', description: 'Convert to integer' },
        { text: 'float', displayText: 'float(value)', description: 'Convert to float' },
        { text: 'bool', displayText: 'bool(value)', description: 'Convert to boolean' },
        { text: 'open', displayText: 'open(file, mode)', description: 'Open a file' },
        { text: 'with', displayText: 'with expression as variable:', description: 'Context manager' }
      ];
      
      // Filter completions based on what the user is typing
      const lineBeforeCursor = code.substring(0, position).split('\n').pop();
      const currentWord = lineBeforeCursor.match(/[a-zA-Z0-9_]*$/)[0];
      
      if (currentWord) {
        suggestions = pythonCompletions.filter(item => 
          item.text.startsWith(currentWord)
        );
      } else {
        suggestions = pythonCompletions;
      }
    } else if (language === 'javascript') {
      // Simple JavaScript keywords and functions
      const jsCompletions = [
        { text: 'function', displayText: 'function name() {}', description: 'Define a function' },
        { text: 'const', displayText: 'const name = value;', description: 'Declare constant' },
        { text: 'let', displayText: 'let name = value;', description: 'Declare variable (block scope)' },
        { text: 'var', displayText: 'var name = value;', description: 'Declare variable (function scope)' },
        { text: 'if', displayText: 'if (condition) {}', description: 'If statement' },
        { text: 'else', displayText: 'else {}', description: 'Else statement' },
        { text: 'for', displayText: 'for (let i = 0; i < array.length; i++) {}', description: 'For loop' },
        { text: 'while', displayText: 'while (condition) {}', description: 'While loop' },
        { text: 'switch', displayText: 'switch (expression) { case value: break; }', description: 'Switch statement' },
        { text: 'try', displayText: 'try { } catch (error) { }', description: 'Try-catch block' },
        { text: 'class', displayText: 'class ClassName {}', description: 'Define a class' },
        { text: 'console.log', displayText: 'console.log(message);', description: 'Log to console' },
        { text: 'return', displayText: 'return value;', description: 'Return statement' },
        { text: 'setTimeout', displayText: 'setTimeout(() => {}, delay);', description: 'Set timeout' },
        { text: 'setInterval', displayText: 'setInterval(() => {}, delay);', description: 'Set interval' },
        { text: 'document.getElementById', displayText: 'document.getElementById("id");', description: 'Get element by ID' },
        { text: 'document.querySelector', displayText: 'document.querySelector("selector");', description: 'Query selector' },
        { text: 'fetch', displayText: 'fetch(url).then(response => response.json());', description: 'Fetch API' },
        { text: 'async', displayText: 'async function name() {}', description: 'Async function' },
        { text: 'await', displayText: 'await promise;', description: 'Await expression' }
      ];
      
      // Filter completions based on what the user is typing
      const lineBeforeCursor = code.substring(0, position).split('\n').pop();
      const currentWord = lineBeforeCursor.match(/[a-zA-Z0-9_\.]*$/)[0];
      
      if (currentWord) {
        suggestions = jsCompletions.filter(item => 
          item.text.startsWith(currentWord)
        );
      } else {
        suggestions = jsCompletions;
      }
    }
    
    res.json({ suggestions });
  } catch (err) {
    console.error('Autocomplete error:', err);
    res.status(500).json({ error: 'Failed to generate autocomplete suggestions', details: err.message });
  }
});

// Improved cleanup expired sessions
function cleanupExpiredSessions() {
  console.log('Running expired session cleanup');

  const tmpDir = path.join(__dirname, 'tmp');
  if (!fs.existsSync(tmpDir)) {
    return;
  }

  try {
    fs.readdirSync(tmpDir).forEach(async (dir) => {
      const dirPath = path.join(tmpDir, dir);

      try {
        const stats = fs.statSync(dirPath);
        const now = Date.now();
        const age = now - stats.mtimeMs;

        // Sessions older than 10 minutes are considered expired
        if (age > 10 * 60 * 1000) {
          console.log(`Cleaning up expired session directory: ${dirPath}`);

          // Kill any processes
          if (shellProcesses[dirPath]) {
            await safelyKillProcess(shellProcesses[dirPath]);
            delete shellProcesses[dirPath];
          }

          if (processInstances[dirPath]) {
            await safelyKillProcess(processInstances[dirPath]);
            delete processInstances[dirPath];
          }

          // Clear any timeouts
          if (processTimeouts[dirPath]) {
            clearTimeout(processTimeouts[dirPath]);
            delete processTimeouts[dirPath];
          }

          // Remove the directory
          fs.rmSync(dirPath, { recursive: true, force: true });
          console.log(`Removed expired session directory: ${dirPath}`);
        }
      } catch (err) {
        console.error(`Error processing directory ${dirPath}:`, err);
      }
    });
  } catch (err) {
    console.error('Error during expired session cleanup:', err);
  }
}

// Helper function to safely kill processes
async function safelyKillProcess(process) {
  return new Promise((resolve) => {
    try {
      if (process && typeof process.kill === 'function') {
        process.kill();
      }
    } catch (error) {
      console.error('Error killing process:', error);
    }
    resolve();
  });
}

// Cleanup all sessions
async function cleanupAllSessions() {
  console.log('Cleaning up all sessions...');
  const tmpDir = path.join(__dirname, 'tmp');

  if (!fs.existsSync(tmpDir)) {
    return;
  }

  try {
    const dirs = fs.readdirSync(tmpDir);
    await Promise.all(dirs.map(async (dir) => {
      const dirPath = path.join(tmpDir, dir);
      try {
        if (shellProcesses[dirPath]) {
          await safelyKillProcess(shellProcesses[dirPath]);
          delete shellProcesses[dirPath];
        }
        if (processInstances[dirPath]) {
          await safelyKillProcess(processInstances[dirPath]);
          delete processInstances[dirPath];
        }
        if (processTimeouts[dirPath]) {
          clearTimeout(processTimeouts[dirPath]);
          delete processTimeouts[dirPath];
        }
      } catch (err) {
        console.error(`Error cleaning up processes for ${dirPath}:`, err);
      }
    }));

    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log('Cleaned up all session directories');
  } catch (err) {
    console.error('Error during complete cleanup:', err);
  }
}

// Set up cleanup interval
const cleanupInterval = setInterval(cleanupExpiredSessions, 10 * 60 * 1000);

// Graceful shutdown handling
async function gracefulShutdown(signal) {
  console.log(`Received ${signal}. Starting graceful shutdown...`);
  
  // Clear the cleanup interval
  clearInterval(cleanupInterval);

  // Clean up all sessions
  await cleanupAllSessions();

  console.log('Graceful shutdown completed');
  process.exit(0);
}

// Register shutdown handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // For nodemon restarts

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

  // Create tmp directory if it doesn't exist
  const tmpDir = path.join(__dirname, 'tmp');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
  }

  // Run initial cleanup
  cleanupExpiredSessions();
});

// File explorer endpoint to list files and directories
app.get('/explorer', validateSessionDir, (req, res) => {
  try {
    const sessionDir = req.session.directory;
    const relPath = req.query.path || '';
    const fullPath = path.join(sessionDir, relPath);
    
    // Security check to prevent path traversal
    if (!fullPath.startsWith(sessionDir)) {
      return res.status(403).json({ error: 'Access denied: Invalid path' });
    }
    
    // Check if path exists
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Path not found' });
    }
    
    // Check if it's a directory
    const stats = fs.statSync(fullPath);
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: 'Not a directory' });
    }
    
    // Read directory contents
    const contents = fs.readdirSync(fullPath, { withFileTypes: true });
    
    // Process and format the directory contents
    const items = contents.map(item => {
      const itemPath = path.join(fullPath, item.name);
      const itemStats = fs.statSync(itemPath);
      const relativePath = path.relative(sessionDir, itemPath);
      
      return {
        name: item.name,
        path: relativePath,
        isDirectory: item.isDirectory(),
        size: itemStats.size,
        modified: itemStats.mtime,
        created: itemStats.birthtime
      };
    });
    
    // Separate directories and files, and sort them
    const dirs = items.filter(item => item.isDirectory).sort((a, b) => a.name.localeCompare(b.name));
    const files = items.filter(item => !item.isDirectory).sort((a, b) => a.name.localeCompare(b.name));
    
    // Combine directories first, then files
    const sortedItems = [...dirs, ...files];
    
    // Add parent directory option if not at root
    if (relPath) {
      const parentPath = path.dirname(relPath);
      sortedItems.unshift({
        name: '..',
        path: parentPath,
        isDirectory: true,
        isParent: true
      });
    }
    
    res.json({
      success: true,
      path: relPath,
      items: sortedItems
    });
  } catch (err) {
    console.error('File explorer error:', err);
    res.status(500).json({ error: 'Failed to list directory contents: ' + err.message });
  }
});

// Add an endpoint to get file information
app.get('/file-info', validateSessionDir, (req, res) => {
  try {
    const sessionDir = req.session.directory;
    const relPath = req.query.path;
    
    if (!relPath) {
      return res.status(400).json({ error: 'File path is required' });
    }
    
    const fullPath = path.join(sessionDir, relPath);
    
    // Security check to prevent path traversal
    if (!fullPath.startsWith(sessionDir)) {
      return res.status(403).json({ error: 'Access denied: Invalid path' });
    }
    
    // Check if file exists
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const stats = fs.statSync(fullPath);
    
    res.json({
      success: true,
      fileInfo: {
        name: path.basename(fullPath),
        path: relPath,
        isDirectory: stats.isDirectory(),
        size: stats.size,
        modified: stats.mtime,
        created: stats.birthtime
      }
    });
  } catch (err) {
    console.error('File info error:', err);
    res.status(500).json({ error: 'Failed to get file information: ' + err.message });
  }
});

// Endpoint to create a new directory
app.post('/create-directory', validateSessionDir, (req, res) => {
  try {
    const sessionDir = req.session.directory;
    const { path: relPath, name } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Directory name is required' });
    }
    
    // Sanitize directory name
    const sanitizedName = name.replace(/[\/\\?%*:|"<>\x7F\x00-\x1F]/g, '_');
    const parentPath = relPath || '';
    const newDirPath = path.join(sessionDir, parentPath, sanitizedName);
    
    // Security check to prevent path traversal
    if (!newDirPath.startsWith(sessionDir)) {
      return res.status(403).json({ error: 'Access denied: Invalid path' });
    }
    
    // Create the directory
    fs.mkdirSync(newDirPath, { recursive: true });
    
    res.json({
      success: true,
      message: 'Directory created successfully',
      path: path.join(parentPath, sanitizedName)
    });
  } catch (err) {
    console.error('Create directory error:', err);
    res.status(500).json({ error: 'Failed to create directory: ' + err.message });
  }
});

// Endpoint to delete a file or directory
app.delete('/delete', validateSessionDir, (req, res) => {
  try {
    const sessionDir = req.session.directory;
    const { path: relPath } = req.body;
    
    if (!relPath) {
      return res.status(400).json({ error: 'Path is required' });
    }
    
    const fullPath = path.join(sessionDir, relPath);
    
    // Security check to prevent path traversal
    if (!fullPath.startsWith(sessionDir)) {
      return res.status(403).json({ error: 'Access denied: Invalid path' });
    }
    
    // Check if path exists
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Path not found' });
    }
    
    // Delete the file or directory
    fs.rmSync(fullPath, { recursive: true, force: true });
    
    res.json({
      success: true,
      message: 'File or directory deleted successfully'
    });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Failed to delete file or directory: ' + err.message });
  }
});

// Endpoint to rename a file or directory
app.post('/rename', validateSessionDir, (req, res) => {
  try {
    const sessionDir = req.session.directory;
    const { path: relPath, newName } = req.body;
    
    if (!relPath) {
      return res.status(400).json({ error: 'Path is required' });
    }
    
    if (!newName) {
      return res.status(400).json({ error: 'New name is required' });
    }
    
    const fullPath = path.join(sessionDir, relPath);
    
    // Security check to prevent path traversal
    if (!fullPath.startsWith(sessionDir)) {
      return res.status(403).json({ error: 'Access denied: Invalid path' });
    }
    
    // Check if path exists
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Path not found' });
    }
    
    // Sanitize new name
    const sanitizedName = newName.replace(/[\/\\?%*:|"<>\x7F\x00-\x1F]/g, '_');
    
    // Get directory and new path
    const dirPath = path.dirname(fullPath);
    const newPath = path.join(dirPath, sanitizedName);
    
    // Rename the file or directory
    fs.renameSync(fullPath, newPath);
    
    // Calculate new relative path
    const newRelPath = path.join(path.dirname(relPath), sanitizedName);
    
    res.json({
      success: true,
      message: 'File or directory renamed successfully',
      newPath: newRelPath
    });
  } catch (err) {
    console.error('Rename error:', err);
    res.status(500).json({ error: 'Failed to rename file or directory: ' + err.message });
  }
});

// Add the list endpoint for compatibility with frontend JS
app.get('/list', validateSessionDir, (req, res) => {
  try {
    const sessionDir = req.session.directory;
    const relPath = req.query.path || '';
    const fullPath = path.join(sessionDir, relPath);
    
    // Security check to prevent path traversal
    if (!fullPath.startsWith(sessionDir)) {
      return res.status(403).json({ error: 'Access denied: Invalid path' });
    }
    
    // Check if path exists
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Path not found' });
    }
    
    // Check if it's a directory
    const stats = fs.statSync(fullPath);
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: 'Not a directory' });
    }
    
    // Read directory contents
    const contents = fs.readdirSync(fullPath, { withFileTypes: true });
    
    // Process and format the directory contents
    const files = contents.map(item => {
      const itemPath = path.join(fullPath, item.name);
      const itemStats = fs.statSync(itemPath);
      
      return {
        name: item.name,
        path: path.relative(sessionDir, itemPath),
        type: item.isDirectory() ? 'folder' : 'file',
        size: itemStats.size,
        modified: itemStats.mtime
      };
    });
    
    // Sort by type (directories first) and then by name
    files.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'folder' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    
    res.json({
      files: files,
      currentPath: relPath
    });
  } catch (err) {
    console.error('File list error:', err);
    res.status(500).json({ error: 'Failed to list directory contents: ' + err.message });
  }
});

// After the /list endpoint, add the remaining required endpoints

// Endpoint to open a file
app.get('/open-file', validateSessionDir, (req, res) => {
  try {
    const sessionDir = req.session.directory;
    const relPath = req.query.path;
    
    if (!relPath) {
      return res.status(400).json({ error: 'File path is required' });
    }
    
    const fullPath = path.join(sessionDir, relPath);
    
    // Security check to prevent path traversal
    if (!fullPath.startsWith(sessionDir)) {
      return res.status(403).json({ error: 'Access denied: Invalid path' });
    }
    
    // Check if file exists
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const stats = fs.statSync(fullPath);
    
    // Don't try to read directories or very large files
    if (stats.isDirectory()) {
      return res.status(400).json({ error: 'Cannot open directories as files' });
    }
    
    if (stats.size > 10 * 1024 * 1024) { // 10MB limit
      return res.status(400).json({ error: 'File too large to open (max 10MB)' });
    }
    
    // Read file content
    const content = fs.readFileSync(fullPath, 'utf8');
    
    res.json({
      name: path.basename(fullPath),
      path: relPath,
      content: content,
      size: stats.size,
      modified: stats.mtime
    });
  } catch (err) {
    console.error('File open error:', err);
    res.status(500).json({ error: 'Failed to open file: ' + err.message });
  }
});

// Endpoint to delete a file or directory
app.delete('/delete-file', validateSessionDir, (req, res) => {
  try {
    const sessionDir = req.session.directory;
    const { path: relPath } = req.body;
    
    if (!relPath) {
      return res.status(400).json({ error: 'Path is required' });
    }
    
    const fullPath = path.join(sessionDir, relPath);
    
    // Security check to prevent path traversal
    if (!fullPath.startsWith(sessionDir)) {
      return res.status(403).json({ error: 'Access denied: Invalid path' });
    }
    
    // Check if path exists
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Path not found' });
    }
    
    // Delete the file or directory
    fs.rmSync(fullPath, { recursive: true, force: true });
    
    res.json({
      success: true,
      message: 'File or directory deleted successfully'
    });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Failed to delete file or directory: ' + err.message });
  }
});

// Endpoint to create a new file
app.post('/create-file', validateSessionDir, (req, res) => {
  try {
    const sessionDir = req.session.directory;
    const { path: relPath, fileName, name, content = '' } = req.body;
    
    // Support both fileName (from frontend) and name (for compatibility)
    const fileNameToUse = fileName || name;
    
    if (!fileNameToUse) {
      return res.status(400).json({ error: 'File name is required' });
    }
    
    // Sanitize file name
    const sanitizedName = fileNameToUse.replace(/[\/\\?%*:|"<>\x7F\x00-\x1F]/g, '_');
    const parentPath = relPath || '';
    const filePath = path.join(sessionDir, parentPath, sanitizedName);
    
    // Security check to prevent path traversal
    if (!filePath.startsWith(sessionDir)) {
      return res.status(403).json({ error: 'Access denied: Invalid path' });
    }
    
    // Create parent directories if needed
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    
    // Create the file with initial content
    fs.writeFileSync(filePath, content);
    
    res.json({
      success: true,
      message: 'File created successfully',
      path: path.join(parentPath, sanitizedName),
      name: sanitizedName
    });
  } catch (err) {
    console.error('Create file error:', err);
    res.status(500).json({ error: 'Failed to create file: ' + err.message });
  }
});

// Endpoint to create a new folder
app.post('/create-folder', validateSessionDir, (req, res) => {
  try {
    const sessionDir = req.session.directory;
    const { path: relPath, name, folderName } = req.body;
    
    // Support both folderName (from frontend) and name (for compatibility)
    const nameToUse = folderName || name;
    
    if (!nameToUse) {
      return res.status(400).json({ error: 'Folder name is required' });
    }
    
    // Sanitize folder name
    const sanitizedName = nameToUse.replace(/[\/\\?%*:|"<>\x7F\x00-\x1F]/g, '_');
    const parentPath = relPath || '';
    const folderPath = path.join(sessionDir, parentPath, sanitizedName);
    
    // Security check to prevent path traversal
    if (!folderPath.startsWith(sessionDir)) {
      return res.status(403).json({ error: 'Access denied: Invalid path' });
    }
    
    // Create the directory
    fs.mkdirSync(folderPath, { recursive: true });
    
    res.json({
      success: true,
      message: 'Folder created successfully',
      path: path.join(parentPath, sanitizedName),
      name: sanitizedName
    });
  } catch (err) {
    console.error('Create folder error:', err);
    res.status(500).json({ error: 'Failed to create folder: ' + err.message });
  }
});

// Endpoint to save a file
app.post('/save-file', validateSessionDir, (req, res) => {
  try {
    const sessionDir = req.session.directory;
    const { path: relPath, content } = req.body;
    
    if (!relPath) {
      return res.status(400).json({ error: 'File path is required' });
    }
    
    const fullPath = path.join(sessionDir, relPath);
    
    // Security check to prevent path traversal
    if (!fullPath.startsWith(sessionDir)) {
      return res.status(403).json({ error: 'Access denied: Invalid path' });
    }
    
    // Create parent directories if needed
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    
    // Write content to file
    fs.writeFileSync(fullPath, content);
    
    const stats = fs.statSync(fullPath);
    
    res.json({
      success: true,
      message: 'File saved successfully',
      path: relPath,
      size: stats.size,
      modified: stats.mtime
    });
  } catch (err) {
    console.error('Save file error:', err);
    res.status(500).json({ error: 'Failed to save file: ' + err.message });
  }
});

// Terminal endpoint
app.post('/terminal', validateSessionDir, (req, res) => {
  const { command } = req.body;
  const sessionDir = req.session.directory;
  
  if (!command) {
    return res.status(400).json({ error: 'Command is required' });
  }
  
  // Prevent dangerous commands
  const dangerousCommands = [
    'rm -rf', 'rmdir /s', 'del /f', 'format', ':(){ :|:& };:', '> /dev/',
    'dd if=', '> /etc/', 'mkfs', 'chmod -R 777', 'chmod 777'
  ];
  
  if (dangerousCommands.some(dc => command.toLowerCase().includes(dc.toLowerCase()))) {
    return res.status(403).json({ error: 'Dangerous command detected' });
  }
  
  // Cleanup any existing shell for this session
  if (shellProcesses[sessionDir]) {
    try {
      shellProcesses[sessionDir].kill();
    } catch (e) {
      console.error('Error killing existing process:', e);
    }
  }
  
  // Create shell process
  const shell = process.platform === 'win32' ? 'cmd.exe' : 'bash';
  const shellProcess = spawn(shell, [], {
    cwd: sessionDir,
    env: process.env,
    shell: true
  });
  
  shellProcesses[sessionDir] = shellProcess;
  
  res.setHeader('Content-Type', 'application/json');
  res.write(JSON.stringify({ message: 'Terminal started' }));
  
  // Run the command
  shellProcess.stdin.write(command + '\n');
  
  shellProcess.stdout.on('data', (data) => {
    res.write(JSON.stringify({ output: data.toString() }));
  });
  
  shellProcess.stderr.on('data', (data) => {
    res.write(JSON.stringify({ error: data.toString() }));
  });
  
  shellProcess.on('close', () => {
    res.write(JSON.stringify({ message: 'Command execution ended' }));
    res.end();
    delete shellProcesses[sessionDir];
  });
  
  // Set a timeout to kill the process after 30 seconds to prevent long-running operations
  processTimeouts[sessionDir] = setTimeout(() => {
    if (shellProcess && !shellProcess.killed) {
      shellProcess.kill();
      delete shellProcesses[sessionDir];
    }
  }, 30000);
});

// Send input to running process
app.post('/send-input', validateSessionDir, (req, res) => {
  const { input } = req.body;
  const sessionDir = req.session.directory;
  
  if (input === undefined) {
    return res.status(400).json({ error: 'Input is required' });
  }
  
  const process = shellProcesses[sessionDir] || processInstances[sessionDir];
  
  if (!process) {
    return res.status(404).json({ error: 'No active process found' });
  }
  
  try {
    process.stdin.write(input + '\n');
    res.json({ success: true, message: 'Input sent to process' });
  } catch (err) {
    console.error('Error sending input:', err);
    res.status(500).json({ error: 'Failed to send input: ' + err.message });
  }
});

// Endpoint to terminate running processes
app.post('/terminate-process', validateSessionDir, (req, res) => {
  const sessionDir = req.session.directory;
  
  try {
    let terminated = false;
    
    // Check for running processes in this session
    if (processInstances[sessionDir]) {
      try {
        processInstances[sessionDir].kill();
        delete processInstances[sessionDir];
        terminated = true;
      } catch (err) {
        console.error(`Error killing process for session ${sessionDir}:`, err);
      }
    }
    
    // Also check for shell processes
    if (shellProcesses[sessionDir]) {
      try {
        shellProcesses[sessionDir].kill();
        delete shellProcesses[sessionDir];
        terminated = true;
      } catch (err) {
        console.error(`Error killing shell process for session ${sessionDir}:`, err);
      }
    }
    
    if (terminated) {
      res.json({ success: true, message: 'Process terminated successfully' });
    } else {
      res.json({ success: false, message: 'No active process found' });
    }
  } catch (err) {
    console.error('Error terminating process:', err);
    res.status(500).json({ success: false, error: 'Failed to terminate process' });
  }
});

// Route handler for collaborative session join URLs
app.get('/join/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  
  // Redirect to homepage with the session ID in the URL
  // The client-side code will detect this pattern and auto-join
  res.redirect(`/?join=${sessionId}`);
});

