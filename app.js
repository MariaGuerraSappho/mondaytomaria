// App Version for tracking
const APP_VERSION = "1.19.0";

const { useState, useEffect, useRef, useMemo } = React;
const { createRoot } = ReactDOM;

// Initialize WebsimSocket with ultra-resilient error handling
let room;
try {
  room = new WebsimSocket();
  console.log(`[${APP_VERSION}] WebsimSocket initialized successfully`);
} catch (err) {
  console.error(`[${APP_VERSION}] Error initializing WebsimSocket:`, err);
  // We have a fallback implementation in the HTML
  room = new WebsimSocket();
}

// Enhanced error handling and reporting with timestamps
const logError = (context, error) => {
  const timestamp = new Date().toISOString();
  const errorMessage = error?.message || String(error) || "Unknown error";
  console.error(`[${APP_VERSION}][${timestamp}] ${context}:`, error);
  return errorMessage;
};

// Ultra-resilient room operation with configurable timeouts and progressive backoff
const safeRoomOperation = async (operation, maxRetries = 5, initialTimeout = 15000) => {
  let retries = 0;
  let lastError = null;
  let timeout = initialTimeout;
  
  while (retries < maxRetries) {
    try {
      // Create a timeout promise to ensure operations don't hang indefinitely
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`Operation timed out after ${timeout}ms`)), timeout)
      );
      
      // Race between the actual operation and the timeout
      return await Promise.race([operation(), timeoutPromise]);
    } catch (err) {
      lastError = err;
      const errorMsg = logError(`Operation failed (attempt ${retries + 1})`, err);
      
      // Special handling for timeout errors
      const isTimeout = errorMsg.includes('timeout') || errorMsg.includes('Timeout');
      
      retries++;
      if (retries >= maxRetries) {
        console.warn(`[${APP_VERSION}] All retries failed for operation`);
        throw new Error(`Failed after ${maxRetries} attempts: ${err.message || 'Unknown error'}`);
      }
      
      // Progressive backoff with jitter
      const baseDelay = isTimeout ? 1500 : 800;
      const jitter = Math.random() * 700;
      const delay = (baseDelay * Math.pow(1.7, retries)) + jitter;
      
      // Increase timeout progressively
      timeout = Math.min(initialTimeout * Math.pow(1.5, retries), 60000); // Cap at 60 seconds
      
      console.log(`[${APP_VERSION}] Retrying in ${Math.round(delay)}ms with timeout ${Math.round(timeout)}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
};

// Status reporting mechanism for debugging
const reportStatus = (component, status, details = {}) => {
  const timestamp = new Date().toISOString();
  console.log(`[${APP_VERSION}][${timestamp}][${component}] ${status}`, details);
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

// Join View with enhanced reliability
function JoinView({ pin, setPin, playerName, setPlayerName, setView }) {
  const [error, setError] = useState('');
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [joinStatus, setJoinStatus] = useState('');
  const subscriptionAttempted = useRef(false);

  // Subscribe to sessions with retries
  useEffect(() => {
    if (subscriptionAttempted.current) return;
    subscriptionAttempted.current = true;
    
    const attemptSubscription = async (retryCount = 0) => {
      try {
        reportStatus('JoinView', 'Subscribing to sessions', { retryCount });
        return room.collection('session').subscribe(sessionsList => {
          reportStatus('JoinView', 'Sessions updated', { count: sessionsList?.length || 0 });
          setSessions(sessionsList || []);
        });
      } catch (err) {
        const errorMsg = logError(`Error subscribing to sessions (retry ${retryCount})`, err);
        
        if (retryCount < 3) {
          reportStatus('JoinView', 'Retrying session subscription', { retryCount });
          setTimeout(() => attemptSubscription(retryCount + 1), 2000 * (retryCount + 1));
          return () => {};
        } else {
          setError("Could not connect to session data. Please refresh and try again.");
          return () => {};
        }
      }
    };
    
    return attemptSubscription();
  }, []);

  const handleJoin = async () => {
    if (!pin || !playerName) {
      setError('Please enter both PIN and name');
      return;
    }

    setLoading(true);
    setError('');
    setJoinStatus('Validating session...');

    try {
      // Store player name for convenience
      localStorage.setItem('playerName', playerName);
      localStorage.setItem('lastPin', pin);
      
      // Check if session exists - with extended timeout
      setJoinStatus('Checking if session exists...');
      const sessions = await safeRoomOperation(
        () => room.collection('session').filter({ pin }).getList(),
        3,  // 3 retries
        12000 // 12 second timeout
      );
      
      if (!sessions || sessions.length === 0) {
        setError('Invalid PIN');
        setLoading(false);
        setJoinStatus('');
        return;
      }

      // Check if player limit reached - with extended timeout
      setJoinStatus('Checking player count...');
      const players = await safeRoomOperation(
        () => room.collection('player').filter({ session_pin: pin }).getList(),
        3,  // 3 retries
        12000 // 12 second timeout
      );
      
      if (players && players.length >= 10) {
        setError('Session is full (max 10 players)');
        setLoading(false);
        setJoinStatus('');
        return;
      }

      // Check if player already exists with this name
      setJoinStatus('Checking player registration...');
      const existingPlayer = players?.find(p => 
        p.name === playerName && p.session_pin === pin
      );
      
      if (!existingPlayer) {
        // Join session - create new player with ultra-reliability
        setJoinStatus('Creating player...');
        try {
          await safeRoomOperation(
            () => room.collection('player').create({
              session_pin: pin,
              name: playerName,
              current_card: null,
              expires_at: null,
              joined_at: new Date().toISOString(),
              client_info: `${APP_VERSION}|${navigator.userAgent.slice(0, 50)}`
            }),
            5, // 5 retries
            15000 // 15 second timeout
          );
          reportStatus('JoinView', 'Player created successfully', { pin, name: playerName });
        } catch (playerErr) {
          logError('Failed to create player', playerErr);
          // We'll proceed to player view anyway and retry there
          reportStatus('JoinView', 'Proceeding despite player creation error', { pin, name: playerName });
        }
      }

      setJoinStatus('Joining session...');
      setTimeout(() => {
        setLoading(false);
        setView('player');
      }, 500);
    } catch (err) {
      const errorMsg = logError('Failed to join session', err);
      setError(`Failed to join: ${errorMsg.slice(0, 100)}`);
      setLoading(false);
      setJoinStatus('');
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
        {joinStatus && <p style={{ color: '#555', marginBottom: '10px' }}>{joinStatus}</p>}
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
  const [pin, setPin] = useState('');
  const [players, setPlayers] = useState([]);
  const [mode, setMode] = useState('unison'); 
  const [minTime, setMinTime] = useState(20);
  const [maxTime, setMaxTime] = useState(60);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isEnding, setIsEnding] = useState(false);

  const [decks, setDecks] = useState([]);
  const [currentDeck, setCurrentDeck] = useState(null);
  const [currentDeckName, setCurrentDeckName] = useState('');
  const [savedDecks, setSavedDecks] = useState([]);
  const [showSavedDecks, setShowSavedDecks] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [deckCreationStatus, setDeckCreationStatus] = useState('');
  const [cardDistributionStatus, setCardDistributionStatus] = useState('');
  const [expandedPlayers, setExpandedPlayers] = useState([]);
  const [deckName, setDeckName] = useState('');
  const [textInput, setTextInput] = useState('');
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  const [networkQuality, setNetworkQuality] = useState('unknown');
  
  const [lastCardDistribution, setLastCardDistribution] = useState(null);
  const [lastDeckRefresh, setLastDeckRefresh] = useState(0);
  const [manualRefreshCount, setManualRefreshCount] = useState(0);
  
  const deckRefIntervalRef = useRef(null);
  const playerDataRef = useRef({});

  // Load saved decks from localStorage on component mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('savedDecks');
      if (saved) {
        const parsedDecks = JSON.parse(saved);
        setSavedDecks(parsedDecks);
        console.log(`[${APP_VERSION}] Loaded ${parsedDecks.length} saved decks from storage`);
      }
    } catch (err) {
      console.error(`[${APP_VERSION}] Error loading saved decks:`, err);
    }
    
    deckRefIntervalRef.current = setInterval(() => {
      if (!loading) { 
        refreshDecksList(false); 
      }
    }, 10000);
    
    return () => {
      if (deckRefIntervalRef.current) {
        clearInterval(deckRefIntervalRef.current);
      }
    };
  }, []);

  // Generate PIN and create session on component mount
  useEffect(() => {
    if (!sessionData) {
      const generatedPin = Math.floor(1000 + Math.random() * 9000).toString();
      setPin(generatedPin);

      const createSession = async () => {
        try {
          reportStatus('ConductorView', 'Creating new session', { pin: generatedPin });
          const newSession = await safeRoomOperation(
            () => room.collection('session').create({
              pin: generatedPin,
              mode: mode,
              min_time: minTime,
              max_time: maxTime,
              is_playing: false,
              is_ending: false,
              created_at: new Date().toISOString(), 
              app_version: APP_VERSION 
            }),
            5, 
            15000 
          );
          setSessionData(newSession);
          reportStatus('ConductorView', 'Created session successfully', { pin: generatedPin, id: newSession?.id });
          
          setTimeout(() => refreshDecksList(true), 1000);
        } catch (err) {
          const errorMsg = logError('Failed to create session', err);
          setError('Failed to create session. Please try again.');
        }
      };

      createSession();
    } else {
      setPin(sessionData.pin);
      setMode(sessionData.mode);
      setMinTime(sessionData.min_time);
      setMaxTime(sessionData.max_time);
      setIsPlaying(sessionData.is_playing);
      setIsEnding(sessionData.is_ending);
      
      setTimeout(() => refreshDecksList(true), 1000);
    }
  }, [sessionData]);

  // Subscribe to players
  useEffect(() => {
    if (!pin) return;
    
    reportStatus('ConductorView', 'Setting up player subscription', { pin });
    
    try {
      return room.collection('player')
        .filter({ session_pin: pin })
        .subscribe(playersList => {
          reportStatus('ConductorView', 'Players updated', { count: playersList?.length || 0 });
          setPlayers(playersList || []);
        });
    } catch (err) {
      logError('Error subscribing to players', err);
      
      const intervalId = setInterval(async () => {
        try {
          const polledPlayers = await room.collection('player')
            .filter({ session_pin: pin })
            .getList();
          
          if (polledPlayers) {
            setPlayers(polledPlayers);
          }
        } catch (err) {
          logError('Player polling fallback failed', err);
        }
      }, 5000);
      
      return () => clearInterval(intervalId);
    }
  }, [pin]);

  // Subscribe to decks
  useEffect(() => {
    if (!pin) return;
    
    reportStatus('ConductorView', 'Setting up deck subscription', { pin });
    
    try {
      return room.collection('deck')
        .filter({ session_pin: pin })
        .subscribe(decksList => {
          reportStatus('ConductorView', 'Decks updated', { count: decksList?.length || 0 });
          
          setDecks(decksList || []);
          
          if (decksList && decksList.length > 0 && !currentDeck) {
            setCurrentDeck(decksList[0].id);
            setCurrentDeckName(decksList[0].name);
          } else if (currentDeck) {
            const selectedDeck = decksList?.find(d => d.id === currentDeck);
            if (selectedDeck) {
              setCurrentDeckName(selectedDeck.name);
            }
          }
        });
    } catch (err) {
      logError('Error subscribing to decks', err);
      
      const intervalId = setInterval(async () => {
        try {
          await refreshDecksList(false);
        } catch (err) {
          // Ignore polling errors
        }
      }, 10000);
      
      return () => clearInterval(intervalId);
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
              last_updated: new Date().toISOString() 
            })
          );
        } catch (err) {
          logError('Failed to update session', err);
        }
      }
    };

    updateSession();
  }, [mode, minTime, maxTime, isPlaying, isEnding, sessionData]);

  // Monitor isPlaying and automatically distribute cards once when play starts
  useEffect(() => {
    if (isPlaying && players.length > 0 && currentDeck && !isEnding) {
      const shouldDistribute = !lastCardDistribution || 
                              (Date.now() - lastCardDistribution.timestamp > 5000) || 
                              (lastCardDistribution.deckId !== currentDeck);
      
      if (shouldDistribute) {
        distributeCards();
      }
    } else if (!isPlaying && isEnding) {
      endSession();
    }
  }, [isPlaying, isEnding, players.length, currentDeck]);

  // Network quality check
  useEffect(() => {
    const checkNetworkQuality = async () => {
      const start = Date.now();
      try {
        const response = await fetch('https://www.cloudflare.com/cdn-cgi/trace', { 
          method: 'GET',
          cache: 'no-store',
          mode: 'no-cors',
          timeout: 5000
        });
        
        const responseTime = Date.now() - start;
        
        if (responseTime < 500) {
          setNetworkQuality('good');
        } else if (responseTime < 1500) {
          setNetworkQuality('fair');
        } else {
          setNetworkQuality('poor');
        }
      } catch (err) {
        setNetworkQuality('poor');
      }
    };
    
    checkNetworkQuality();
    const interval = setInterval(checkNetworkQuality, 120000);
    return () => clearInterval(interval);
  }, []);

  // Refresh deck list
  const refreshDecksList = async (showFeedback = true) => {
    const refreshId = Date.now();
    setLastDeckRefresh(refreshId);
    
    if (showFeedback) {
      setManualRefreshCount(prev => prev + 1);
      setDeckCreationStatus('Refreshing deck list...');
    }
    
    try {
      const timeoutMs = networkQuality === 'poor' ? 12000 : 8000;
      
      const fetchedDecks = await safeRoomOperation(
        () => room.collection('deck').filter({ session_pin: pin }).getList(),
        3,
        timeoutMs
      );
      
      if (fetchedDecks && Array.isArray(fetchedDecks)) {
        reportStatus('ConductorView', 'Refreshed decks list', {
          count: fetchedDecks.length,
          refresh_id: refreshId,
          manual: showFeedback
        });
        
        setDecks(fetchedDecks);
        
        if (fetchedDecks.length > 0 && !currentDeck) {
          setCurrentDeck(fetchedDecks[0].id);
          setCurrentDeckName(fetchedDecks[0].name);
        } else if (currentDeck) {
          const selectedDeck = fetchedDecks.find(d => d.id === currentDeck);
          if (selectedDeck) {
            setCurrentDeckName(selectedDeck.name);
          }
        }
        
        if (showFeedback) {
          setDeckCreationStatus(`Found ${fetchedDecks.length} deck${fetchedDecks.length !== 1 ? 's' : ''}`);
          setTimeout(() => setDeckCreationStatus(''), 3000);
        }
      }
    } catch (err) {
      console.error(`[${APP_VERSION}] Deck refresh error:`, err);
      
      if (showFeedback) {
        setDeckCreationStatus(`Could not refresh from server. Using local data.`);
      }
    }
  };

  // Create a new deck
  const createDeck = async (name, cardsInput) => {
    if (!pin) {
      setError('Session PIN not available. Please refresh the page.');
      return false;
    }

    if (!name || name.trim() === '') {
      setError('Deck name is required');
      return false;
    }

    setLoading(true);
    setError(null);
    setDeckCreationStatus(`Processing deck "${name}"...`);

    try {
      let cards = [];
      
      if (Array.isArray(cardsInput)) {
        cards = cardsInput.filter(card => card && typeof card === 'string' && card.trim() !== '');
      } else if (typeof cardsInput === 'string') {
        cards = cardsInput.split('\n')
          .map(line => line.trim())
          .filter(line => line !== '');
      } else {
        throw new Error('Invalid cards format');
      }

      if (cards.length === 0) {
        setDeckCreationStatus('Error: No valid cards found in input');
        setError('No valid cards found. Please add at least one card.');
        setLoading(false);
        return false;
      }

      setDeckCreationStatus(`Creating deck "${name}" with ${cards.length} cards...`);
      
      const newDeck = await safeRoomOperation(
        () => room.collection('deck').create({
          name: name,
          cards: cards,
          session_pin: pin,
          card_count: cards.length,
          created_at: new Date().toISOString()
        }),
        3,
        20000
      );
      
      setDecks(prev => {
        const updated = [...prev];
        const existingIndex = updated.findIndex(d => d.name === name);
        
        if (existingIndex >= 0) {
          updated[existingIndex] = newDeck;
        } else {
          updated.push(newDeck);
        }
        
        return updated;
      });
      
      if (!currentDeck && decks.length === 0) {
        setCurrentDeck(newDeck.id);
        setCurrentDeckName(newDeck.name);
      }
      
      setDeckCreationStatus(`Deck "${name}" created successfully with ${cards.length} cards!`);
      
      try {
        const deckToSave = {
          name: name,
          cards: cards,
          saved_at: new Date().toISOString()
        };
        
        const exists = savedDecks.some(saved => 
          saved.name === name && 
          JSON.stringify(saved.cards) === JSON.stringify(cards)
        );
        
        if (!exists) {
          const updatedSavedDecks = [...savedDecks, deckToSave];
          setSavedDecks(updatedSavedDecks);
          localStorage.setItem('savedDecks', JSON.stringify(updatedSavedDecks));
        }
      } catch (saveErr) {
        console.warn(`[${APP_VERSION}] Could not save deck locally:`, saveErr);
      }
      
      setLoading(false);
      return true;
    } catch (err) {
      setLoading(false);
      
      const errorMsg = logError(`Failed to create deck "${name}"`, err);
      setError(`Upload error: ${errorMsg}`);
      setDeckCreationStatus(`Error creating deck: ${errorMsg}`);
      return false;
    }
  };

  // Handle file upload
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setDeckCreationStatus('Reading file...');
    
    try {
      const fileContent = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (err) => reject(new Error('Failed to read file'));
        reader.readAsText(file);
      });
      
      setDeckCreationStatus('Parsing file content...');
      
      let data;
      try {
        data = JSON.parse(fileContent);
      } catch (jsonErr) {
        setDeckCreationStatus('Error: Not a valid JSON file');
        throw new Error(`Invalid JSON format: ${jsonErr.message}`);
      }
      
      let successCount = 0;
      
      if (Array.isArray(data)) {
        setDeckCreationStatus(`Creating deck from array with ${data.length} cards...`);
        const success = await createDeck(file.name.replace(/\.[^/.]+$/, ""), data);
        if (success) successCount++;
      } 
      else if (data.cards && Array.isArray(data.cards)) {
        setDeckCreationStatus(`Creating deck "${data.name || file.name}"...`);
        const success = await createDeck(data.name || file.name.replace(/\.[^/.]+$/, ""), data.cards);
        if (success) successCount++;
      }
      else if (data.decks && Array.isArray(data.decks)) {
        setDeckCreationStatus(`Processing ${data.decks.length} decks...`);
        
        for (let i = 0; i < data.decks.length; i++) {
          const deck = data.decks[i];
          if (!deck.name || !Array.isArray(deck.cards)) {
            console.warn(`[${APP_VERSION}] Skipping invalid deck at position ${i}`);
            continue;
          }
          
          setDeckCreationStatus(`Creating deck ${i+1}/${data.decks.length}: "${deck.name}"`);
          const success = await createDeck(deck.name, deck.cards);
          if (success) successCount++;
          
          if (i < data.decks.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
      else {
        throw new Error("Unsupported JSON format. Expected array of cards or object with cards/decks property.");
      }
      
      setDeckCreationStatus(`Upload complete! Added ${successCount} deck${successCount !== 1 ? 's' : ''}.`);
      
      setTimeout(() => refreshDecksList(true), 1000);
      setTimeout(() => refreshDecksList(true), 3000);
    } catch (err) {
      console.error(`[${APP_VERSION}] File upload error:`, err);
      setError('Upload error: ' + (err.message || 'Unknown error'));
      setDeckCreationStatus('Error: ' + (err.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  // Handle text deck submission
  const handleTextSubmit = async () => {
    if (!textInput.trim()) {
      setError('Please enter at least one card');
      return;
    }
    
    if (!deckName.trim()) {
      setError('Please enter a deck name');
      return;
    }

    const success = await createDeck(deckName, textInput);
    
    if (success) {
      setTextInput('');
      setDeckName('');
      setTimeout(() => refreshDecksList(true), 1000);
      setTimeout(() => refreshDecksList(true), 3000);
    }
  };

  // Upload all saved decks at once
  const uploadAllSavedDecks = async () => {
    if (savedDecks.length === 0) {
      setDeckCreationStatus('No saved decks to upload');
      return;
    }

    setLoading(true);
    setDeckCreationStatus(`Uploading ${savedDecks.length} saved decks...`);
    
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < savedDecks.length; i++) {
      const deck = savedDecks[i];
      setDeckCreationStatus(`Uploading deck ${i+1}/${savedDecks.length}: "${deck.name}"`);
      
      try {
        const success = await createDeck(deck.name, deck.cards);
        if (success) {
          successCount++;
        } else {
          errorCount++;
        }
        
        if (i < savedDecks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (err) {
        errorCount++;
        console.error(`[${APP_VERSION}] Error uploading saved deck "${deck.name}":`, err);
      }
    }
    
    setLoading(false);
    setDeckCreationStatus(`Upload complete! Added ${successCount} deck${successCount !== 1 ? 's' : ''}, failed ${errorCount}`);
    
    setTimeout(() => refreshDecksList(true), 1000);
  };

  // Card distribution function
  const distributeCards = async () => {
    if (!currentDeck || players.length === 0 || !isPlaying || isEnding) {
      setCardDistributionStatus('Cannot distribute cards: missing deck, players, or not in play mode');
      return;
    }

    setCardDistributionStatus('Preparing to distribute cards...');

    try {
      const selectedDeck = decks.find(deck => deck.id === currentDeck);
      if (!selectedDeck || !selectedDeck.cards || selectedDeck.cards.length === 0) {
        setCardDistributionStatus('Error: Selected deck has no cards');
        return;
      }

      const cardsPool = [...selectedDeck.cards];
      
      setLastCardDistribution({
        timestamp: Date.now(),
        deckId: currentDeck
      });

      setCardDistributionStatus(`Distributing cards from "${selectedDeck.name}" to ${players.length} players in ${mode} mode...`);

      let unisonCard = null;
      
      if (mode === 'unison') {
        const randomIndex = Math.floor(Math.random() * cardsPool.length);
        unisonCard = cardsPool[randomIndex];
        console.log(`[${APP_VERSION}] Unison mode: Selected card "${unisonCard}" for all players`);
      }

      const usedCardIndices = new Set();

      const updatePromises = players.map(async (player) => {
        let selectedCard;
        
        switch (mode) {
          case 'unison':
            selectedCard = unisonCard;
            break;
            
          case 'unique':
            if (cardsPool.length > 0) {
              if (usedCardIndices.size < cardsPool.length) {
                let randomIndex;
                do {
                  randomIndex = Math.floor(Math.random() * cardsPool.length);
                } while (usedCardIndices.has(randomIndex));
                
                usedCardIndices.add(randomIndex);
                selectedCard = cardsPool[randomIndex];
              } else {
                selectedCard = cardsPool[Math.floor(Math.random() * cardsPool.length)];
              }
            } else {
              selectedCard = "Error: No cards available";
            }
            break;
            
          case 'random':
          default:
            selectedCard = cardsPool[Math.floor(Math.random() * cardsPool.length)];
            break;
        }

        const randomTime = Math.floor(Math.random() * (maxTime - minTime + 1)) + minTime;
        const expiryTime = new Date(Date.now() + randomTime * 1000).toISOString();

        try {
          return safeRoomOperation(
            () => room.collection('player').update(player.id, {
              current_card: selectedCard,
              deck_name: selectedDeck.name, 
              expires_at: expiryTime,
              updated_at: new Date().toISOString(),
              total_duration_ms: randomTime * 1000 
            }),
            3,
            10000
          );
        } catch (error) {
          logError(`Failed to update player ${player.name}`, error);
          return null;
        }
      });

      const results = await Promise.allSettled(updatePromises);
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      
      setCardDistributionStatus(`Cards distributed to ${successCount}/${players.length} players`);
      
      if (isPlaying && !isEnding) {
        const nextDistributionTime = Math.max(minTime * 1000, 15000); 
        setTimeout(() => {
          if (isPlaying && !isEnding) {
            distributeCards();
          }
        }, nextDistributionTime);
      }

      return successCount;
    } catch (err) {
      logError('Card distribution error', err);
      setCardDistributionStatus(`Error distributing cards: ${err.message}`);
      return 0;
    }
  };

  // End session function
  const endSession = async () => {
    setCardDistributionStatus('Ending session...');
    
    setIsPlaying(false);
    setIsEnding(true);
    
    try {
      if (sessionData && sessionData.id) {
        await safeRoomOperation(() =>
          room.collection('session').update(sessionData.id, {
            is_playing: false,
            is_ending: true,
            last_updated: new Date().toISOString()
          }),
          3,
          8000
        );
      }
      
      setCardDistributionStatus('Sending END signal to players...');
      
      for (const player of players) {
        try {
          await safeRoomOperation(
            () => room.collection('player').update(player.id, {
              current_card: 'END',
              expires_at: null,
              updated_at: new Date().toISOString()
            }),
            5, 
            10000 
          );
        } catch (playerErr) {
          console.error(`[${APP_VERSION}] Failed to end session for ${player.name}:`, playerErr);
        }
      }
      
      if (sessionData && sessionData.id) {
        await safeRoomOperation(() =>
          room.collection('session').update(sessionData.id, {
            is_playing: false,
            is_ending: false,
            last_updated: new Date().toISOString()
          }),
          3,
          8000
        );
      }
      
      setCardDistributionStatus('Session ended successfully');
      setIsPlaying(false);
      setIsEnding(false);
      
      setTimeout(async () => {
        try {
          const finalPlayers = await room.collection('player')
            .filter({ session_pin: pin })
            .getList();
          
          if (finalPlayers) {
            setPlayers(finalPlayers);
          }
        } catch (err) {
          // Ignore
        }
      }, 1000);
      
    } catch (err) {
      logError('End session error', err);
      setCardDistributionStatus(`Error ending session: ${err.message}`);
      
      setIsPlaying(false);
      setIsEnding(false);
      
      try {
        if (sessionData && sessionData.id) {
          await room.collection('session').update(sessionData.id, {
            is_playing: false,
            is_ending: false
          });
        }
        
        for (const player of players) {
          try {
            room.collection('player').update(player.id, { current_card: 'END', expires_at: null });
          } catch (e) {} 
        }
      } catch (finalErr) {
        // Ignore final attempt errors
      }
    }
  };

  // Toggle expanded view for a player
  const togglePlayerExpanded = (playerId) => {
    setExpandedPlayers(prev => {
      if (prev.includes(playerId)) {
        return prev.filter(id => id !== playerId);
      } else {
        return [...prev, playerId];
      }
    });
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
        <h2 className="header">Create or Upload Decks</h2>
        
        <input
          type="text"
          className="input"
          placeholder="Deck Name (required)"
          value={deckName}
          onChange={(e) => setDeckName(e.target.value)}
          disabled={loading}
        />
        <textarea
          className="input"
          rows="5"
          placeholder="Enter cards, one per line:&#10;Card 1&#10;Card 2&#10;Card 3"
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          disabled={loading}
        ></textarea>
        <button 
          className={`btn btn-primary ${loading ? 'btn-disabled' : ''}`} 
          onClick={handleTextSubmit}
          disabled={loading}
        >
          {loading ? 'Creating...' : 'Add Deck'}
        </button>
        
        <div style={{ marginTop: '15px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div>
            <label htmlFor="file-upload" className="btn" style={{ display: 'inline-block', marginRight: '10px' }}>
              Upload JSON File
            </label>
            <input 
              id="file-upload"
              type="file" 
              accept=".json"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
              disabled={loading}
            />
            
            {savedDecks.length > 0 && (
              <button 
                className="btn"
                onClick={uploadAllSavedDecks}
                disabled={loading}
              >
                Upload All Saved Decks ({savedDecks.length})
              </button>
            )}
          </div>
        </div>
        
        {error && (
          <div style={{ color: 'red', marginTop: '15px', padding: '10px', backgroundColor: '#ffeeee', borderRadius: '8px' }}>
            <strong>Error:</strong> {error}
            <div style={{ marginTop: '8px', textAlign: 'right' }}>
              <button 
                className="btn btn-small"
                onClick={() => {
                  setError(null);
                  setLoading(false);
                  setDeckCreationStatus('Error state cleared');
                  setTimeout(() => setDeckCreationStatus(''), 2000);
                }}
                style={{ padding: '3px 8px', fontSize: '12px' }}
              >
                Clear Error
              </button>
            </div>
          </div>
        )}
        
        {deckCreationStatus && (
          <div className="helper-text" style={{ marginTop: '10px', fontWeight: 'bold' }}>
            {deckCreationStatus}
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="header">Available Decks</h2>
        {decks.length === 0 ? (
          <p>No decks created yet. Create a deck above to start.</p>
        ) : (
          <div className="deck-container">
            {decks.map((deck) => (
              <div 
                key={deck.id} 
                className={`deck-item ${deck.id === currentDeck ? 'deck-active' : ''}`}
                onClick={() => {
                  setCurrentDeck(deck.id);
                  setCurrentDeckName(deck.name);
                }}
                style={{ cursor: 'pointer' }}
              >
                <div>
                  <strong>{deck.name}</strong> ({deck.cards?.length || 0} cards)
                </div>
                <div>
                  {deck.id === currentDeck && (
                    <span style={{ 
                      backgroundColor: '#000', 
                      color: '#fff',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontSize: '12px'
                    }}>
                      SELECTED
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        
        <button 
          className="btn"
          onClick={() => refreshDecksList(true)}
          disabled={loading}
          style={{ marginTop: '10px' }}
        >
          Refresh Deck List
        </button>
      </div>

      <div className="card">
        <h2 className="header">Session Settings</h2>
        
        <div className="mb-4">
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            Card Distribution Mode:
          </label>
          <select 
            className="input" 
            value={mode} 
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="unison">Unison - Give everyone the same card</option>
            <option value="unique">Unique - Give everyone different cards</option>
            <option value="random">Random - Mix of same and different cards</option>
          </select>
          <p className="helper-text">
            {isPlaying ? 
              "Changes will apply to the next card distribution" : 
              "Choose how to distribute cards from the selected deck"}
          </p>
        </div>

        <div className="mb-4">
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            Card Display Duration (seconds):
          </label>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <div style={{ width: '50%' }}>
              <label>Min Time:</label>
              <input
                type="number"
                className="input"
                value={minTime}
                onChange={(e) => setMinTime(Math.max(5, parseInt(e.target.value) || 5))}
                min="5"
                max="300"
              />
            </div>
            <div style={{ width: '50%' }}>
              <label>Max Time:</label>
              <input
                type="number"
                className="input"
                value={maxTime}
                onChange={(e) => setMaxTime(Math.max(minTime, parseInt(e.target.value) || minTime))}
                min={minTime}
                max="300"
              />
            </div>
          </div>
          <p className="helper-text">
            System will pick a random time between min and max for each card
          </p>
        </div>

        <div className="mb-4">
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            Current Selected Deck:
          </label>
          <div style={{ 
            padding: '10px', 
            backgroundColor: '#f8f8f8', 
            borderRadius: '8px',
            border: '1px solid #ddd'
          }}>
            {currentDeck ? (
              <strong>{currentDeckName}</strong>
            ) : (
              <span className="helper-text">No deck selected</span>
            )}
          </div>
        </div>

        <div className="conductor-actions">
          {isPlaying ? (
            <button 
              className="btn btn-primary" 
              onClick={endSession}
              style={{ 
                backgroundColor: '#ff3b30', 
                borderColor: '#ff3b30',
                marginRight: '10px'
              }}
            >
              End Session
            </button>
          ) : (
            <button 
              className={`btn btn-primary ${(!currentDeck || players.length === 0) ? 'btn-disabled' : ''}`}
              onClick={() => setIsPlaying(true)}
              disabled={!currentDeck || players.length === 0}
              style={{ marginRight: '10px' }}
            >
              Start Session
            </button>
          )}
          
          {isPlaying && (
            <button 
              className="btn"
              onClick={distributeCards}
              style={{ marginRight: '10px' }}
            >
              Distribute New Cards Now
            </button>
          )}
          
          <button 
            className="btn"
            onClick={() => {
              if (isPlaying) {
                if (confirm('Are you sure you want to reset? This will stop the current session.')) {
                  setIsPlaying(false);
                  setIsEnding(false);
                }
              } else {
                setIsPlaying(false);
                setIsEnding(false);
              }
            }}
          >
            Reset Session
          </button>
        </div>
        
        {cardDistributionStatus && (
          <div className="status-message" style={{ marginTop: '15px' }}>
            {cardDistributionStatus}
          </div>
        )}
        
        {(!currentDeck || players.length === 0) && !isPlaying && (
          <div style={{ 
            marginTop: '15px',
            padding: '10px', 
            backgroundColor: '#fff9db', 
            borderRadius: '8px', 
            fontSize: '14px' 
          }}>
            <strong>Note:</strong> You need at least one deck selected and one player joined to start the session.
            {!currentDeck && decks.length > 0 && (
              <div style={{marginTop: '5px'}}>
                <button 
                  className="btn btn-small"
                  onClick={() => {
                    setCurrentDeck(decks[0].id);
                    setCurrentDeckName(decks[0].name);
                  }}
                  style={{padding: '3px 8px', fontSize: '12px'}}
                >
                  Select First Deck
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="header">
          Players ({players.length}/10)
          <span className="tooltip" style={{ fontSize: '14px', marginLeft: '8px' }}>
            <span className="help-icon">?</span>
            <span className="tooltip-text">Click on a player to see their current instruction</span>
          </span>
        </h2>
        
        {players.length === 0 ? (
          <p>No players have joined yet. Share the PIN with players to join.</p>
        ) : (
          <div className="player-list">
            {players.map((player) => (
              <div 
                key={player.id} 
                className="player-item"
                style={{ cursor: 'pointer' }}
                onClick={() => togglePlayerExpanded(player.id)}
              >
                <div className="conductor-card-info">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <strong>{player.name}</strong>
                      {player.current_card && player.current_card !== 'END' && (
                        <span style={{ 
                          marginLeft: '10px', 
                          padding: '2px 6px', 
                          backgroundColor: '#f0f0f0', 
                          borderRadius: '4px',
                          fontSize: '12px'
                        }}>
                          {player.deck_name ? `From: ${player.deck_name}` : 'Has card'}
                        </span>
                      )}
                      {player.current_card === 'END' && (
                        <span style={{ 
                          marginLeft: '10px', 
                          padding: '2px 6px', 
                          backgroundColor: '#ffeeee', 
                          borderRadius: '4px',
                          fontSize: '12px'
                        }}>
                          Session Ended
                        </span>
                      )}
                    </div>
                    <div>
                      {player.expires_at && (
                        <span style={{ 
                          fontSize: '16px', 
                          fontWeight: 'bold',
                          color: getTimeLeft(player.expires_at) < 10 ? '#ff3b30' : '#000'
                        }}>
                          {getTimeLeft(player.expires_at)}s
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {player.expires_at && (
                    <div className="player-timer-bar">
                      <div 
                        className="player-timer-progress"
                        style={{ 
                          width: `${calculateProgressPercent(player)}%`,
                          backgroundColor: getTimeLeft(player.expires_at) < 10 ? '#ff3b30' : '#000'
                        }}
                      ></div>
                    </div>
                  )}
                  
                  {(expandedPlayers.includes(player.id) || player.current_card) && 
                   player.current_card && player.current_card !== 'END' && (
                    <div className="player-card-content">
                      "{player.current_card}"
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        
        <div style={{ marginTop: '15px' }}>
          <button 
            className="btn"
            onClick={async () => {
              try {
                const polledPlayers = await room.collection('player')
                  .filter({ session_pin: pin })
                  .getList();
                
                if (polledPlayers) {
                  setPlayers(polledPlayers);
                  alert(`Found ${polledPlayers.length} player(s)`);
                }
              } catch (err) {
                console.error(`[${APP_VERSION}] Player refresh error:`, err);
                alert('Error refreshing player list. Please try again.');
              }
            }}
          >
            Refresh Player List
          </button>
          
          <button 
            className="btn"
            onClick={() => setShowDebugInfo(!showDebugInfo)}
            style={{ marginLeft: '10px' }}
          >
            {showDebugInfo ? 'Hide Debug Info' : 'Show Debug Info'}
          </button>
        </div>
        
        {showDebugInfo && (
          <div className="debug-panel">
            <p>Version: {APP_VERSION}</p>
            <p>Session PIN: {pin}</p>
            <p>Mode: {mode}</p>
            <p>Network Quality: {networkQuality}</p>
            <p>Last Card Distribution: {lastCardDistribution ? new Date(lastCardDistribution.timestamp).toLocaleTimeString() : 'Never'}</p>
            <p>Active Players: {players.filter(p => p.current_card && p.current_card !== 'END').length}</p>
          </div>
        )}
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
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [emergencyModeActive, setEmergencyModeActive] = useState(false);
  
  const playerDataRef = useRef(null);
  const lastCardContent = useRef(null);
  const directRenderBypassRef = useRef(null);
  const lastExpiryTime = useRef(null);
  const lastCardSyncTimestamp = useRef(Date.now());
  const cardUpdateCountRef = useRef(0);
  const timerRef = useRef(null);
  const initialSetupDone = useRef(false);
  const pollIntervalRef = useRef(null);
  const cardCheckIntervalRef = useRef(null);
  const directDisplayCountdownIntervalRef = useRef(null);

  const createDirectDisplay = () => {
    if (!document.getElementById('direct-display-container')) {
      console.log(`[${APP_VERSION}] Creating direct display container`);
      
      const container = document.createElement('div');
      container.id = 'direct-display-container';
      container.style.position = 'fixed';
      container.style.top = '0';
      container.style.left = '0';
      container.style.width = '100%';
      container.style.height = '100%';
      container.style.backgroundColor = 'white';
      container.style.zIndex = '10000';
      container.style.display = 'none';
      container.style.flexDirection = 'column';
      container.style.justifyContent = 'center';
      container.style.alignItems = 'center';
      container.style.padding = '20px';
      container.style.textAlign = 'center';
      container.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
      
      document.body.appendChild(container);
      directRenderBypassRef.current = container;
    }
  };
  
  useEffect(() => {
    createDirectDisplay();
    
    return () => {
      if (directRenderBypassRef.current) {
        directRenderBypassRef.current.remove();
        directRenderBypassRef.current = null;
      }
      
      if (directDisplayCountdownIntervalRef.current) {
        clearInterval(directDisplayCountdownIntervalRef.current);
        directDisplayCountdownIntervalRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (directDisplayCountdownIntervalRef.current) {
      clearInterval(directDisplayCountdownIntervalRef.current);
    }
    
    directDisplayCountdownIntervalRef.current = setInterval(() => {
      updateDirectDisplay();
    }, 100);
    
    return () => {
      if (directDisplayCountdownIntervalRef.current) {
        clearInterval(directDisplayCountdownIntervalRef.current);
      }
    };
  }, []);

  const processPlayerData = (player) => {
    if (!player) return false;
    
    try {
      playerDataRef.current = player;
      
      if (player.current_card && player.current_card !== lastCardContent.current) {
        lastCardContent.current = player.current_card;
        lastCardSyncTimestamp.current = Date.now();
        console.log(`[${APP_VERSION}] NEW CARD RECEIVED: "${player.current_card}"`);
      }
      
      if (player.current_card) {
        setCurrentCard(player.current_card);
        cardUpdateCountRef.current++;
        
        if (player.expires_at) {
          lastExpiryTime.current = player.expires_at;
          
          const expiry = new Date(player.expires_at).getTime();
          const now = Date.now();
          const remaining = Math.max(0, (expiry - now) / 1000);
          setTimeLeft(remaining);
          
          if (player.total_duration_ms) {
            setTotalTime(player.total_duration_ms / 1000);
          } else if (totalTime <= 0) {
            setTotalTime(Math.max(30, remaining)); 
          }
        }
      }
      
      return true;
    } catch (err) {
      console.error(`[${APP_VERSION}] Error processing player data:`, err);
      return false;
    }
  };

  const setupPlayer = async () => {
    try {
      setLoading(true);
      setConnectionStatus('connecting');
      console.log(`[${APP_VERSION}] Player setup initiated: PIN=${pin}, Name=${playerName}`);

      const sessions = await safeRoomOperation(
        () => room.collection('session').filter({ pin }).getList(),
        3,
        12000
      );
      
      if (!sessions || sessions.length === 0) {
        setError('Session not found. Please check your PIN.');
        setLoading(false);
        setConnectionStatus('error: session not found');
        return;
      }

      console.log(`[${APP_VERSION}] Connected to session with PIN: ${pin}`);
      setConnectionStatus('checking player');
      
      let players = await safeRoomOperation(
        () => room.collection('player').filter({ 
          session_pin: pin, 
          name: playerName 
        }).getList(),
        2,
        8000
      );
      
      if (players && players.length > 0) {
        const foundPlayer = players[0];
        setPlayerId(foundPlayer.id);
        console.log(`[${APP_VERSION}] Found existing player: ${foundPlayer.name}, ID: ${foundPlayer.id}`);
        
        processPlayerData(foundPlayer);
      } else {
        setConnectionStatus('creating player');
        
        try {
          const newPlayer = await safeRoomOperation(
            () => room.collection('player').create({
              session_pin: pin,
              name: playerName,
              current_card: null,
              expires_at: null,
              joined_at: new Date().toISOString(),
              client_info: `${APP_VERSION}|${navigator.userAgent.slice(0, 50)}`
            }),
            4,
            15000
          );
          
          setPlayerId(newPlayer.id);
          console.log(`[${APP_VERSION}] Created new player with ID: ${newPlayer.id}`);
        } catch (createErr) {
          logError('Failed to create player', createErr);
          setError('Failed to join as player. Please try again.');
          setLoading(false);
          return;
        }
      }

      setLoading(false);
      setConnectionStatus('connected');
      console.log(`[${APP_VERSION}] Player setup complete, ID: ${playerId}`);

      pollIntervalRef.current = setInterval(async () => {
        try {
          const polledPlayers = await room.collection('player')
            .filter({ session_pin: pin, name: playerName })
            .getList();
          
          if (polledPlayers && polledPlayers.length > 0) {
            processPlayerData(polledPlayers[0]);
          }
        } catch (pollErr) {
          // Silent fail for polling - it's just a backup
        }
      }, 1000);

      cardCheckIntervalRef.current = setInterval(async () => {
        try {
          const polledPlayers = await room.collection('player')
            .filter({ session_pin: pin, name: playerName })
            .getList();
          
          if (polledPlayers && polledPlayers.length > 0) {
            const player = polledPlayers[0];
            
            processPlayerData(player);
            
            const reactCardElement = document.querySelector('.card-text');
            
            if (player.current_card && player.current_card !== 'END' &&
                (!reactCardElement || reactCardElement.textContent !== player.current_card)) {
              console.log(`[${APP_VERSION}] DISPLAY ERROR DETECTED: Card "${player.current_card}" not visible in DOM!`);
              
              setEmergencyModeActive(true);
            }
          }
          
          if (lastCardSyncTimestamp.current) {
            const timeSinceLastSync = Date.now() - lastCardSyncTimestamp.current;
            if (timeSinceLastSync > 15000) { 
              console.log(`[${APP_VERSION}] WARNING: No card updates for ${Math.round(timeSinceLastSync/1000)}s, forcing sync...`);
              
              const refreshedPlayers = await room.collection('player')
                .filter({ session_pin: pin, name: playerName })
                .getList();
              
              if (refreshedPlayers && refreshedPlayers.length > 0) {
                processPlayerData(refreshedPlayers[0]);
                lastCardSyncTimestamp.current = Date.now();
              }
            }
          }
        } catch (error) {
          // Silent fail - this is just a backup check
        }
      }, 2000);

      return room.collection('player')
        .filter({ session_pin: pin, name: playerName })
        .subscribe(playersList => {
          if (playersList && playersList.length > 0) {
            processPlayerData(playersList[0]);
          }
        });
    } catch (err) {
      const errorMsg = logError('Failed to setup player', err);
      setError('Failed to connect to session. Please try again.');
      setLoading(false);
      setConnectionStatus('error: setup failed');
    }
  };

  useEffect(() => {
    if (initialSetupDone.current) return;
    
    initialSetupDone.current = true;
    
    setupPlayer();
    
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      
      if (cardCheckIntervalRef.current) {
        clearInterval(cardCheckIntervalRef.current);
      }
    };
  }, [pin, playerName]);

  useEffect(() => {
    if (currentCard && currentCard !== 'END' && timeLeft > 0) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      
      const lastTimeRef = { current: Date.now() };
      
      timerRef.current = setInterval(() => {
        const now = Date.now();
        const elapsed = (now - lastTimeRef.current) / 1000;
        lastTimeRef.current = now;
        
        setTimeLeft(prev => {
          const newTime = Math.max(0, prev - elapsed);
          
          if (newTime <= 0 && currentCard) {
            setTimeout(async () => {
              try {
                const players = await room.collection('player')
                  .filter({ session_pin: pin, name: playerName })
                  .getList();
                
                if (players && players.length > 0) {
                  processPlayerData(players[0]);
                }
              } catch (err) {
                // Silent fail
              }
            }, 500);
          }
          
          return parseFloat(newTime.toFixed(1)); 
        });
      }, 100); 

      return () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }
      };
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
  }, [currentCard, timeLeft, pin, playerName]);

  const updateDirectDisplay = () => {
    if (!directRenderBypassRef.current) return;
    
    const container = directRenderBypassRef.current;
    const reactCardElement = document.querySelector('.card-text');
    const reactTimer = document.querySelector('.timer-bar');
    
    let cardToDisplay = lastCardContent.current;
    const playerData = playerDataRef.current;
    
    let displayTimeLeft = 0;
    let displayTotalTime = 0;
    let showEmergencyDisplay = false;
    
    if (lastExpiryTime.current) {
      const expiry = new Date(lastExpiryTime.current).getTime();
      const now = Date.now();
      displayTimeLeft = Math.max(0, (expiry - now) / 1000);
    }
    
    if (cardToDisplay && cardToDisplay !== 'END' && displayTimeLeft > 0) {
      const reactDisplayWorking = reactCardElement && 
                                 reactCardElement.textContent === cardToDisplay &&
                                 reactTimer;
      
      showEmergencyDisplay = !reactDisplayWorking || emergencyModeActive;
      
      if (showEmergencyDisplay) {
        if (playerData && playerData.total_duration_ms) {
          displayTotalTime = playerData.total_duration_ms / 1000;
        } else {
          displayTotalTime = Math.max(30, displayTimeLeft + 5);
        }
        
        const progressPercent = displayTotalTime > 0 ? 
            Math.min(100, Math.max(0, ((displayTotalTime - displayTimeLeft) / displayTotalTime) * 100)) : 0;
        
        container.innerHTML = `
          <div style="background-color: white; border-radius: 16px; padding: 40px 20px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); width: 90%; max-width: 500px;">
            <h1 style="font-size: 36px; font-weight: bold; color: black; word-wrap: break-word; text-shadow: 0 0 1px rgba(0,0,0,0.1); padding: 10px; line-height: 1.4;">
              ${cardToDisplay}
            </h1>
            
            <div style="margin-top: 30px; text-align: center;">
              <span style="font-size: 48px; font-weight: bold; color: ${displayTimeLeft < 10 ? '#ff3b30' : '#000'}">
                ${Math.ceil(displayTimeLeft)}
              </span>
              <span style="font-size: 20px;"> seconds remaining</span>
            </div>
            
            <div style="margin-top: 30px; width: 100%; height: 14px; background-color: #eee; border-radius: 4px; overflow: hidden;">
              <div style="width: ${progressPercent}%; height: 100%; background-color: ${displayTimeLeft < 10 ? '#ff3b30' : '#000'}; border-radius: 4px;"></div>
            </div>
            
            <p style="margin-top: 20px; font-size: 12px; color: #888;">Direct display mode - v${APP_VERSION}</p>
          </div>
        `;
        
        container.style.display = 'flex';
      } else {
        container.style.display = 'none';
        if (emergencyModeActive) {
          setEmergencyModeActive(false);
        }
      }
    } else if (cardToDisplay === 'END') {
      container.innerHTML = `
        <div style="background-color: white; border-radius: 16px; padding: 40px 20px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); width: 90%; max-width: 500px;">
          <h1 style="font-size: 36px; font-weight: bold; color: black; word-wrap: break-word; text-shadow: 0 0 1px rgba(0,0,0,0.1); padding: 10px; line-height: 1.4;">
            SESSION ENDED
          </h1>
          <p>Thank you for playing!</p>
          <button style="margin-top: 20px; padding: 10px 20px; font-size: 16px; font-weight: bold; cursor: pointer; border: 2px solid black; border-radius: 8px; background-color: white;" onclick="window.location.href = window.location.origin + window.location.pathname">
            Return to Home
          </button>
          <p style="margin-top: 10px; font-size: 12px; color: #888;">Direct display mode - v${APP_VERSION}</p>
        </div>
      `;
      container.style.display = 'flex';
    } else {
      container.style.display = 'none';
    }
  };

  const getProgressWidth = () => {
    if (timeLeft <= 0 || totalTime <= 0) return 0;
    const percentage = ((totalTime - timeLeft) / totalTime) * 100;
    return Math.min(100, Math.max(0, percentage)); 
  };

  useEffect(() => {
    if (loading) {
      setEmergencyModeActive(false);
      if (directRenderBypassRef.current) {
        directRenderBypassRef.current.style.display = 'none';
      }
    }
  }, [loading]);

  if (loading) {
    return (
      <div className="fullscreen-card">
        <div>
          <h2 className="header">Connecting to session...</h2>
          <p>Status: {connectionStatus}</p>
          <div style={{ marginTop: '20px', width: '100%', height: '8px', backgroundColor: '#eee', borderRadius: '4px' }}>
            <div 
              style={{ 
                width: '30%', 
                height: '100%', 
                backgroundColor: '#000', 
                borderRadius: '4px',
                animation: 'progress-bar 1.5s infinite'
              }}
            ></div>
          </div>
          <p style={{ marginTop: '10px', fontSize: '12px', color: '#888' }}>
            Version: {APP_VERSION}
          </p>
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
          <p style={{ fontSize: '14px', marginTop: '8px' }}>Status: {connectionStatus}</p>
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
          <p style={{ marginTop: '10px', fontSize: '12px', color: '#888' }}>
            Version: {APP_VERSION}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100vh', position: 'relative' }} id="player-view-container">
      {currentCard && currentCard !== 'END' ? (
        <div className="fullscreen-card" id="card-display">
          <div style={{ width: '100%' }}>
            <h1 className="card-text" style={{ fontSize: '36px', padding: '10px' }}>{currentCard}</h1>
            
            <div style={{ marginTop: '30px', textAlign: 'center' }}>
              <span style={{ 
                fontSize: '48px', 
                fontWeight: 'bold',
                color: timeLeft < 10 ? '#ff3b30' : '#000'
              }}>
                {Math.ceil(timeLeft)}
              </span>
              <span style={{ fontSize: '20px' }}> seconds remaining</span>
            </div>
            
            <div className="timer-bar" style={{ height: '14px', marginTop: '30px' }}>
              <div 
                className="timer-progress"
                style={{ 
                  width: `${getProgressWidth()}%`,
                  transition: 'width 0.1s linear', 
                  backgroundColor: timeLeft < 10 ? '#ff3b30' : '#000'
                }}
              ></div>
            </div>
            
            {emergencyModeActive && (
              <div style={{ 
                marginTop: '10px', 
                padding: '5px 10px',
                backgroundColor: '#fffde7', 
                border: '1px solid #ffd700',
                borderRadius: '4px',
                fontSize: '12px',
                display: 'inline-block'
              }}>
                Emergency backup active
              </div>
            )}
            
            <div 
              onDoubleClick={() => alert(`Debug: Card="${currentCard}", Time=${timeLeft}s, Total=${totalTime}s, Emergency=${emergencyModeActive ? 'YES' : 'NO'}`)}
              style={{ fontSize: '10px', color: '#fff', position: 'absolute', bottom: '5px', right: '5px', cursor: 'default' }}
            >
              v{APP_VERSION}
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
              <p style={{ marginTop: '15px', fontWeight: 'bold' }}>
                Waiting for conductor to start the session
              </p>
            )}
            <div className="connection-status">
              Status: {connectionStatus === 'connected' ? '✓ Connected' : connectionStatus}
            </div>
            <p style={{ marginTop: '10px', fontSize: '12px', color: '#888' }}>
              Version: {APP_VERSION}
            </p>
            
            <button 
              className="btn"
              onClick={() => {
                console.log(`[${APP_VERSION}] Manual reconnect initiated`);
                setConnectionStatus('manually reconnecting...');
                
                room.collection('player')
                  .filter({ session_pin: pin, name: playerName })
                  .getList()
                  .then(players => {
                    if (players && players.length > 0) {
                      processPlayerData(players[0]);
                      setConnectionStatus('reconnected');
                    }
                  })
                  .catch(err => {
                    console.error(`[${APP_VERSION}] Manual reconnect error:`, err);
                    setConnectionStatus('reconnect failed');
                  });
              }}
              style={{ marginTop: '15px' }}
            >
              Reconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function getTimeLeft(expiryTime) {
  if (!expiryTime) return 0;
  const expiry = new Date(expiryTime).getTime();
  const now = Date.now();
  return Math.max(0, Math.floor((expiry - now) / 1000));
}

function calculateProgressPercent(player) {
  if (!player.expires_at) return 0;
  
  const expiry = new Date(player.expires_at).getTime();
  const now = Date.now();
  const totalDuration = player.total_duration_ms || 30000;
  const elapsed = totalDuration - Math.max(0, expiry - now);
  
  return Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));
}

try {
  const root = createRoot(document.getElementById('root'));
  root.render(<App />);
  console.log(`[${APP_VERSION}] App rendered successfully`);
} catch (err) {
  const errorMsg = logError("Error rendering app", err);
  const loadingEl = document.getElementById('loading');
  if (loadingEl) {
    loadingEl.innerHTML = `
      <div style="text-align:center;">
        <h2>Error loading application</h2>
        <p>${errorMsg}</p>
        <p>Version: ${APP_VERSION}</p>
        <button onclick="window.location.reload()" style="padding:10px 20px; margin-top:20px; cursor:pointer;">
          Reload Page
        </button>
      </div>
    `;
  }
}