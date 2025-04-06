// Code Generator JavaScript
// -------------------

// Global state variables
let currentBotMessage;
let currentResponse = "";
let ws;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
let reconnectTimeout;
let isWsConnected = false;

// DOM Elements
let loadingSpinner;
let statusIndicator;

// Chat history management
let chatHistory = [];
let currentChatId = generateUniqueId();
let currentChat = {
  id: currentChatId,
  title: 'New Chat',
  messages: [],
  created: new Date(),
  lastUpdated: new Date()
};

// Compiler-related global variables
let currentRelativePath = '';
let selectedFilePath = '';
let codeEditor;
let cssEditor;
let terminal;
let isTerminalInitialized = false;
let activeEditorContent = {
  python: '',
  java: '',
  html: '',
  css: ''
};
let processActive = false; // Global for process state

// Add new function to store error message and create a better way to handle the button click
let lastErrorMessage = '';

// Near the top of the script, add theme management variables
let availableThemes = ['light', 'dark', 'monokai', 'github', 'solarized', 'dracula'];
let currentTheme = 'light';

// Add collaborative editing functionality

// Variables for collaborative editing
let isCollaborativeMode = false;
let collaborativeSessionId = null;
let collaborativeUserName = null;
let collaborativeWs = null;
let collaborativeUsers = [];

// Function to create a new collaborative session
function createCollaborativeSession() {
  const userName = prompt('Enter your name for collaboration:');
  if (!userName) return;
  
  toggleLoadingSpinner(true);
  
  fetch('/collaborative/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userName })
  })
  .then(res => {
    if (!res.ok) {
      throw new Error(`Server responded with status: ${res.status}`);
    }
    return res.json();
  })
  .then(data => {
    if (data.success && data.sessionId) {
      showNotification('Collaborative session created', 'success');
      
      // Save session data
      collaborativeSessionId = data.sessionId;
      collaborativeUserName = userName;
      
      // Show share link
      const shareUrl = window.location.origin + data.joinUrl;
      showShareLink(shareUrl);
      
      // Connect to WebSocket for collaboration
      connectToCollaborativeSession(data.sessionId, userName);
    }
  })
  .catch(err => {
    console.error('Error creating collaborative session:', err);
    showNotification(`Failed to create collaborative session: ${err.message}`, 'error');
  })
  .finally(() => {
    toggleLoadingSpinner(false);
  });
}

// Function to join an existing collaborative session
function joinCollaborativeSession(sessionId) {
  if (!sessionId) {
    // Extract from URL if not provided
    const urlParts = window.location.pathname.split('/');
    const joinIndex = urlParts.indexOf('join');
    if (joinIndex >= 0 && joinIndex < urlParts.length - 1) {
      sessionId = urlParts[joinIndex + 1];
    }
  }
  
  if (!sessionId) {
    showNotification('Invalid session ID', 'error');
    return;
  }
  
  // Ask for user name
  const userName = prompt('Enter your name for collaboration:');
  if (!userName) return;
  
  // Save session data
  collaborativeSessionId = sessionId;
  collaborativeUserName = userName;
  
  // Connect to WebSocket for collaboration
  connectToCollaborativeSession(sessionId, userName);
}

// Connect to WebSocket for collaborative editing
function connectToCollaborativeSession(sessionId, userName) {
  // Close existing connection if any
  if (collaborativeWs && collaborativeWs.readyState === WebSocket.OPEN) {
    collaborativeWs.close();
  }
  
  // Create WebSocket URL
  const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
  const wsUrl = `${protocol}${window.location.host}?sessionId=${sessionId}&userName=${encodeURIComponent(userName)}&mode=collaborative`;
  
  // Connect to WebSocket
  collaborativeWs = new WebSocket(wsUrl);
  
  // Set up event handlers
  collaborativeWs.onopen = () => {
    isCollaborativeMode = true;
    showNotification('Connected to collaborative session', 'success');
    
    // Enable collaborative UI
    setupCollaborativeUI();
    
    // Show compiler section if not already visible
    const compilerSection = document.getElementById('compiler');
    if (compilerSection && window.getComputedStyle(compilerSection).display === 'none') {
      toggleCodePlayground();
    }
  };
  
  collaborativeWs.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleCollaborativeMessage(data);
    } catch (err) {
      console.error('Error handling collaborative message:', err);
    }
  };
  
  collaborativeWs.onclose = () => {
    if (isCollaborativeMode) {
      showNotification('Disconnected from collaborative session', 'warning');
      isCollaborativeMode = false;
      
      // Disable collaborative UI
      disableCollaborativeUI();
    }
  };
  
  collaborativeWs.onerror = (error) => {
    console.error('WebSocket error:', error);
    showNotification('Collaborative session error', 'error');
  };
}

// Handle incoming collaborative messages
function handleCollaborativeMessage(data) {
  switch (data.type) {
    case 'user-joined':
      showNotification(`${data.userName} joined the session`, 'info');
      updateCollaborativeUserCount(data.usersCount);
      break;
      
    case 'user-left':
      showNotification(`${data.userName} left the session`, 'info');
      updateCollaborativeUserCount(data.usersCount);
      break;
      
    case 'document-state':
      // Initialize editor with shared document
      if (codeEditor) {
        // Save cursor position before update
        const cursor = codeEditor.getCursor();
        
        // Update content
        codeEditor.setValue(data.content || '');
        
        // Try to restore cursor position
        try {
          codeEditor.setCursor(cursor);
        } catch (err) {
          // Ignore cursor errors
        }
        
        // Update language if needed
        if (data.language) {
          const langSelect = document.getElementById('comp-language');
          if (langSelect && langSelect.value !== data.language) {
            langSelect.value = data.language;
            handleLanguageChange();
          }
        }
        
        // Update users list
        if (data.users) {
          collaborativeUsers = data.users;
          updateCollaborativeUsersList();
        }
      }
      break;
      
    case 'code-update':
      // Update code from another user
      if (codeEditor) {
        // Save cursor position before update
        const cursor = codeEditor.getCursor();
        
        // Update content without triggering our own change event
        codeEditor.setValue(data.content || '');
        
        // Try to restore cursor position
        try {
          codeEditor.setCursor(cursor);
        } catch (err) {
          // Ignore cursor errors
        }
        
        // Show update notification
        const chatArea = document.getElementById('collaborative-chat-area');
        if (chatArea) {
          const updateMsg = document.createElement('div');
          updateMsg.className = 'system-message';
          updateMsg.textContent = `${data.userName} updated the code`;
          chatArea.appendChild(updateMsg);
          chatArea.scrollTop = chatArea.scrollHeight;
        }
      }
      break;
      
    case 'cursor-position':
      // Update cursor position of another user
      updateRemoteCursor(data.userId, data.userName, data.position);
      break;
      
    case 'language-change':
      // Update language if changed by another user
      const langSelect = document.getElementById('comp-language');
      if (langSelect && langSelect.value !== data.language) {
        langSelect.value = data.language;
        handleLanguageChange();
        
        // Show language change notification
        const chatArea = document.getElementById('collaborative-chat-area');
        if (chatArea) {
          const langMsg = document.createElement('div');
          langMsg.className = 'system-message';
          langMsg.textContent = `${data.userName} changed language to ${data.language}`;
          chatArea.appendChild(langMsg);
          chatArea.scrollTop = chatArea.scrollHeight;
        }
      }
      break;
      
    case 'chat-message':
      // Display chat message
      addChatMessage(data.userName, data.message, data.timestamp);
      break;
      
    case 'error':
      showNotification(`Collaborative error: ${data.message}`, 'error');
      break;
  }
}

// Send code updates to collaborative session
function sendCodeUpdate(code) {
  if (!isCollaborativeMode || !collaborativeWs || collaborativeWs.readyState !== WebSocket.OPEN) {
    return;
  }
  
  collaborativeWs.send(JSON.stringify({
    type: 'code-update',
    content: code
  }));
}

// Send cursor position updates
function sendCursorPosition(position) {
  if (!isCollaborativeMode || !collaborativeWs || collaborativeWs.readyState !== WebSocket.OPEN) {
    return;
  }
  
  collaborativeWs.send(JSON.stringify({
    type: 'cursor-position',
    position: position
  }));
}

// Send language change notification
function sendLanguageChange(language) {
  if (!isCollaborativeMode || !collaborativeWs || collaborativeWs.readyState !== WebSocket.OPEN) {
    return;
  }
  
  collaborativeWs.send(JSON.stringify({
    type: 'language-change',
    language: language
  }));
}

// Send chat message
function sendChatMessage(message) {
  if (!isCollaborativeMode || !collaborativeWs || collaborativeWs.readyState !== WebSocket.OPEN) {
    return;
  }
  
  collaborativeWs.send(JSON.stringify({
    type: 'chat-message',
    message: message
  }));
  
  // The message will be displayed when we receive it back from the server
  // We don't need to display it locally to avoid duplication
}

// Set up collaborative UI
function setupCollaborativeUI() {
  // Mark collaborative mode active
  const collabBtn = document.getElementById('collaborative-btn');
  if (collabBtn) {
    collabBtn.classList.add('active');
    collabBtn.innerHTML = '<i class="bx bx-group"></i> Collaborating';
  }
  
  // Create collaborative panel if not exists
  let panel = document.getElementById('collaborative-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'collaborative-panel';
    panel.className = 'collaborative-panel';
    panel.style.display = 'block';
    
    // Create panel content
    panel.innerHTML = `
      <div class="collaborative-header">
        <h3>Collaborative Session</h3>
        <button id="close-collab-panel"><i class="bx bx-x"></i></button>
        <div class="session-info">
          <span>Session ID: ${collaborativeSessionId}</span>
        </div>
      </div>
      <div class="collaborative-content">
        <div class="users-list">
          <h4>Users</h4>
          <ul id="collaborative-users"></ul>
        </div>
        <div class="chat-area" id="collaborative-chat-area"></div>
        <div class="chat-input">
          <input type="text" id="collaborative-chat-input" placeholder="Type a message..." />
          <button id="collaborative-chat-send"><i class="bx bx-send"></i></button>
        </div>
      </div>
    `;
    
    document.body.appendChild(panel);
    
    // Setup chat input handler
    const chatInput = document.getElementById('collaborative-chat-input');
    const chatSend = document.getElementById('collaborative-chat-send');
    
    if (chatInput && chatSend) {
      // Send button click
      chatSend.addEventListener('click', () => {
        const message = chatInput.value.trim();
        if (message) {
          sendChatMessage(message);
          chatInput.value = '';
        }
      });
      
      // Enter key press
      chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          const message = chatInput.value.trim();
          if (message) {
            sendChatMessage(message);
            chatInput.value = '';
          }
        }
      });
    }
    
    // Close button handler
    const closeBtn = document.getElementById('close-collab-panel');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        panel.style.display = 'none';
      });
    }
  } else {
    panel.style.display = 'block';
  }
  
  // Update user list
  updateCollaborativeUsersList();
  
  // Add editor event listeners for collaboration
  if (codeEditor) {
    // Add change handler for code updates
    codeEditor.on('change', (editor, change) => {
      // Only send when change is from user input, not from setValue
      if (change.origin === '+input' || change.origin === 'paste' || change.origin === '+delete' || change.origin === 'cut') {
        sendCodeUpdate(editor.getValue());
      }
    });
    
    // Add cursor activity handler
    codeEditor.on('cursorActivity', () => {
      if (collaborativeUserName) {
        const cursor = codeEditor.getCursor();
        sendCursorPosition({
          line: cursor.line,
          ch: cursor.ch,
          userId: collaborativeUserName.replace(/\s+/g, '_').toLowerCase()
        });
      }
    });
  }
  
  // Language change listeners
  const langSelect = document.getElementById('comp-language');
  if (langSelect) {
    const originalHandler = langSelect.onchange;
    langSelect.onchange = (e) => {
      // Run original handler first
      if (originalHandler) originalHandler(e);
      
      // Send language change event
      sendLanguageChange(langSelect.value);
    };
  }
  
  // Make panel draggable with header
  makeDraggable(panel, panel.querySelector('.collaborative-header'));
  
  // System message for session joined
  addChatMessage('System', `You joined as "${collaborativeUserName}"`, Date.now());
}

// Make an element draggable
function makeDraggable(element, handle) {
  if (!element || !handle) return;
  
  let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
  
  handle.style.cursor = 'move';
  handle.onmousedown = dragMouseDown;
  
  function dragMouseDown(e) {
    e.preventDefault();
    // Get the mouse cursor position at startup
    pos3 = e.clientX;
    pos4 = e.clientY;
    document.onmouseup = closeDragElement;
    // Call function whenever the cursor moves
    document.onmousemove = elementDrag;
  }
  
  function elementDrag(e) {
    e.preventDefault();
    // Calculate the new cursor position
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    // Set the element's new position
    const newTop = (element.offsetTop - pos2);
    const newLeft = (element.offsetLeft - pos1);
    
    // Constrain to window
    const maxTop = window.innerHeight - 100;
    const maxLeft = window.innerWidth - 100;
    
    element.style.top = Math.min(Math.max(0, newTop), maxTop) + "px";
    element.style.left = Math.min(Math.max(0, newLeft), maxLeft) + "px";
  }
  
  function closeDragElement() {
    // Stop moving when mouse button is released
    document.onmouseup = null;
    document.onmousemove = null;
  }
}

// Disable collaborative UI
function disableCollaborativeUI() {
  // Hide collaborative panel
  const collaborativePanel = document.getElementById('collaborative-panel');
  if (collaborativePanel) {
    collaborativePanel.style.display = 'none';
  }
  
  // Clear remote cursors
  clearRemoteCursors();
}

// Update collaborative users count
function updateCollaborativeUserCount(count) {
  const countElement = document.getElementById('collaborative-users-count');
  if (countElement) {
    countElement.textContent = count || '1';
  }
}

