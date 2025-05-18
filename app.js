// App Version for tracking
const APP_VERSION = "1.13.0";

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
              joined_at: new Date().toISOString(), // Add timestamp for debugging
              client_info: `${APP_VERSION}|${navigator.userAgent.slice(0, 50)}` // Add client info for debugging
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
    if (isPlaying && players.length > 0 && currentDeck) {
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
    if (!currentDeck || players.length === 0 || !isPlaying) {
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

      setCardDistributionStatus(`Distributing cards from "${selectedDeck.name}" to ${players.length} players...`);

      // Distribute cards based on mode
      const updatePromises = players.map(async (player) => {
        let selectedCard;
        
        switch (mode) {
          case 'unison':
            // Everyone gets the same card
            selectedCard = cardsPool[Math.floor(Math.random() * cardsPool.length)];
            break;
          case 'unique':
            // Everyone gets a different card if possible
            if (cardsPool.length > 0) {
              const randomIndex = Math.floor(Math.random() * cardsPool.length);
              selectedCard = cardsPool[randomIndex];
              // Remove this card from pool for unique distribution
              cardsPool.splice(randomIndex, 1);
              
              // If we run out of cards, reset the pool
              if (cardsPool.length === 0) {
                const allCards = [...selectedDeck.cards];
                for (let i = 0; i < allCards.length; i++) {
                  cardsPool.push(allCards[i]);
                }
              }
            } else {
              selectedCard = selectedDeck.cards[Math.floor(Math.random() * selectedDeck.cards.length)];
            }
            break;
          case 'random':
          default:
            // 50/50 chance of same or different card
            if (Math.random() > 0.5) {
              // Same card (use the first player's card if available)
              if (players.length > 0 && players[0].current_card && Math.random() > 0.3) {
                selectedCard = players[0].current_card;
              } else {
                selectedCard = cardsPool[Math.floor(Math.random() * cardsPool.length)];
              }
            } else {
              // Different card
              selectedCard = cardsPool[Math.floor(Math.random() * cardsPool.length)];
            }
            break;
        }

        // Calculate random time between min and max
        const randomTime = Math.floor(Math.random() * (maxTime - minTime + 1)) + minTime;
        const expiryTime = new Date(Date.now() + randomTime * 1000).toISOString();

        try {
          return safeRoomOperation(
            () => room.collection('player').update(player.id, {
              current_card: selectedCard,
              expires_at: expiryTime,
              updated_at: new Date().toISOString()
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

  // End session function
  const endSession = async () => {
    setCardDistributionStatus('Ending session...');
    setIsEnding(true);
    
    try {
      // First update session state to stop new distributions
      if (sessionData && sessionData.id) {
        await safeRoomOperation(() =>
          room.collection('session').update(sessionData.id, {
            is_playing: false,
            is_ending: true,
            last_updated: new Date().toISOString()
          })
        );
      }
      
      // Then update all players with END card
      const updatePromises = players.map(player => 
        safeRoomOperation(
          () => room.collection('player').update(player.id, {
            current_card: 'END',
            expires_at: null,
            updated_at: new Date().toISOString()
          }),
          3,
          8000
        )
      );
      
      await Promise.allSettled(updatePromises);
      
      // Then finalize session end state
      if (sessionData && sessionData.id) {
        await safeRoomOperation(() =>
          room.collection('session').update(sessionData.id, {
            is_playing: false,
            is_ending: false,
            last_updated: new Date().toISOString()
          })
        );
      }
      
      setCardDistributionStatus('Session ended successfully');
      setIsPlaying(false);
      setIsEnding(false);
    } catch (err) {
      logError('End session error', err);
      setCardDistributionStatus(`Error ending session: ${err.message}`);
      
      // Safety fallback - reset state even if error
      setIsPlaying(false);
      setIsEnding(false);
      
      // Try one more time with simpler approach
      try {
        if (sessionData && sessionData.id) {
          await room.collection('session').update(sessionData.id, {
            is_playing: false,
            is_ending: false
          });
        }
      } catch (finalErr) {
        // Ignore final attempt errors
      }
    }
  };

  // Ultra-reliable deck creation with chunking, timeouts based on network quality
  const createDeck = async (name, cardsText) => {
    if (!name.trim()) {
      setError('Please enter a deck name');
      return false;
    }

    let cards = [];
    if (typeof cardsText === 'string') {
      cards = cardsText
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
    } else if (Array.isArray(cardsText)) {
      cards = cardsText.filter(card => card && typeof card === 'string' && card.trim().length > 0);
    } else {
      setError('Invalid card format');
      return false;
    }

    if (cards.length === 0) {
      setError('No valid cards found. Please add at least one card.');
      return false;
    }

    setLoading(true);
    setError(null);
    
    // Create a unique operation ID
    const opId = Date.now() + Math.random().toString(36).substr(2, 5);
    setDeckOperationId(opId);
    
    // Add to optimistic list immediately
    const optimisticDeck = {
      id: `temp-${opId}`,
      session_pin: pin,
      name: name,
      cards: cards,
      _isOptimistic: true,
      _opId: opId,
      created_at: new Date().toISOString()
    };
    
    setOptimisticDecks(prev => [...prev, optimisticDeck]);
    setProcessingQueue(prev => [...prev, opId]);
    
    // Set appropriate timeout based on network quality and payload size
    let timeoutMs = 20000; // Default 20 seconds
    if (networkQuality === 'poor') {
      timeoutMs = Math.max(30000, cards.length * 100); // At least 30 seconds for poor networks
    } else if (networkQuality === 'fair') {
      timeoutMs = Math.max(20000, cards.length * 50); // At least 20 seconds for fair networks
    } else {
      timeoutMs = Math.max(15000, cards.length * 25); // At least 15 seconds for good networks
    }
    
    const maxRetries = networkQuality === 'poor' ? 5 : 3;
    
    setDeckCreationStatus(`Creating deck "${name}" with ${cards.length} cards...`);
    
    try {
      let newDeck = null;
      
      // For very large decks, use chunking (over 500 cards)
      if (cards.length > 500 && networkQuality !== 'good') {
        setDeckCreationStatus(`Large deck detected (${cards.length} cards). Using chunked processing...`);
        
        // Create deck with initial chunk
        const initialChunk = cards.slice(0, 100);
        const deckData = {
          session_pin: pin,
          name: name,
          cards: initialChunk,
          created_at: new Date().toISOString(),
          version: APP_VERSION,
          client_id: opId,
          is_chunked: true,
          total_cards: cards.length
        };
        
        reportStatus('ConductorView', 'Creating chunked deck', {
          deck_name: name,
          initial_chunk: initialChunk.length,
          total_cards: cards.length,
          op_id: opId
        });
        
        newDeck = await safeRoomOperation(
          () => room.collection('deck').create(deckData),
          maxRetries,
          timeoutMs
        );
        
        // Process remaining chunks
        const remainingCards = cards.slice(100);
        const chunkSize = 100;
        
        for (let i = 0; i < remainingCards.length; i += chunkSize) {
          const chunk = remainingCards.slice(i, i + chunkSize);
          const chunkNumber = Math.floor(i / chunkSize) + 1;
          const totalChunks = Math.ceil(remainingCards.length / chunkSize);
          
          setDeckCreationStatus(`Processing chunk ${chunkNumber}/${totalChunks} (${chunk.length} cards)...`);
          
          await safeRoomOperation(
            () => room.collection('deck').update(newDeck.id, {
              cards: [...(newDeck.cards || []), ...chunk],
              last_updated: new Date().toISOString(),
              _chunk: chunkNumber
            }),
            maxRetries,
            timeoutMs
          );
          
          // Update our local reference to include the new cards
          newDeck.cards = [...(newDeck.cards || []), ...chunk];
          
          reportStatus('ConductorView', `Chunk ${chunkNumber} processed`, {
            deck_id: newDeck.id,
            cards_processed: (100 + i + chunk.length),
            remaining: cards.length - (100 + i + chunk.length)
          });
        }
      } else {
        // Standard deck creation for normal-sized decks
        const deckData = {
          session_pin: pin,
          name: name,
          cards: cards,
          created_at: new Date().toISOString(),
          version: APP_VERSION,
          client_id: opId
        };
        
        reportStatus('ConductorView', 'Creating deck', {
          deck_name: name,
          cards_count: cards.length,
          op_id: opId,
          timeout: timeoutMs
        });
        
        newDeck = await safeRoomOperation(
          () => room.collection('deck').create(deckData),
          maxRetries,
          timeoutMs
        );
      }
      
      if (!newDeck) {
        throw new Error('Deck creation returned empty result');
      }
      
      reportStatus('ConductorView', 'Deck created successfully', {
        deck_id: newDeck.id,
        cards_count: newDeck.cards?.length || 0,
        op_id: opId
      });
      
      // Remove from optimistic list and add to real list
      setOptimisticDecks(prev => prev.filter(d => d._opId !== opId));
      setProcessingQueue(prev => prev.filter(id => id !== opId));
      
      setDecks(prevDecks => {
        const deckWithMeta = {
          ...newDeck,
          _localAdded: new Date().toISOString(),
          _opId: opId
        };
        
        // Avoid duplicates by removing any with same ID
        const filteredDecks = prevDecks.filter(d => d.id !== newDeck.id);
        const updatedDecks = [...filteredDecks, deckWithMeta];
        console.log(`[${APP_VERSION}] Updated decks array locally:`, updatedDecks.length);
        return updatedDecks;
      });
      
      if (!currentDeck) {
        setCurrentDeck(newDeck.id);
      }
      
      setDeckCreationStatus(`Success! "${name}" deck added with ${cards.length} cards`);
      
      // Schedule multiple refreshes to ensure consistency
      setTimeout(() => refreshDecksList(true), 500);
      setTimeout(() => refreshDecksList(true), 2500);
      setTimeout(() => refreshDecksList(true), 7000);
      
      return true;
    } catch (err) {
      console.error(`[${APP_VERSION}] Final deck creation error:`, err);
      
      // Remove from processing queue but keep in optimistic list with error state
      setProcessingQueue(prev => prev.filter(id => id !== opId));
      setOptimisticDecks(prev => prev.map(d => 
        d._opId === opId ? {...d, _error: true, _errorMsg: err.message} : d
      ));
      
      setError(`Failed to create deck: ${err.message || 'Unknown error'}`);
      setDeckCreationStatus('Error creating deck. You can try again with a smaller deck size.');
      return false;
    } finally {
      setLoading(false);
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
    
    const expiry = new Date(player.expires_at).getTime();
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

  // Get the currently selected deck
  const selectedDeck = displayDecks.find(deck => deck.id === currentDeck);

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
        <h2 className="header">Deck Management</h2>
        
        <div className="mb-4">
          <h3>Create a New Deck</h3>
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
          {deckCreationStatus && (
            <div className="helper-text" style={{ marginTop: '10px', fontWeight: 'bold' }}>
              {deckCreationStatus}
            </div>
          )}
        </div>
        
        <div className="mb-4">
          <h3>Or Upload JSON File</h3>
          <input
            type="file"
            accept=".json"
            onChange={handleFileUpload}
            value={fileInput}
            disabled={loading}
          />
          <p className="helper-text">
            Accepts: JSON array of strings, or objects with name/cards properties
          </p>
        </div>
        
        {loading && (
          <div style={{ marginTop: '10px', width: '100%', height: '8px', backgroundColor: '#eee', borderRadius: '4px' }}>
            <div 
              style={{ 
                width: '50%', 
                height: '100%', 
                backgroundColor: '#000', 
                borderRadius: '4px',
                animation: 'progress-bar 1.5s infinite'
              }}
            ></div>
          </div>
        )}
        
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
        
        <div className="mb-4">
          <button 
            className="btn"
            onClick={() => setShowSavedDecks(!showSavedDecks)}
            style={{ marginBottom: '10px' }}
          >
            {showSavedDecks ? 'Hide Saved Decks' : `Show Saved Decks (${savedDecks.length})`}
          </button>
          
          {showSavedDecks && (
            <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid #ddd', borderRadius: '8px', padding: '10px' }}>
              {savedDecks.length === 0 ? (
                <p>No saved decks yet. Save decks to reuse them later.</p>
              ) : (
                savedDecks.map((deck, index) => (
                  <div key={index} style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    padding: '8px',
                    borderBottom: index < savedDecks.length - 1 ? '1px solid #eee' : 'none'
                  }}>
                    <div>
                      <strong>{deck.name}</strong> ({deck.cards.length} cards)
                    </div>
                    <div>
                      <button 
                        className="btn"
                        onClick={() => {
                          setDeckCreationStatus(`Loading deck "${deck.name}"...`);
                          createDeck(deck.name, deck.cards).then(success => {
                            if (success) {
                              setShowSavedDecks(false);
                              setDeckCreationStatus(`Deck "${deck.name}" loaded successfully`);
                              setTimeout(() => refreshDecksList(true), 1000);
                              setTimeout(() => refreshDecksList(true), 3000);
                            }
                          });
                        }}
                        style={{ 
                          marginRight: '5px', 
                          padding: '5px 10px',
                          backgroundColor: '#000',
                          color: '#fff'
                        }}
                      >
                        Load
                      </button>
                      <button 
                        className="btn"
                        onClick={() => {
                          try {
                            const updatedDecks = savedDecks.filter((_, i) => i !== index);
                            setSavedDecks(updatedDecks);
                            localStorage.setItem('savedDecks', JSON.stringify(updatedDecks));
                            setDeckCreationStatus('Saved deck removed');
                            setTimeout(() => setDeckCreationStatus(''), 2000);
                          } catch (err) {
                            console.error(`[${APP_VERSION}] Error removing saved deck:`, err);
                          }
                        }}
                        style={{ padding: '5px 10px' }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        
        <div>
          <h3>Available Decks for This Session ({displayDecks.length})</h3>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '15px', flexWrap: 'wrap' }}>
            <button 
              className="btn" 
              onClick={() => refreshDecksList(true)}
              disabled={loading}
              style={{ backgroundColor: '#000', color: '#fff' }}
            >
              <span style={{ marginRight: '5px' }}>↻</span> Refresh Decks
            </button>
            
            <button 
              className={`btn ${displayDecks.length === 0 ? 'btn-disabled' : ''}`}
              onClick={() => {
                try {
                  if (displayDecks.length === 0) {
                    setError('No decks to download');
                    return;
                  }
                  
                  const exportData = {
                    app_version: APP_VERSION,
                    exported_at: new Date().toISOString(),
                    decks: displayDecks.map(deck => ({
                      name: deck.name,
                      cards: deck.cards || []
                    }))
                  };
                  
                  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `improv_decks_${new Date().toISOString().slice(0,10)}.json`;
                  document.body.appendChild(a);
                  a.click();
                  
                  setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  }, 100);
                  
                  setDeckCreationStatus(`Downloaded ${displayDecks.length} deck${displayDecks.length !== 1 ? 's' : ''}`);
                  setTimeout(() => setDeckCreationStatus(''), 3000);
                } catch (err) {
                  console.error(`[${APP_VERSION}] Download error:`, err);
                  setError(`Download failed: ${err.message || 'Unknown error'}`);
                }
              }}
              disabled={displayDecks.length === 0 || loading}
            >
              Download All Decks
            </button>
          </div>
          
          {displayDecks.length === 0 ? (
            <div style={{ padding: '15px', backgroundColor: '#f8f8f8', borderRadius: '8px', marginBottom: '15px' }}>
              <p>No decks available for this session yet</p>
              <p style={{ fontSize: '14px', marginTop: '5px' }}>
                Create a deck above or upload a JSON file
              </p>
            </div>
          ) : (
            <div style={{ marginBottom: '15px' }}>
              <div style={{ 
                maxHeight: '250px', 
                overflowY: 'auto', 
                border: '1px solid #ddd', 
                borderRadius: '8px' 
              }}>
                {displayDecks.map((deck, index) => (
                  <div key={deck.id || deck._opId} style={{ 
                    padding: '10px',
                    backgroundColor: currentDeck === deck.id ? '#f0f0f0' : 
                                    deck._isOptimistic ? '#fffde7' : 'transparent',
                    borderBottom: index < displayDecks.length - 1 ? '1px solid #eee' : 'none',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    opacity: deck._isOptimistic ? 0.8 : 1
                  }}>
                    <div>
                      <strong 
                        style={{ cursor: 'pointer' }}
                        onClick={() => !deck._isOptimistic && setCurrentDeck(deck.id)}
                      >
                        {deck.name}
                        {deck._isOptimistic && processingQueue.includes(deck._opId) && ' (Processing...)'}
                        {deck._isOptimistic && deck._error && ' (Error - Try Again)'}
                      </strong>
                      <div style={{ fontSize: '14px', color: '#666' }}>
                        {deck.cards?.length || 0} cards
                        {deck._isOptimistic && <span> - local only</span>}
                      </div>
                    </div>
                    <div>
                      {!deck._isOptimistic && (
                        <>
                          <button 
                            className="btn"
                            onClick={() => setCurrentDeck(deck.id)}
                            style={{ 
                              marginRight: '5px', 
                              padding: '5px 10px',
                              backgroundColor: currentDeck === deck.id ? '#000' : '#fff',
                              color: currentDeck === deck.id ? '#fff' : '#000'
                            }}
                          >
                            Select
                          </button>
                          <button 
                            className="btn"
                            onClick={() => {
                              try {
                                const exists = savedDecks.some(saved => 
                                  saved.name === deck.name && 
                                  JSON.stringify(saved.cards) === JSON.stringify(deck.cards)
                                );
                                
                                if (exists) {
                                  setDeckCreationStatus(`Deck "${deck.name}" is already saved`);
                                  return;
                                }
                                
                                const deckToSave = {
                                  name: deck.name,
                                  cards: deck.cards,
                                  saved_at: new Date().toISOString()
                                };
                                
                                const updatedSavedDecks = [...savedDecks, deckToSave];
                                setSavedDecks(updatedSavedDecks);
                                
                                localStorage.setItem('savedDecks', JSON.stringify(updatedSavedDecks));
                                
                                setDeckCreationStatus(`Deck "${deck.name}" saved for future use`);
                                setTimeout(() => setDeckCreationStatus(''), 3000);
                              } catch (err) {
                                console.error(`[${APP_VERSION}] Error saving deck:`, err);
                                setDeckCreationStatus(`Could not save deck: ${err.message || 'Unknown error'}`);
                              }
                            }}
                            style={{ padding: '5px 10px' }}
                          >
                            Save
                          </button>
                        </>
                      )}
                      {deck._isOptimistic && deck._error && (
                        <button 
                          className="btn"
                          onClick={() => setOptimisticDecks(prev => 
                            prev.filter(d => d._opId !== deck._opId)
                          )}
                          style={{ 
                            padding: '5px 10px',
                            backgroundColor: '#fff',
                            color: '#000'
                          }}
                        >
                          Dismiss
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
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
                  onClick={() => setCurrentDeck(decks[0].id)}
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
                          Has card
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
                  
                  {expandedPlayers.includes(player.id) && player.current_card && player.current_card !== 'END' && (
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

// Enhanced Player View with better countdown visualization
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
  const [debugInfo, setDebugInfo] = useState({ lastAction: '', playerFound: false });
  const [lastCardUpdate, setLastCardUpdate] = useState(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const initialSetupDone = useRef(false);
  const pollIntervalRef = useRef(null);
  const timerRef = useRef(null);
  const lastTimeRef = useRef(0);

  useEffect(() => {
    if (initialSetupDone.current) return;
    
    const setupPlayer = async () => {
      try {
        setLoading(true);
        setConnectionStatus('connecting');
        reportStatus('PlayerView', 'Setup initiated', { pin, name: playerName });

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

        setConnectionStatus('checking player');
        
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
            
            reportStatus('PlayerView', `Player search attempt ${findAttempt+1}`, { 
              found: players?.length > 0
            });
            
            if (players && players.length > 0) {
              setPlayerId(players[0].id);
              setDebugInfo(prev => ({ ...prev, playerFound: true }));
              
              // Immediately set current card if player has one
              if (players[0].current_card) {
                setCurrentCard(players[0].current_card);
                setLastCardUpdate(Date.now());
                
                if (players[0].expires_at) {
                  const expiry = new Date(players[0].expires_at).getTime();
                  const now = Date.now();
                  const remaining = Math.max(0, Math.floor((expiry - now) / 1000));
                  setTimeLeft(remaining);
                  
                  // Estimate total time from session or use a reasonable default
                  try {
                    const sessionData = await room.collection('session').filter({ pin }).getList();
                    if (sessionData && sessionData.length > 0) {
                      const avgTime = (sessionData[0].min_time + sessionData[0].max_time) / 2;
                      setTotalTime(avgTime);
                    } else {
                      setTotalTime(Math.max(remaining, 30)); // Fallback
                    }
                  } catch (err) {
                    setTotalTime(Math.max(remaining, 30)); // Fallback
                  }
                }
              }
              
              reportStatus('PlayerView', 'Found existing player', { id: players[0].id });
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
                
                reportStatus('PlayerView', 'Created new player', { id: newPlayer.id });
                setPlayerId(newPlayer.id);
                setDebugInfo(prev => ({ ...prev, playerFound: true }));
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
        initialSetupDone.current = true;
        reportStatus('PlayerView', 'Player setup complete', { id: playerId });

        // More aggressive polling for better reliability
        pollIntervalRef.current = setInterval(async () => {
          try {
            const polledPlayers = await room.collection('player')
              .filter({ session_pin: pin, name: playerName })
              .getList();
              
            if (polledPlayers && polledPlayers.length > 0) {
              const player = polledPlayers[0];
              
              // Always update the card if one exists
              if (player.current_card) {
                // Only update if card has changed or there's been enough time
                const cardChanged = player.current_card !== currentCard;
                const timeToUpdate = !lastCardUpdate || (Date.now() - lastCardUpdate > 5000);
                
                if (cardChanged || timeToUpdate) {
                  setCurrentCard(player.current_card);
                  setLastCardUpdate(Date.now());
                  setDebugInfo(prev => ({ 
                    ...prev, 
                    lastAction: `Card poll update: ${player.current_card || 'no card'}`
                  }));
                  
                  if (player.expires_at) {
                    const expiry = new Date(player.expires_at).getTime();
                    const now = Date.now();
                    const remaining = Math.max(0, Math.floor((expiry - now) / 1000));
                    setTimeLeft(remaining);
                    
                    // Get total time from session for better progress visualization
                    try {
                      const sessions = await room.collection('session').filter({ pin }).getList();
                      if (sessions && sessions.length > 0) {
                        const session = sessions[0];
                        const avgTime = (session.min_time + session.max_time) / 2;
                        setTotalTime(avgTime);
                      } else {
                        setTotalTime(Math.max(remaining + 5, 30)); // Fallback
                      }
                    } catch (err) {
                      setTotalTime(Math.max(remaining + 5, 30)); // Fallback on error
                    }
                  }
                }
              }
            }
          } catch (pollErr) {
            // Silent fail for polling - it's just a backup
          }
        }, 3000); // More frequent polling

        // Set up subscription for real-time updates
        const setupPlayerSubscription = () => {
          let retryAttempt = 0;
          const maxRetries = 10;
          
          const attemptSubscribe = () => {
            try {
              reportStatus('PlayerView', 'Subscribing to player updates', { 
                attempt: retryAttempt + 1 
              });
              
              return room.collection('player')
                .filter({ session_pin: pin, name: playerName })
                .subscribe(playersList => {
                  if (playersList && playersList.length > 0) {
                    const player = playersList[0];
                    setCurrentCard(player.current_card);
                    setLastCardUpdate(Date.now());
                    setDebugInfo(prev => ({ 
                      ...prev, 
                      lastAction: `Player update: ${player.current_card || 'no card'}`
                    }));

                    if (player.expires_at) {
                      const expiry = new Date(player.expires_at).getTime();
                      const now = Date.now();
                      const remaining = Math.max(0, Math.floor((expiry - now) / 1000));
                      setTimeLeft(remaining);
                      
                      // Calculate total time from expires_at and session settings (if available)
                      if (totalTime <= 0) {
                        room.collection('session').filter({ pin }).getList().then(sessions => {
                          if (sessions && sessions.length > 0) {
                            const avgTime = (sessions[0].min_time + sessions[0].max_time) / 2;
                            setTotalTime(avgTime);
                          } else {
                            setTotalTime(Math.max(remaining + 5, 30)); // Fallback
                          }
                        }).catch(() => {
                          setTotalTime(Math.max(remaining + 5, 30)); // Fallback on error
                        });
                      }
                    } else if (!player.current_card || player.current_card === 'END') {
                      setTimeLeft(0);
                    }
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
          setTimeout(() => setupPlayer(), 2000); 
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
    };
  }, [pin, playerName, retries]);

  // Subscribe to session changes
  useEffect(() => {
    if (pin) {
      const subscribeToSession = () => {
        let retryAttempt = 0;
        const maxRetries = 10;
        
        const attemptSubscribe = () => {
          if (retryAttempt >= maxRetries) return () => {};
          
          try {
            reportStatus('PlayerView', 'Subscribing to session', { 
              attempt: retryAttempt + 1 
            });
            
            return room.collection('session')
              .filter({ pin })
              .subscribe(sessionsList => {
                if (sessionsList && sessionsList.length > 0) {
                  const session = sessionsList[0];
                  setIsSessionActive(session.is_playing);
                  
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
          } catch (subErr) {
            logError(`Error subscribing to session (attempt ${retryAttempt + 1})`, subErr);
            
            retryAttempt++;
            setTimeout(() => attemptSubscribe(), Math.min(1000 * retryAttempt, 10000));
            return () => {};
          }
        };
        
        return attemptSubscribe();
      };
      
      return subscribeToSession();
    }
  }, [pin]);

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
            // When timer expires, check if we have a new card
            setTimeout(async () => {
              try {
                const players = await room.collection('player')
                  .filter({ session_pin: pin, name: playerName })
                  .getList();
                
                if (players && players.length > 0) {
                  const updatedPlayer = players[0];
                  setCurrentCard(updatedPlayer.current_card);
                  setLastCardUpdate(Date.now());
                  
                  if (updatedPlayer.expires_at) {
                    const expiry = new Date(updatedPlayer.expires_at).getTime();
                    const now = Date.now();
                    const newRemaining = Math.max(0, Math.floor((expiry - now) / 1000));
                    if (newRemaining > 0) {
                      setTimeLeft(newRemaining);
                    }
                  }
                }
              } catch (err) {
                logError('Error getting updated player info after timer expired', err);
              }
            }, 500);
          }
          
          return parseFloat(newTime.toFixed(1)); // Keep one decimal place for smoother appearance
        });
      }, 100); // Update 10 times per second for smooth visuals

      return () => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }
      };
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
  }, [currentCard, timeLeft, pin, playerName]);

  // Reconnect logic if no card updates are received for a long time
  useEffect(() => {
    let reconnectTimer;
    
    // If we're in active session but haven't received a card update in a while
    if (isSessionActive && lastCardUpdate && Date.now() - lastCardUpdate > 30000) {
      reconnectTimer = setTimeout(() => {
        reportStatus('PlayerView', 'Attempting reconnect due to inactivity', {
          lastUpdate: lastCardUpdate ? new Date(lastCardUpdate).toISOString() : 'never',
          reconnectAttempt: reconnectAttempts + 1
        });
        
        setReconnectAttempts(prev => prev + 1);
        
        // Reset our subscription by forcing a retry
        setRetries(prev => prev + 1);
        
        // Also directly poll for latest card
        room.collection('player')
          .filter({ session_pin: pin, name: playerName })
          .getList()
          .then(players => {
            if (players && players.length > 0) {
              const player = players[0];
              setCurrentCard(player.current_card);
              setLastCardUpdate(Date.now());
              
              if (player.expires_at) {
                const expiry = new Date(player.expires_at).getTime();
                const now = Date.now();
                const remaining = Math.max(0, Math.floor((expiry - now) / 1000));
                setTimeLeft(remaining);
              }
            }
          })
          .catch(err => {
            logError('Failed to poll during reconnect', err);
          });
          
      }, 5000);
    }
    
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [isSessionActive, lastCardUpdate, reconnectAttempts, pin, playerName]);

  const getProgressWidth = () => {
    if (timeLeft <= 0 || totalTime <= 0) return 0;
    // Smooth calculation with better precision
    const percentage = (timeLeft / totalTime) * 100;
    return Math.max(0.5, percentage); // Ensure at least a tiny bit is visible
  };

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

  return (
    <div style={{ height: '100vh', position: 'relative' }}>
      {currentCard ? (
        <div className="fullscreen-card">
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
                  transition: 'width 0.1s linear', // Smoother transition
                  backgroundColor: timeLeft < 10 ? '#ff3b30' : '#000'
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