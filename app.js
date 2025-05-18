// App Version for tracking
const APP_VERSION = "1.18.0";

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

// Conductor View with completely redesigned deck handling and card distribution
function ConductorView({ setView, sessionData, setSessionData }) {
  const [decks, setDecks] = useState([]);
  const [currentDeck, setCurrentDeck] = useState(null);
  const [currentDeckName, setCurrentDeckName] = useState('');
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
  const [deckCreationStatus, setDeckCreationStatus] = useState('');
  const [lastDeckRefresh, setLastDeckRefresh] = useState(0);
  const [manualRefreshCount, setManualRefreshCount] = useState(0);
  const [savedDecks, setSavedDecks] = useState([]);
  const [showSavedDecks, setShowSavedDecks] = useState(false);
  const [deckOperationId, setDeckOperationId] = useState(0); 
  const deckRefIntervalRef = useRef(null); 
  const [optimisticDecks, setOptimisticDecks] = useState([]);
  const [processingQueue, setProcessingQueue] = useState([]);
  const [networkQuality, setNetworkQuality] = useState('unknown');
  const [lastCardDistribution, setLastCardDistribution] = useState(null);
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  const [cardDistributionStatus, setCardDistributionStatus] = useState('');
  const [expandedPlayers, setExpandedPlayers] = useState([]);

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

  // Create shareable link when PIN is set
  useEffect(() => {
    if (pin) {
      const shareableUrl = `${window.baseUrl || window.location.origin + window.location.pathname}?pin=${pin}`;
      reportStatus('ConductorView', 'Shareable link created', { url: shareableUrl });
    }
  }, [pin]);

  // Subscribe to players with ultra-reliability
  useEffect(() => {
    if (pin) {
      reportStatus('ConductorView', 'Setting up player subscription', { pin });
      let unsubscribed = false;
      let retryCount = 0;
      let intervalId = null;
      
      const subscribeWithRetry = () => {
        if (unsubscribed) return () => {};
        
        try {
          reportStatus('ConductorView', 'Subscribing to players', { pin, retryCount });
          
          return room.collection('player')
            .filter({ session_pin: pin })
            .subscribe(playersList => {
              if (unsubscribed) return;
              
              reportStatus('ConductorView', 'Players updated', { count: playersList?.length || 0 });
              setPlayers(playersList || []);
              retryCount = 0; 
            });
        } catch (err) {
          logError(`Error subscribing to players (retry ${retryCount})`, err);
          
          if (!unsubscribed && retryCount < 10) {
            retryCount++;
            setTimeout(() => {
              if (!unsubscribed) subscribeWithRetry();
            }, Math.min(1000 * retryCount, 10000));
          }
          
          return () => {};
        }
      };
      
      const unsubscribe = subscribeWithRetry();
      
      intervalId = setInterval(async () => {
        if (unsubscribed) return;
        
        try {
          reportStatus('ConductorView', 'Polling players (fallback)', { pin });
          const polledPlayers = await room.collection('player')
            .filter({ session_pin: pin })
            .getList();
          
          if (polledPlayers && !unsubscribed) {
            setPlayers(polledPlayers);
          }
        } catch (err) {
          logError('Player polling fallback failed', err);
        }
      }, 8000); 

      return () => {
        unsubscribed = true;
        if (typeof unsubscribe === 'function') {
          unsubscribe();
        }
        if (intervalId) {
          clearInterval(intervalId);
        }
      };
    }
  }, [pin]);

  // Ultra-reliable deck subscription with fallbacks
  useEffect(() => {
    if (pin) {
      reportStatus('ConductorView', 'Setting up deck subscription', { pin });
      let unsubscribed = false;
      let retryCount = 0;
      let intervalId = null;
      
      const subscribeWithRetry = () => {
        if (unsubscribed) return () => {};
        
        try {
          reportStatus('ConductorView', 'Subscribing to decks', { pin, retryCount });
          
          return room.collection('deck')
            .filter({ session_pin: pin })
            .subscribe(decksList => {
              if (unsubscribed) return;
              
              reportStatus('ConductorView', 'Decks updated via subscription', { 
                count: decksList?.length || 0,
                received: new Date().toISOString()
              });
              
              const enhancedDecks = (decksList || []).map(deck => ({
                ...deck,
                _received: new Date().toISOString()
              }));
              
              setDecks(enhancedDecks);
              
              if (enhancedDecks.length > 0 && !currentDeck) {
                setCurrentDeck(enhancedDecks[0].id);
                setCurrentDeckName(enhancedDecks[0].name);
              } else if (currentDeck) {
                // Update current deck name if the current deck exists
                const selectedDeck = enhancedDecks.find(d => d.id === currentDeck);
                if (selectedDeck) {
                  setCurrentDeckName(selectedDeck.name);
                }
              }
              
              retryCount = 0; 
            });
        } catch (err) {
          logError(`Error subscribing to decks (retry ${retryCount})`, err);
          
          if (!unsubscribed && retryCount < 10) {
            retryCount++;
            setTimeout(() => {
              if (!unsubscribed) subscribeWithRetry();
            }, Math.min(1000 * retryCount, 10000));
          }
          
          return () => {};
        }
        };
      
      const unsubscribe = subscribeWithRetry();
      
      intervalId = setInterval(async () => {
        if (unsubscribed) return;
        
        try {
          reportStatus('ConductorView', 'Polling decks (fallback)', { pin });
          const polledDecks = await room.collection('deck')
            .filter({ session_pin: pin })
            .getList();
          
          if (polledDecks && !unsubscribed) {
            reportStatus('ConductorView', 'Decks updated via polling', { 
              count: polledDecks.length 
            });
            
            const enhancedDecks = polledDecks.map(deck => ({
              ...deck,
              _received: new Date().toISOString()
            }));
            
            setDecks(enhancedDecks);
            
            if (enhancedDecks.length > 0 && !currentDeck) {
              setCurrentDeck(enhancedDecks[0].id);
              setCurrentDeckName(enhancedDecks[0].name);
            }
          }
        } catch (err) {
          logError('Deck polling fallback failed', err);
        }
      }, 10000); 

      setTimeout(refreshDecksList, 2000);
      
      return () => {
        unsubscribed = true;
        if (typeof unsubscribe === 'function') {
          unsubscribe();
        }
        if (intervalId) {
          clearInterval(intervalId);
        }
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
      // Only distribute if we haven't recently or if the last distribution was for a different deck
      const shouldDistribute = !lastCardDistribution || 
                              (Date.now() - lastCardDistribution.timestamp > 5000) || 
                              (lastCardDistribution.deckId !== currentDeck);
      
      if (shouldDistribute) {
        distributeCards();
      }
    } else if (!isPlaying && isEnding) {
      // End the session and clear all player cards
      endSession();
    }
  }, [isPlaying, isEnding, players.length, currentDeck]);

  // Card distribution function
  const distributeCards = async () => {
    if (!currentDeck || players.length === 0 || !isPlaying || isEnding) {
      setCardDistributionStatus('Cannot distribute cards: missing deck, players, or not in play mode');
      return;
    }

    setCardDistributionStatus('Preparing to distribute cards...');

    try {
      // Get the selected deck
      const selectedDeck = decks.find(deck => deck.id === currentDeck);
      if (!selectedDeck || !selectedDeck.cards || selectedDeck.cards.length === 0) {
        setCardDistributionStatus('Error: Selected deck has no cards');
        return;
      }

      const cardsPool = [...selectedDeck.cards];
      
      // Update timestamp to prevent rapid re-distribution
      setLastCardDistribution({
        timestamp: Date.now(),
        deckId: currentDeck
      });

      setCardDistributionStatus(`Distributing cards from "${selectedDeck.name}" to ${players.length} players in ${mode} mode...`);

      // PRE-SELECT THE CARD FOR UNISON MODE BEFORE THE PLAYER LOOP
      let unisonCard = null;
      
      if (mode === 'unison') {
        // Everyone gets the same card - select it once outside the loop
        const randomIndex = Math.floor(Math.random() * cardsPool.length);
        unisonCard = cardsPool[randomIndex];
        console.log(`[${APP_VERSION}] Unison mode: Selected card "${unisonCard}" for all players`);
      }

      // Track which cards are already distributed for unique mode
      const usedCardIndices = new Set();

      // Distribute cards based on mode
      const updatePromises = players.map(async (player) => {
        let selectedCard;
        
        switch (mode) {
          case 'unison':
            // Everyone gets the same pre-selected card
            selectedCard = unisonCard;
            break;
            
          case 'unique':
            if (cardsPool.length > 0) {
              // Find an unused card if possible
              if (usedCardIndices.size < cardsPool.length) {
                let randomIndex;
                do {
                  randomIndex = Math.floor(Math.random() * cardsPool.length);
                } while (usedCardIndices.has(randomIndex));
                
                usedCardIndices.add(randomIndex);
                selectedCard = cardsPool[randomIndex];
              } else {
                // If all cards are used, pick a random one
                selectedCard = cardsPool[Math.floor(Math.random() * cardsPool.length)];
              }
            } else {
              selectedCard = "Error: No cards available";
            }
            break;
            
          case 'random':
          default:
            // True random - just pick any card
            selectedCard = cardsPool[Math.floor(Math.random() * cardsPool.length)];
            break;
        }

        // Calculate random time between min and max
        const randomTime = Math.floor(Math.random() * (maxTime - minTime + 1)) + minTime;
        const expiryTime = new Date(Date.now() + randomTime * 1000).toISOString();

        try {
          return safeRoomOperation(
            () => room.collection('player').update(player.id, {
              current_card: selectedCard,
              deck_name: selectedDeck.name, // Add deck name for reference
              expires_at: expiryTime,
              updated_at: new Date().toISOString(),
              total_duration_ms: randomTime * 1000 // Add total duration for better progress calculation
            }),
            3,
            10000
          );
        } catch (error) {
          logError(`Failed to update player ${player.name}`, error);
          return null;
        }
      });

      // Use Promise.allSettled to handle partial failures
      const results = await Promise.allSettled(updatePromises);
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      
      setCardDistributionStatus(`Cards distributed to ${successCount}/${players.length} players`);
      
      // Schedule next distribution if still playing
      if (isPlaying && !isEnding) {
        const nextDistributionTime = Math.max(minTime * 1000, 15000); // At least 15 seconds
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

  // End session function - COMPLETELY REWRITTEN FOR RELIABILITY
  const endSession = async () => {
    setCardDistributionStatus('Ending session...');
    
    // Immediately stop any ongoing activity
    setIsPlaying(false);
    setIsEnding(true);
    
    try {
      // Force-stop the session first before any player updates to prevent race conditions
      if (sessionData && sessionData.id) {
        console.log(`[${APP_VERSION}] Ending session: Updating session state to stopped`);
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
      
      // Use a more direct approach for ending - don't rely on Promise.allSettled
      // Update players one by one with forced retries
      setCardDistributionStatus('Sending END signal to players...');
      
      for (const player of players) {
        try {
          console.log(`[${APP_VERSION}] Ending session: Sending END to ${player.name}`);
          // More aggressive timeout and retries for critical end operation
          await safeRoomOperation(
            () => room.collection('player').update(player.id, {
              current_card: 'END',
              expires_at: null,
              updated_at: new Date().toISOString()
            }),
            5, // More retries
            10000 // Longer timeout
          );
        } catch (playerErr) {
          console.error(`[${APP_VERSION}] Failed to end session for ${player.name}:`, playerErr);
          // Continue with other players even if one fails
        }
      }
      
      // Verify players are actually updated
      setCardDistributionStatus('Confirming all players received END signal...');
      
      try {
        // Get fresh player data to confirm updates
        const updatedPlayers = await room.collection('player')
          .filter({ session_pin: pin })
          .getList();
        
        const endedCount = updatedPlayers.filter(p => p.current_card === 'END').length;
        console.log(`[${APP_VERSION}] End confirmation: ${endedCount}/${updatedPlayers.length} players marked as ended`);
        
        // If any players weren't updated, try again just for them
        if (endedCount < updatedPlayers.length) {
          const notEndedPlayers = updatedPlayers.filter(p => p.current_card !== 'END');
          
          for (const player of notEndedPlayers) {
            try {
              console.log(`[${APP_VERSION}] Retry ending for ${player.name}`);
              await room.collection('player').update(player.id, {
                current_card: 'END',
                expires_at: null,
                updated_at: new Date().toISOString()
              });
            } catch (retryErr) {
              // Just log and continue
              console.error(`[${APP_VERSION}] Retry failed for ${player.name}:`, retryErr);
            }
          }
        }
      } catch (verifyErr) {
        console.error(`[${APP_VERSION}] End verification failed:`, verifyErr);
        // Continue with session finalization regardless
      }
      
      // Final session state update
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
      
      // Force refresh player list to show final state
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
      
      // Safety fallback - reset state even if error
      setIsPlaying(false);
      setIsEnding(false);
      
      // Try one more time with absolutely minimal approach
      try {
        if (sessionData && sessionData.id) {
          await room.collection('session').update(sessionData.id, {
            is_playing: false,
            is_ending: false
          });
        }
        
        // Direct database calls without error handling for last-ditch effort
        for (const player of players) {
          try {
            room.collection('player').update(player.id, { current_card: 'END', expires_at: null });
          } catch (e) {} // Intentionally empty catch
        }
      } catch (finalErr) {
        // Ignore final attempt errors
      }
    }
  };

  // Rendering the view - include optimistic decks in display
  const displayDecks = useMemo(() => {
    // Include both real decks and optimistic ones that aren't errored
    const validOptimistic = optimisticDecks.filter(d => !d._error);
    const combinedDecks = [...decks];
    
    // Add optimistic decks not already in the regular deck list
    validOptimistic.forEach(optDeck => {
      if (!combinedDecks.some(d => d._opId === optDeck._opId)) {
        combinedDecks.push(optDeck);
      }
    });
    
    return combinedDecks;
  }, [decks, optimisticDecks]);

  // Network quality assessment
  useEffect(() => {
    const checkNetworkQuality = async () => {
      const start = Date.now();
      try {
        // Make a small request to check network responsiveness
        await fetch('https://www.cloudflare.com/cdn-cgi/trace', { 
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
        
        console.log(`[${APP_VERSION}] Network quality check: ${responseTime}ms`);
      } catch (err) {
        console.log(`[${APP_VERSION}] Network quality check failed`);
        setNetworkQuality('poor');
      }
    };
    
    checkNetworkQuality();
    // Re-check every 2 minutes
    const interval = setInterval(checkNetworkQuality, 120000);
    return () => clearInterval(interval);
  }, []);

  // Enhanced deck list refresh
  const refreshDecksList = async (showFeedback = true) => {
    const refreshId = Date.now();
    setLastDeckRefresh(refreshId);
    
    if (showFeedback) {
      setManualRefreshCount(prev => prev + 1);
      setDeckCreationStatus('Refreshing deck list...');
    }
    
    try {
      // Choose timeout based on network quality
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
        
        const enhancedDecks = fetchedDecks.map(deck => ({
          ...deck,
          _refreshed: new Date().toISOString(),
          _refreshId: refreshId
        }));
        
        setDecks(enhancedDecks);
        
        if (enhancedDecks.length > 0 && !currentDeck) {
          setCurrentDeck(enhancedDecks[0].id);
          setCurrentDeckName(enhancedDecks[0].name);
        } else if (currentDeck) {
          // Update current deck name if the current deck exists
          const selectedDeck = enhancedDecks.find(d => d.id === currentDeck);
          if (selectedDeck) {
            setCurrentDeckName(selectedDeck.name);
          }
        }
        
        if (showFeedback) {
          setDeckCreationStatus(`Found ${enhancedDecks.length} deck${enhancedDecks.length !== 1 ? 's' : ''}`);
          setTimeout(() => setDeckCreationStatus(''), 3000);
        }
        
        // Clean up any optimistic decks that now exist in real list
        setOptimisticDecks(prev => {
          return prev.filter(optDeck => {
            // Keep it if it has an error or if we don't have a matching real deck
            return optDeck._error || !enhancedDecks.some(d => d._opId === optDeck._opId);
          });
        });
      } else {
        throw new Error('Invalid response from server');
      }
    } catch (err) {
      console.error(`[${APP_VERSION}] Deck refresh error:`, err);
      
      if (showFeedback) {
        setDeckCreationStatus(`Could not refresh from server. Using local data.`);
      }
      // We continue using the decks we have in state
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

  // Calculate progress for player timer
  const getPlayerProgress = (player) => {
    if (!player.expires_at) return 0;
    
    const timestamp = playerDataRef.current?.expires_at;
    if (!timestamp) return 0;
    
    const expiry = new Date(timestamp).getTime();
    const now = Date.now();
    const totalDuration = player.total_duration_ms || ((maxTime + minTime) / 2 * 1000);
    const elapsed = totalDuration - Math.max(0, expiry - now);
    
    return Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));
  };

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
      setFileInput(''); 
    }
  };

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

  // Define the createDeck function to create decks reliably
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
      // Process the cards input (can be array or string)
      let cards = [];
      
      if (Array.isArray(cardsInput)) {
        // If input is already an array, use it directly
        cards = cardsInput.filter(card => card && typeof card === 'string' && card.trim() !== '');
      } else if (typeof cardsInput === 'string') {
        // If input is a string, split by newlines and filter empty lines
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

      // Create a unique operation ID for tracking this creation
      const opId = `op_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      
      // Add optimistic deck to UI immediately
      const optimisticDeck = {
        id: `temp_${opId}`,
        _opId: opId,
        name: name,
        cards: cards,
        session_pin: pin,
        _isOptimistic: true,
        created_at: new Date().toISOString()
      };
      
      setOptimisticDecks(prev => [...prev, optimisticDeck]);
      setProcessingQueue(prev => [...prev, opId]);
      
      setDeckCreationStatus(`Creating deck "${name}" with ${cards.length} cards...`);
      
      // Actually create the deck in the database
      const newDeck = await safeRoomOperation(
        () => room.collection('deck').create({
          name: name,
          cards: cards,
          session_pin: pin,
          card_count: cards.length,
          operation_id: opId,
          created_at: new Date().toISOString()
        }),
        3,
        20000
      );
      
      // Update optimistic state
      setProcessingQueue(prev => prev.filter(id => id !== opId));
      setOptimisticDecks(prev => prev.filter(deck => deck._opId !== opId));
      
      // Update decks list
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
      
      // Set current deck to the new one if it's the first deck
      if (!currentDeck && decks.length === 0) {
        setCurrentDeck(newDeck.id);
        setCurrentDeckName(newDeck.name);
      }
      
      setDeckCreationStatus(`Deck "${name}" created successfully with ${cards.length} cards!`);
      
      // Record it locally too
      try {
        const deckToSave = {
          name: name,
          cards: cards,
          saved_at: new Date().toISOString()
        };
        
        // Check if it already exists in saved decks
        const exists = savedDecks.some(saved => 
          saved.name === name && 
          JSON.stringify(saved.cards) === JSON.stringify(cards)
        );
        
        if (!exists) {
          const updatedSavedDecks = [...savedDecks, deckToSave];
          setSavedDecks(updatedSavedDecks);
          localStorage.setItem('savedDecks', JSON.stringify(updatedSavedDecks));
          console.log(`[${APP_VERSION}] Saved deck "${name}" locally`);
        }
      } catch (saveErr) {
        console.warn(`[${APP_VERSION}] Could not save deck locally:`, saveErr);
        // Non-critical error, just log it
      }
      
      setLoading(false);
      return true;
    } catch (err) {
      setLoading(false);
      
      // Update optimistic state to show error
      const opId = optimisticDecks.find(d => d.name === name)?._opId;
      if (opId) {
        setProcessingQueue(prev => prev.filter(id => id !== opId));
        setOptimisticDecks(prev => prev.map(deck => 
          deck.name === name ? { ...deck, _error: true, _errorMsg: err.message } : deck
        ));
      }
      
      const errorMsg = logError(`Failed to create deck "${name}"`, err);
      setError(`Upload error: ${errorMsg}`);
      setDeckCreationStatus(`Error creating deck: ${errorMsg}`);
      return false;
    }
  };

  // Add a new function to upload all saved decks at once
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
        
        // Small delay between uploads to avoid overwhelming the server
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
    
    // Refresh the decks list to show the newly added decks
    setTimeout(() => refreshDecksList(true), 1000);
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
        {error && (
          <div style={{ color: 'red', marginBottom: '15px', padding: '10px', backgroundColor: '#ffeeee', borderRadius: '8px' }}>
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
              className={`btn btn-small ${(!currentDeck || players.length === 0) ? 'btn-disabled' : ''}`}
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
                          width: `${getPlayerProgress(player)}%`,
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

// Completely redesigned PlayerView with multiple failsafes to ensure card visibility
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
  const [debugInfo, setDebugInfo] = useState({ lastAction: '', playerFound: false, lastCardReceived: 'none' });
  const [lastCardUpdate, setLastCardUpdate] = useState(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [cardVisibilityChecks, setCardVisibilityChecks] = useState(0);
  const [lastKnownCard, setLastKnownCard] = useState(null); 
  const [forcedRefreshCount, setForcedRefreshCount] = useState(0);
  const [emergencyModeActive, setEmergencyModeActive] = useState(false);
  const initialSetupDone = useRef(false);
  const playerDataRef = useRef(null); // Store player data here for direct access
  const pollIntervalRef = useRef(null);
  const timerRef = useRef(null);
  const lastTimeRef = useRef(0);
  const cardCheckIntervalRef = useRef(null);
  const lastCardContent = useRef(null);
  const forceUpdateInterval = useRef(null);
  const syncFailures = useRef(0);
  const cardUpdateCountRef = useRef(0); 
  const directRenderBypassRef = useRef(null);
  const lastExpiryTime = useRef(null);
  const directDisplayCountdownIntervalRef = useRef(null);
  const lastCardSyncTimestamp = useRef(Date.now());
  const lastCardDistributed = useRef(null);

  // Create a more reliable and direct display element for critical card display
  useEffect(() => {
    const createDirectDisplay = () => {
      // Add direct emergency display container if it doesn't exist
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

  // Setup a separate interval to update the direct display independently
  useEffect(() => {
    if (directDisplayCountdownIntervalRef.current) {
      clearInterval(directDisplayCountdownIntervalRef.current);
    }
    
    // Autonomous direct display update interval
    directDisplayCountdownIntervalRef.current = setInterval(() => {
      updateDirectDisplay();
    }, 100);
    
    return () => {
      if (directDisplayCountdownIntervalRef.current) {
        clearInterval(directDisplayCountdownIntervalRef.current);
      }
    };
  }, []);

  // Autonomous emergency display function that works independently of React
  const updateDirectDisplay = () => {
    if (!directRenderBypassRef.current) return;
    
    const container = directRenderBypassRef.current;
    const reactCardElement = document.querySelector('.card-text');
    const reactTimer = document.querySelector('.timer-bar');
    
    let cardToDisplay = lastCardContent.current;
    const playerData = playerDataRef.current;
    
    // Calculate time remaining directly if we have expiry time
    let displayTimeLeft = 0;
    let displayTotalTime = 0;
    let showEmergencyDisplay = false;
    
    if (lastExpiryTime.current) {
      const expiry = new Date(lastExpiryTime.current).getTime();
      const now = Date.now();
      displayTimeLeft = Math.max(0, (expiry - now) / 1000);
    }
    
    // Safety check - if React display is not showing our card, activate emergency display
    if (cardToDisplay && cardToDisplay !== 'END' && displayTimeLeft > 0) {
      // Check if React display is working correctly
      const reactDisplayWorking = reactCardElement && 
                                 reactCardElement.textContent === cardToDisplay &&
                                 reactTimer;
      
      // Show emergency display if React failed or if we're in emergency mode
      showEmergencyDisplay = !reactDisplayWorking || emergencyModeActive;
      
      if (showEmergencyDisplay) {
        // If emergency mode not already active, set it
        if (!emergencyModeActive) {
          console.log(`[${APP_VERSION}] EMERGENCY MODE ACTIVATED: React display not functioning correctly for card "${cardToDisplay}"`);
          setEmergencyModeActive(true);
        }
        
        // Calculate progress
        if (playerData && playerData.total_duration_ms) {
          displayTotalTime = playerData.total_duration_ms / 1000;
        } else {
          displayTotalTime = Math.max(30, displayTimeLeft + 5);
        }
        
        const progressPercent = displayTotalTime > 0 ? 
            Math.min(100, Math.max(0, ((displayTotalTime - displayTimeLeft) / displayTotalTime) * 100)) : 0;
        
        // Update the emergency display
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
        // React display is working, hide emergency display
        container.style.display = 'none';
        if (emergencyModeActive) {
          console.log(`[${APP_VERSION}] Emergency mode deactivated: React display functioning correctly`);
          setEmergencyModeActive(false);
        }
      }
    } else if (cardToDisplay === 'END') {
      // Session ended message
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
      // No active card or time expired, hide emergency display
      container.style.display = 'none';
    }
  };

  // Ultra-reliable player data processing function
  const processPlayerData = (player) => {
    if (!player) return false;
    
    try {
      // Store the full player data for direct access
      playerDataRef.current = player;
      
      // Log detailed player data
      console.log(`[${APP_VERSION}] Player data received:`, {
        name: player.name,
        card: player.current_card,
        deck: player.deck_name,
        expiresAt: player.expires_at,
        totalDuration: player.total_duration_ms
      });
      
      // Record this card distribution
      if (player.current_card && player.current_card !== lastCardDistributed.current) {
        lastCardDistributed.current = player.current_card;
        lastCardSyncTimestamp.current = Date.now();
        console.log(`[${APP_VERSION}] NEW CARD DISTRIBUTED: "${player.current_card}"`);
      }
      
      // Always update the card if it exists
      if (player.current_card) {
        console.log(`[${APP_VERSION}] Setting card to: "${player.current_card}"`);
        setCurrentCard(player.current_card);
        setLastKnownCard(player.current_card);
        lastCardContent.current = player.current_card;
        cardUpdateCountRef.current++;
        setLastCardUpdate(Date.now());
        
        if (player.expires_at) {
          lastExpiryTime.current = player.expires_at;
          
          const expiry = new Date(player.expires_at).getTime();
          const now = Date.now();
          const remaining = Math.max(0, (expiry - now) / 1000);
          setTimeLeft(remaining);
          
          // Update total time for progress bar calculation
          if (player.total_duration_ms) {
            setTotalTime(player.total_duration_ms / 1000);
          } else if (totalTime <= 0) {
            setTotalTime(Math.max(30, remaining)); // Fallback estimate
          }
        }
      }
      
      return true;
    } catch (err) {
      console.error(`[${APP_VERSION}] Error processing player data:`, err);
      return false;
    }
  };

  // Setup player and initial data with multiple fallbacks
  useEffect(() => {
    if (initialSetupDone.current) return;
    
    // Mark setup as done immediately to prevent multiple setups
    initialSetupDone.current = true;
    
    const setupPlayer = async () => {
      try {
        setLoading(true);
        setConnectionStatus('connecting');
        console.log(`[${APP_VERSION}] Player setup initiated: PIN=${pin}, Name=${playerName}`);

        // Verify session exists
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
        
        // Multi-attempt player search and creation
        for (let findAttempt = 0; findAttempt < 3; findAttempt++) {
          try {
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
              setDebugInfo(prev => ({ 
                ...prev, 
                playerFound: true,
                playerId: foundPlayer.id
              }));
              
              console.log(`[${APP_VERSION}] Found existing player: ${foundPlayer.name}, ID: ${foundPlayer.id}`);
              
              // Process player data immediately
              processPlayerData(foundPlayer);
              break;
            }
            
            if (findAttempt === 0) {
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
                setDebugInfo(prev => ({ 
                  ...prev, 
                  playerFound: true,
                  playerId: newPlayer.id
                }));
                break;
              } catch (createErr) {
                logError(`Player creation attempt ${findAttempt+1} failed`, createErr);
              }
            }
            
            if (findAttempt < 2) {
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          } catch (findErr) {
            logError(`Player search attempt ${findAttempt+1} failed`, findErr);
            if (findAttempt < 2) {
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          }
        }
        
        if (!playerId) {
          setError('Could not join session. Please try again with a different name.');
          setLoading(false);
          setConnectionStatus('error: failed to join');
          return;
        }

        setLoading(false);
        setConnectionStatus('connected');
        console.log(`[${APP_VERSION}] Player setup complete, ID: ${playerId}`);

        // Set up continuous polling for player data (independently of React rendering)
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

        // Set up continuous card visibility verification
        cardCheckIntervalRef.current = setInterval(async () => {
          try {
            // Direct poll to ensure cards are being received
            const polledPlayers = await room.collection('player')
              .filter({ session_pin: pin, name: playerName })
              .getList();
              
            if (polledPlayers && polledPlayers.length > 0) {
              const player = polledPlayers[0];
              
              // Force a reprocessing of player data
              processPlayerData(player);
              
              // Verify card is displayed
              const reactCardElement = document.querySelector('.card-text');
              
              if (player.current_card && player.current_card !== 'END' &&
                  (!reactCardElement || reactCardElement.textContent !== player.current_card)) {
                console.log(`[${APP_VERSION}] DISPLAY ERROR DETECTED: Card "${player.current_card}" not visible in DOM!`);
                setForcedRefreshCount(prev => prev + 1);
                
                // Force emergency mode if React display isn't working
                setEmergencyModeActive(true);
              }
            }
            
            // Check for stale data
            if (lastCardSyncTimestamp.current) {
              const timeSinceLastSync = Date.now() - lastCardSyncTimestamp.current;
              if (timeSinceLastSync > 15000) { // 15 seconds since last update
                console.log(`[${APP_VERSION}] WARNING: No card updates for ${Math.round(timeSinceLastSync/1000)}s, forcing sync...`);
                
                // Force a direct poll
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

        // Set up subscription for real-time updates with improved error handling
        const setupPlayerSubscription = () => {
          let retryAttempt = 0;
          const maxRetries = 10;
          
          const attemptSubscribe = () => {
            try {
              console.log(`[${APP_VERSION}] Setting up player subscription, attempt ${retryAttempt + 1}`);
              
              return room.collection('player')
                .filter({ session_pin: pin, name: playerName })
                .subscribe(playersList => {
                  if (playersList && playersList.length > 0) {
                    processPlayerData(playersList[0]);
                  }
                });
            } catch (subErr) {
              logError(`Error subscribing to player updates (attempt ${retryAttempt + 1})`, subErr);
              
              if (retryAttempt < maxRetries) {
                retryAttempt++;
                setTimeout(attemptSubscribe, Math.min(2000 * retryAttempt, 10000));
                return () => {}; 
              } else {
                setConnectionStatus('subscription failed');
                return () => {}; 
              }
            }
          };
          
          return attemptSubscribe();
        };
        
        return setupPlayerSubscription();
      } catch (err) {
        const errorMsg = logError('Failed to setup player', err);
        
        if (retries < 3) {
          setRetries(prev => prev + 1);
          setConnectionStatus(`retrying (${retries + 1}/3)`);
          setTimeout(() => {
            initialSetupDone.current = false; // Allow retry
            setupPlayer();
          }, 2000);
        } else {
          setError('Failed to connect to session. Please try again.');
          setLoading(false);
          setConnectionStatus('error: max retries reached');
        }
      }
    };

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
      
      if (forceUpdateInterval.current) {
        clearInterval(forceUpdateInterval.current);
      }
    };
  }, [pin, playerName, retries]);

  // Improved timer logic for smoother countdown
  useEffect(() => {
    if (currentCard && currentCard !== 'END' && timeLeft > 0) {
      // Clear any existing timer
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      
      // Store the last time for smooth countdown
      lastTimeRef.current = Date.now();
      
      // Set up a faster interval for smoother visual updates
      timerRef.current = setInterval(() => {
        const now = Date.now();
        const elapsed = (now - lastTimeRef.current) / 1000;
        lastTimeRef.current = now;
        
        setTimeLeft(prev => {
          // Calculate new time with more precision
          const newTime = Math.max(0, prev - elapsed);
          
          // When timer expires, check if we have a new card
          if (newTime <= 0 && currentCard) {
            // Poll for new card when timer expires
            setTimeout(async () => {
              try {
                const players = await room.collection('player')
                  .filter({ session_pin: pin, name: playerName })
                  .getList();
                
                if (players && players.length > 0) {
                  processPlayerData(players[0]);
                }
              } catch (err) {
                logError('Error getting updated player info after timer expired', err);
              }
            }, 500);
          }
          
          return parseFloat(newTime.toFixed(1)); 
        });
      }, 100); 

      return () => {
        if (directDisplayCountdownIntervalRef.current) {
          clearInterval(directDisplayCountdownIntervalRef.current);
        }
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }
      };
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
  }, [currentCard, timeLeft, pin, playerName]);

  // CRITICAL: Extra emergency check for cases where React doesn't update
  useEffect(() => {
    // Force card display if card was received but not showing
    if (lastKnownCard && !currentCard && lastKnownCard !== 'END') {
      console.log(`[${APP_VERSION}] CRITICAL FIX: Restoring missing card "${lastKnownCard}"`);
      setCurrentCard(lastCardContent.current);
      setForcedRefreshCount(prev => prev + 1);
    }
    
    // Update direct display whenever currentCard changes
    updateDirectDisplay();
  }, [currentCard, lastKnownCard]);

  // Calculate progress percentage for timer bar
  const getProgressWidth = () => {
    if (timeLeft <= 0 || totalTime <= 0) return 0;
    // Smooth calculation with better precision
    const percentage = ((totalTime - timeLeft) / totalTime) * 100;
    return Math.min(100, Math.max(0, percentage)); 
  };

  // Reset emergency mode when loading
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
          <div style={{ marginTop: '10px', fontSize: '12px', color: '#888' }}>
            <details>
              <summary>Debug Info</summary>
              <p>Version: {APP_VERSION}</p>
              <p>Last action: {debugInfo.lastAction}</p>
              <p>Player found: {debugInfo.playerFound ? 'Yes' : 'No'}</p>
              <p>PIN: {pin}</p>
              <p>Name: {playerName}</p>
              <p>Status: {connectionStatus}</p>
            </details>
          </div>
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

  console.log(`[${APP_VERSION}] Rendering card view: "${currentCard || 'NO CARD'}", Timer: ${timeLeft}s, Updates: ${cardUpdateCountRef.current}, Forced: ${forcedRefreshCount} `);

  // Display card using either current or last known card
  const displayCard = currentCard || lastKnownCard;

  return (
    <div style={{ height: '100vh', position: 'relative' }} id="player-view-container">
      {displayCard && displayCard !== 'END' ? (
        <div className="fullscreen-card" id="card-display">
          <div style={{ width: '100%' }}>
            <h1 className="card-text" style={{ fontSize: '36px', padding: '10px' }}>{displayCard}</h1>
            
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
            
            {/* Emergency mode indicator */}
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
            
            {/* Card status indicator */}
            <div style={{ 
              marginTop: '5px', 
              fontSize: '12px', 
              color: '#888',
              textAlign: 'center' 
            }}>
              {forcedRefreshCount > 0 ? `Card restored ${forcedRefreshCount} times` : 'Card received normally'}
            </div>
            
            {/* Hidden debug info */}
            <div 
              onDoubleClick={() => alert(`Debug: Card="${displayCard}", Time=${timeLeft}s, Total=${totalTime}s, Updates=${cardUpdateCountRef.current}, Emergency=${emergencyModeActive ? 'YES' : 'NO'}`)}
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
            
            {/* Add reconnect button */}
            <button 
              className="btn"
              onClick={() => {
                console.log(`[${APP_VERSION}] Manual reconnect initiated`);
                setReconnectAttempts(prev => prev + 1);
                setConnectionStatus('manually reconnecting...');
                
                // Reset the player view
                initialSetupDone.current = false;
                
                // Force a reload of player data
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
            
            {/* Last known card status for debugging */}
            {lastKnownCard && (
              <p style={{ marginTop: '15px', fontSize: '12px', color: '#888' }}>
                <button onTouchStart={() => {
                  console.log(`[${APP_VERSION}] Manual restore of card: "${lastKnownCard}"`);
                  setCurrentCard(lastCardContent.current);
                  setForcedRefreshCount(prev => prev + 1);
                  setEmergencyModeActive(true);
                }} className="btn btn-small">
                  Force Restore Card
                </button>
              </p>
            )}
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