// Update collaborative users list
function updateCollaborativeUsersList() {
  const usersList = document.getElementById('collaborative-users');
  if (!usersList) return;
  
  // Clear existing list
  usersList.innerHTML = '';
  
  // Add current user first
  const currentUserItem = document.createElement('li');
  currentUserItem.className = 'current-user';
  currentUserItem.innerHTML = `<i class="bx bx-user"></i> ${collaborativeUserName} (You)`;
  usersList.appendChild(currentUserItem);
  
  // Add other users
  collaborativeUsers.forEach(user => {
    // Skip current user
    if (user.userName === collaborativeUserName) return;
    
    const userItem = document.createElement('li');
    const userId = user.id || user.userName.replace(/\s+/g, '_').toLowerCase();
    const userColor = getColorForUser(userId);
    
    userItem.innerHTML = `
      <span style="color: ${userColor}">
        <i class="bx bx-user"></i> ${user.userName}
      </span>
    `;
    
    usersList.appendChild(userItem);
  });
  
  // Update user count if available
  const usersCount = document.getElementById('collaborative-users-count');
  if (usersCount) {
    usersCount.textContent = (collaborativeUsers.length || 1);
  }
}

// Add a chat message
function addChatMessage(userName, message, timestamp) {
  const chatArea = document.getElementById('collaborative-chat-area');
  if (!chatArea) return;
  
  const msgElement = document.createElement('div');
  msgElement.className = 'chat-message';
  
  // Add 'self' class if it's from current user
  if (userName === collaborativeUserName) {
    msgElement.classList.add('self');
  }
  
  const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  msgElement.innerHTML = `
    <div class="chat-message-header">
      <span class="chat-username">${userName}</span>
      <span class="chat-time">${time}</span>
    </div>
    <div class="chat-message-content">${message}</div>
  `;
  
  chatArea.appendChild(msgElement);
  chatArea.scrollTop = chatArea.scrollHeight;
}

// Update remote cursor display
function updateRemoteCursor(userId, userName, position) {
  if (!codeEditor) return;
  
  // Clear existing cursor
  clearRemoteCursor(userId);
  
  // Create cursor element
  const cursor = document.createElement('div');
  cursor.className = 'remote-cursor';
  cursor.setAttribute('data-user-id', userId);
  cursor.style.backgroundColor = getColorForUser(userId);
  
  // Create cursor label
  const label = document.createElement('div');
  label.className = 'remote-cursor-label';
  label.textContent = userName;
  label.style.backgroundColor = getColorForUser(userId);
  
  cursor.appendChild(label);
  
  // Add cursor to editor
  const cursorCoords = codeEditor.cursorCoords(position, 'local');
  cursor.style.left = `${cursorCoords.left}px`;
  cursor.style.top = `${cursorCoords.top}px`;
  cursor.style.height = `${cursorCoords.bottom - cursorCoords.top}px`;
  
  // Add to DOM
  const editorScroll = codeEditor.getScrollerElement();
  editorScroll.appendChild(cursor);
  
  // Remove cursor after a timeout (if no updates)
  setTimeout(() => {
    if (editorScroll.contains(cursor)) {
      editorScroll.removeChild(cursor);
    }
  }, 5000);
}

// Clear a specific remote cursor
function clearRemoteCursor(userId) {
  if (!codeEditor) return;
  
  const editorScroll = codeEditor.getScrollerElement();
  const existingCursor = editorScroll.querySelector(`.remote-cursor[data-user-id="${userId}"]`);
  
  if (existingCursor) {
    editorScroll.removeChild(existingCursor);
  }
}

// Clear all remote cursors
function clearRemoteCursors() {
  if (!codeEditor) return;
  
  const editorScroll = codeEditor.getScrollerElement();
  const cursors = editorScroll.querySelectorAll('.remote-cursor');
  
  cursors.forEach(cursor => {
    editorScroll.removeChild(cursor);
  });
}

// Get a consistent color for a user
function getColorForUser(userId) {
  const colors = [
    '#FF5370', '#F78C6C', '#FFCB6B', '#C3E88D',
    '#89DDFF', '#82AAFF', '#C792EA', '#BB80B3'
  ];
  
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash) + userId.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  
  // Use abs to ensure positive index
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

// Show share link dialog
function showShareLink(shareUrl) {
  // Create modal for link sharing
  const modal = document.createElement('div');
  modal.className = 'modal share-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Share Collaborative Session</h3>
        <button class="modal-close"><i class="bx bx-x"></i></button>
      </div>
      <div class="modal-body">
        <p>Share this link with others to collaborate:</p>
        <div class="share-link-container">
          <input type="text" class="share-link" value="${shareUrl}" readonly />
          <button class="copy-link-btn"><i class="bx bx-copy"></i> Copy</button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Add event listeners
  modal.querySelector('.modal-close').addEventListener('click', () => {
    document.body.removeChild(modal);
  });
  
  modal.querySelector('.copy-link-btn').addEventListener('click', () => {
    const linkInput = modal.querySelector('.share-link');
    linkInput.select();
    document.execCommand('copy');
    showNotification('Link copied to clipboard', 'success');
  });
  
  // Show modal with animation
  setTimeout(() => {
    modal.classList.add('active');
  }, 10);
}

// Add a collaborative mode button
function setupCollaborativeButton() {
  const controlGroup = document.querySelector('.controls .control-group:last-child');
  if (!controlGroup) return;
  
  const collabBtn = document.createElement('button');
  collabBtn.id = 'collaborative-btn';
  collabBtn.className = 'control-btn';
  collabBtn.innerHTML = '<i class="bx bx-group"></i> Collaborate';
  collabBtn.addEventListener('click', () => {
    if (isCollaborativeMode) {
      // Already in collaborative mode - show panel
      const panel = document.getElementById('collaborative-panel');
      if (panel) {
        panel.style.display = 'block';
      }
    } else {
      // Ask if user wants to create or join
      const choice = confirm('Create a new collaborative session?\n\nClick OK to create a new session, or Cancel to join an existing one.');
      
      if (choice) {
        createCollaborativeSession();
      } else {
        const sessionId = prompt('Enter the session ID to join:');
        if (sessionId) {
          joinCollaborativeSession(sessionId);
        }
      }
    }
  });
  
  controlGroup.appendChild(collabBtn);
}

// Check URL for collaborative mode
function checkForCollaborativeUrl() {
  // Check URL path first
  const urlParts = window.location.pathname.split('/');
  const joinIndex = urlParts.indexOf('join');
  
  if (joinIndex >= 0 && joinIndex < urlParts.length - 1) {
    const sessionId = urlParts[joinIndex + 1];
    if (sessionId) {
      // Auto-join the collaborative session
      setTimeout(() => {
        joinCollaborativeSession(sessionId);
      }, 1000);
      return;
    }
  }
  
  // Also check URL query parameters
  const urlParams = new URLSearchParams(window.location.search);
  const sessionId = urlParams.get('join');
  if (sessionId) {
    // Auto-join the collaborative session
    setTimeout(() => {
      joinCollaborativeSession(sessionId);
    }, 1000);
  }
}

// Update setupCompilerUIEventListeners
function setupCompilerUIEventListeners() {
  // ... existing code ...
  
  // Add collaborative button
  setupCollaborativeButton();
  
  // ... existing code ...
  
  // Check URL for collaborative session
  checkForCollaborativeUrl();
  
  // Add terminate button
  setupTerminateButton();
}

function storeErrorMessage(errorMsg) {
  lastErrorMessage = errorMsg.trim();
  
  // Add special handling for common Java errors
  if (lastErrorMessage.includes('class') && lastErrorMessage.includes('public') && lastErrorMessage.includes('should be declared in a file named')) {
    // Extract the expected file name
    const match = lastErrorMessage.match(/should be declared in a file named ([A-Za-z0-9_]+\.java)/);
    if (match && match[1]) {
      const expectedFileName = match[1];
      // Add advice to the error message
      lastErrorMessage += `\n\nSuggestion: Rename your file to ${expectedFileName} or change your class from public to non-public.`;
      
      // Show this suggestion in the terminal too
      if (terminal) {
        terminal.write(`\r\n\x1b[33mSuggestion: Rename your file to ${expectedFileName} or change your class from public to non-public.\x1b[0m\r\n`);
      }
    }
  }
}

function handleErrorHelp() {
  if (lastErrorMessage) {
    // Make sure both sections are visible
    const generatorSection = document.getElementById('code-generator');
    const compilerSection = document.getElementById('compiler');
    const mainContainer = document.querySelector('.main-container');
    
    // Show chat interface if it's hidden
    if (generatorSection && getComputedStyle(generatorSection).display === 'none') {
      generatorSection.style.display = 'block';
    }
    
    // Make sure compiler remains visible
    if (compilerSection && getComputedStyle(compilerSection).display === 'none') {
      compilerSection.style.display = 'block';
    }
    
    // Apply the both-visible class
    mainContainer.classList.add('both-visible');
    
    // Update toggle button text
    const toggleBtn = document.getElementById('togglePlayground');
    if (toggleBtn) {
      toggleBtn.innerHTML = '<i class="bx bx-message-square-dots"></i> Hide Playground';
    }
    
    // Update any error UI elements to show that the error was sent
    updateErrorElementsToSent();
    
    // Send the error to chat
    sendErrorToChat(lastErrorMessage);
    
    // Show confirmation notification
    showNotification('Error sent to AI assistant. You can continue the conversation in the chat.', 'success');
  } else {
    showNotification('No error message available', 'warning');
  }
}

// Add a new function to update error UI elements
function updateErrorElementsToSent() {
  // Update the auto-send buttons to show "sent" state
  document.querySelectorAll('.auto-send-error button').forEach(button => {
    button.disabled = true;
    button.classList.add('sent');
    button.innerHTML = '<i class="bx bx-check"></i> Error Sent to AI';
  });
  
  // Update the error banner to indicate the error was sent
  const errorBanner = document.querySelector('.error-banner');
  if (errorBanner) {
    errorBanner.classList.add('sent');
    errorBanner.innerHTML = `
      <i class='bx bx-check-circle'></i>
      <div class="error-banner-message">Error sent to AI assistant!</div>
    `;
  }
}

// Setup DOM after the page has loaded
document.addEventListener('DOMContentLoaded', () => {
  // Create status indicator
  statusIndicator = document.createElement('div');
  statusIndicator.id = 'connection-status';
  statusIndicator.className = 'status-indicator';
  document.body.appendChild(statusIndicator);

  // Create loading spinner
  loadingSpinner = document.createElement('div');
  loadingSpinner.id = 'loading-spinner';
  loadingSpinner.className = 'spinner';
  loadingSpinner.style.display = 'none';
  document.body.appendChild(loadingSpinner);

  // Setup input event for gen-userInput
  const inputField = document.getElementById("gen-userInput");
  if (inputField) {
    inputField.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendInput();
      }
    });
  }

  // Setup send button click event
  const sendButton = document.getElementById("send-btn");
  if (sendButton) {
    sendButton.addEventListener('click', () => {
      sendInput();
    });
  }

  // Setup new chat button
  const newChatBtn = document.getElementById("newChatBtn");
  if (newChatBtn) {
    newChatBtn.addEventListener('click', createNewChat);
  }
  
  // Setup chat history button
  const chatHistoryBtn = document.getElementById("chatHistoryBtn");
  if (chatHistoryBtn) {
    chatHistoryBtn.addEventListener('click', toggleChatHistoryDropdown);
  }
  
  // Setup close history button
  const closeHistoryBtn = document.getElementById("closeHistoryBtn");
  if (closeHistoryBtn) {
    closeHistoryBtn.addEventListener('click', toggleChatHistoryDropdown);
  }

  // Initialize WebSocket connection
  initWebSocket();
  
  // Load chat history from localStorage
  loadChatHistory();

  // Initialize code playground
  codeEditor = CodeMirror.fromTextArea(document.getElementById('comp-code-editor'), {
    lineNumbers: true,
    mode: 'python',
    theme: 'default',
    indentUnit: 4,
    tabSize: 4,
    indentWithTabs: false,
    lineWrapping: true,
    extraKeys: {
      'Tab': function(cm) {
        if (cm.somethingSelected()) {
          cm.indentSelection('add');
        } else {
          cm.replaceSelection('    ', 'end', '+input');
        }
      },
      'Ctrl-S': function(cm) {
        saveCurrentFile();
      },
      'Cmd-S': function(cm) {
        saveCurrentFile();
      },
      'F5': function(cm) {
        document.getElementById('comp-run-btn').click();
      },
    },
    autofocus: false
  });

  cssEditor = CodeMirror.fromTextArea(document.getElementById('comp-css-editor'), {
    lineNumbers: true,
    mode: 'css',
    theme: 'default',
    indentUnit: 2,
    tabSize: 2,
    lineWrapping: true,
    extraKeys: {
      'Tab': function(cm) {
        if (cm.somethingSelected()) {
          cm.indentSelection('add');
        } else {
          cm.replaceSelection('  ', 'end', '+input');
        }
      },
      'Ctrl-S': function(cm) {
        saveCurrentFile();
      },
      'Cmd-S': function(cm) {
        saveCurrentFile();
      }
    },
    autofocus: false
  });

  initializeTerminal();
  setupCompilerUIEventListeners();
  cssEditor.getWrapperElement().style.display = 'none';
  loadExplorer('');

  // Add event listener for theme toggle
  const themeToggle = document.querySelector('.theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }

  // Initialize theme based on saved preference
  const savedTheme = localStorage.getItem('theme') || 'light';
  setTheme(savedTheme);

  // Load theme from server
  fetch('/themes')
    .then(res => res.json())
    .then(data => {
      if (data.themes) {
        availableThemes = data.themes;
      }
      if (data.current) {
        setTheme(data.current);
      }
    })
    .catch(err => {
      console.error('Error loading themes:', err);
    });
});

