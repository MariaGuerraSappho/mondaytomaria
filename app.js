// App Version for tracking
const APP_VERSION = "1.22.0";

const { useState, useEffect, useRef, useMemo, useCallback } = React;
const { createRoot } = ReactDOM;

// Initialize WebsimSocket with error handling
let room;
try {
  room = new WebsimSocket();
  console.log(`[${APP_VERSION}] WebsimSocket initialized successfully`);
} catch (err) {
  console.error(`[${APP_VERSION}] Error initializing WebsimSocket:`, err);
  try {
    room = new WebsimSocketFallback();
    console.log(`[${APP_VERSION}] Fallback WebsimSocket initialized`);
  } catch (fallbackErr) {
    console.error(`[${APP_VERSION}] Critical: Fallback also failed:`, fallbackErr);
  }
}

// Utility Functions
const logError = (context, error) => {
  const timestamp = new Date().toISOString();
  const errorMessage = error?.message || String(error) || "Unknown error";
  console.error(`[${APP_VERSION}][${timestamp}] ${context}:`, error);
  return errorMessage;
};

const safeRoomOperation = async (operation, maxRetries = 5, initialTimeout = 15000) => {
  let retries = 0;
  let lastError = null;
  let timeout = initialTimeout;

  while (retries < maxRetries) {
    try {
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`Operation timed out after ${timeout}ms`)), timeout)
      );
      return await Promise.race([operation(), timeoutPromise]);
    } catch (err) {
      lastError = err;
      const errorMsg = logError(`Operation failed (attempt ${retries + 1})`, err);
      const isTimeout = errorMsg.includes('timeout') || errorMsg.includes('Timeout');

      retries++;
      if (retries >= maxRetries) {
        throw new Error(`Failed after ${maxRetries} attempts: ${err.message || 'Unknown error'}`);
      }

      const baseDelay = isTimeout ? 1500 : 800;
      const jitter = Math.random() * 700;
      const delay = (baseDelay * Math.pow(1.7, retries)) + jitter;
      timeout = Math.min(initialTimeout * Math.pow(1.5, retries), 60000);
      console.log(`[${APP_VERSION}] Retrying in ${Math.round(delay)}ms with timeout ${Math.round(timeout)}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
};

const reportStatus = (component, status, details = {}) => {
  const timestamp = new Date().toISOString();
  console.log(`[${APP_VERSION}][${timestamp}][${component}] ${status}`, details);
};

// HomeView Component
function HomeView({ setView }) {
  return (
    <div className="card">
      <h1 className="header">Improv Card Distributor</h1>
      <div className="version-display">Version {APP_VERSION}</div>
      <p className="mb-4">Welcome to the Improv Card Distributor! Choose your role:</p>
      
      <button className="btn btn-primary mb-4" onClick={() => setView('conductor')}>
        Create Session (Conductor)
      </button>
      
      <button className="btn mb-4" onClick={() => setView('join')}>
        Join Session (Player)
      </button>
    </div>
  );
}

// ConductorView Component
function ConductorView({ setView, sessionData, setSessionData }) {
  const [loading, setLoading] = useState(true);
  const [creatingSession, setCreatingSession] = useState(false);
  const [sessionPin, setSessionPin] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [players, setPlayers] = useState([]);
  const [decks, setDecks] = useState([]);
  const [activeDeckId, setActiveDeckId] = useState('');
  const [distributionMode, setDistributionMode] = useState('unique'); // unique, unison, random
  const [sessionEnded, setSessionEnded] = useState(false);
  const [timer, setTimer] = useState(60);
  const [currentCard, setCurrentCard] = useState('');
  const [deckCreationStatus, setDeckCreationStatus] = useState('');
  const [newDeckName, setNewDeckName] = useState('');
  const [deckCards, setDeckCards] = useState('');
  const [showDebug, setShowDebug] = useState(false);
  const [loadingDecks, setLoadingDecks] = useState(false);
  const fileInputRef = useRef(null);
  
  // Handler for creation of session
  const createSession = async () => {
    setCreatingSession(true);
    setErrorMessage('');
    
    try {
      // Generate a 6-digit PIN
      const pin = Math.floor(100000 + Math.random() * 900000).toString();
      
      const session = await safeRoomOperation(async () => {
        return await room.collection('session').create({
          pin,
          active: true,
          created_at: new Date().toISOString(),
          distribution_mode: distributionMode,
          timer_seconds: timer,
          active_deck_id: activeDeckId,
          ended: false
        });
      });
      
      setSessionPin(pin);
      setSessionData(session);
      setIsActive(true);
      
      // Success message
      setSuccessMessage(`Session created with PIN: ${pin}`);
      reportStatus('ConductorView', 'Session created', { pin });
      
    } catch (error) {
      const errorMsg = logError('Error creating session', error);
      setErrorMessage(`Failed to create session: ${errorMsg}`);
    } finally {
      setCreatingSession(false);
    }
  };
  
  // Function to refresh the players list
  const refreshPlayersList = useCallback(async () => {
    if (!sessionPin) return;
    
    try {
      const playerList = await safeRoomOperation(async () => {
        return await room.collection('player')
          .filter({ session_pin: sessionPin })
          .getList();
      });
      
      setPlayers(playerList);
      reportStatus('ConductorView', 'Players list refreshed', { count: playerList.length });
    } catch (error) {
      logError('Error refreshing players list', error);
    }
  }, [sessionPin]);
  
  // Function to refresh the decks list
  const refreshDecksList = useCallback(async (showLoading = false) => {
    if (showLoading) setLoadingDecks(true);
    
    try {
      const deckList = await safeRoomOperation(async () => {
        return await room.collection('deck').getList();
      });
      
      setDecks(deckList);
      
      // If no active deck is set and decks exist, set the first one as active
      if (!activeDeckId && deckList.length > 0) {
        setActiveDeckId(deckList[0].id);
      }
      
      reportStatus('ConductorView', 'Decks list refreshed', { count: deckList.length });
    } catch (error) {
      logError('Error refreshing decks list', error);
    } finally {
      if (showLoading) setLoadingDecks(false);
    }
  }, [activeDeckId]);
  
  // Function to send cards to players
  const distributeCards = async () => {
    if (!isActive || sessionEnded) {
      setErrorMessage("Session is not active or has ended");
      return;
    }
    
    if (!activeDeckId) {
      setErrorMessage("Please select a deck first");
      return;
    }
    
    if (players.length === 0) {
      setErrorMessage("No players have joined yet");
      return;
    }
    
    setErrorMessage('');
    setSuccessMessage('');
    
    try {
      // Find the active deck
      const activeDeck = decks.find(d => d.id === activeDeckId);
      if (!activeDeck || !activeDeck.cards || activeDeck.cards.length === 0) {
        setErrorMessage("Selected deck has no cards");
        return;
      }
      
      const cards = activeDeck.cards;
      const cardAssignments = [];
      
      // Distribute cards based on the mode
      if (distributionMode === 'unison') {
        // Everyone gets the same card
        const randomIndex = Math.floor(Math.random() * cards.length);
        const selectedCard = cards[randomIndex];
        setCurrentCard(selectedCard);
        
        for (const player of players) {
          cardAssignments.push({
            playerId: player.id,
            playerName: player.name,
            card: selectedCard,
            deckName: activeDeck.name,
            deckId: activeDeckId
          });
        }
      } else if (distributionMode === 'unique') {
        // Each player gets a unique card if possible
        const shuffledCards = [...cards].sort(() => Math.random() - 0.5);
        
        for (let i = 0; i < players.length; i++) {
          const cardIndex = i % shuffledCards.length; // Wrap around if more players than cards
          const selectedCard = shuffledCards[cardIndex];
          cardAssignments.push({
            playerId: players[i].id,
            playerName: players[i].name,
            card: selectedCard,
            deckName: activeDeck.name,
            deckId: activeDeckId
          });
        }
        
        // Set current card to indicate multiple cards
        setCurrentCard("[Multiple Cards]");
      } else if (distributionMode === 'random') {
        // Each player gets a random card (duplicates allowed)
        for (const player of players) {
          const randomIndex = Math.floor(Math.random() * cards.length);
          const selectedCard = cards[randomIndex];
          cardAssignments.push({
            playerId: player.id,
            playerName: player.name,
            card: selectedCard,
            deckName: activeDeck.name,
            deckId: activeDeckId
          });
        }
        
        // Set current card to indicate multiple cards
        setCurrentCard("[Random Cards]");
      }
      
      // Update each player
      for (const assignment of cardAssignments) {
        await safeRoomOperation(async () => {
          return await room.collection('player').update(assignment.playerId, {
            current_card: assignment.card,
            current_deck_name: assignment.deckName,
            current_deck_id: assignment.deckId,
            card_start_time: new Date().toISOString(),
            card_duration: timer
          });
        });
      }
      
      // Update session object
      await safeRoomOperation(async () => {
        return await room.collection('session').update(sessionData.id, {
          last_distribution: new Date().toISOString(),
          distribution_mode: distributionMode,
          timer_seconds: timer,
          active_deck_id: activeDeckId
        });
      });
      
      setSuccessMessage(`Cards distributed to ${cardAssignments.length} players`);
      reportStatus('ConductorView', 'Cards distributed', { 
        mode: distributionMode, 
        count: cardAssignments.length,
        deckName: activeDeck.name
      });
      
    } catch (error) {
      const errorMsg = logError('Error distributing cards', error);
      setErrorMessage(`Failed to distribute cards: ${errorMsg}`);
    }
  };
  
  // Function to end session
  const endSession = async () => {
    if (!sessionData) return;
    
    try {
      // Update all players with END signal
      for (const player of players) {
        await safeRoomOperation(async () => {
          return await room.collection('player').update(player.id, {
            current_card: 'END',
            card_start_time: new Date().toISOString()
          });
        });
      }
      
      // Update session as ended
      await safeRoomOperation(async () => {
        return await room.collection('session').update(sessionData.id, {
          ended: true,
          active: false
        });
      });
      
      setSessionEnded(true);
      setIsActive(false);
      setSuccessMessage("Session ended successfully");
      reportStatus('ConductorView', 'Session ended', { pin: sessionPin });
      
    } catch (error) {
      const errorMsg = logError('Error ending session', error);
      setErrorMessage(`Failed to end session: ${errorMsg}`);
    }
  };
  
  // Function to create a new deck
  const createDeck = async () => {
    if (!newDeckName || !deckCards) {
      setErrorMessage("Please provide a deck name and cards");
      return;
    }
    
    setErrorMessage('');
    setDeckCreationStatus('Creating deck...');
    
    try {
      // Parse the cards (one per line)
      const cards = deckCards.split('\n')
        .map(card => card.trim())
        .filter(card => card.length > 0);
      
      if (cards.length === 0) {
        setErrorMessage("No valid cards found");
        setDeckCreationStatus('');
        return;
      }
      
      const deck = await safeRoomOperation(async () => {
        return await room.collection('deck').create({
          name: newDeckName,
          cards: cards,
          card_count: cards.length
        });
      });
      
      setDeckCreationStatus(`Deck "${newDeckName}" created with ${cards.length} cards`);
      setNewDeckName('');
      setDeckCards('');
      
      // Refresh decks list
      await refreshDecksList(true);
      
      // Set as active deck if no other deck is active
      if (!activeDeckId) {
        setActiveDeckId(deck.id);
      }
      
    } catch (error) {
      const errorMsg = logError('Error creating deck', error);
      setErrorMessage(`Failed to create deck: ${errorMsg}`);
      setDeckCreationStatus('');
    }
  };
  
  // Function to handle file upload
  const handleFileUpload = async (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    setErrorMessage('');
    setDeckCreationStatus('Processing uploaded file(s)...');
    setLoading(true);
    
    const processSingleFile = async (file) => {
      try {
        const text = await file.text();
        
        // Try to parse as JSON
        try {
          const json = JSON.parse(text);
          
          // Handle array of decks
          if (Array.isArray(json)) {
            const results = [];
            
            for (const deckData of json) {
              if (deckData.name && Array.isArray(deckData.cards) && deckData.cards.length > 0) {
                const deck = await room.collection('deck').create({
                  name: deckData.name,
                  cards: deckData.cards,
                  card_count: deckData.cards.length
                });
                results.push({ success: true, deck });
              } else {
                results.push({ 
                  success: false, 
                  error: "Invalid deck format (must have name and cards array)" 
                });
              }
            }
            
            return results;
          }
          
          // Handle single deck
          if (json.name && Array.isArray(json.cards) && json.cards.length > 0) {
            const deck = await room.collection('deck').create({
              name: json.name,
              cards: json.cards,
              card_count: json.cards.length
            });
            return [{ success: true, deck }];
          } else {
            return [{ 
              success: false, 
              error: "Invalid deck format (must have name and cards array)" 
            }];
          }
        } catch (jsonError) {
          // Not JSON, try to parse as text format
          // Format: First line is deck name, subsequent lines are cards
          const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
          
          if (lines.length < 2) {
            return [{ success: false, error: "Not enough content (need at least deck name and one card)" }];
          }
          
          const deckName = lines[0];
          const cards = lines.slice(1);
          
          const deck = await room.collection('deck').create({
            name: deckName,
            cards: cards,
            card_count: cards.length
          });
          
          return [{ success: true, deck }];
        }
      } catch (error) {
        logError(`Error processing file ${file.name}`, error);
        return [{ success: false, error: error.message || "Unknown error" }];
      }
    };
    
    try {
      let allResults = [];
      
      for (let i = 0; i < files.length; i++) {
        const fileResults = await processSingleFile(files[i]);
        allResults = [...allResults, ...fileResults];
      }
      
      const successCount = allResults.filter(r => r.success).length;
      const errorCount = allResults.filter(r => !r.success).length;
      
      setLoading(false);
      setDeckCreationStatus(`Upload complete! Added ${successCount} deck${successCount !== 1 ? 's' : ''}, failed ${errorCount}`);
      
      // Refresh the decks list to show the newly added decks
      setTimeout(() => refreshDecksList(true), 1000);
      
    } catch (error) {
      setLoading(false);
      const errorMsg = logError('Error in file upload process', error);
      setErrorMessage(`Upload failed: ${errorMsg}`);
      setDeckCreationStatus('');
    }
    
    // Clear the file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };
  
  // Load decks and monitor players on mount
  useEffect(() => {
    setLoading(true);
    
    const loadInitialData = async () => {
      try {
        await refreshDecksList();
        setLoading(false);
      } catch (error) {
        logError('Error loading initial data', error);
        setErrorMessage("Failed to load initial data. Please refresh the page.");
        setLoading(false);
      }
    };
    
    loadInitialData();
  }, [refreshDecksList]);
  
  // Subscribe to player updates when session is active
  useEffect(() => {
    if (!sessionPin) return;
    
    const playerSubscription = room.collection('player')
      .filter({ session_pin: sessionPin })
      .subscribe(updatedPlayers => {
        setPlayers(updatedPlayers);
      });
    
    // Initial fetch
    refreshPlayersList();
    
    return () => {
      if (typeof playerSubscription === 'function') {
        playerSubscription();
      }
    };
  }, [sessionPin, refreshPlayersList]);
  
  // Render the conductor view UI
  if (loading) {
    return (
      <div className="card">
        <h2 className="header">Loading Conductor Panel...</h2>
        <div className="timer-bar">
          <div className="timer-progress" style={{ width: '50%' }}></div>
        </div>
      </div>
    );
  }
  
  if (!isActive) {
    return (
      <div className="card">
        <h2 className="header">Create a Session</h2>
        
        {!sessionEnded ? (
          <>
            <div className="mb-4">
              <label>Distribution Mode:</label>
              <select 
                className="input" 
                value={distributionMode} 
                onChange={(e) => setDistributionMode(e.target.value)}
              >
                <option value="unique">Unique - Each player gets a different card</option>
                <option value="unison">Unison - All players get the same card</option>
                <option value="random">Random - Each player gets a random card</option>
              </select>
            </div>
            
            <div className="mb-4">
              <label>Timer (seconds):</label>
              <input 
                type="number" 
                className="input" 
                value={timer} 
                min="5" 
                max="300" 
                onChange={(e) => setTimer(parseInt(e.target.value) || 60)}
              />
            </div>
            
            <div className="mb-4">
              <label>Select Deck:</label>
              {loadingDecks ? (
                <p>Loading decks...</p>
              ) : decks.length > 0 ? (
                <select 
                  className="input" 
                  value={activeDeckId} 
                  onChange={(e) => setActiveDeckId(e.target.value)}
                >
                  {decks.map(deck => (
                    <option key={deck.id} value={deck.id}>
                      {deck.name} ({deck.card_count || deck.cards.length} cards)
                    </option>
                  ))}
                </select>
              ) : (
                <p>No decks available. Create one below.</p>
              )}
              
              <button 
                className="btn btn-small" 
                style={{ marginTop: '5px' }} 
                onClick={() => refreshDecksList(true)}
              >
                Refresh Decks
              </button>
            </div>
            
            <button 
              className={`btn btn-primary ${creatingSession ? 'btn-disabled' : ''}`} 
              onClick={createSession} 
              disabled={creatingSession || decks.length === 0}
            >
              {creatingSession ? 'Creating...' : 'Create Session'}
            </button>
            
            {decks.length === 0 && (
              <p className="helper-text">Please create at least one deck before starting a session.</p>
            )}
          </>
        ) : (
          <div>
            <p>The previous session has ended.</p>
            <button className="btn btn-primary" onClick={() => {
              setSessionEnded(false);
              setSessionData(null);
              setSessionPin('');
            }}>
              Start New Session
            </button>
          </div>
        )}
        
        {errorMessage && (
          <div className="status-message status-error">{errorMessage}</div>
        )}
        
        <hr style={{ margin: '20px 0' }} />
        
        <div>
          <h3 className="header">Deck Management</h3>
          
          <div className="mb-4">
            <h4>Create New Deck</h4>
            <input 
              type="text" 
              className="input" 
              placeholder="Deck Name" 
              value={newDeckName} 
              onChange={(e) => setNewDeckName(e.target.value)}
            />
            <textarea 
              className="input" 
              placeholder="Enter cards, one per line" 
              rows="5" 
              value={deckCards} 
              onChange={(e) => setDeckCards(e.target.value)}
            ></textarea>
            <button className="btn" onClick={createDeck}>Create Deck</button>
          </div>
          
          <div className="mb-4">
            <h4>Upload Deck(s)</h4>
            <p className="helper-text">
              Upload JSON or text files. For text files, the first line should be the deck name, and each subsequent line is a card.
            </p>
            <input 
              type="file" 
              ref={fileInputRef}
              accept=".txt,.json" 
              multiple 
              onChange={handleFileUpload}
            />
            <button 
              className="btn btn-small" 
              style={{ marginTop: '5px' }} 
              onClick={() => fileInputRef.current?.click()}
            >
              Select Files
            </button>
          </div>
          
          {deckCreationStatus && (
            <div className="status-message status-success">{deckCreationStatus}</div>
          )}
        </div>
        
        <button className="btn" onClick={() => setView('home')} style={{ marginTop: '20px' }}>
          Back to Home
        </button>
      </div>
    );
  }
  
  // Active session view
  return (
    <div className="card">
      <h2 className="header">Session Control Panel</h2>
      
      <div className="version-display">PIN: {sessionPin}</div>
      
      <p>Share this link with players:</p>
      <input 
        type="text" 
        className="input" 
        readOnly 
        value={`${window.baseUrl || window.location.origin}?pin=${sessionPin}`} 
        onClick={(e) => e.target.select()}
      />
      <button 
        className="btn btn-small" 
        onClick={() => {
          const url = `${window.baseUrl || window.location.origin}?pin=${sessionPin}`;
          navigator.clipboard.writeText(url).catch(() => {
            // Fallback for browsers that don't support clipboard API
            const textArea = document.createElement("textarea");
            textArea.value = url;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
          });
          setSuccessMessage("Link copied to clipboard!");
        }}
      >
        Copy Link
      </button>
      
      <hr style={{ margin: '20px 0' }} />
      
      <div className="mb-4">
        <h3>Players ({players.length})</h3>
        {players.length > 0 ? (
          <div className="player-list">
            {players.map(player => (
              <div key={player.id} className="player-item">
                <div>
                  <strong>{player.name}</strong>
                  {player.current_card && player.current_card !== 'END' && (
                    <div className="player-card-content">
                      {player.current_card}
                      {player.current_deck_name && (
                        <span style={{ fontSize: '12px', color: '#666', display: 'block', marginTop: '4px' }}>
                          Deck: {player.current_deck_name}
                        </span>
                      )}
                      {player.card_start_time && player.card_duration && (
                        <PlayerTimerBar 
                          startTime={player.card_start_time} 
                          duration={player.card_duration} 
                        />
                      )}
                    </div>
                  )}
                  {player.current_card === 'END' && (
                    <div className="player-card-content">SESSION ENDED</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p>No players have joined yet</p>
        )}
        
        <button className="btn btn-small" onClick={refreshPlayersList}>
          Refresh Players
        </button>
      </div>
      
      <hr style={{ margin: '20px 0' }} />
      
      <div className="mb-4">
        <h3>Distribution Controls</h3>
        
        <div className="mb-4">
          <label>Distribution Mode:</label>
          <select 
            className="input" 
            value={distributionMode} 
            onChange={(e) => setDistributionMode(e.target.value)}
          >
            <option value="unique">Unique - Each player gets a different card</option>
            <option value="unison">Unison - All players get the same card</option>
            <option value="random">Random - Each player gets a random card</option>
          </select>
        </div>
        
        <div className="mb-4">
          <label>Timer (seconds):</label>
          <input 
            type="number" 
            className="input" 
            value={timer} 
            min="5" 
            max="300" 
            onChange={(e) => setTimer(parseInt(e.target.value) || 60)}
          />
        </div>
        
        <div className="mb-4">
          <label>Select Deck:</label>
          {loadingDecks ? (
            <p>Loading decks...</p>
          ) : decks.length > 0 ? (
            <select 
              className="input" 
              value={activeDeckId} 
              onChange={(e) => setActiveDeckId(e.target.value)}
            >
              {decks.map(deck => (
                <option key={deck.id} value={deck.id}>
                  {deck.name} ({deck.card_count || deck.cards.length} cards)
                </option>
              ))}
            </select>
          ) : (
            <p>No decks available</p>
          )}
          
          <button 
            className="btn btn-small" 
            style={{ marginTop: '5px' }} 
            onClick={() => refreshDecksList(true)}
          >
            Refresh Decks
          </button>
        </div>
        
        {currentCard && (
          <div className="mb-4">
            <label>Current Card(s):</label>
            <div className="conductor-card-info">
              <div style={{ 
                padding: '10px', 
                backgroundColor: '#f8f8f8', 
                borderRadius: '6px', 
                marginTop: '5px',
                borderLeft: '3px solid #333'
              }}>
                {currentCard}
              </div>
            </div>
          </div>
        )}
        
        <div className="conductor-actions">
          <button 
            className="btn btn-primary mb-4" 
            onClick={distributeCards}
            disabled={sessionEnded}
          >
            Distribute Cards
          </button>
          
          <button 
            className="btn mb-4" 
            onClick={endSession}
            disabled={sessionEnded}
          >
            End Session
          </button>
        </div>
      </div>
      
      {errorMessage && (
        <div className="status-message status-error">{errorMessage}</div>
      )}
      
      {successMessage && (
        <div className="status-message status-success">{successMessage}</div>
      )}
      
      <button className="btn" onClick={() => {
        if (confirm("Are you sure you want to leave? This will NOT end the session.")) {
          setView('home');
        }
      }}>
        Back to Home
      </button>
      
      <div style={{ marginTop: '10px' }}>
        <button 
          className="btn btn-small" 
          onClick={() => setShowDebug(!showDebug)}
        >
          {showDebug ? 'Hide Debug Info' : 'Show Debug Info'}
        </button>
        
        {showDebug && (
          <div className="debug-panel">
            <p>Session ID: {sessionData?.id}</p>
            <p>PIN: {sessionPin}</p>
            <p>Active: {isActive ? 'Yes' : 'No'}</p>
            <p>Players: {players.length}</p>
            <p>Version: {APP_VERSION}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Timer bar for player cards
function PlayerTimerBar({ startTime, duration }) {
  const [progress, setProgress] = useState(100);
  
  useEffect(() => {
    const start = new Date(startTime).getTime();
    const durationMs = duration * 1000;
    const end = start + durationMs;
    
    const updateProgress = () => {
      const now = Date.now();
      if (now >= end) {
        setProgress(0);
        return;
      }
      
      const remaining = end - now;
      const newProgress = (remaining / durationMs) * 100;
      setProgress(Math.max(0, Math.min(100, newProgress)));
    };
    
    updateProgress();
    const interval = setInterval(updateProgress, 1000);
    
    return () => clearInterval(interval);
  }, [startTime, duration]);
  
  return (
    <div className="player-timer-bar">
      <div 
        className="player-timer-progress" 
        style={{ width: `${progress}%` }}
      ></div>
    </div>
  );
}

// JoinView Component
function JoinView({ pin, setPin, playerName, setPlayerName, setView }) {
  const [joining, setJoining] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [sessionInfo, setSessionInfo] = useState(null);
  
  // Check if session exists when pin changes
  useEffect(() => {
    if (!pin) return;
    
    const checkSession = async () => {
      try {
        const sessions = await safeRoomOperation(async () => {
          return await room.collection('session')
            .filter({ pin, active: true, ended: false })
            .getList();
        });
        
        if (sessions.length > 0) {
          setSessionInfo(sessions[0]);
          setErrorMessage('');
        } else {
          setSessionInfo(null);
          setErrorMessage('Session not found or has ended');
        }
      } catch (error) {
        logError('Error checking session', error);
        setErrorMessage('Error checking session status');
        setSessionInfo(null);
      }
    };
    
    checkSession();
  }, [pin]);
  
  // Handle join attempt
  const handleJoin = async () => {
    if (!pin) {
      setErrorMessage('Please enter a session PIN');
      return;
    }
    
    if (!playerName) {
      setErrorMessage('Please enter your name');
      return;
    }
    
    setJoining(true);
    setErrorMessage('');
    
    try {
      // Verify session exists
      const sessions = await safeRoomOperation(async () => {
        return await room.collection('session')
          .filter({ pin, active: true, ended: false })
          .getList();
      });
      
      if (sessions.length === 0) {
        setErrorMessage('Session not found or has ended');
        setJoining(false);
        return;
      }
      
      // Create player record
      await safeRoomOperation(async () => {
        return await room.collection('player').create({
          name: playerName,
          session_pin: pin,
          current_card: '',
          joined_at: new Date().toISOString()
        });
      });
      
      // Save to localStorage for reconnection
      localStorage.setItem('playerName', playerName);
      localStorage.setItem('lastPin', pin);
      
      // Navigate to player view
      setView('player');
      
    } catch (error) {
      const errorMsg = logError('Error joining session', error);
      setErrorMessage(`Failed to join: ${errorMsg}`);
      setJoining(false);
    }
  };
  
  return (
    <div className="card">
      <h2 className="header">Join Session</h2>
      
      <div className="mb-4">
        <label>Session PIN:</label>
        <input 
          type="text" 
          className="input" 
          placeholder="Enter 6-digit PIN" 
          value={pin} 
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').substring(0, 6))}
          maxLength={6}
        />
      </div>
      
      <div className="mb-4">
        <label>Your Name:</label>
        <input 
          type="text" 
          className="input" 
          placeholder="Enter your name" 
          value={playerName} 
          onChange={(e) => setPlayerName(e.target.value)}
          maxLength={20}
        />
      </div>
      
      {sessionInfo && (
        <div className="status-message status-success">
          Session found! Ready to join.
        </div>
      )}
      
      {errorMessage && (
        <div className="status-message status-error">{errorMessage}</div>
      )}
      
      <button 
        className={`btn btn-primary mb-4 ${joining ? 'btn-disabled' : ''}`} 
        onClick={handleJoin} 
        disabled={joining}
      >
        {joining ? 'Joining...' : 'Join Session'}
      </button>
      
      <button className="btn" onClick={() => setView('home')}>
        Back to Home
      </button>
    </div>
  );
}

// PlayerView Component
function PlayerView({ pin, playerName, setView }) {
  const [loading, setLoading] = useState(true);
  const [player, setPlayer] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [sessionEnded, setSessionEnded] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const intervalRef = useRef(null);
  
  // Reset timer when card changes
  useEffect(() => {
    if (player?.card_start_time && player?.card_duration) {
      const startTime = new Date(player.card_start_time).getTime();
      const durationMs = player.card_duration * 1000;
      const endTime = startTime + durationMs;
      
      const updateTimer = () => {
        const now = Date.now();
        const remaining = Math.max(0, endTime - now);
        setTimeRemaining(Math.ceil(remaining / 1000));
      };
      
      // Clear previous interval
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      
      // Initial update
      updateTimer();
      
      // Set new interval
      intervalRef.current = setInterval(updateTimer, 1000);
      
      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    }
  }, [player?.card_start_time, player?.card_duration]);
  
  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);
  
  // Find player and subscribe to updates
  useEffect(() => {
    if (!pin || !playerName) {
      setErrorMessage('Missing session PIN or player name');
      setLoading(false);
      return;
    }
    
    setLoading(true);
    setConnectionStatus('connecting');
    
    const findPlayer = async () => {
      try {
        const players = await safeRoomOperation(async () => {
          return await room.collection('player')
            .filter({ name: playerName, session_pin: pin })
            .getList();
        });
        
        if (players.length === 0) {
          // Player not found, may need to create a new record or reconnect
          setErrorMessage('Player not found. Please try rejoining.');
          setLoading(false);
          return;
        }
        
        // Check if this is an ended session
        if (players[0].current_card === 'END') {
          setSessionEnded(true);
        }
        
        setPlayer(players[0]);
        setConnectionStatus('connected');
        setLoading(false);
        
      } catch (error) {
        logError('Error finding player', error);
        setErrorMessage('Error connecting to session');
        setConnectionStatus('error');
        setLoading(false);
      }
    };
    
    findPlayer();
    
    // Subscribe to player updates
    const playerSubscription = room.collection('player')
      .filter({ name: playerName, session_pin: pin })
      .subscribe(players => {
        if (players.length > 0) {
          const updatedPlayer = players[0];
          
          // Check if session has ended
          if (updatedPlayer.current_card === 'END') {
            setSessionEnded(true);
            setConnectionStatus('session ended');
            if (intervalRef.current) {
              clearInterval(intervalRef.current);
            }
          }
          
          setPlayer(updatedPlayer);
          setConnectionStatus('connected');
        }
      });
    
    return () => {
      if (typeof playerSubscription === 'function') {
        playerSubscription();
      }
    };
  }, [pin, playerName]);
  
  if (loading) {
    return (
      <div className="card">
        <h2 className="header">Connecting to Session...</h2>
        <div className="timer-bar">
          <div className="timer-progress" style={{ width: '50%' }}></div>
        </div>
      </div>
    );
  }
  
  if (sessionEnded) {
    return (
      <div className="fullscreen-card">
        <div>
          <h2 className="card-text">SESSION ENDED</h2>
          <p>Thank you for participating!</p>
          <button 
            className="btn btn-primary" 
            style={{ marginTop: '20px' }} 
            onClick={() => setView('home')}
          >
            Return to Home
          </button>
        </div>
      </div>
    );
  }
  
  // Show error if player is not found
  if (!player) {
    return (
      <div className="card">
        <h2 className="header">Connection Error</h2>
        <p>{errorMessage || 'Unable to connect to session'}</p>
        <button 
          className="btn btn-primary mb-4" 
          onClick={() => {
            // Try to reconnect
            window.location.reload();
          }}
        >
          Try Again
        </button>
        <button className="btn" onClick={() => setView('home')}>
          Back to Home
        </button>
      </div>
    );
  }
  
  // Show waiting screen if no card is assigned
  if (!player.current_card) {
    return (
      <div className="fullscreen-card">
        <div>
          <h2 className="header">Waiting for instruction...</h2>
          <p>The conductor will assign cards shortly.</p>
          <div className="connection-status">
            Status: {connectionStatus}
          </div>
        </div>
      </div>
    );
  }
  
  // Show the active card
  return (
    <div className="fullscreen-card">
      <div style={{ width: '100%' }}>
        <h2 className="card-text">{player.current_card}</h2>
        
        {player.current_deck_name && (
          <p style={{ marginTop: '10px', fontSize: '14px', color: '#666' }}>
            Deck: {player.current_deck_name}
          </p>
        )}
        
        {timeRemaining > 0 && (
          <div>
            <div className="timer-bar" style={{ marginTop: '20px' }}>
              <div 
                className="timer-progress" 
                style={{ 
                  width: `${(timeRemaining / player.card_duration) * 100}%` 
                }}
              ></div>
            </div>
            <p style={{ marginTop: '5px', fontSize: '14px' }}>
              Time remaining: {timeRemaining} seconds
            </p>
          </div>
        )}
        
        <div className="connection-status">
          Connected as: {playerName}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [view, setView] = useState('home');
  const [pin, setPin] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [sessionData, setSessionData] = useState(null);
  const [initError, setInitError] = useState(null);
  const [appVersion] = useState(APP_VERSION);

  useEffect(() => {
    const loadingElement = document.getElementById('loading');
    if (loadingElement) {
      loadingElement.style.display = 'none';
    }

    if (!room) {
      setInitError("Could not initialize real-time connection. Please refresh the page.");
    }
  }, [appVersion]);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const pinParam = params.get('pin');
      if (pinParam) {
        setPin(pinParam);
        localStorage.setItem('lastPin', pinParam);
        setView('join');
      } else {
        const storedPin = localStorage.getItem('lastPin');
        if (storedPin) setPin(storedPin);
        const storedName = localStorage.getItem('playerName');
        if (storedName) setPlayerName(storedName);
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