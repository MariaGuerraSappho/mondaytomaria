// App Version for tracking
const APP_VERSION = "1.4.0";

const { useState, useEffect, useRef, useMemo } = React;
const { createRoot } = ReactDOM;

// Initialize WebsimSocket with error handling
let room;
try {
  room = new WebsimSocket();
  console.log("WebsimSocket initialized successfully");
} catch (err) {
  console.error("Error initializing WebsimSocket:", err);
  // We have a fallback implementation in the HTML
  room = new WebsimSocket();
}

// Enhanced error handling and reporting
const logError = (context, error) => {
  const errorMessage = error?.message || String(error) || "Unknown error";
  console.error(`[${APP_VERSION}] ${context}:`, error);
  return errorMessage;
};

// Utility function to safely perform room operations with retry and improved error handling
const safeRoomOperation = async (operation, maxRetries = 5) => {
  let retries = 0;
  let lastError = null;
  
  while (retries < maxRetries) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      const errorMsg = logError(`Operation failed (attempt ${retries + 1})`, err);
      
      // Special handling for timeout errors
      const isTimeout = errorMsg.includes('timeout') || errorMsg.includes('Timeout');
      
      retries++;
      if (retries >= maxRetries) {
        console.warn(`[${APP_VERSION}] All retries failed for operation`);
        throw err;
      }
      
      // Exponential backoff with jitter
      const baseDelay = isTimeout ? 800 : 500;
      const jitter = Math.random() * 300;
      const delay = (baseDelay * retries) + jitter;
      
      console.log(`[${APP_VERSION}] Retrying in ${Math.round(delay)}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
};

// Main App Component
function App() {
  const [view, setView] = useState('home');
  const [pin, setPin] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [sessionData, setSessionData] = useState(null);
  const [initError, setInitError] = useState(null);
  const [appVersion] = useState(APP_VERSION);

  // Handle initialization errors
  useEffect(() => {
    // Hide loading indicator once React is mounted
    const loadingElement = document.getElementById('loading');
    if (loadingElement) {
      loadingElement.style.display = 'none';
    }
    
    if (!room) {
      setInitError("Could not initialize real-time connection. Please refresh the page.");
    }
    
    console.log(`[${APP_VERSION}] App initialized`);
  }, [appVersion]);

  // Check URL params to see if we should join a session directly
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const pinParam = params.get('pin');
      if (pinParam) {
        setPin(pinParam);
        // Store the PIN in localStorage for persistence
        localStorage.setItem('lastPin', pinParam);
        setView('join');
      } else {
        // Check if we have a PIN stored
        const storedPin = localStorage.getItem('lastPin');
        if (storedPin) {
          setPin(storedPin);
        }

        // Check if we have a stored name
        const storedName = localStorage.getItem('playerName');
        if (storedName) {
          setPlayerName(storedName);
        }
      }
    } catch (error) {
      logError("Error processing URL parameters", error);
    }
  }, []);

  if (initError) {
    return (
      <div className="container">
        <div className="card">
          <h2 className="header">Error</h2>
          <p>{initError}</p>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload Page
          </button>
        </div>
        <div className="version-tag">v{appVersion}</div>
      </div>
    );
  }

  const renderView = () => {
    switch (view) {
      case 'home':
        return <HomeView setView={setView} />;
      case 'conductor':
        return <ConductorView setView={setView} sessionData={sessionData} setSessionData={setSessionData} />;
      case 'join':
        return <JoinView pin={pin} setPin={setPin} playerName={playerName} setPlayerName={setPlayerName} setView={setView} />;
      case 'player':
        return <PlayerView pin={pin} playerName={playerName} setView={setView} />;
      default:
        return <HomeView setView={setView} />;
    }
  };

  return (
    <div className="container">
      {renderView()}
      <div className="version-tag">v{appVersion}</div>
    </div>
  );
}

// Home View
function HomeView({ setView }) {
  return (
    <div className="flex flex-col items-center gap-4">
      <h1 className="header">Improv Card Distributor</h1>
      <div className="version-display">Version {APP_VERSION}</div>
      <div className="card">
        <button className="btn btn-primary mb-4" onClick={() => setView('conductor')}>
          I'm the Conductor
        </button>
        <button className="btn" onClick={() => setView('join')}>
          I'm a Player
        </button>
      </div>
    </div>
  );
}

// Join View
function JoinView({ pin, setPin, playerName, setPlayerName, setView }) {
  const [error, setError] = useState('');
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Subscribe to sessions
    try {
      return room.collection('session').subscribe(sessionsList => {
        setSessions(sessionsList);
      });
    } catch (err) {
      const errorMsg = logError("Error subscribing to sessions", err);
      setError("Could not connect to session data. Please refresh and try again.");
    }
  }, []);

  const handleJoin = async () => {
    if (!pin || !playerName) {
      setError('Please enter both PIN and name');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Store player name for convenience
      localStorage.setItem('playerName', playerName);
      localStorage.setItem('lastPin', pin);
      
      // Check if session exists
      const sessions = await safeRoomOperation(() => 
        room.collection('session').filter({ pin }).getList()
      );
      
      if (!sessions || sessions.length === 0) {
        setError('Invalid PIN');
        setLoading(false);
        return;
      }

      // Check if player limit reached
      const players = await safeRoomOperation(() => 
        room.collection('player').filter({ session_pin: pin }).getList()
      );
      
      if (players.length >= 10) {
        setError('Session is full (max 10 players)');
        setLoading(false);
        return;
      }

      // Check if player already exists with this name
      const existingPlayer = players.find(p => p.name === playerName && p.session_pin === pin);
      if (!existingPlayer) {
        // Join session - create new player
        try {
          await safeRoomOperation(() => 
            room.collection('player').create({
              session_pin: pin,
              name: playerName,
              current_card: null,
              expires_at: null,
            })
          );
        } catch (playerErr) {
          logError('Failed to create player', playerErr);
          // We'll proceed to player view anyway and retry there
        }
      }

      setLoading(false);
      setView('player');
    } catch (err) {
      const errorMsg = logError('Failed to join session', err);
      setError(`Failed to join session: ${errorMsg}`);
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <h1 className="header">Join Session</h1>
      <div className="card">
        <input
          type="text"
          className="input"
          placeholder="4-digit PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          maxLength={4}
        />
        <input
          type="text"
          className="input"
          placeholder="Your Name"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
        />
        {error && <p style={{ color: 'red', marginBottom: '10px' }}>{error}</p>}
        <button 
          className={`btn btn-primary ${loading ? 'btn-disabled' : ''}`} 
          onClick={handleJoin}
          disabled={loading}
        >
          {loading ? 'Joining...' : 'Join Session'}
        </button>
        <button className="btn" onClick={() => setView('home')} style={{ marginTop: '10px' }}>
          Back
        </button>
      </div>
    </div>
  );
}

// Conductor View
function ConductorView({ setView, sessionData, setSessionData }) {
  const [decks, setDecks] = useState([]);
  const [currentDeck, setCurrentDeck] = useState(null);
  const [mode, setMode] = useState('unison'); // unison, unique, random
  const [minTime, setMinTime] = useState(20);
  const [maxTime, setMaxTime] = useState(60);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [pin, setPin] = useState('');
  const [players, setPlayers] = useState([]);
  const [fileInput, setFileInput] = useState('');
  const [textInput, setTextInput] = useState('');
  const [deckName, setDeckName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deckCreationStatus, setDeckCreationStatus] = useState('');
  const [lastDeckRefresh, setLastDeckRefresh] = useState(0);
  const [debugInfo, setDebugInfo] = useState({ lastAction: '', decksCount: 0 });

  // Generate PIN and create session on component mount
  useEffect(() => {
    if (!sessionData) {
      const generatedPin = Math.floor(1000 + Math.random() * 9000).toString();
      setPin(generatedPin);

      const createSession = async () => {
        try {
          const newSession = await safeRoomOperation(() =>
            room.collection('session').create({
              pin: generatedPin,
              mode: mode,
              min_time: minTime,
              max_time: maxTime,
              is_playing: false,
              is_ending: false,
            })
          );
          setSessionData(newSession);
          console.log(`[${APP_VERSION}] Created session with PIN:`, generatedPin);
        } catch (err) {
          const errorMsg = logError('Failed to create session', err);
          setError('Failed to create session. Please try again.');
        }
      };

      createSession();
    } else {
      // If we already have session data, use it
      setPin(sessionData.pin);
      setMode(sessionData.mode);
      setMinTime(sessionData.min_time);
      setMaxTime(sessionData.max_time);
      setIsPlaying(sessionData.is_playing);
      setIsEnding(sessionData.is_ending);
    }
  }, [sessionData]);

  // Create shareable link when PIN is set
  useEffect(() => {
    if (pin) {
      const shareableUrl = `${window.baseUrl || window.location.origin + window.location.pathname}?pin=${pin}`;
      console.log(`[${APP_VERSION}] Shareable link:`, shareableUrl);
    }
  }, [pin]);

  // Subscribe to players in this session - FIXED: improved reliability
  useEffect(() => {
    if (pin) {
      const subscribeToPlayers = () => {
        try {
          return room.collection('player')
            .filter({ session_pin: pin })
            .subscribe(playersList => {
              console.log(`[${APP_VERSION}] Players updated:`, playersList?.length || 0);
              setPlayers(playersList || []);
            });
        } catch (err) {
          logError("Error subscribing to players", err);
          // Retry subscription after a delay
          setTimeout(subscribeToPlayers, 3000);
          return () => {}; // Return empty unsubscribe function
        }
      };
      
      return subscribeToPlayers();
    }
  }, [pin]);

  // Force update player list periodically to ensure it's current
  useEffect(() => {
    if (pin) {
      const interval = setInterval(async () => {
        try {
          const latestPlayers = await room.collection('player')
            .filter({ session_pin: pin })
            .getList();
          
          if (latestPlayers && latestPlayers.length > 0) {
            setPlayers(latestPlayers);
          }
        } catch (err) {
          logError("Failed to refresh player list", err);
        }
      }, 10000); // Refresh every 10 seconds
      
      return () => clearInterval(interval);
    }
  }, [pin]);

  // FIXED: Improved deck subscription with recovery and debugging
  useEffect(() => {
    if (pin) {
      let isSubscribed = false;
      
      const refreshDecks = async () => {
        try {
          setDebugInfo(prev => ({ ...prev, lastAction: 'Manual refresh of decks' }));
          const decksList = await room.collection('deck')
            .filter({ session_pin: pin })
            .getList();
          
          if (decksList) {
            console.log(`[${APP_VERSION}] Manually refreshed decks: ${decksList.length}`);
            setDecks(decksList);
            setDebugInfo(prev => ({ ...prev, decksCount: decksList.length }));
            
            if (decksList.length > 0 && !currentDeck) {
              setCurrentDeck(decksList[0].id);
            }
          }
          
          setLastDeckRefresh(Date.now());
        } catch (err) {
          logError("Error refreshing decks", err);
        }
      };
      
      const setupSubscription = () => {
        if (isSubscribed) return; // Prevent multiple subscriptions
        
        try {
          setDebugInfo(prev => ({ ...prev, lastAction: 'Setting up deck subscription' }));
          
          const unsubscribe = room.collection('deck')
            .filter({ session_pin: pin })
            .subscribe(decksList => {
              console.log(`[${APP_VERSION}] Decks subscription update:`, decksList?.length || 0);
              
              if (decksList) {
                setDecks(decksList);
                setDebugInfo(prev => ({ ...prev, decksCount: decksList.length }));
                
                if (decksList.length > 0 && !currentDeck) {
                  setCurrentDeck(decksList[0].id);
                }
              }
            });
          
          isSubscribed = true;
          return unsubscribe;
        } catch (err) {
          logError("Error subscribing to decks", err);
          isSubscribed = false;
          
          // Retry subscription after a delay
          setTimeout(setupSubscription, 3000);
          return () => {}; // Return empty unsubscribe function
        }
      };
      
      // Initial subscription setup
      const unsubscribe = setupSubscription();
      
      // Periodic refresh as a fallback
      const refreshInterval = setInterval(refreshDecks, 30000); // Every 30 seconds
      
      // Force a refresh 2 seconds after mounting to ensure we have data
      setTimeout(refreshDecks, 2000);
      
      return () => {
        if (typeof unsubscribe === 'function') {
          unsubscribe();
        }
        clearInterval(refreshInterval);
      };
    }
  }, [pin]);

  // Update session when parameters change
  useEffect(() => {
    const updateSession = async () => {
      if (sessionData && sessionData.id && pin) {
        try {
          await safeRoomOperation(() =>
            room.collection('session').update(sessionData.id, {
              mode,
              min_time: minTime,
              max_time: maxTime,
              is_playing: isPlaying,
              is_ending: isEnding,
            })
          );
        } catch (err) {
          logError('Failed to update session', err);
        }
      }
    };

    updateSession();
  }, [mode, minTime, maxTime, isPlaying, isEnding, sessionData]);

  // Timer to check and update player cards
  useEffect(() => {
    if (isPlaying && decks.length > 0) {
      const interval = setInterval(() => {
        const now = new Date().getTime();

        players.forEach(async player => {
          if (player.expires_at && new Date(player.expires_at).getTime() <= now) {
            // Card expired, assign a new card
            assignNewCard(player);
          } else if (!player.current_card) {
            // Player doesn't have a card yet, assign one
            assignNewCard(player);
          }
        });
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [isPlaying, players, decks, mode, currentDeck, minTime, maxTime, isEnding]);

  const assignNewCard = async (player) => {
    if (isEnding) {
      // If ending, don't assign new cards
      try {
        await safeRoomOperation(() =>
          room.collection('player').update(player.id, {
            current_card: 'END',
            expires_at: null,
          })
        );
      } catch (err) {
        logError('Failed to update player', err);
      }
      return;
    }

    if (decks.length === 0) {
      console.error('No decks available');
      return;
    }

    let card = null;
    let selectedDeck = null;

    // Select deck based on mode
    if (mode === 'unison' || mode === 'unique') {
      // For unison and unique, use the current deck
      selectedDeck = decks.find(d => d.id === currentDeck);
      if (!selectedDeck && decks.length > 0) {
        selectedDeck = decks[0];
        setCurrentDeck(decks[0].id);
      }
    } else if (mode === 'random') {
      // For random, select a random deck
      selectedDeck = decks[Math.floor(Math.random() * decks.length)];
    }

    if (!selectedDeck || !selectedDeck.cards || selectedDeck.cards.length === 0) {
      console.error('Selected deck has no cards');
      return; // No cards available
    }

    // Select card based on mode
    if (mode === 'unison') {
      // Same card for everyone
      // Find a card that's already assigned to someone else, or pick a new one
      const assignedPlayer = players.find(p => p.current_card && p.current_card !== 'END' && p.id !== player.id);
      if (assignedPlayer) {
        card = assignedPlayer.current_card;
      } else {
        // No one has a card yet, pick a random one
        card = selectedDeck.cards[Math.floor(Math.random() * selectedDeck.cards.length)];
      }
    } else {
      // For unique and random, pick a random card from the selected deck
      // Try to avoid giving the same card to multiple players
      const assignedCards = players
        .filter(p => p.current_card && p.current_card !== 'END')
        .map(p => p.current_card);

      const availableCards = selectedDeck.cards.filter(c => !assignedCards.includes(c));

      if (availableCards.length > 0) {
        card = availableCards[Math.floor(Math.random() * availableCards.length)];
      } else {
        // All cards are assigned, pick any random card
        card = selectedDeck.cards[Math.floor(Math.random() * selectedDeck.cards.length)];
      }
    }

    // Calculate random duration between min and max time
    const durationMs = (Math.floor(Math.random() * (maxTime - minTime + 1)) + minTime) * 1000;
    const expiresAt = new Date(Date.now() + durationMs).toISOString();

    // Update player
    try {
      await safeRoomOperation(() =>
        room.collection('player').update(player.id, {
          current_card: card,
          expires_at: expiresAt,
        })
      );
    } catch (err) {
      logError('Failed to update player', err);
    }
  };

  const handlePlay = () => {
    if (decks.length === 0) {
      alert('Please upload at least one deck before starting');
      return;
    }
    setIsPlaying(true);
    setIsEnding(false);
  };

  const handleEnd = () => {
    setIsEnding(true);
  };

  const handleStop = () => {
    setIsPlaying(false);
    setIsEnding(false);

    // Reset all players' cards
    players.forEach(async player => {
      try {
        await safeRoomOperation(() =>
          room.collection('player').update(player.id, {
            current_card: null,
            expires_at: null,
          })
        );
      } catch (err) {
        logError('Failed to update player', err);
      }
    });
  };

  // FIXED: Further improved file upload for better compatibility and smaller payloads
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setUploadProgress(0);
    setDeckCreationStatus('');
    setDebugInfo(prev => ({ ...prev, lastAction: 'Starting file upload' }));

    // Add a size limit to prevent timeouts
    const MAX_FILE_SIZE = 250 * 1024; // Reduced to 250KB for better server compatibility
    if (file.size > MAX_FILE_SIZE) {
      alert('File is too large (max 250KB). Please split into smaller files.');
      setLoading(false);
      setFileInput('');
      return;
    }

    // Use smaller file reader chunks for better reliability
    const CHUNK_SIZE = 32 * 1024; // Reduced to 32KB chunks for better server compatibility
    let offset = 0;
    const fileSize = file.size;
    let fileContent = '';
    
    const readNextChunk = () => {
      const reader = new FileReader();
      const blob = file.slice(offset, Math.min(offset + CHUNK_SIZE, fileSize));
      
      reader.onload = (e) => {
        fileContent += e.target.result;
        offset += CHUNK_SIZE;
        
        // Update progress
        const progress = Math.min(100, Math.round((offset / fileSize) * 100));
        setUploadProgress(progress);
        setDeckCreationStatus(`Reading file: ${progress}%`);
        
        if (offset < fileSize) {
          // Read next chunk
          readNextChunk();
        } else {
          // File completely read
          processFileContent(fileContent);
        }
      };
      
      reader.onerror = function(err) {
        const errorMsg = logError('Error reading file chunk', err);
        setError('Error reading file: ' + errorMsg);
        setLoading(false);
        setUploadProgress(0);
      };
      
      reader.readAsText(blob);
    };
    
    const processFileContent = async (content) => {
      try {
        setDebugInfo(prev => ({ ...prev, lastAction: 'Parsing JSON content' }));
        setDeckCreationStatus('Parsing JSON...');
        // Use try-catch for JSON parsing to avoid crashing
        let data;
        try {
          data = JSON.parse(content);
        } catch (jsonErr) {
          throw new Error('Failed to parse JSON: ' + jsonErr.message);
        }
        
        // Function to process decks with increased reliability
        const processDecksWithDelay = async (items) => {
          const totalItems = items.length;
          const results = [];
          
          // Process 1 deck at a time with longer delays for server compatibility
          for (let i = 0; i < items.length; i++) {
            // Update progress
            const progress = Math.floor((i / totalItems) * 100);
            setUploadProgress(progress);
            setDeckCreationStatus(`Processing deck ${i+1}/${totalItems} (${progress}%)`);
            setDebugInfo(prev => ({ ...prev, lastAction: `Processing deck ${i+1}/${totalItems}` }));
            
            try {
              // Process one deck at a time
              const deck = items[i];
              if (deck.name && Array.isArray(deck.cards)) {
                const result = await createDeck(deck.name, deck.cards);
                if (result) {
                  results.push(result);
                  
                  // Force a refresh of decks after each successful creation
                  try {
                    const refreshedDecks = await room.collection('deck')
                      .filter({ session_pin: pin })
                      .getList();
                    
                    if (refreshedDecks) {
                      console.log(`[${APP_VERSION}] Refreshed decks after create:`, refreshedDecks.length);
                      setDecks(refreshedDecks);
                      setDebugInfo(prev => ({ ...prev, decksCount: refreshedDecks.length }));
                    }
                  } catch (refreshErr) {
                    logError("Error refreshing decks after create", refreshErr);
                  }
                }
              }
              
              // Add a longer delay between each deck for server compatibility
              if (i < items.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 2000));
              }
            } catch (err) {
              const errorMsg = logError(`Error processing deck at index ${i}`, err);
              // Continue with next deck despite errors
              await new Promise(resolve => setTimeout(resolve, 3000)); // Longer delay after error
            }
          }
          
          setUploadProgress(100);
          setDeckCreationStatus('All decks processed!');
          
          // Final refresh of decks
          try {
            const finalDecks = await room.collection('deck')
              .filter({ session_pin: pin })
              .getList();
            
            if (finalDecks) {
              console.log(`[${APP_VERSION}] Final deck refresh:`, finalDecks.length);
              setDecks(finalDecks);
              setDebugInfo(prev => ({ ...prev, decksCount: finalDecks.length }));
            }
          } catch (finalErr) {
            logError("Error in final deck refresh", finalErr);
          }
          
          return results;
        };

        if (Array.isArray(data)) {
          // Simple array of strings
          setDeckCreationStatus('Processing deck...');
          setDebugInfo(prev => ({ ...prev, lastAction: 'Processing simple array deck' }));
          await createDeck(file.name.replace('.json', ''), data);
        } else if (data.cards && Array.isArray(data.cards)) {
          // Single deck with cards property
          setDeckCreationStatus('Processing deck...');
          setDebugInfo(prev => ({ ...prev, lastAction: 'Processing single deck object' }));
          await createDeck(data.name || file.name.replace('.json', ''), data.cards);
        } else if (data.decks && Array.isArray(data.decks)) {
          // Multiple decks format
          setDeckCreationStatus(`Processing ${data.decks.length} decks...`);
          setDebugInfo(prev => ({ ...prev, lastAction: `Processing ${data.decks.length} decks from array` }));
          await processDecksWithDelay(data.decks);
        } else {
          setError('Invalid JSON format. Expected an array of strings or object with cards array.');
          setDeckCreationStatus('Error: Invalid format');
          setDebugInfo(prev => ({ ...prev, lastAction: 'Error: Invalid JSON format' }));
        }
        
        // Final deck refresh
        try {
          setDebugInfo(prev => ({ ...prev, lastAction: 'Final deck refresh after processing' }));
          const finalDecks = await room.collection('deck')
            .filter({ session_pin: pin })
            .getList();
            
          console.log(`[${APP_VERSION}] Final deck count after upload:`, finalDecks?.length || 0);
          if (finalDecks) {
            setDecks(finalDecks);
            setDebugInfo(prev => ({ ...prev, decksCount: finalDecks.length }));
          }
        } catch (err) {
          logError("Error in final deck refresh", err);
        }
        
        setLoading(false);
        setUploadProgress(0);
        setTimeout(() => setDeckCreationStatus(''), 5000);
      } catch (err) {
        const errorMsg = logError('Failed to process file', err);
        setError('Error processing file: ' + errorMsg);
        setLoading(false);
        setUploadProgress(0);
        setDeckCreationStatus('Error: ' + errorMsg);
        setDebugInfo(prev => ({ ...prev, lastAction: 'Error processing file: ' + errorMsg }));
      }
    };
    
    // Start reading the file in chunks
    readNextChunk();
    setFileInput('');
  };

  // FIXED: Improved deck creation with smaller batch sizes and individual error handling
  const createDeck = async (name, cards) => {
    try {
      // Validate inputs
      if (!name || !cards || !Array.isArray(cards) || cards.length === 0) {
        throw new Error("Invalid deck data");
      }
      
      setDebugInfo(prev => ({ ...prev, lastAction: `Creating deck: ${name} with ${cards.length} cards` }));
      
      // Use a more unique deck name to avoid conflicts
      const timestamp = new Date().getTime();
      const randomString = Math.random().toString(36).substring(2, 7);
      const uniqueName = `${name.substring(0, 12)}_${randomString}`;

      // Limit the size of each card to prevent payload issues
      const processedCards = cards.map(card => {
        if (typeof card === 'string' && card.length > 80) {
          return card.substring(0, 80); // Reduced to 80 chars for better server compatibility
        }
        return card;
      }).filter(card => card && typeof card === 'string' && card.trim().length > 0);

      if (processedCards.length === 0) {
        throw new Error("No valid cards found in deck");
      }

      console.log(`[${APP_VERSION}] Creating deck "${uniqueName}" with ${processedCards.length} cards`);

      // Split large decks into smaller chunks for server compatibility
      const MAX_CARDS_PER_DECK = 5; // Reduced to 5 cards for better server compatibility
      const MAX_CHUNK_SIZE = 2 * 1024; // Reduced to 2KB maximum payload size for server compatibility
      
      if (processedCards.length > MAX_CARDS_PER_DECK) {
        const chunks = [];
        let currentChunk = [];
        let currentSize = 0;
        
        for (const card of processedCards) {
          // Roughly estimate the size of the card in the JSON payload
          const cardSize = JSON.stringify(card).length;
          
          // If adding this card would exceed our chunk size or card count, start a new chunk
          if (currentChunk.length >= MAX_CARDS_PER_DECK || (currentSize + cardSize > MAX_CHUNK_SIZE && currentChunk.length > 0)) {
            chunks.push([...currentChunk]);
            currentChunk = [card];
            currentSize = cardSize;
          } else {
            currentChunk.push(card);
            currentSize += cardSize;
          }
        }
        
        // Add the last chunk if it has any cards
        if (currentChunk.length > 0) {
          chunks.push(currentChunk);
        }
        
        // Create multiple decks
        for (let i = 0; i < chunks.length; i++) {
          const chunkName = chunks.length > 1 ? `${name} (${i+1}/${chunks.length})` : name;
          setDeckCreationStatus(`Creating chunk ${i+1}/${chunks.length}`);
          setDebugInfo(prev => ({ ...prev, lastAction: `Creating chunk ${i+1}/${chunks.length}` }));
          
          try {
            const result = await createDeckChunk(chunkName, chunks[i]);
            
            // Force a refresh after each chunk
            const refreshedDecks = await room.collection('deck')
              .filter({ session_pin: pin })
              .getList();
              
            if (refreshedDecks) {
              console.log(`[${APP_VERSION}] Refreshed decks after chunk:`, refreshedDecks.length);
              setDecks(refreshedDecks);
              setDebugInfo(prev => ({ ...prev, decksCount: refreshedDecks.length }));
            }
            
            // Add a larger delay between chunks for server compatibility
            if (i < chunks.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 2000)); // Increased delay for better server reliability
            }
          } catch (chunkErr) {
            logError(`Error creating chunk ${i+1}/${chunks.length}`, chunkErr);
            // Continue with next chunk despite errors
            await new Promise(resolve => setTimeout(resolve, 3000)); // Longer delay after error
          }
        }
        
        return { name, chunked: true };
      } else {
        return await createDeckChunk(name, processedCards);
      }
    } catch (err) {
      const errorMsg = logError('Failed to create deck', err);
      setError('Failed to create deck: ' + errorMsg);
      setDebugInfo(prev => ({ ...prev, lastAction: 'Error: ' + errorMsg }));
      throw err;
    }
  };

  // Helper function to create a single deck - FIXED: further reduced payload size
  const createDeckChunk = async (name, cards) => {
    try {
      setDebugInfo(prev => ({ ...prev, lastAction: `Creating deck chunk "${name}" with ${cards.length} cards` }));
      
      // Create a new deck with enhanced retry logic
      const newDeck = await safeRoomOperation(() =>
        room.collection('deck').create({
          session_pin: pin,
          name: name,
          cards: cards,
          created_at: new Date().toISOString()
        })
      );

      console.log(`[${APP_VERSION}] Created new deck:`, newDeck?.id);
      setDebugInfo(prev => ({ ...prev, lastAction: `Successfully created deck: ${newDeck?.id}` }));

      // Update currentDeck to the newly created deck if no deck is selected
      if (!currentDeck) {
        setCurrentDeck(newDeck.id);
      }

      return newDeck;
    } catch (err) {
      const errorMsg = logError(`Failed to create deck chunk "${name}"`, err);
      setDebugInfo(prev => ({ ...prev, lastAction: `Error creating deck: ${errorMsg}` }));
      throw new Error(`Failed to create deck: ${errorMsg}`);
    }
  };

  // FIXED: Improved text submission for deck creation with better reliability
  const handleTextSubmit = async () => {
    if (!textInput.trim() || !deckName.trim()) {
      alert('Please enter both deck name and cards');
      return;
    }

    // Pre-process cards to filter empty lines and trim whitespace
    const cards = textInput.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
      
    if (cards.length === 0) {
      alert('No valid cards found');
      return;
    }

    // Limit the number of cards for better server compatibility
    if (cards.length > 30) {
      alert('Too many cards in one deck (max 30). Please split into multiple smaller decks.');
      return;
    }

    setLoading(true);
    setError(null);
    setDeckCreationStatus('Processing text input...');
    setDebugInfo(prev => ({ ...prev, lastAction: 'Starting text deck creation' }));
    
    try {
      const result = await createDeck(deckName, cards);
      
      // Force a final refresh after creating the deck
      try {
        setDebugInfo(prev => ({ ...prev, lastAction: 'Refreshing decks after text creation' }));
        const finalDecks = await room.collection('deck')
          .filter({ session_pin: pin })
          .getList();
          
        console.log(`[${APP_VERSION}] Final deck count after text input:`, finalDecks?.length || 0);
        if (finalDecks) {
          setDecks(finalDecks);
          setDebugInfo(prev => ({ ...prev, decksCount: finalDecks.length }));
        }
      } catch (err) {
        logError("Error in final deck refresh after text input", err);
      }
      
      setTextInput('');
      setDeckName('');
      setDeckCreationStatus('Deck created successfully!');
      setDebugInfo(prev => ({ ...prev, lastAction: 'Text deck created successfully' }));
      setTimeout(() => setDeckCreationStatus(''), 5000);
    } catch (err) {
      const errorMsg = logError('Failed to add deck', err);
      setError('Failed to add deck: ' + errorMsg);
      setDeckCreationStatus('Error creating deck');
      setDebugInfo(prev => ({ ...prev, lastAction: 'Error creating text deck: ' + errorMsg }));
    }
    setLoading(false);
  };

  // ADDED: Manual deck refresh function
  const refreshDecksList = async () => {
    setDebugInfo(prev => ({ ...prev, lastAction: 'Manual refresh requested' }));
    setDeckCreationStatus('Refreshing decks...');
    
    try {
      const refreshedDecks = await room.collection('deck')
        .filter({ session_pin: pin })
        .getList();
        
      console.log(`[${APP_VERSION}] Manual deck refresh:`, refreshedDecks?.length || 0);
      if (refreshedDecks) {
        setDecks(refreshedDecks);
        setDebugInfo(prev => ({ ...prev, decksCount: refreshedDecks.length }));
        setDeckCreationStatus(`Found ${refreshedDecks.length} decks`);
        setTimeout(() => setDeckCreationStatus(''), 3000);
      } else {
        setDeckCreationStatus('No decks found');
        setTimeout(() => setDeckCreationStatus(''), 3000);
      }
      
      setLastDeckRefresh(Date.now());
    } catch (err) {
      const errorMsg = logError("Error manually refreshing decks", err);
      setDeckCreationStatus('Error refreshing: ' + errorMsg);
      setTimeout(() => setDeckCreationStatus(''), 5000);
    }
  };

  const downloadDecks = () => {
    try {
      const decksToDownload = {
        version: APP_VERSION,
        exportDate: new Date().toISOString(),
        decks: decks.map(deck => ({
          name: deck.name,
          cards: deck.cards
        }))
      };

      const json = JSON.stringify(decksToDownload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `improv_decks_v${APP_VERSION}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      logError('Error downloading decks', err);
      alert('Error creating download. Please try again.');
    }
  };

  const getTimeLeft = (expiresAt) => {
    if (!expiresAt) return 0;
    const remaining = new Date(expiresAt).getTime() - Date.now();
    return Math.max(0, Math.floor(remaining / 1000));
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="header">Conductor Panel <span style={{ fontSize: '14px' }}>v{APP_VERSION}</span></h1>

      <div className="card">
        <h2 className="header">Session PIN: {pin}</h2>
        <p>Share this PIN with players to join (max 10)</p>
        <button className="btn" onClick={() => {
          const url = `${window.baseUrl || window.location.origin + window.location.pathname}?pin=${pin}`;
          try {
            navigator.clipboard.writeText(url);
            alert('Shareable link copied to clipboard');
          } catch (err) {
            alert('Could not copy link. Please manually share this PIN: ' + pin);
          }
        }}>
          Copy Shareable Link
        </button>
      </div>

      <div className="card">
        <h2 className="header">Upload Decks</h2>

        <div className="mb-4">
          <h3>Upload JSON File</h3>
          <input
            type="file"
            accept=".json"
            onChange={handleFileUpload}
            value={fileInput}
            disabled={loading}
          />
          <p className="helper-text">Accepts single deck (array of strings), deck object {`{ name, cards }`}, or multiple decks {`{ decks: [{ name, cards }] }`}</p>
          {loading && uploadProgress > 0 && (
            <div style={{ marginTop: '10px' }}>
              <div style={{ width: '100%', backgroundColor: '#eee', borderRadius: '4px', overflow: 'hidden' }}>
                <div 
                  style={{
                    width: `${uploadProgress}%`, 
                    backgroundColor: 'black', 
                    height: '10px', 
                    transition: 'width 0.3s ease'
                  }}
                ></div>
              </div>
              <p>Progress: {uploadProgress}%</p>
              {deckCreationStatus && <p>{deckCreationStatus}</p>}
            </div>
          )}
        </div>

        <div className="mb-4">
          <h3>Or Paste Cards (one per line)</h3>
          <input
            type="text"
            className="input"
            placeholder="Deck Name"
            value={deckName}
            onChange={(e) => setDeckName(e.target.value)}
            disabled={loading}
          />
          <textarea
            className="input"
            rows="5"
            placeholder="Card 1&#10;Card 2&#10;Card 3"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            disabled={loading}
          ></textarea>
          <button 
            className={`btn ${loading ? 'btn-disabled' : ''}`} 
            onClick={handleTextSubmit}
            disabled={loading}
          >
            {loading ? 'Adding...' : 'Add Deck'}
          </button>
          {deckCreationStatus && <p style={{ marginTop: '5px' }}>{deckCreationStatus}</p>}
        </div>

        {error && <p style={{ color: 'red', marginBottom: '10px' }}>{error}</p>}

        <div>
          <h3>Available Decks ({decks.length})</h3>
          <div style={{ marginBottom: '10px' }}>
            <button 
              className="btn" 
              onClick={refreshDecksList}
              disabled={loading}
              style={{ marginRight: '10px' }}
            >
              Refresh Decks List
            </button>
            <span style={{ fontSize: '12px', color: '#888' }}>
              Last refreshed: {lastDeckRefresh ? new Date(lastDeckRefresh).toLocaleTimeString() : 'never'}
            </span>
          </div>
          
          {decks.length === 0 ? (
            <p>No decks uploaded yet</p>
          ) : (
            <>
              <select 
                className="input" 
                value={currentDeck || ''}
                onChange={(e) => setCurrentDeck(e.target.value)}
              >
                {decks.map(deck => (
                  <option key={deck.id} value={deck.id}>
                    {deck.name} ({deck.cards?.length || 0} cards)
                  </option>
                ))}
              </select>
              <button className="btn" onClick={downloadDecks} style={{ marginTop: '10px' }}>
                Download All Decks as JSON
              </button>
            </>
          )}
          
          {/* Debug info */}
          <div style={{ marginTop: '10px', fontSize: '12px', color: '#888', borderTop: '1px solid #eee', paddingTop: '10px' }}>
            <details>
              <summary>Debug Info</summary>
              <p>Last action: {debugInfo.lastAction || 'None'}</p>
              <p>Decks count (debug): {debugInfo.decksCount}</p>
              <p>App version: {APP_VERSION}</p>
            </details>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="header">Session Settings</h2>

        <div className="mb-4">
          <h3>Distribution Mode</h3>
          <select
            className="input"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="unison">Unison - Everyone sees the same card</option>
            <option value="unique">Unique - Different cards from same deck</option>
            <option value="random">Random - Random cards from any deck</option>
          </select>
        </div>

        <div className="mb-4">
          <h3>Display Time (seconds)</h3>
          <div className="flex gap-2">
            <div>
              <label>Min:</label>
              <input
                type="number"
                className="input"
                min="20"
                max="300"
                value={minTime}
                onChange={(e) => setMinTime(parseInt(e.target.value))}
              />
            </div>
            <div>
              <label>Max:</label>
              <input
                type="number"
                className="input"
                min="20"
                max="300"
                value={maxTime}
                onChange={(e) => setMaxTime(parseInt(e.target.value))}
              />
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          {!isPlaying ? (
            <button 
              className={`btn btn-primary ${decks.length === 0 ? 'btn-disabled' : ''}`}
              onClick={handlePlay}
              disabled={decks.length === 0}
            >
              Start
            </button>
          ) : (
            <>
              <button className="btn" onClick={handleStop}>Stop</button>
              <button className="btn" onClick={handleEnd}>End Session</button>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <h2 className="header">Players ({players.length}/10)</h2>

        <div className="player-list">
          {players.length === 0 ? (
            <p>No players have joined yet</p>
          ) : (
            players.map(player => (
              <div key={player.id} className="player-item">
                <div>
                  <strong>{player.name}</strong>
                  <div>{player.current_card === 'END' ? 'ENDED' : player.current_card || 'Waiting...'}</div>
                </div>
                <div>
                  {player.expires_at ? `${getTimeLeft(player.expires_at)}s left` : ''}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <button className="btn" onClick={() => setView('home')}>Exit Session</button>
    </div>
  );
}

// Player View
function PlayerView({ pin, playerName, setView }) {
  const [currentCard, setCurrentCard] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [totalTime, setTotalTime] = useState(0);
  const [error, setError] = useState('');
  const [playerId, setPlayerId] = useState(null);
  const [isSessionActive, setIsSessionActive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [retries, setRetries] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const initialSetupDone = useRef(false);

  // Find player record and subscribe to changes - FIXED: improved reliability
  useEffect(() => {
    if (initialSetupDone.current) return;
    
    const setupPlayer = async () => {
      try {
        setLoading(true);
        setConnectionStatus('connecting');
        console.log(`[${APP_VERSION}] Looking for player with pin:`, pin, 'and name:', playerName);

        // Make sure session exists first
        const sessions = await safeRoomOperation(() => 
          room.collection('session').filter({ pin }).getList()
        );
        
        if (!sessions || sessions.length === 0) {
          setError('Session not found. Please check your PIN.');
          setLoading(false);
          setConnectionStatus('error');
          return;
        }

        setConnectionStatus('checking player');
        
        // Try to find the existing player
        let players = await safeRoomOperation(() => 
          room.collection('player').filter({ 
            session_pin: pin, 
            name: playerName 
          }).getList()
        );

        console.log(`[${APP_VERSION}] Found players:`, players?.length || 0);

        // If no players found, create one with retries
        if (!players || players.length === 0) {
          console.log(`[${APP_VERSION}] Player not found, attempting to create...`);
          setConnectionStatus('creating player');
          
          // Try to create the player with retries
          let playerCreated = false;
          let maxCreateRetries = 3;
          let createRetryCount = 0;
          
          while (!playerCreated && createRetryCount < maxCreateRetries) {
            try {
              const newPlayer = await safeRoomOperation(() => 
                room.collection('player').create({
                  session_pin: pin,
                  name: playerName,
                  current_card: null,
                  expires_at: null,
                })
              );
              console.log(`[${APP_VERSION}] Created new player:`, newPlayer?.id);
              setPlayerId(newPlayer.id);
              playerCreated = true;
            } catch (createErr) {
              const errorMsg = logError(`Failed to create player (attempt ${createRetryCount + 1})`, createErr);
              createRetryCount++;
              setConnectionStatus(`retry ${createRetryCount}/${maxCreateRetries}`);
              
              // Check if player was actually created despite the error
              await new Promise(resolve => setTimeout(resolve, 1000));
              
              players = await safeRoomOperation(() => 
                room.collection('player').filter({ 
                  session_pin: pin, 
                  name: playerName 
                }).getList()
              );
              
              if (players && players.length > 0) {
                console.log(`[${APP_VERSION}] Player was created despite error`);
                setPlayerId(players[0].id);
                playerCreated = true;
                break;
              }
            }
            
            if (!playerCreated) {
              await new Promise(resolve => setTimeout(resolve, 1000 * createRetryCount));
            }
          }
          
          if (!playerCreated) {
            setError('Could not join session. Please try again with a different name.');
            setLoading(false);
            setConnectionStatus('error');
            return;
          }
        } else {
          setPlayerId(players[0].id);
        }

        setLoading(false);
        setConnectionStatus('connected');
        initialSetupDone.current = true;

        // Subscribe to player changes - FIXED: Improved reliability
        const subscribeToPlayerUpdates = () => {
          try {
            return room.collection('player')
              .filter({ session_pin: pin, name: playerName })
              .subscribe(playersList => {
                if (playersList && playersList.length > 0) {
                  const player = playersList[0];
                  setCurrentCard(player.current_card);

                  if (player.expires_at) {
                    const expiry = new Date(player.expires_at).getTime();
                    const now = Date.now();
                    const remaining = Math.max(0, Math.floor((expiry - now) / 1000));
                    setTimeLeft(remaining);

                    // Calculate total time from remaining time and session settings
                    const totalTimeEstimate = remaining + 5; // Add buffer for calculation
                    setTotalTime(Math.max(totalTime, totalTimeEstimate));
                  } else if (!player.current_card || player.current_card === 'END') {
                    // Reset timer if no card or ended
                    setTimeLeft(0);
                  }
                }
              });
          } catch (subErr) {
            logError("Error subscribing to player updates", subErr);
            // Retry subscription after a delay
            setTimeout(subscribeToPlayerUpdates, 3000);
            return () => {}; // Return empty unsubscribe function
          }
        };
        
        return subscribeToPlayerUpdates();
      } catch (err) {
        const errorMsg = logError('Failed to setup player', err);
        if (retries < 3) {
          setRetries(retries + 1);
          setConnectionStatus(`retrying (${retries + 1}/3)`);
          setTimeout(() => setupPlayer(), 2000); // Retry after delay
        } else {
          setError('Failed to connect to session. Please try again.');
          setLoading(false);
          setConnectionStatus('error');
        }
      }
    };

    setupPlayer();
  }, [pin, playerName, retries]);

  // Subscribe to session - FIXED: improved reliability
  useEffect(() => {
    if (pin) {
      const subscribeToSession = () => {
        try {
          return room.collection('session')
            .filter({ pin })
            .subscribe(sessionsList => {
              if (sessionsList && sessionsList.length > 0) {
                const session = sessionsList[0];
                setIsSessionActive(session.is_playing);
                
                // Update total time estimate from session settings
                if (session.min_time && session.max_time) {
                  const avgSessionTime = (session.min_time + session.max_time) / 2;
                  if (!totalTime || avgSessionTime > totalTime) {
                    setTotalTime(avgSessionTime);
                  }
                }
              } else {
                setError('Session not found');
              }
            });
        } catch (err) {
          logError("Error subscribing to session", err);
          // Retry subscription after a delay
          setTimeout(subscribeToSession, 3000);
          return () => {}; // Return empty unsubscribe function
        }
      };
      
      return subscribeToSession();
    }
  }, [pin]);

  // Timer to update time left - FIXED: more accurate countdown
  useEffect(() => {
    if (currentCard && currentCard !== 'END' && timeLeft > 0) {
      const timer = setInterval(() => {
        setTimeLeft(prev => {
          const newTime = Math.max(0, prev - 1);
          if (newTime === 0 && currentCard) {
            // When timer hits zero, attempt to fetch updated card from server
            try {
              room.collection('player')
                .filter({ session_pin: pin, name: playerName })
                .getList()
                .then(players => {
                  if (players && players.length > 0) {
                    setCurrentCard(players[0].current_card);
                    if (players[0].expires_at) {
                      const expiry = new Date(players[0].expires_at).getTime();
                      const now = Date.now();
                      const newRemaining = Math.max(0, Math.floor((expiry - now) / 1000));
                      if (newRemaining > 0) {
                        setTimeLeft(newRemaining);
                      }
                    }
                  }
                });
            } catch (err) {
              logError("Error refreshing player data", err);
            }
          }
          return newTime;
        });
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [currentCard, timeLeft, pin, playerName]);

  // ENHANCED: Improved progress calculation for better visual feedback
  const getProgressWidth = () => {
    if (timeLeft <= 0 || totalTime <= 0) return 0;
    // Calculate percentage with a minimum to ensure visibility
    const percentage = (timeLeft / totalTime) * 100;
    return Math.max(1, percentage); // At least 1% width to show something is happening
  };

  if (loading) {
    return (
      <div className="fullscreen-card">
        <div>
          <h2 className="header">Connecting to session...</h2>
          <p>Status: {connectionStatus}</p>
          <div style={{ marginTop: '20px', width: '100%', height: '4px', backgroundColor: '#eee', borderRadius: '2px' }}>
            <div 
              style={{ 
                width: '30%', 
                height: '100%', 
                backgroundColor: '#000', 
                borderRadius: '2px',
                animation: 'progress-bar 1.5s infinite'
              }}
            ></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="card">
          <h2 className="header">Error</h2>
          <p>{error}</p>
          <button className="btn btn-primary" onClick={() => setView('join')}>
            Back to Join
          </button>
        </div>
      </div>
    );
  }

  if (currentCard === 'END') {
    return (
      <div className="fullscreen-card">
        <div>
          <h1 className="card-text">SESSION ENDED</h1>
          <p>Thank you for playing!</p>
          <button className="btn" onClick={() => setView('home')} style={{ marginTop: '20px' }}>
            Return to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', position: 'relative' }}>
      {currentCard ? (
        <div className="fullscreen-card">
          <div style={{ width: '100%' }}>
            <h1 className="card-text">{currentCard}</h1>
            
            {/* ENHANCED: Improved countdown visualization */}
            <div style={{ marginTop: '30px', textAlign: 'center' }}>
              <span style={{ fontSize: '32px', fontWeight: 'bold' }}>{timeLeft}</span>
              <span style={{ fontSize: '20px' }}> seconds remaining</span>
            </div>
            
            <div className="timer-bar">
              <div
                className="timer-progress"
                style={{ 
                  width: `${getProgressWidth()}%`,
                  transition: 'width 0.95s linear'
                }}
              ></div>
            </div>
          </div>
        </div>
      ) : (
        <div className="fullscreen-card">
          <div>
            <h2 className="header">Waiting for cards...</h2>
            <p>PIN: {pin}</p>
            <p>Name: {playerName}</p>
            {!isSessionActive && (
              <p>Waiting for conductor to start the session</p>
            )}
            <div className="connection-status">
              Status: {connectionStatus === 'connected' ? '✓ Connected' : connectionStatus}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Render the app
try {
  const root = createRoot(document.getElementById('root'));
  root.render(<App />);
} catch (err) {
  const errorMsg = logError("Error rendering app", err);
  document.getElementById('loading').innerHTML = 'Error loading application: ' + errorMsg;
}