// Initialize WebSocket connection with reconnection logic
function initWebSocket() {
  if (ws) {
    ws.close();
  }
  updateConnectionStatus('connecting');
  
  // Use secure WebSocket (wss://) if the page is loaded over HTTPS
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.hostname}:${window.location.port || 3000}`);
  ws.onopen = handleWebSocketOpen;
  ws.onmessage = handleWebSocketMessage;
  ws.onclose = handleWebSocketClose;
  ws.onerror = handleWebSocketError;
}

// WebSocket event handlers
function handleWebSocketOpen() {
  isWsConnected = true;
  reconnectAttempts = 0;
  updateConnectionStatus('connected');
}

function handleWebSocketClose(event) {
  isWsConnected = false;
  updateConnectionStatus('disconnected');
  console.log(`WebSocket connection closed. Code: ${event.code}`);
  if (event.code !== 1000 && event.code !== 1001) {
    attemptReconnect();
  }
}

function handleWebSocketError(error) {
  console.error('WebSocket error:', error);
  updateConnectionStatus('error');
}

function updateConnectionStatus(status) {
  if (!statusIndicator) return;
  statusIndicator.className = 'status-indicator';
  statusIndicator.classList.add(status);
  switch (status) {
    case 'connected':
      statusIndicator.title = 'Connected to server';
      break;
    case 'connecting':
      statusIndicator.title = 'Connecting to server...';
      break;
    case 'disconnected':
      statusIndicator.title = 'Disconnected from server';
      break;
    case 'error':
      statusIndicator.title = 'Connection error';
      break;
  }
}

function attemptReconnect() {
  if (reconnectAttempts >= maxReconnectAttempts) {
    console.error('Maximum reconnection attempts reached');
    showNotification('Server connection lost. Please refresh the page.', 'error');
    return;
  }
  const backoffTime = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
  console.log(`Attempting to reconnect in ${backoffTime / 1000} seconds...`);
  reconnectAttempts++;
  clearTimeout(reconnectTimeout);
  reconnectTimeout = setTimeout(() => {
    console.log(`Reconnection attempt ${reconnectAttempts}/${maxReconnectAttempts}`);
    initWebSocket();
  }, backoffTime);
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);
  setTimeout(() => {
    notification.classList.add('fade-out');
    setTimeout(() => {
      document.body.removeChild(notification);
    }, 500);
  }, 5000);
}

// Function to generate unique ID for chats
function generateUniqueId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Function to create a new chat
function createNewChat() {
  // Save current chat if it has messages
  if (currentChat.messages.length > 0) {
    saveChatToHistory(currentChat);
  }
  
  // Clear chat display
  const outputDiv = document.getElementById("gen-output");
  if (outputDiv) {
    outputDiv.innerHTML = '';
  }
  
  // Reset conversation on server if connected
  if (ws && isWsConnected) {
    try {
      ws.send(JSON.stringify({ input: '>>>' }));
    } catch (error) {
      console.error('Error resetting conversation:', error);
    }
  }
  
  // Create new chat
  currentChatId = generateUniqueId();
  currentChat = {
    id: currentChatId,
    title: 'New Chat',
    messages: [],
    created: new Date(),
    lastUpdated: new Date()
  };
  
  showNotification('New chat created', 'info');
}

// Function to load chat history from localStorage
function loadChatHistory() {
  try {
    const savedHistory = localStorage.getItem('chatHistory');
    if (savedHistory) {
      chatHistory = JSON.parse(savedHistory);
      updateChatHistoryDisplay();
    }
  } catch (error) {
    console.error('Error loading chat history:', error);
    chatHistory = [];
  }
}

// Function to save chat history to localStorage
function saveChatHistory() {
  try {
    localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
  } catch (error) {
    console.error('Error saving chat history:', error);
    showNotification('Failed to save chat history', 'error');
  }
}

// Function to save current chat to history
function saveChatToHistory(chat) {
  // Set a title based on the first message if no title yet
  if (chat.title === 'New Chat' && chat.messages.length > 0) {
    // Get first user message
    const firstUserMessage = chat.messages.find(msg => msg.type === 'user');
    if (firstUserMessage) {
      // Truncate long messages
      chat.title = firstUserMessage.content.length > 30 
        ? firstUserMessage.content.substring(0, 27) + '...' 
        : firstUserMessage.content;
    }
  }
  
  // Update last modified time
  chat.lastUpdated = new Date();
  
  // Check if chat already exists in history
  const existingChatIndex = chatHistory.findIndex(c => c.id === chat.id);
  
  if (existingChatIndex !== -1) {
    // Update existing chat
    chatHistory[existingChatIndex] = chat;
  } else {
    // Add new chat to history
    chatHistory.unshift(chat);
    
    // Limit history size (keep most recent 20 chats)
    if (chatHistory.length > 20) {
      chatHistory = chatHistory.slice(0, 20);
    }
  }
  
  // Save to localStorage
  saveChatHistory();
  
  // Update display
  updateChatHistoryDisplay();
}

// Function to load a chat from history
function loadChatFromHistory(chatId) {
  // Save current chat if it has messages
  if (currentChat.messages.length > 0) {
    saveChatToHistory(currentChat);
  }
  
  // Find chat in history
  const chat = chatHistory.find(c => c.id === chatId);
  
  if (chat) {
    // Update current chat
    currentChat = JSON.parse(JSON.stringify(chat)); // Deep clone
    currentChatId = chat.id;
    
    // Display messages
    const outputDiv = document.getElementById("gen-output");
    if (outputDiv) {
      outputDiv.innerHTML = '';
      
      // Add all messages to display
      chat.messages.forEach(msg => {
        if (msg.type === 'user') {
          const userMessage = document.createElement("div");
          userMessage.classList.add("user-message");
          userMessage.innerText = `You: ${msg.content}`;
          outputDiv.appendChild(userMessage);
        } else if (msg.type === 'bot') {
          const botMessage = document.createElement("div");
          botMessage.classList.add("bot-message");
          botMessage.innerHTML = formatMessage(msg.content);
          outputDiv.appendChild(botMessage);
        } else if (msg.type === 'system') {
          const systemMessage = document.createElement("div");
          systemMessage.classList.add("system-message");
          systemMessage.innerText = msg.content;
          outputDiv.appendChild(systemMessage);
        }
      });
      
      // Scroll to bottom
      outputDiv.scrollTop = outputDiv.scrollHeight;
    }
    
    // Reset conversation on server
    if (ws && isWsConnected) {
      try {
        ws.send(JSON.stringify({ input: '>>>' }));
      } catch (error) {
        console.error('Error resetting conversation:', error);
      }
    }
    
    showNotification(`Loaded chat: ${chat.title}`, 'info');
    
    // Hide dropdown
    toggleChatHistoryDropdown(false);
  }
}

// Function to delete a chat from history
function deleteChatFromHistory(event, chatId) {
  // Prevent clicking on the parent element
  event.stopPropagation();
  
  // Remove from array
  chatHistory = chatHistory.filter(c => c.id !== chatId);
  
  // Save to localStorage
  saveChatHistory();
  
  // Update display
  updateChatHistoryDisplay();
  
  showNotification('Chat deleted', 'info');
}

// Function to toggle chat history dropdown
function toggleChatHistoryDropdown(forceState) {
  const dropdown = document.getElementById('chatHistoryDropdown');
  if (!dropdown) return;
  
  if (typeof forceState === 'boolean') {
    dropdown.style.display = forceState ? 'block' : 'none';
  } else {
    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
  }
  
  // Update chat history display when opening
  if (dropdown.style.display === 'block') {
    updateChatHistoryDisplay();
  }
}

// Function to update chat history display
function updateChatHistoryDisplay() {
  const historyList = document.getElementById('chatHistoryList');
  if (!historyList) return;
  
  // Clear existing items
  historyList.innerHTML = '';
  
  if (chatHistory.length === 0) {
    // Show empty state
    const emptyState = document.createElement('div');
    emptyState.className = 'history-empty-state';
    emptyState.innerText = 'No chat history yet';
    historyList.appendChild(emptyState);
    return;
  }
  
  // Add items for each chat
  chatHistory.forEach(chat => {
    const historyItem = document.createElement('div');
    historyItem.className = 'history-item';
    historyItem.setAttribute('data-chat-id', chat.id);
    
    // Format date
    const date = new Date(chat.lastUpdated);
    const formattedDate = `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    
    historyItem.innerHTML = `
      <div class="history-item-title">${chat.title}</div>
      <div class="history-item-date">${formattedDate}</div>
      <i class="bx bx-trash history-item-delete"></i>
    `;
    
    // Add click listener for loading chat
    historyItem.addEventListener('click', () => {
      loadChatFromHistory(chat.id);
    });
    
    // Add click listener for delete button
    const deleteBtn = historyItem.querySelector('.history-item-delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        deleteChatFromHistory(e, chat.id);
      });
    }
    
    historyList.appendChild(historyItem);
  });
}

async function sendInput() {
  const inputField = document.getElementById("gen-userInput");
  const outputDiv = document.getElementById("gen-output");
  
  if (!inputField) {
    console.error("Input field element not found");
    return;
  }
  
  const input = inputField.value.trim();
  console.log("Sending input:", input);
  
  if (!input) {
    showNotification('Please enter a message!', 'warning');
    return;
  }
  
  if (!isWsConnected) {
    showNotification('Not connected to server. Attempting to reconnect...', 'error');
    attemptReconnect();
    return;
  }
  
  try {
    // Create user message element
    const userMessage = document.createElement("div");
    userMessage.classList.add("user-message");
    userMessage.innerText = `You: ${input}`;
    outputDiv.appendChild(userMessage);
    
    // Add user message to current chat
    currentChat.messages.push({
      type: 'user',
      content: input,
      timestamp: new Date()
    });
    
    // Update chat history if this is the first message
    if (currentChat.messages.length === 1) {
      currentChat.title = input.length > 30 ? input.substring(0, 27) + '...' : input;
      saveChatToHistory(currentChat);
    }
    
    // Clear input field
    inputField.value = "";
    inputField.focus();
    
    toggleLoadingSpinner(true);
    currentBotMessage = document.createElement("div");
    currentBotMessage.classList.add("bot-message");
    outputDiv.appendChild(currentBotMessage);
    currentBotMessage.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
    currentResponse = "";
    
    // Send message to server
    ws.send(JSON.stringify({ input }));
    outputDiv.scrollTop = outputDiv.scrollHeight;
  } catch (error) {
    console.error('Error sending input:', error);
    showNotification('Failed to send message. Please try again.', 'error');
    toggleLoadingSpinner(false);
  }
}

function handleWebSocketMessage(event) {
  try {
    const data = JSON.parse(event.data);
    const outputDiv = document.getElementById("gen-output");
    
    if (data.chunk) {
      currentResponse += data.chunk;
      const formattedResponse = formatMessage(currentResponse);
      currentBotMessage.innerHTML = formattedResponse;
      outputDiv.scrollTop = outputDiv.scrollHeight;
    } else if (data.done) {
      toggleLoadingSpinner(false);
      
      // Add bot message to current chat
      currentChat.messages.push({
        type: 'bot',
        content: currentResponse,
        timestamp: new Date()
      });
      
      // Update chat in history
      currentChat.lastUpdated = new Date();
      saveChatToHistory(currentChat);
      
      const codeBlocks = currentResponse.match(/```(.*?)```/gs);
      if (codeBlocks && codeBlocks.length > 0) {
        processCodeBlocks(codeBlocks);
      }
    } else if (data.output) {
      const systemMessage = document.createElement("div");
      systemMessage.classList.add("system-message");
      systemMessage.innerText = data.output;
      outputDiv.appendChild(systemMessage);
      
      // Add system message to current chat
      currentChat.messages.push({
        type: 'system',
        content: data.output,
        timestamp: new Date()
      });
      
      outputDiv.scrollTop = outputDiv.scrollHeight;
    } else if (data.error) {
      toggleLoadingSpinner(false);
      const errorMessage = document.createElement("div");
      errorMessage.classList.add("error-message");
      errorMessage.innerText = `Error: ${data.error}`;
      outputDiv.appendChild(errorMessage);
      
      // Add error message to current chat
      currentChat.messages.push({
        type: 'error',
        content: data.error,
        timestamp: new Date()
      });
      
      outputDiv.scrollTop = outputDiv.scrollHeight;
      showNotification(data.error, 'error');
    }
  } catch (error) {
    console.error('Error handling WebSocket message:', error);
    toggleLoadingSpinner(false);
    showNotification('Error processing server response', 'error');
  }
}

function toggleLoadingSpinner(show) {
  if (!loadingSpinner) return;
  loadingSpinner.style.display = show ? 'block' : 'none';
}

function processCodeBlocks(codeBlocks) {
  const toggleBtn = document.getElementById('togglePlayground');
  
  // Filter for valid, executable code blocks
  const executableBlocks = codeBlocks.filter(block => {
    const cleanedCode = block.replace(/```/g, '').trim();
    const firstLine = cleanedCode.split('\n')[0].toLowerCase();
    
    // Check for explicit save marker
    if (firstLine.includes('#save-code') || 
        cleanedCode.includes('#save-code') || 
        cleanedCode.includes('// save-code') || 
        cleanedCode.includes('/* save-code */')) {
      return true;
    }
    
    // Check if it's labeled as a specific language
    const hasLanguageLabel = 
      firstLine.includes('python') || 
      firstLine.includes('java') || 
      firstLine.includes('html') || 
      firstLine.includes('javascript') || 
      firstLine.includes('js');
    
    // Check if it has code-specific indicators
    const hasCodeIndicators = 
      cleanedCode.includes('class ') || 
      cleanedCode.includes('def ') || 
      cleanedCode.includes('function ') || 
      cleanedCode.includes('<!DOCTYPE html>') || 
      cleanedCode.includes('<html') || 
      cleanedCode.includes('import ') || 
      cleanedCode.includes('public static void main');
    
    // If it's short or looks like console output or a filename, skip it
    const isShortOrNonExecutable = 
      cleanedCode.split('\n').length < 3 || // Too short
      /^[a-zA-Z0-9_\-\.\/\\]+\.[a-z]{1,5}$/m.test(cleanedCode) || // Looks like a filename
      /^\$\s|^>\s|^#\s/.test(cleanedCode); // Looks like console output
      
    return (hasLanguageLabel || hasCodeIndicators) && !isShortOrNonExecutable;
  });
  
  // Only save executable code blocks
  executableBlocks.forEach((block, index) => {
    try {
      let code = block.replace(/```/g, '').trim();
      let language;
      let fileName;
      const firstLine = code.split('\n')[0].toLowerCase();
      
      // Check for save marker with explicit language
      const saveCodeMatch = code.match(/#save-code:([a-z]+)(?:\s+(\S+\.?[a-z]+))?/i) || 
                           code.match(/\/\/\s*save-code:([a-z]+)(?:\s+(\S+\.?[a-z]+))?/i) || 
                           code.match(/\/\*\s*save-code:([a-z]+)(?:\s+(\S+\.?[a-z]+))?\s*\*\//i);
      
      if (saveCodeMatch) {
        language = saveCodeMatch[1].toLowerCase();
        
        // If a custom filename was provided in the save marker
        if (saveCodeMatch[2]) {
          fileName = saveCodeMatch[2];
        } else {
          // Use the default naming convention
          const ext = {
            'python': 'py',
            'java': 'java',
            'html': 'html',
            'javascript': 'js',
            'js': 'js',
            'css': 'css'
          }[language] || 'txt';
          
          fileName = `code_${index + 1}.${ext}`;
        }
        
        // Remove the save marker from the code
        code = code.replace(/#save-code:[a-z]+(?:\s+\S+\.?[a-z]+)?/i, '')
                  .replace(/\/\/\s*save-code:[a-z]+(?:\s+\S+\.?[a-z]+)?/i, '')
                  .replace(/\/\*\s*save-code:[a-z]+(?:\s+\S+\.?[a-z]+)?\s*\*\//i, '')
                  .trim();
      }
      // Determine language from explicit markers if not already set by save marker
      else if (firstLine.includes('python')) {
        language = 'python';
        code = code.replace(/^python\s*\n/i, '');
        fileName = `code_${index + 1}.py`;
      } else if (firstLine.includes('java')) {
        language = 'java';
        code = code.replace(/^java\s*\n/i, '');
        fileName = `code_${index + 1}.java`;
      } else if (firstLine.includes('html')) {
        language = 'html';
        code = code.replace(/^html\s*\n/i, '');
        fileName = `code_${index + 1}.html`;
      } else if (firstLine.includes('javascript') || firstLine.includes('js')) {
        language = 'javascript';
        code = code.replace(/^(javascript|js)\s*\n/i, '');
        fileName = `code_${index + 1}.js`;
      } else {
        // Try to identify language from content if no explicit marker
        if (code.includes('class ') && code.includes('public static void main')) {
          language = 'java';
          fileName = `code_${index + 1}.java`;
        } else if ((code.includes('def ') && code.includes(':')) || 
                  (code.includes('import ') && !code.includes('{'))) {
          language = 'python';
          fileName = `code_${index + 1}.py`;
        } else if (code.includes('<!DOCTYPE html>') || code.includes('<html')) {
          language = 'html';
          fileName = `code_${index + 1}.html`;
        } else if (code.includes('function ') && code.includes('{')) {
          language = 'javascript';
          fileName = `code_${index + 1}.js`;
        } else {
          // Check for more language indicators
          if (code.includes('println') || code.includes('System.out')) {
            language = 'java';
            fileName = `code_${index + 1}.java`;
          } else if (code.includes('console.log') || code.includes('let ') || code.includes('const ')) {
            language = 'javascript';
            fileName = `code_${index + 1}.js`;
          } else if (code.includes('print(') || code.includes('#')) {
            language = 'python';
            fileName = `code_${index + 1}.py`;
          } else {
            // Default fallback based on syntax patterns
            if (code.includes('{') && code.includes('}')) {
              language = 'javascript';
              fileName = `code_${index + 1}.js`;
            } else if (code.includes(':') && code.includes('    ')) {
              language = 'python';
              fileName = `code_${index + 1}.py`;
            } else {
              language = 'python'; // Last resort default
              fileName = `code_${index + 1}.py`;
            }
          }
        }
      }
      
      // Save code to compiler
      saveCodeToCompiler(code, language, fileName);
      
      if (toggleBtn && getComputedStyle(document.getElementById('compiler')).display === 'none') {
        showNotification(`Code saved! Click "Code Playground" to view and run it.`, 'info');
      }
    } catch (error) {
      console.error('Error processing code block:', error);
      showNotification('Failed to process code block', 'error');
    }
  });
}

function saveCodeToCompiler(code, language, fileName) {
  toggleLoadingSpinner(true);
  fetch('/create-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: '',
      fileName,
      content: code
    })
  })
  .then(res => {
    if (!res.ok) {
      throw new Error(`Server responded with status: ${res.status}`);
    }
    return res.json();
  })
  .then(data => {
    console.log('File created:', data);
    showNotification(`Code saved to ${fileName}`, 'success');
    loadExplorer('');
  })
  .catch(err => {
    console.error('Error saving code:', err);
    showNotification(`Failed to save code: ${err.message}`, 'error');
  })
  .finally(() => {
    toggleLoadingSpinner(false);
  });
}

function formatMessage(text) {
  if (!text) return '';
  
  try {
    let formattedText = text;
    
    // Handle URL links
    formattedText = formattedText.replace(
      /(https?:\/\/[^\s]+)/g, 
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    
    // Format code blocks with syntax highlighting
    formattedText = formattedText.replace(
      /```([\s\S]*?)```/g,
      (match, codeContent) => {
        // Determine language from first line if specified
        const lines = codeContent.trim().split('\n');
        const firstLine = lines[0].toLowerCase();
        let language = '';
        let code = codeContent;
        let codeBlockNote = '';
        
        if (firstLine.includes('python')) {
          language = 'language-python';
          code = lines.slice(1).join('\n');
          codeBlockNote = '<div class="code-block-note">Python code - will be extracted to the playground</div>';
        } else if (firstLine.includes('java')) {
          language = 'language-java';
          code = lines.slice(1).join('\n');
          codeBlockNote = '<div class="code-block-note">Java code - will be extracted to the playground</div>';
        } else if (firstLine.includes('html')) {
          language = 'language-html';
          code = lines.slice(1).join('\n');
          codeBlockNote = '<div class="code-block-note">HTML code - will be extracted to the playground</div>';
        } else if (firstLine.includes('javascript') || firstLine.includes('js')) {
          language = 'language-javascript';
          code = lines.slice(1).join('\n');
          codeBlockNote = '<div class="code-block-note">JavaScript code - will be extracted to the playground</div>';
        } else {
          // If no language specified, try to detect
          let detectedLanguage = 'plaintext';
          if (codeContent.includes('class ') && codeContent.includes('public static void main')) {
            detectedLanguage = 'java';
            codeBlockNote = '<div class="code-block-note">Java code - will be extracted to the playground</div>';
          } else if ((codeContent.includes('def ') && codeContent.includes(':')) || 
                    (codeContent.includes('import ') && !codeContent.includes('{'))) {
            detectedLanguage = 'python';
            codeBlockNote = '<div class="code-block-note">Python code - will be extracted to the playground</div>';
          } else if (codeContent.includes('<!DOCTYPE html>') || codeContent.includes('<html')) {
            detectedLanguage = 'html';
            codeBlockNote = '<div class="code-block-note">HTML code - will be extracted to the playground</div>';
          } else if (codeContent.includes('function ') && codeContent.includes('{')) {
            detectedLanguage = 'javascript';
            codeBlockNote = '<div class="code-block-note">JavaScript code - will be extracted to the playground</div>';
          } else if (codeContent.split('\n').length < 3 || 
                    /^\$\s|^>\s|^#\s/.test(codeContent) ||
                    /^[a-zA-Z0-9_\-\.\/\\]+\.[a-z]{1,5}$/m.test(codeContent)) {
            // Likely not executable code
            codeBlockNote = '<div class="code-block-note">Add #save-code:language to extract this to the playground</div>';
          }
          
          language = `language-${detectedLanguage}`;
          code = codeContent;
        }
        
        return `${codeBlockNote}<pre><code class="${language}">${code.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>`;
      }
    );
    
    // Handle bold text
    formattedText = formattedText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Handle italic text
    formattedText = formattedText.replace(/\*(.*?)\*/g, '<em>$1</em>');
    
    // Convert line breaks to <br> for HTML display
    formattedText = formattedText.replace(/\n/g, "<br>");
    
    return formattedText;
  } catch (error) {
    console.error('Error formatting message:', error);
    return text.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
  }
}

// ==========================================
// Compiler & File Explorer JavaScript
// ==========================================

function setupCompilerUIEventListeners() {
  // Language selector change handler
  const languageSelector = document.getElementById('comp-language');
  if (languageSelector) {
    languageSelector.addEventListener('change', handleLanguageChange);
  }

  // Run button handler
  const runButton = document.getElementById('comp-run-btn');
  if (runButton) {
    runButton.addEventListener('click', runCurrentCode);
  }

  // Download button handler
  const downloadButton = document.getElementById('comp-download-btn');
  if (downloadButton) {
    downloadButton.addEventListener('click', downloadCurrentCode);
  }

  // Explorer toggle button
  const explorerToggleButton = document.getElementById('comp-toggle-explorer-btn');
  if (explorerToggleButton) {
    explorerToggleButton.addEventListener('click', toggleFileExplorer);
  }

  // Fullscreen button
  const fullscreenButton = document.getElementById('comp-fullscreen-btn');
  if (fullscreenButton) {
    fullscreenButton.addEventListener('click', toggleTerminalFullscreen);
  }

  // File actions: create file button
  const createFileButton = document.getElementById('comp-createFileBtn');
  if (createFileButton) {
    createFileButton.addEventListener('click', createNewFile);
  }

  // File actions: create folder button
  const createFolderButton = document.getElementById('comp-createFolderBtn');
  if (createFolderButton) {
    createFolderButton.addEventListener('click', createNewFolder);
  }

  // Explorer refresh button
  const refreshExplorerButton = document.getElementById('comp-refreshExplorer');
  if (refreshExplorerButton) {
    refreshExplorerButton.addEventListener('click', () => loadExplorer(''));
  }

  // Save button
  const saveButton = document.querySelector('.editor-btn');
  if (saveButton) {
    saveButton.addEventListener('click', () => saveCurrentFile());
  }
  
  // Add HTML preview update button to the editor header
  const editorHeader = document.querySelector('.editor-header .editor-actions');
  if (editorHeader) {
    const previewButton = document.createElement('button');
    previewButton.className = 'editor-btn preview-btn';
    previewButton.innerHTML = '<i class="bx bx-refresh"></i>';
    previewButton.title = 'Update Preview';
    previewButton.addEventListener('click', updateHTMLPreview);
    editorHeader.appendChild(previewButton);
  }

  // Handle code changes to persist editor content when switching languages
  codeEditor.on('change', () => {
    const lang = document.getElementById('comp-language').value;
    activeEditorContent[lang] = codeEditor.getValue();
    
    // For HTML files, add debounced auto-preview update
    if (lang === 'html') {
      clearTimeout(window.htmlPreviewDebounce);
      window.htmlPreviewDebounce = setTimeout(() => {
        updateHTMLPreview();
      }, 1500); // Update preview 1.5 seconds after typing stops
    }
  });

  cssEditor.on('change', () => {
    activeEditorContent.css = cssEditor.getValue();
  });

  // Code playground toggle button
  const togglePlaygroundBtn = document.getElementById('togglePlayground');
  if (togglePlaygroundBtn) {
    togglePlaygroundBtn.addEventListener('click', toggleCodePlayground);
  }

  // Add code quality buttons
  setupCodeQualityButtons();
  
  // Add Git controls
  setupGitControls();
  
  // Add snippets button
  setupSnippetsButton();
  
  // Setup autocomplete
  setupAutocomplete();
  
  // Add collaborative button
  setupCollaborativeButton();
  
  // Check URL for collaborative session
  checkForCollaborativeUrl();
  
  // Add terminate button
  setupTerminateButton();
}

function handleLanguageChange() {
  const lang = document.getElementById('comp-language').value;
  if (codeEditor && document.getElementById('comp-language')) {
    const previousLang = document.getElementById('comp-language').getAttribute('data-previous-lang') || 'python';
    activeEditorContent[previousLang] = codeEditor.getValue();
    document.getElementById('comp-language').setAttribute('data-previous-lang', lang);
  }
  
  // Hide inputs for all modes - not used for HTML
  const inputContainer = document.querySelector('.input-container');
  if (inputContainer) {
    inputContainer.style.display = 'none';
  }
  
  // Make the output container take full width
  const outputContainer = document.querySelector('.output-container');
  if (outputContainer) {
    outputContainer.style.width = '100%';
  }
  
  if (lang === 'python') {
    codeEditor.setOption('mode', 'python');
    cssEditor.getWrapperElement().style.display = 'none';
    codeEditor.getWrapperElement().style.width = '100%';
    document.getElementById('comp-output').style.display = 'block';
    document.getElementById('comp-preview').style.display = 'none';
    codeEditor.setValue(activeEditorContent.python || '');
  } else if (lang === 'java') {
    codeEditor.setOption('mode', 'text/x-java');
    cssEditor.getWrapperElement().style.display = 'none';
    codeEditor.getWrapperElement().style.width = '100%';
    document.getElementById('comp-output').style.display = 'block';
    document.getElementById('comp-preview').style.display = 'none';
    codeEditor.setValue(activeEditorContent.java || '');
  } else if (lang === 'html') {
    codeEditor.setOption('mode', 'htmlmixed');
    // Hide CSS editor - we're simplifying HTML to be like other languages
    cssEditor.getWrapperElement().style.display = 'none';
    codeEditor.getWrapperElement().style.width = '100%';
    document.getElementById('comp-output').style.display = 'none';
    document.getElementById('comp-preview').style.display = 'block';
    codeEditor.setValue(activeEditorContent.html || '');
  } else if (lang === 'javascript') {
    codeEditor.setOption('mode', 'javascript');
    cssEditor.getWrapperElement().style.display = 'none';
    codeEditor.getWrapperElement().style.width = '100%';
    document.getElementById('comp-output').style.display = 'block';
    document.getElementById('comp-preview').style.display = 'none';
    codeEditor.setValue(activeEditorContent.javascript || '');
  } else if (lang === 'cpp') {
    codeEditor.setOption('mode', 'text/x-c++src');
    cssEditor.getWrapperElement().style.display = 'none';
    codeEditor.getWrapperElement().style.width = '100%';
    document.getElementById('comp-output').style.display = 'block';
    document.getElementById('comp-preview').style.display = 'none';
    codeEditor.setValue(activeEditorContent.cpp || '');
  }
  
  setTimeout(() => {
    codeEditor.refresh();
    if (lang === 'html') {
      // For HTML, automatically update the preview when changing to HTML mode
      updateHTMLPreview();
    }
  }, 1);
  
  // Load snippets for the new language
  loadSnippets(lang);
}

function toggleFileExplorer() {
  const explorer = document.querySelector('.file-explorer');
  const mainContent = document.querySelector('.main-content');
  if (!explorer || !mainContent) return;
  if (getComputedStyle(explorer).display === 'none' || explorer.style.display === '') {
    explorer.style.display = 'block';
    mainContent.style.gridColumn = '2 / -1';
  } else {
    explorer.style.display = 'none';
    mainContent.style.gridColumn = '1 / -1';
  }
}

function toggleTerminalFullscreen() {
  const terminalContainer = document.querySelector('.terminal-container');
  const fullscreenBtn = document.getElementById('comp-fullscreen-btn');
  const terminalHeader = document.querySelector('.terminal-header');
  const terminalElement = document.getElementById('comp-terminal');
  
  if (!terminalContainer) {
    console.error('Terminal container not found');
    return;
  }

  if (!fullscreenBtn) {
    console.error('Fullscreen button not found');
    return;
  }

  console.log('Toggling terminal fullscreen');

  // Save terminal dimensions before entering fullscreen
  if (!document.fullscreenElement) {
    // Store current dimensions before fullscreen
    window.terminalOriginalHeight = terminalContainer.offsetHeight;
    window.terminalOriginalWidth = terminalContainer.offsetWidth;
    console.log(`Saved original dimensions: ${window.terminalOriginalWidth}x${window.terminalOriginalHeight}`);
    
    // Store terminal state
    if (terminal) {
      window.savedTerminalState = {
        cursorX: terminal._core.buffer.x,
        cursorY: terminal._core.buffer.y,
        wasActive: processActive
      };
    }

    console.log('Entering fullscreen mode');
    terminalContainer.requestFullscreen().then(() => {
      fullscreenBtn.innerHTML = '<i class="bx bx-exit-fullscreen"></i>';
      
      // Fit terminal after entering fullscreen
      setTimeout(() => {
        if (terminal && terminal.fit) {
          terminal.fit();
          console.log('Terminal fitted after entering fullscreen');
        }
      }, 200);
    }).catch(err => {
      console.error('Error entering fullscreen:', err);
      showNotification('Failed to enter fullscreen mode: ' + err.message, 'error');
    });
  } else {
    console.log('Exiting fullscreen mode');
    document.exitFullscreen().then(() => {
      fullscreenBtn.innerHTML = '<i class="bx bx-fullscreen"></i>';
      
      // Reset container size to original dimensions
      if (window.terminalOriginalHeight && window.terminalOriginalWidth) {
        terminalContainer.style.height = `${window.terminalOriginalHeight}px`;
        terminalContainer.style.width = `${window.terminalOriginalWidth}px`;
        console.log(`Restored dimensions: ${window.terminalOriginalWidth}x${window.terminalOriginalHeight}`);
      } else {
        // Default size if original not saved
        terminalContainer.style.height = 'auto';
        terminalContainer.style.width = '100%';
      }
      
      // Reset positioning
      terminalContainer.style.position = 'relative';
      terminalContainer.style.overflow = 'hidden';
      
      // Reset terminal window
      if (terminalElement) {
        terminalElement.style.display = 'block';
        terminalElement.style.height = '100%';
      }
      
      // Fit terminal after exiting fullscreen
      setTimeout(() => {
        if (terminal && terminal.fit) {
          terminal.fit();
          console.log('Terminal fitted after exiting fullscreen');
          
          // Restore terminal state if needed
          if (window.savedTerminalState) {
            processActive = window.savedTerminalState.wasActive;
          }
        }
      }, 300);
    }).catch(err => {
      console.error('Error exiting fullscreen:', err);
      showNotification('Failed to exit fullscreen mode: ' + err.message, 'error');
    });
  }
}

// Add fullscreen change event listener
document.addEventListener('fullscreenchange', () => {
  const terminalContainer = document.querySelector('.terminal-container');
  const fullscreenBtn = document.getElementById('comp-fullscreen-btn');
  const terminalHeader = document.querySelector('.terminal-header');
  const terminalElement = document.getElementById('comp-terminal');
  
  if (!terminalContainer) {
    console.error('Terminal container not found');
    return;
  }
  
  if (!fullscreenBtn) {
    console.error('Fullscreen button not found');
    return;
  }
  
  console.log('Fullscreen state changed:', !!document.fullscreenElement);

  if (document.fullscreenElement === terminalContainer) {
    // Entering fullscreen
    fullscreenBtn.innerHTML = '<i class="bx bx-exit-fullscreen"></i>';
    
    // Set up fullscreen styles
    terminalContainer.style.display = 'flex';
    terminalContainer.style.flexDirection = 'column';
    terminalContainer.style.width = '100%';
    terminalContainer.style.height = '100%';
    terminalContainer.style.overflow = 'hidden';
    
    // Set up header
    if (terminalHeader) {
      terminalHeader.style.position = 'sticky';
      terminalHeader.style.top = '0';
      terminalHeader.style.zIndex = '1000';
      terminalHeader.style.width = '100%';
    }
    
    // Ensure terminal gets proper sizing
    if (terminalElement) {
      terminalElement.style.flexGrow = '1';
      terminalElement.style.height = 'calc(100% - 40px)';
    }
  } else {
    // Exiting fullscreen
    fullscreenBtn.innerHTML = '<i class="bx bx-fullscreen"></i>';
    
    // Reset container styles
    terminalContainer.style.display = 'block';
    if (window.terminalOriginalHeight && window.terminalOriginalWidth) {
      terminalContainer.style.height = `${window.terminalOriginalHeight}px`;
      terminalContainer.style.width = `${window.terminalOriginalWidth}px`;
    } else {
      terminalContainer.style.height = 'auto';
      terminalContainer.style.width = '100%';
    }
    
    // Reset terminal element styles
    if (terminalElement) {
      terminalElement.style.display = 'block';
      terminalElement.style.height = '100%';
      terminalElement.style.flexGrow = '0';
    }
    
    // Reset header position
    if (terminalHeader) {
      terminalHeader.style.position = 'relative';
      terminalHeader.style.top = 'auto';
      terminalHeader.style.zIndex = '10';
      terminalHeader.style.width = '100%';
    }
    
    // Ensure terminal stays visible and properly sized
    setTimeout(() => {
      if (terminal && terminal.fit) {
        terminal.fit();
        console.log('Terminal fitted after fullscreen change');
      }
      
      // Check if terminal needs to be reinitialized
      const xtermElement = terminalElement?.querySelector('.xterm');
      if (!xtermElement || !terminalElement.querySelector('.xterm-screen')) {
        console.log('Terminal needs re-initialization after fullscreen exit');
        reinitializeTerminalIfNeeded();
      }
    }, 300); 
  }
});

// Add a function to reinitialize the terminal if needed
function reinitializeTerminalIfNeeded() {
  const terminalElement = document.getElementById('comp-terminal');
  if (!terminalElement) return;
  
  // Check if terminal is still operational
  let terminalIsValid = false;
  
  try {
    // Try to perform a simple terminal operation
    if (terminal && typeof terminal.write === 'function') {
      terminalIsValid = true;
    }
  } catch (error) {
    console.error('Terminal validation error:', error);
    terminalIsValid = false;
  }
  
  if (!terminalIsValid) {
    console.log('Terminal needs full re-initialization');
    
    // Clear the terminal element
    terminalElement.innerHTML = '';
    
    // Reset terminal initialization flag
    isTerminalInitialized = false;
    
    // Reinitialize
    setTimeout(() => {
      initializeTerminal();
      showNotification('Terminal has been reinitialized', 'info');
    }, 100);
  } else {
    console.log('Terminal is still valid, just ensuring display');
    terminal.fit();
  }
}

function toggleCodePlayground() {
  const generatorSection = document.getElementById('code-generator');
  const compilerSection = document.getElementById('compiler');
  const toggleBtn = document.getElementById('togglePlayground');
  const mainContainer = document.querySelector('.main-container');

  if (getComputedStyle(compilerSection).display === 'none') {
    // Show compiler
    compilerSection.style.display = 'block';
    toggleBtn.innerHTML = '<i class="bx bx-message-square-dots"></i> Hide Playground';
    mainContainer.classList.add('both-visible');
    
    // Refresh CodeMirror instances
    if (codeEditor) {
      setTimeout(() => {
        codeEditor.refresh();
        cssEditor.refresh();
      }, 1);
    }
    
    // Automatically refresh the file explorer
    loadExplorer('');
  } else {
    // Hide compiler
    compilerSection.style.display = 'none';
    toggleBtn.innerHTML = '<i class="bx bx-code-block"></i> Code Playground';
    mainContainer.classList.remove('both-visible');
  }
}

function loadExplorer(path = '') {
  toggleLoadingSpinner(true);
  fetch('/list?path=' + encodeURIComponent(path))
    .then(res => {
      if (!res.ok) {
        throw new Error(`Failed to load explorer: ${res.status} ${res.statusText}`);
      }
      return res.json();
    })
    .then(data => {
      currentRelativePath = path;
      const pathDisplay = document.getElementById('comp-currentPath');
      if (pathDisplay) {
        pathDisplay.textContent = path ? `/${path}` : '/ (root)';
      }
      const explorerList = document.getElementById('comp-explorerList');
      if (!explorerList) return;
      explorerList.innerHTML = '';
      if (path) {
        const parentItem = document.createElement('li');
        parentItem.innerHTML = '<i class="bx bx-arrow-back"></i> ..';
        parentItem.className = 'parent-dir';
        parentItem.addEventListener('click', () => {
          const parentPath = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '';
          loadExplorer(parentPath);
        });
        explorerList.appendChild(parentItem);
      }
      data.files.forEach(item => {
        const li = document.createElement('li');
        li.className = item.type;
        const sizeText = item.size ? ` (${formatFileSize(item.size)})` : '';
        li.innerHTML = `<span class="item-name">${item.name}${sizeText}</span>`;
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'item-actions';
        if (item.type === 'folder') {
          actionsDiv.innerHTML = `
            <button class="action-btn open-btn" title="Open folder"><i class="bx bx-folder-open"></i></button>
            <button class="action-btn delete-btn" title="Delete folder"><i class="bx bx-trash"></i></button>
          `;
          li.querySelector('.item-name').addEventListener('click', () => {
            const newPath = path ? path + '/' + item.name : item.name;
            loadExplorer(newPath);
          });
          actionsDiv.querySelector('.open-btn').addEventListener('click', () => {
            const newPath = path ? path + '/' + item.name : item.name;
            loadExplorer(newPath);
          });
        } else {
          actionsDiv.innerHTML = `
            <button class="action-btn edit-btn" title="Edit file"><i class="bx bx-edit"></i></button>
            <button class="action-btn run-btn" title="Run file"><i class="bx bx-play"></i></button>
            <button class="action-btn delete-btn" title="Delete file"><i class="bx bx-trash"></i></button>
          `;
          li.querySelector('.item-name').addEventListener('click', () => {
            openFile(path, item.name);
          });
          actionsDiv.querySelector('.edit-btn').addEventListener('click', () => {
            openFile(path, item.name);
          });
          actionsDiv.querySelector('.run-btn').addEventListener('click', () => {
            runFile(path, item.name);
          });
        }
        actionsDiv.querySelector('.delete-btn').addEventListener('click', () => {
          deleteFileOrFolder(path, item.name, item.type);
        });
        li.appendChild(actionsDiv);
        explorerList.appendChild(li);
      });
    })
    .catch(err => {
      console.error('Error loading explorer:', err);
      showNotification(`Failed to load file explorer: ${err.message}`, 'error');
    })
    .finally(() => {
      toggleLoadingSpinner(false);
    });
}

function formatFileSize(bytes) {
  if (bytes < 1024) {
    return bytes + ' B';
  } else if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + ' KB';
  } else {
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
}

function openFile(dirPath, fileName) {
  const filePath = dirPath ? dirPath + '/' + fileName : fileName;
  selectedFilePath = filePath;
  
  toggleLoadingSpinner(true);
  
  fetch('/open-file?path=' + encodeURIComponent(filePath))
    .then(res => {
      if (!res.ok) {
        throw new Error(`Server responded with status: ${res.status}`);
      }
      return res.json();
    })
    .then(data => {
      const extension = fileName.toLowerCase().split('.').pop();
      const languageSelect = document.getElementById('comp-language');
      const filenameDisplay = document.querySelector('.file-name');
      
      if (filenameDisplay) {
        filenameDisplay.textContent = data.name;
      }
      
      // Set default values
      selectedFilePath = filePath;
      
      // Set editor language based on file extension
      if (extension === 'py') {
        languageSelect.value = 'python';
        codeEditor.setOption('mode', 'python');
        activeEditorContent.python = data.content;
      } else if (extension === 'java') {
        languageSelect.value = 'java';
        codeEditor.setOption('mode', 'text/x-java');
        activeEditorContent.java = data.content;
      } else if (extension === 'html') {
        languageSelect.value = 'html';
        codeEditor.setOption('mode', 'htmlmixed');
        activeEditorContent.html = data.content;
        // We no longer load CSS separately - simplified HTML workflow
      }
      
      // Apply the language change to update editor display
      handleLanguageChange();
      
      // Set current content to editor
      codeEditor.setValue(data.content);
      codeEditor.clearHistory();
    })
    .catch(err => {
      console.error('Error opening file:', err);
      showNotification(`Failed to open file: ${err.message}`, 'error');
    })
    .finally(() => {
      toggleLoadingSpinner(false);
    });
}

function deleteFileOrFolder(dirPath, name, type) {
  if (!confirm(`Are you sure you want to delete ${name}?`)) {
    return;
  }
  const path = dirPath ? dirPath + '/' + name : name;
  fetch('/delete-file', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  })
  .then(res => {
    if (!res.ok) {
      throw new Error(`Server responded with status: ${res.status}`);
    }
    return res.json();
  })
  .then(data => {
    showNotification(`${type === 'folder' ? 'Folder' : 'File'} deleted successfully`, 'success');
    loadExplorer(currentRelativePath);
    if (selectedFilePath === path) {
      selectedFilePath = '';
      codeEditor.setValue('');
    }
  })
  .catch(err => {
    console.error(`Error deleting ${type}:`, err);
    showNotification(`Failed to delete ${type}: ${err.message}`, 'error');
  });
}

function createNewFile() {
  const nameInput = document.getElementById('comp-newItemName');
  const fileName = nameInput.value.trim();
  if (!fileName) {
    showNotification('Please enter a file name', 'warning');
    return;
  }
  toggleLoadingSpinner(true);
  fetch('/create-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: currentRelativePath,
      fileName,
      content: ''
    })
  })
  .then(res => {
    if (!res.ok) {
      throw new Error(`Server responded with status: ${res.status}`);
    }
    return res.json();
  })
  .then(data => {
    showNotification(`File '${fileName}' created successfully`, 'success');
    nameInput.value = '';
    loadExplorer(currentRelativePath);
    setTimeout(() => {
      openFile(currentRelativePath, fileName);
    }, 500);
  })
  .catch(err => {
    console.error('Error creating file:', err);
    showNotification(`Failed to create file: ${err.message}`, 'error');
  })
  .finally(() => {
    toggleLoadingSpinner(false);
  });
}

function createNewFolder() {
  const nameInput = document.getElementById('comp-newItemName');
  const folderName = nameInput.value.trim();
  if (!folderName) {
    showNotification('Please enter a folder name', 'warning');
    return;
  }
  toggleLoadingSpinner(true);
  fetch('/create-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: currentRelativePath,
      folderName
    })
  })
  .then(res => {
    if (!res.ok) {
      throw new Error(`Server responded with status: ${res.status}`);
    }
    return res.json();
  })
  .then(data => {
    showNotification(`Folder '${folderName}' created successfully`, 'success');
    nameInput.value = '';
    loadExplorer(currentRelativePath);
  })
  .catch(err => {
    console.error('Error creating folder:', err);
    showNotification(`Failed to create folder: ${err.message}`, 'error');
  })
  .finally(() => {
    toggleLoadingSpinner(false);
  });
}

function saveCurrentFile(callback) {
  if (!selectedFilePath) {
    showNotification('No file selected to save', 'warning');
    if (callback) callback();
    return;
  }

  const lang = document.getElementById('comp-language').value;
  let content = codeEditor.getValue();

  toggleLoadingSpinner(true);

  // For all file types, just save the main content
    fetch('/save-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: selectedFilePath,
        content
      })
    })
    .then(res => {
      if (!res.ok) {
        throw new Error(`Server responded with status: ${res.status}`);
      }
      return res.json();
    })
    .then(data => {
    showNotification('File saved successfully', 'success');
    if (callback) callback();
    })
    .catch(err => {
      console.error('Error saving file:', err);
      showNotification(`Failed to save file: ${err.message}`, 'error');
    if (callback) callback();
    })
    .finally(() => {
      toggleLoadingSpinner(false);
    });
}

function runFile(dirPath, fileName) {
  // Clear any existing error elements when running a new file
  clearErrorElements();
  
  const filePath = dirPath ? dirPath + '/' + fileName : fileName;
  const extension = fileName.toLowerCase().split('.').pop();
  let language;
  
  if (extension === 'py') {
    language = 'python';
  } else if (extension === 'java') {
    language = 'java';
  } else if (extension === 'html') {
    language = 'html';
    toggleLoadingSpinner(true);
    
    // First save the file to ensure we use latest content
    saveCurrentFile(() => {
    const previewFrame = document.getElementById('comp-preview');
    if (previewFrame) {
      previewFrame.src = `/preview?path=${encodeURIComponent(filePath)}`;
        
        // Show compiler section if it's hidden
      const compilerSection = document.getElementById('compiler');
      if (compilerSection && getComputedStyle(compilerSection).display === 'none') {
        toggleCodePlayground();
      }
        
        // Switch to HTML mode
      document.getElementById('comp-language').value = 'html';
      handleLanguageChange();
        
      showNotification('HTML preview loaded', 'info');
      toggleLoadingSpinner(false);
    }
    });
    return;
  } else {
    showNotification(`Cannot run files with .${extension} extension`, 'error');
    return;
  }
  
  // For Python and Java, show compiler section if it's hidden
  const compilerSection = document.getElementById('compiler');
  if (compilerSection && getComputedStyle(compilerSection).display === 'none') {
    toggleCodePlayground();
  }
  
  if (terminal && typeof terminal.clear === 'function') {
    terminal.clear();
  }
  
  processActive = true;
  terminal.write(`Running ${fileName}...\r\n`);
  
  fetch('/run-file', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      path: filePath,
      language
    })
  }).then(response => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    let errorMessages = '';
    
    const readOutput = () => {
      reader.read().then(({ value, done }) => {
        if (done) {
          processActive = false;
          terminal.write('\r\n> ');
          toggleLoadingSpinner(false);
          
          // Check if we collected errors and send them to the chat
          if (errorMessages) {
            storeErrorMessage(errorMessages);
            // Don't add a button here, let checkAndSendTerminalErrors handle it
            
            // Auto-check for errors
            setTimeout(checkAndSendTerminalErrors, 500);
          }
          
          return;
        }
        
        try {
          const text = decoder.decode(value);
          const jsonResponses = text.split('\n')
            .filter(line => line.trim())
            .map(line => {
              try {
                return JSON.parse(line);
        } catch (e) {
                console.error('Error parsing line:', line);
                return { error: line }; // Treat unparseable lines as errors
              }
            });
          
          jsonResponses.forEach(data => {
            if (data.output) {
              terminal.write(data.output);
            } else if (data.error) {
              terminal.write(`\r\n\x1b[31m${data.error}\x1b[0m`);
              // Collect error messages for potential AI help
              errorMessages += data.error + '\n';
            } else if (data.message) {
              if (data.message.includes("Process exited with code 0")) {
                terminal.write(`\r\n\x1b[32m${data.message}\x1b[0m`); // Green for successful exit
              } else {
                terminal.write(`\r\n${data.message}`);
              }
            }
          });
        } catch (error) {
          console.error('Error parsing output:', error);
        }
        
        readOutput();
      }).catch(err => {
        console.error('Error reading stream:', err);
        terminal.write(`\r\n\x1b[31mError: ${err.message}\x1b[0m\r\n> `);
        processActive = false;
        toggleLoadingSpinner(false);
      });
    };
    
    readOutput();
  }).catch(err => {
    console.error('Error running file:', err);
    terminal.write(`\r\n\x1b[31mError: ${err.message}\x1b[0m\r\n> `);
    processActive = false;
    toggleLoadingSpinner(false);
  });
}

function runCurrentCode() {
  // Clear any existing error elements when running new code
  clearErrorElements();
  
  if (!selectedFilePath) {
    showNotification('No file is currently open. Please open or create a file first.', 'warning');
    return;
  }

  const language = document.getElementById('comp-language').value;
  
  if (language === 'html') {
    // For HTML, just update the preview
    updateHTMLPreview();
    return;
  }
  
  const codeContent = codeEditor.getValue();
  if (!codeContent.trim()) {
    showNotification('Cannot run empty code.', 'warning');
    return;
  }

  if (terminal && typeof terminal.clear === 'function') {
    terminal.clear();
  }

  // Reset process state
  processActive = false;
  
  // Set loading state
  toggleLoadingSpinner(true);
  terminal.write(`Running code...\r\n`);

  // For Python and Java, we use the server-side execution
  if (language === 'python' || language === 'java' || language === 'javascript' || language === 'cpp') {
    // Save the current file before running
    saveCurrentFile(() => {
      // After saving, run the file
      processActive = true; // Set process as active when starting
      
      fetch('/run-file', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          path: selectedFilePath,
          language
        })
      }).then(response => {
        if (!response.ok) {
          throw new Error(`Server responded with status: ${response.status}`);
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        let errorMessages = '';
        
        const readOutput = () => {
          reader.read().then(({ value, done }) => {
            if (done) {
              processActive = false;
              terminal.write('\r\n> ');
              toggleLoadingSpinner(false);
              
              // Check if we collected errors and send them to the chat
              if (errorMessages) {
                storeErrorMessage(errorMessages);
                // Don't add a button here, let checkAndSendTerminalErrors handle it
                
                // Auto-check for errors
                setTimeout(checkAndSendTerminalErrors, 500);
              }
              
              return;
            }
            
            try {
              const text = decoder.decode(value);
              const jsonResponses = text.split('\n')
                .filter(line => line.trim())
                .map(line => {
                  try {
                    return JSON.parse(line);
                  } catch (e) {
                    console.error('Error parsing line:', line);
                    return { error: line }; // Treat unparseable lines as errors
                  }
                });
              
              jsonResponses.forEach(data => {
                if (data.output) {
                  terminal.write(data.output);
                } else if (data.error) {
                  terminal.write(`\r\n\x1b[31m${data.error}\x1b[0m`);
                  // Collect error messages for potential AI help
                  errorMessages += data.error + '\n';
                } else if (data.message) {
                  if (data.message.includes("Process exited with code 0")) {
                    terminal.write(`\r\n\x1b[32m${data.message}\x1b[0m`); // Green for successful exit
                  } else {
                    terminal.write(`\r\n${data.message}`);
                  }
                }
              });
            } catch (error) {
              console.error('Error parsing output:', error);
              terminal.write(`\r\n\x1b[31mError parsing output: ${error.message}\x1b[0m`);
            }
            
            readOutput();
          }).catch(err => {
            console.error('Error reading stream:', err);
            terminal.write(`\r\n\x1b[31mError: ${err.message}\x1b[0m\r\n> `);
            processActive = false;
            toggleLoadingSpinner(false);
          });
        };
        
        readOutput();
      }).catch(err => {
        console.error('Error running code:', err);
        terminal.write(`\r\n\x1b[31mError: ${err.message}\x1b[0m\r\n> `);
        processActive = false;
        toggleLoadingSpinner(false);
      });
    });
  }
}

// Function to manually terminate the current running process
function terminateProcess() {
  if (!processActive) {
    showNotification('No active process to terminate', 'info');
    return;
  }
  
  fetch('/terminate-process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  })
  .then(res => {
    if (!res.ok) {
      throw new Error(`Server responded with status: ${res.status}`);
    }
    return res.json();
  })
  .then(data => {
    processActive = false;
    terminal.write(`\r\n\x1b[33mProcess terminated by user\x1b[0m\r\n> `);
    toggleLoadingSpinner(false);
    showNotification('Process terminated', 'info');
  })
  .catch(err => {
    console.error('Error terminating process:', err);
    showNotification(`Failed to terminate process: ${err.message}`, 'error');
  });
}

// Add a terminate button to the controls
function setupTerminateButton() {
  const controlGroup = document.querySelector('.controls .control-group:first-child');
  if (!controlGroup) return;
  
  // Check if the button already exists
  if (document.getElementById('terminate-btn')) return;
  
  const terminateBtn = document.createElement('button');
  terminateBtn.id = 'terminate-btn';
  terminateBtn.className = 'control-btn';
  terminateBtn.title = 'Terminate running process';
  terminateBtn.innerHTML = '<i class="bx bx-stop-circle"></i>';
  terminateBtn.addEventListener('click', terminateProcess);
  
  controlGroup.appendChild(terminateBtn);
}

function downloadCurrentCode() {
  const lang = document.getElementById('comp-language').value;
  if (selectedFilePath) {
    window.open(`/download?path=${encodeURIComponent(selectedFilePath)}`, '_blank');
    return;
  }
  if (!codeEditor.getValue().trim()) {
    showNotification('No code to download', 'warning');
    return;
  }
  window.open(`/download?language=${lang}`, '_blank');
}

function initializeTerminal() {
  if (isTerminalInitialized) return;
  try {
    const terminalElement = document.getElementById('comp-terminal');
    if (!terminalElement) {
      console.error('Terminal element not found');
      return;
    }
    
    // Make terminal global so it can be accessed from other functions
    window.terminal = terminal = new Terminal({
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      cursorBlink: true,
      scrollback: 1000,
      theme: {
        background: '#202124',
        foreground: '#E8EAED',
        cursor: '#FFFFFF'
      }
    });

    // Initialize the fit addon
    const fitAddon = new FitAddon.FitAddon();
    terminal.loadAddon(fitAddon);
    
    // Store fitAddon for global access
    window.terminalFitAddon = fitAddon;
    
    terminal.open(terminalElement);
    
    // Initial fit after opening
    setTimeout(() => {
      fitAddon.fit();
      console.log('Terminal fitted');
    }, 100);

    // Handle window resize
    window.addEventListener('resize', () => {
      if (fitAddon) {
        try {
          fitAddon.fit();
        } catch (err) {
          console.error('Error resizing terminal:', err);
        }
      }
    });

    terminal.write('Welcome to the terminal! Type commands and press Enter.\r\nType "help" for available commands.\r\n> ');
    let terminalInput = '';
    let commandHistory = [];
    let historyIndex = -1;

    // Add fit() method to terminal for easy access
    terminal.fit = function() {
      if (fitAddon) {
        try {
          fitAddon.fit();
        } catch (err) {
          console.error('Error fitting terminal:', err);
        }
      }
    };

    terminal.onData(data => {
      if (data === '\r') {
        terminal.write('\r\n'); // Move to a new line
        if (processActive) {
          fetch('/send-input', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: terminalInput })
          })
          .catch(err => terminal.write(`\r\nError sending input: ${err.message}\r\n> `));
        } else if (terminalInput.trim() === 'clear' || terminalInput.trim() === 'cls') {
          terminal.clear();
          terminal.write('> ');
        } else if (terminalInput.trim() === 'help') {
          showTerminalHelp();
        } else if (terminalInput.trim()) {
          fetch('/terminal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: terminalInput })
          })
            .then(res => res.json())
            .then(data => {
              terminal.write(formatTerminalOutput(data.output));
            terminal.write('\r\n> ');
            })
            .catch(err => terminal.write(`\r\nError: ${err.message}\r\n> `));

          // Add command to history
          if (commandHistory.length === 0 || commandHistory[commandHistory.length - 1] !== terminalInput) {
            commandHistory.push(terminalInput);
            if (commandHistory.length > 100) commandHistory.shift();
          }
        } else {
          terminal.write('> ');
        }
        terminalInput = '';
        historyIndex = -1;
      } else if (data === '\x1b[A') { // Up arrow
        if (commandHistory.length > 0 && historyIndex < commandHistory.length - 1) {
          historyIndex++;
          terminal.write('\x1b[2K\r> ' + commandHistory[commandHistory.length - 1 - historyIndex]);
          terminalInput = commandHistory[commandHistory.length - 1 - historyIndex];
        }
      } else if (data === '\x1b[B') { // Down arrow
        if (historyIndex > -1) {
          historyIndex--;
          if (historyIndex === -1) {
            terminal.write('\x1b[2K\r> ');
            terminalInput = '';
          } else {
            terminal.write('\x1b[2K\r> ' + commandHistory[commandHistory.length - 1 - historyIndex]);
            terminalInput = commandHistory[commandHistory.length - 1 - historyIndex];
          }
        }
      } else if (data === '\x7f') { // Backspace
        if (terminalInput.length > 0) {
          terminalInput = terminalInput.slice(0, -1);
          terminal.write('\b \b');
        }
      } else if (!data.startsWith('\x1b')) { // Regular input (ignore other escape sequences)
        terminalInput += data;
        terminal.write(data);
      }
    });

    console.log('Terminal initialized successfully');
    isTerminalInitialized = true;
  } catch (error) {
    console.error('Error initializing terminal:', error);
    showNotification('Failed to initialize terminal', 'error');
  }
}

function showTerminalHelp() {
  const helpText = [
    'Available Terminal Commands:',
    '-------------------------',
    'ls                - List files in current directory',
    'cd <dir>          - Change directory',
    'pwd               - Show current directory',
    'cat <file>        - Display file contents',
    'python <file.py>  - Run a Python file',
    'javac <file.java> - Compile a Java file',
    'java <class>      - Run a compiled Java class',
    'clear or cls      - Clear the terminal',
    'help              - Show this help message',
    '-------------------------',
    'Press Up/Down arrows to navigate command history',
  ].join('\r\n');
  terminal.write(`\r\n${helpText}\r\n\r\n> `);
}

function formatTerminalOutput(output) {
  return output
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, '\r\n');
}

// Function to toggle theme
function toggleTheme() {
  // Get the next theme in rotation
  let themeIndex = availableThemes.indexOf(currentTheme);
  let nextThemeIndex = (themeIndex + 1) % availableThemes.length;
  let nextTheme = availableThemes[nextThemeIndex];
  
  setTheme(nextTheme);
}

function setTheme(theme) {
  fetch('/set-theme', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme })
  })
  .then(res => res.json())
  .then(data => {
    if (data.theme) {
      currentTheme = data.theme;
      
      // Apply theme to document body
      document.body.classList.remove(...availableThemes.map(t => t + '-mode'));
      document.body.classList.add(currentTheme + '-mode');
      
      // Update editor theme if CodeMirror is initialized
      if (codeEditor) {
        const editorTheme = getEditorThemeForTheme(currentTheme);
        codeEditor.setOption('theme', editorTheme);
      }
      
      // Update theme toggle icon
      updateThemeToggleIcon(isDarkTheme(currentTheme));
      
      showNotification(`Theme changed to ${currentTheme}`, 'info');
    }
  })
  .catch(err => {
    console.error('Error setting theme:', err);
    showNotification('Failed to set theme', 'error');
  });
}

function getEditorThemeForTheme(theme) {
  switch(theme) {
    case 'dark': return 'dracula';
    case 'monokai': return 'monokai';
    case 'github': return 'default';
    case 'solarized': return 'solarized';
    case 'dracula': return 'dracula';
    case 'light':
    default: return 'default';
  }
}

function isDarkTheme(theme) {
  return ['dark', 'monokai', 'dracula'].includes(theme);
}

// Function to update the toggle icon
function updateThemeToggleIcon(isDarkMode) {
  const themeToggle = document.querySelector('.theme-toggle');
  if (!themeToggle) return;
  
    const icon = themeToggle.querySelector('i');
    if (!icon) return;
  
    if (isDarkMode) {
      icon.classList.remove('bx-sun');
      icon.classList.add('bx-moon');
    } else {
      icon.classList.remove('bx-moon');
      icon.classList.add('bx-sun');
    }
  }

// Function to clear chat messages
function clearChat() {
  const outputDiv = document.getElementById("gen-output");
  if (outputDiv) {
    // Clear chat history
    outputDiv.innerHTML = '';
    
    // Reset conversation on server
    if (ws && isWsConnected) {
      try {
        ws.send(JSON.stringify({ input: '>>>' }));
      } catch (error) {
        console.error('Error resetting conversation:', error);
      }
    }
    
    // Show notification
    showNotification('Chat history cleared', 'info');
  }
}

// Add this new function to update the HTML preview
function updateHTMLPreview() {
  // Only proceed if we have a valid file path and we're in HTML mode
  if (!selectedFilePath || document.getElementById('comp-language').value !== 'html') {
    return;
  }
  
  // Save the current HTML content
  const htmlContent = codeEditor.getValue();
  
  // Save file first to ensure preview uses the latest content
  saveCurrentFile(() => {
    // After saving, update the preview
    const previewFrame = document.getElementById('comp-preview');
    if (previewFrame) {
      previewFrame.src = `/preview?path=${encodeURIComponent(selectedFilePath)}`;
      showNotification('HTML preview updated', 'info');
    }
  });
}

// Add error feedback functionality
function sendErrorToChat(errorMessage) {
  const userInput = document.getElementById("gen-userInput");
  const outputDiv = document.getElementById("gen-output");
  
  if (!errorMessage) return;
  
  // Format error message
  const formattedError = errorMessage.replace(/\n/g, '\n> ');
  
  // Create a message to send to AI
  let errorFeedbackMessage = `I got this error while running my code. Please help me fix it:\n\n\`\`\`\n${formattedError}\n\`\`\``;
  
  // For Java errors related to public class naming, add more context
  if (errorMessage.includes('class') && errorMessage.includes('public') && errorMessage.includes('should be declared in a file named')) {
    errorFeedbackMessage = `I got a Java error about class naming. Please explain how to fix this issue:\n\n\`\`\`\n${formattedError}\n\`\`\`\n\nI named my file differently than the public class name. How should I fix this?`;
  }
  
  // Make sure the code generator section is visible
  const generatorSection = document.getElementById('code-generator');
  if (generatorSection && getComputedStyle(generatorSection).display === 'none') {
    generatorSection.style.display = 'block';
  }
  
  // Add to chat as user message
  const userMessage = document.createElement("div");
  userMessage.classList.add("user-message");
  userMessage.innerText = errorFeedbackMessage;
  outputDiv.appendChild(userMessage);
  
  // Add to current chat
  if (typeof currentChat !== 'undefined' && currentChat.messages) {
    currentChat.messages.push({
      type: 'user',
      content: errorFeedbackMessage,
      timestamp: new Date()
    });
    
    // Update chat history if needed
    if (currentChat.messages.length <= 2) {
      currentChat.title = "Code Error Help";
      saveChatToHistory(currentChat);
    } else {
      saveChatHistory();
    }
  }
  
  // Clear input field
  if (userInput) {
    userInput.value = "";
  }
  
  // Scroll to the bottom
  outputDiv.scrollTop = outputDiv.scrollHeight;
  
  // Send to AI
  if (ws && isWsConnected) {
    toggleLoadingSpinner(true);
    currentBotMessage = document.createElement("div");
    currentBotMessage.classList.add("bot-message");
    outputDiv.appendChild(currentBotMessage);
    currentBotMessage.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
    currentResponse = "";
    
    ws.send(JSON.stringify({ input: errorFeedbackMessage }));
    
    // Notify user
    showNotification('Sent error to AI for help', 'info');
  } else {
    showNotification('Not connected to server. Attempting to reconnect...', 'error');
    attemptReconnect();
  }
}

// Extract detected Java errors from error messages
function detectJavaError(errorMessage) {
  if (!errorMessage) return null;
  
  // Check for common Java errors
  const javaErrors = {
    classNaming: /class\s+(\w+)\s+is\s+public,\s+should\s+be\s+declared\s+in\s+a\s+file\s+named\s+([A-Za-z0-9_]+\.java)/i,
    missingBrace: /';'\s+expected|'}'\s+expected|missing\s+(return|statement)/i,
    cannotFind: /cannot\s+find\s+symbol|symbol\s*:\s*(\w+)/i,
    incompatible: /incompatible\s+types|inconvertible\s+types/i,
    unclosed: /unclosed\s+(string|literal|character)/i
  };
  
  let detectedError = null;
  
  for (const [errorType, regex] of Object.entries(javaErrors)) {
    if (regex.test(errorMessage)) {
      detectedError = {
        type: errorType,
        message: errorMessage.split('\n')[0] // Get the first line of the error
      };
      break;
    }
  }
  
  return detectedError;
}

// Add a function to automatically check terminal output for errors and send them to the chat
function checkAndSendTerminalErrors() {
  if (lastErrorMessage && lastErrorMessage.trim()) {
    // Check for Java errors
    const javaError = detectJavaError(lastErrorMessage);
    
    // Remove any existing error elements before adding new ones
    document.querySelectorAll('.error-banner, .auto-send-error, .tip-banner').forEach(el => {
      el.remove();
    });
    
    // Create error banner
    const errorBanner = document.createElement('div');
    errorBanner.classList.add('error-banner');
    errorBanner.innerHTML = `
      <i class='bx bx-error-circle'></i>
      <div class="error-banner-message">Error detected in your code!</div>
    `;
    
    // Create auto-send container
    const autoSendContainer = document.createElement('div');
    autoSendContainer.classList.add('auto-send-error');
    
    // Create send button
    const sendButton = document.createElement('button');
    sendButton.innerHTML = '<i class="bx bx-bot"></i> Send Error to AI Chat';
    sendButton.onclick = function() {
      handleErrorHelp();
    };
    
    autoSendContainer.appendChild(sendButton);
    
    // For common Java errors, add auto-send option
    if (javaError) {
      const autoButton = document.createElement('button');
      autoButton.innerHTML = '<i class="bx bx-share"></i> Auto-Fix Java Error';
      autoButton.classList.add('auto-fix');
      autoButton.onclick = function() {
        // Auto send to the chatbot
        handleErrorHelp();
        
        // Show suggestion for class naming errors
        if (javaError.type === 'classNaming') {
          const match = lastErrorMessage.match(/should be declared in a file named ([A-Za-z0-9_]+\.java)/);
          if (match && match[1]) {
            const expectedFileName = match[1];
            showNotification(`Tip: Rename your file to ${expectedFileName} or change your class from public to non-public`, 'info');
          }
        }
      };
      
      autoSendContainer.appendChild(autoButton);
    }
    
    // Add to terminal window - this is the critical fix
    const terminalWindow = document.getElementById('comp-terminal');
    if (terminalWindow) {
      const terminalContainer = terminalWindow.parentNode;
      terminalContainer.appendChild(errorBanner);
      terminalContainer.appendChild(autoSendContainer);
      
      // Show notification to alert user
      showNotification('Error detected! Click the button to send to AI for help.', 'warning');
      
      // For class naming errors in Java, automatically show a useful message
      if (javaError && javaError.type === 'classNaming') {
        const match = lastErrorMessage.match(/should be declared in a file named ([A-Za-z0-9_]+\.java)/);
        if (match && match[1]) {
          const expectedFileName = match[1];
          const tipBanner = document.createElement('div');
          tipBanner.classList.add('tip-banner');
          tipBanner.innerHTML = `
            <i class='bx bx-bulb'></i>
            <div class="tip-message">You named your file differently than your public class. Either rename your file to <strong>${expectedFileName}</strong> or remove the 'public' keyword from your class.</div>
          `;
          terminalContainer.appendChild(tipBanner);
        }
      }
      
      // Scroll to make sure error UI is visible
      terminalContainer.scrollTop = terminalContainer.scrollHeight;
    } else {
      console.error('Terminal element not found');
    }
  }
}

// Add a new function to clear error elements
function clearErrorElements() {
  // Remove any existing error UI elements
  document.querySelectorAll('.error-banner, .auto-send-error, .tip-banner').forEach(el => {
    el.remove();
  });
  
  // Reset the global error message
  lastErrorMessage = '';
}

// Add a function to format code
function formatCode() {
  if (!codeEditor) return;
  
  const lang = document.getElementById('comp-language').value;
  const code = codeEditor.getValue();
  
  if (!code.trim()) {
    showNotification('No code to format', 'warning');
    return;
  }
  
  toggleLoadingSpinner(true);
  
  fetch('/format-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      language: lang
    })
  })
  .then(res => {
    if (!res.ok) {
      throw new Error(`Server responded with status: ${res.status}`);
    }
    return res.json();
  })
  .then(data => {
    if (data.formattedCode) {
      // Save cursor position
      const cursor = codeEditor.getCursor();
      
      // Update code
      codeEditor.setValue(data.formattedCode);
      
      // Try to restore cursor position
      codeEditor.setCursor(cursor);
      
      showNotification('Code formatted successfully', 'success');
    }
  })
  .catch(err => {
    console.error('Error formatting code:', err);
    showNotification(`Failed to format code: ${err.message}`, 'error');
  })
  .finally(() => {
    toggleLoadingSpinner(false);
  });
}

// Add a function to lint code
function lintCode() {
  if (!codeEditor) return;
  
  const lang = document.getElementById('comp-language').value;
  const code = codeEditor.getValue();
  
  if (!code.trim()) {
    showNotification('No code to lint', 'warning');
    return;
  }
  
  if (lang !== 'javascript' && lang !== 'python') {
    showNotification(`Linting not supported for ${lang}`, 'warning');
    return;
  }
  
  toggleLoadingSpinner(true);
  
  fetch('/lint-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      language: lang
    })
  })
  .then(res => {
    if (!res.ok) {
      throw new Error(`Server responded with status: ${res.status}`);
    }
    return res.json();
  })
  .then(data => {
    if (data.lintResults) {
      // Clear existing marks
      codeEditor.getAllMarks().forEach(mark => mark.clear());
      
      // Add new marks
      data.lintResults.forEach(result => {
        const line = result.line - 1;
        const startCol = result.column - 1;
        const endCol = startCol + 1;
        
        const marker = document.createElement('div');
        marker.className = `lint-marker lint-${result.severity}`;
        marker.title = `${result.severity}: ${result.message} (${result.ruleId})`;
        
        codeEditor.markText(
          {line, ch: startCol},
          {line, ch: endCol},
          {
            className: `lint-highlight lint-${result.severity}`,
            title: marker.title
          }
        );
      });
      
      const errorCount = data.lintResults.filter(r => r.severity === 'error').length;
      const warningCount = data.lintResults.filter(r => r.severity === 'warning').length;
      
      showNotification(`Linting completed: ${errorCount} errors, ${warningCount} warnings`, 
                      errorCount > 0 ? 'error' : warningCount > 0 ? 'warning' : 'success');
    }
  })
  .catch(err => {
    console.error('Error linting code:', err);
    showNotification(`Failed to lint code: ${err.message}`, 'error');
  })
  .finally(() => {
    toggleLoadingSpinner(false);
  });
}

// Add buttons to the editor UI
function setupCodeQualityButtons() {
  const editorActions = document.querySelector('.editor-actions');
  if (!editorActions) return;
  
  // Format button
  const formatBtn = document.createElement('button');
  formatBtn.className = 'editor-btn';
  formatBtn.title = 'Format code';
  formatBtn.innerHTML = '<i class="bx bx-code-block"></i>';
  formatBtn.addEventListener('click', formatCode);
  
  // Lint button
  const lintBtn = document.createElement('button');
  lintBtn.className = 'editor-btn';
  lintBtn.title = 'Lint code';
  lintBtn.innerHTML = '<i class="bx bx-check-double"></i>';
  lintBtn.addEventListener('click', lintCode);
  
  editorActions.appendChild(formatBtn);
  editorActions.appendChild(lintBtn);
}

// Add Git functions

// Initialize a git repository
function gitInit() {
  toggleLoadingSpinner(true);
  
  fetch('/git/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  })
  .then(res => {
    if (!res.ok) {
      throw new Error(`Server responded with status: ${res.status}`);
    }
    return res.json();
  })
  .then(data => {
    showNotification(data.message || 'Git repository initialized', 'success');
    gitStatus(); // Update status after init
  })
  .catch(err => {
    console.error('Git init error:', err);
    showNotification(`Failed to initialize Git repository: ${err.message}`, 'error');
  })
  .finally(() => {
    toggleLoadingSpinner(false);
  });
}

// Get Git status
function gitStatus() {
  toggleLoadingSpinner(true);
  
  fetch('/git/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  })
  .then(res => {
    if (!res.ok) {
      throw new Error(`Server responded with status: ${res.status}`);
    }
    return res.json();
  })
  .then(data => {
    // Display Git status in the interface
    displayGitStatus(data);
  })
  .catch(err => {
    console.error('Git status error:', err);
    if (err.message.includes('404')) {
      showNotification('Not a git repository. Initialize first.', 'warning');
    } else {
      showNotification(`Failed to get Git status: ${err.message}`, 'error');
    }
  })
  .finally(() => {
    toggleLoadingSpinner(false);
  });
}

// Stage files
function gitAdd(files) {
  toggleLoadingSpinner(true);
  
  fetch('/git/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: files || [] }) // Empty array means add all
  })
  .then(res => {
    if (!res.ok) {
      throw new Error(`Server responded with status: ${res.status}`);
    }
    return res.json();
  })
  .then(data => {
    showNotification(data.message || 'Files added to staging area', 'success');
    gitStatus(); // Refresh status
  })
  .catch(err => {
    console.error('Git add error:', err);
    showNotification(`Failed to add files: ${err.message}`, 'error');
  })
  .finally(() => {
    toggleLoadingSpinner(false);
  });
}

// Commit changes
function gitCommit(message) {
  if (!message) {
    message = prompt('Enter commit message:');
    if (!message) return; // User cancelled
  }
  
  toggleLoadingSpinner(true);
  
  fetch('/git/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message })
  })
  .then(res => {
    if (!res.ok) {
      throw new Error(`Server responded with status: ${res.status}`);
    }
    return res.json();
  })
  .then(data => {
    showNotification(data.message || 'Changes committed successfully', 'success');
    gitStatus(); // Refresh status
  })
  .catch(err => {
    console.error('Git commit error:', err);
    showNotification(`Failed to commit changes: ${err.message}`, 'error');
  })
  .finally(() => {
    toggleLoadingSpinner(false);
  });
}

// View commit history
function gitLog() {
  toggleLoadingSpinner(true);
  
  fetch('/git/log')
    .then(res => {
      if (!res.ok) {
        throw new Error(`Server responded with status: ${res.status}`);
      }
      return res.json();
    })
    .then(data => {
      // Display commit log in the interface
      displayGitLog(data);
    })
    .catch(err => {
      console.error('Git log error:', err);
      showNotification(`Failed to get commit history: ${err.message}`, 'error');
    })
    .finally(() => {
      toggleLoadingSpinner(false);
    });
}

// Helper function to display Git status
function displayGitStatus(status) {
  // Create or get status display area
  let gitStatusArea = document.getElementById('git-status-area');
  
  if (!gitStatusArea) {
    // Create a new status area if it doesn't exist
    gitStatusArea = document.createElement('div');
    gitStatusArea.id = 'git-status-area';
    gitStatusArea.className = 'git-panel';
    
    // Find a good place to add it in the UI
    const editorContainer = document.querySelector('.editor-container');
    if (editorContainer) {
      editorContainer.after(gitStatusArea);
    }
  }
  
  // Display current branch and changes
  let html = `<div class="git-header">
                <h3>Git Status</h3>
                <div class="git-actions">
                  <button id="git-refresh-btn"><i class="bx bx-refresh"></i></button>
                  <button id="git-close-btn"><i class="bx bx-x"></i></button>
                </div>
              </div>
              <div class="git-content">
                <p>Current branch: <strong>${status.current || 'master'}</strong></p>`;
  
  // Show staged files
  if (status.staged && status.staged.length > 0) {
    html += `<h4>Staged Changes</h4>
             <ul class="git-file-list staged-files">`;
    status.staged.forEach(file => {
      html += `<li>${file}</li>`;
    });
    html += `</ul>`;
  }
  
  // Show unstaged changes
  const unstaged = [
    ...(status.modified || []),
    ...(status.not_added || []),
    ...(status.deleted || [])
  ];
  
  if (unstaged.length > 0) {
    html += `<h4>Unstaged Changes</h4>
             <ul class="git-file-list unstaged-files">`;
    unstaged.forEach(file => {
      html += `<li>${file}</li>`;
    });
    html += `</ul>`;
  }
  
  // Show action buttons
  html += `<div class="git-actions-group">
            <button id="git-add-all-btn">Stage All</button>
            <button id="git-commit-btn">Commit</button>
            <button id="git-log-btn">View History</button>
          </div>`;
  
  html += `</div>`;
  
  gitStatusArea.innerHTML = html;
  
  // Add event listeners to the buttons
  document.getElementById('git-refresh-btn').addEventListener('click', gitStatus);
  document.getElementById('git-close-btn').addEventListener('click', () => {
    gitStatusArea.style.display = 'none';
  });
  document.getElementById('git-add-all-btn').addEventListener('click', () => gitAdd());
  document.getElementById('git-commit-btn').addEventListener('click', () => gitCommit());
  document.getElementById('git-log-btn').addEventListener('click', gitLog);
  
  // Show the panel
  gitStatusArea.style.display = 'block';
}

// Helper function to display Git log
function displayGitLog(logData) {
  // Create or get log display area
  let gitLogArea = document.getElementById('git-log-area');
  
  if (!gitLogArea) {
    // Create a new log area if it doesn't exist
    gitLogArea = document.createElement('div');
    gitLogArea.id = 'git-log-area';
    gitLogArea.className = 'git-panel';
    
    // Find a good place to add it in the UI
    const editorContainer = document.querySelector('.editor-container');
    if (editorContainer) {
      editorContainer.after(gitLogArea);
    }
  }
  
  // Display commit history
  let html = `<div class="git-header">
                <h3>Commit History</h3>
                <div class="git-actions">
                  <button id="git-log-close-btn"><i class="bx bx-x"></i></button>
                </div>
              </div>
              <div class="git-content">`;
  
  if (logData.all && logData.all.length > 0) {
    html += `<ul class="git-commit-list">`;
    logData.all.forEach(commit => {
      const date = new Date(commit.date).toLocaleString();
      html += `<li class="git-commit-item">
                <div class="commit-hash">${commit.hash.substring(0, 7)}</div>
                <div class="commit-info">
                  <div class="commit-message">${commit.message}</div>
                  <div class="commit-details">
                    <span class="commit-author">${commit.author_name}</span>
                    <span class="commit-date">${date}</span>
                  </div>
                </div>
              </li>`;
    });
    html += `</ul>`;
  } else {
    html += `<p>No commits yet.</p>`;
  }
  
  html += `</div>`;
  
  gitLogArea.innerHTML = html;
  
  // Add event listener to the close button
  document.getElementById('git-log-close-btn').addEventListener('click', () => {
    gitLogArea.style.display = 'none';
  });
  
  // Show the panel
  gitLogArea.style.display = 'block';
}

// Add Git panel toggle button to controls
function setupGitControls() {
  const controlGroup = document.querySelector('.controls .control-group:last-child');
  if (!controlGroup) return;
  
  const gitBtn = document.createElement('button');
  gitBtn.id = 'git-btn';
  gitBtn.className = 'control-btn';
  gitBtn.innerHTML = '<i class="bx bx-git-branch"></i> Git';
  gitBtn.addEventListener('click', () => {
    // Check if repository exists
    fetch('/git/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })
    .then(res => {
      if (res.ok) {
        // Repository exists, show status
        return res.json().then(data => {
          displayGitStatus(data);
        });
      } else {
        // Repository doesn't exist, ask to initialize
        if (confirm('Git repository not found. Initialize a new repository?')) {
          gitInit();
        }
      }
    })
    .catch(err => {
      console.error('Git check error:', err);
      if (confirm('Error checking Git status. Initialize a new repository?')) {
        gitInit();
      }
    });
  });
  
  controlGroup.appendChild(gitBtn);
}

// Add code snippets functionality
function loadSnippets(language) {
  if (!language) {
    language = document.getElementById('comp-language').value;
  }
  
  fetch(`/snippets?language=${language}`)
    .then(res => {
      if (!res.ok) {
        throw new Error(`Server responded with status: ${res.status}`);
      }
      return res.json();
    })
    .then(data => {
      if (data.snippets) {
        displaySnippets(data.snippets);
      }
    })
    .catch(err => {
      console.error('Error loading snippets:', err);
      showNotification(`Failed to load snippets: ${err.message}`, 'error');
    });
}

function displaySnippets(snippets) {
  // Create or get snippets panel
  let snippetsPanel = document.getElementById('snippets-panel');
  
  if (!snippetsPanel) {
    // Create new panel
    snippetsPanel = document.createElement('div');
    snippetsPanel.id = 'snippets-panel';
    snippetsPanel.className = 'side-panel';
    
    // Find a good place in the UI to add it
    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
      mainContent.appendChild(snippetsPanel);
    }
  }
  
  // Generate HTML
  let html = `<div class="panel-header">
                <h3>Code Snippets</h3>
                <button id="close-snippets-btn"><i class="bx bx-x"></i></button>
              </div>
              <div class="panel-content">`;
  
  if (snippets.length > 0) {
    html += `<ul class="snippets-list">`;
    snippets.forEach(snippet => {
      html += `<li class="snippet-item" data-code="${encodeURIComponent(snippet.code)}">
                <div class="snippet-header">
                  <h4>${snippet.name}</h4>
                </div>
                <p class="snippet-description">${snippet.description}</p>
              </li>`;
    });
    html += `</ul>`;
  } else {
    html += `<p>No snippets available for this language.</p>`;
  }
  
  html += `</div>`;
  
  snippetsPanel.innerHTML = html;
  
  // Add event listeners
  document.getElementById('close-snippets-btn').addEventListener('click', () => {
    snippetsPanel.style.display = 'none';
  });
  
  // Add click event for each snippet to insert code
  document.querySelectorAll('.snippet-item').forEach(item => {
    item.addEventListener('click', () => {
      const code = decodeURIComponent(item.dataset.code);
      if (codeEditor) {
        // Insert at cursor position
        const cursor = codeEditor.getCursor();
        codeEditor.replaceRange(code, cursor);
        // Focus back on editor
        codeEditor.focus();
      }
    });
  });
  
  // Show the panel
  snippetsPanel.style.display = 'block';
}

// Add a function to handle autocomplete
function setupAutocomplete() {
  // Only proceed if CodeMirror is initialized
  if (!codeEditor) return;
  
  // Custom hint function that calls our backend
  CodeMirror.registerHelper('hint', 'custom', function(editor) {
    const cursor = editor.getCursor();
    const token = editor.getTokenAt(cursor);
    const start = token.start;
    const end = cursor.ch;
    const line = cursor.line;
    
    // Get current language
    const language = document.getElementById('comp-language').value;
    
    // Get the code up to the cursor
    const code = editor.getValue();
    const position = editor.indexFromPos(cursor);
    
    return new Promise((resolve) => {
      // Call our server API for completions
      fetch('/autocomplete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          language,
          position
        })
      })
      .then(res => res.json())
      .then(data => {
        const suggestions = data.suggestions || [];
        
        if (suggestions.length > 0) {
          resolve({
            list: suggestions.map(suggestion => ({
              text: suggestion.text,
              displayText: suggestion.displayText || suggestion.text,
              hint: (cm, data, completion) => {
                cm.replaceRange(completion.text, {line, ch: start}, {line, ch: end});
              }
            })),
            from: CodeMirror.Pos(line, start),
            to: CodeMirror.Pos(line, end)
          });
        } else {
          resolve(null);
        }
      })
      .catch(err => {
        console.error('Autocomplete error:', err);
        resolve(null);
      });
    });
  });
  
  // Add key binding for autocomplete
  codeEditor.setOption('extraKeys', {
    'Ctrl-Space': function(cm) {
      cm.showHint({ hint: CodeMirror.hint.custom, completeSingle: false });
    }
  });
}

// Add snippets button
function setupSnippetsButton() {
  const controlGroup = document.querySelector('.controls .control-group:last-child');
  if (!controlGroup) return;
  
  const snippetsBtn = document.createElement('button');
  snippetsBtn.id = 'snippets-btn';
  snippetsBtn.className = 'control-btn';
  snippetsBtn.innerHTML = '<i class="bx bx-code-alt"></i> Snippets';
  snippetsBtn.addEventListener('click', () => {
    const language = document.getElementById('comp-language').value;
    loadSnippets(language);
  });
  
  controlGroup.appendChild(snippetsBtn);
}
