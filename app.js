const { useState, useEffect, useRef, useMemo } = React;
const { createRoot } = ReactDOM;

// Initialize WebsimSocket
const room = new WebsimSocket();

// Main App Component
function App() {
  const [view, setView] = useState('home');
  const [pin, setPin] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [sessionData, setSessionData] = useState(null);

  // Check URL params to see if we should join a session directly
  useEffect(() => {
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
  }, []);

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
    </div>
  );
}

// Home View
function HomeView({ setView }) {
  return (
    <div className="flex flex-col items-center gap-4">
      <h1 className="header">Improv Card Distributor</h1>
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
    return room.collection('session').subscribe(sessionsList => {
      setSessions(sessionsList);
    });
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
      const sessions = await room.collection('session').filter({ pin }).getList();
      if (sessions.length === 0) {
        setError('Invalid PIN');
        setLoading(false);
        return;
      }

      // Check if player limit reached
      const players = await room.collection('player').filter({ session_pin: pin }).getList();
      if (players.length >= 10) {
        setError('Session is full (max 10 players)');
        setLoading(false);
        return;
      }

      // Check if player already exists with this name
      const existingPlayer = players.find(p => p.name === playerName && p.session_pin === pin);
      if (existingPlayer) {
        // If player exists, use that player
        console.log('Player already exists, using existing player');
      } else {
        // Join session - create new player
        try {
          const newPlayer = await room.collection('player').create({
            session_pin: pin,
            name: playerName,
            current_card: null,
            expires_at: null,
          });
          console.log('Created new player:', newPlayer);
        } catch (playerErr) {
          console.error('Failed to create player:', playerErr);
          // Continue anyway - the PlayerView will retry
        }
      }

      // Create shareable link
      const shareableUrl = `${window.baseUrl}?pin=${pin}`;
      navigator.clipboard.writeText(shareableUrl)
        .then(() => console.log('Shareable link copied to clipboard'))
        .catch(err => console.error('Could not copy link: ', err));

      setLoading(false);
      setView('player');
    } catch (err) {
      console.error('Failed to join session:', err);
      setError(`Failed to join session: ${err.message}`);
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

  // Generate PIN and create session on component mount
  useEffect(() => {
    if (!sessionData) {
      const generatedPin = Math.floor(1000 + Math.random() * 9000).toString();
      setPin(generatedPin);

      const createSession = async () => {
        try {
          const newSession = await room.collection('session').create({
            pin: generatedPin,
            mode: mode,
            min_time: minTime,
            max_time: maxTime,
            is_playing: false,
            is_ending: false,
          });
          setSessionData(newSession);
        } catch (err) {
          console.error('Failed to create session:', err);
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
      const shareableUrl = `${window.baseUrl}?pin=${pin}`;
      console.log('Shareable link:', shareableUrl);
    }
  }, [pin]);

  // Subscribe to players in this session
  useEffect(() => {
    if (pin) {
      return room.collection('player').filter({ session_pin: pin }).subscribe(playersList => {
        setPlayers(playersList);
      });
    }
  }, [pin]);

  // Subscribe to decks in this session
  useEffect(() => {
    if (pin) {
      return room.collection('deck').filter({ session_pin: pin }).subscribe(decksList => {
        setDecks(decksList);
        if (decksList.length > 0 && !currentDeck) {
          setCurrentDeck(decksList[0].id);
        }
      });
    }
  }, [pin]);

  // Update session when parameters change
  useEffect(() => {
    const updateSession = async () => {
      if (sessionData && sessionData.id && pin) {
        try {
          await room.collection('session').update(sessionData.id, {
            mode,
            min_time: minTime,
            max_time: maxTime,
            is_playing: isPlaying,
            is_ending: isEnding,
          });
        } catch (err) {
          console.error('Failed to update session:', err);
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
        await room.collection('player').update(player.id, {
          current_card: 'END',
          expires_at: null,
        });
      } catch (err) {
        console.error('Failed to update player:', err);
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
      await room.collection('player').update(player.id, {
        current_card: card,
        expires_at: expiresAt,
      });
    } catch (err) {
      console.error('Failed to update player:', err);
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
        await room.collection('player').update(player.id, {
          current_card: null,
          expires_at: null,
        });
      } catch (err) {
        console.error('Failed to update player:', err);
      }
    });
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);

    // Add a size limit to prevent timeouts
    const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
    if (file.size > MAX_FILE_SIZE) {
      alert('File is too large (max 5MB). Please split into smaller files.');
      setLoading(false);
      setFileInput('');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        
        // Function to process decks with a delay to prevent timeouts
        const processDecksWithDelay = async (items, processFn) => {
          const results = [];
          // Process in smaller batches
          const BATCH_SIZE = 5;
          
          for (let i = 0; i < items.length; i += BATCH_SIZE) {
            const batch = items.slice(i, i + BATCH_SIZE);
            // Process batch
            const batchPromises = batch.map(processFn);
            const batchResults = await Promise.allSettled(batchPromises);
            
            // Add successful results
            batchResults.forEach((result, index) => {
              if (result.status === 'fulfilled') {
                results.push(result.value);
              } else {
                console.error(`Failed to process item ${i + index}:`, result.reason);
              }
            });
            
            // Add a small delay between batches to prevent timeout
            if (i + BATCH_SIZE < items.length) {
              await new Promise(resolve => setTimeout(resolve, 300));
            }
          }
          return results;
        };

        if (Array.isArray(data)) {
          // Simple array of strings
          await createDeck(file.name.replace('.json', ''), data);
        } else if (data.cards && Array.isArray(data.cards)) {
          // Single deck with cards property
          await createDeck(data.name || file.name.replace('.json', ''), data.cards);
        } else if (data.decks && Array.isArray(data.decks)) {
          // Multiple decks format
          await processDecksWithDelay(data.decks, async (deck) => {
            if (deck.name && Array.isArray(deck.cards)) {
              return await createDeck(deck.name, deck.cards);
            }
          });
        } else {
          alert('Invalid JSON format. Expected an array of strings or object with cards array.');
        }
        
        setLoading(false);
      } catch (err) {
        alert('Failed to parse JSON: ' + err.message);
        setLoading(false);
      }
    };
    
    reader.onerror = function() {
      alert('Error reading file');
      setLoading(false);
    };
    
    reader.readAsText(file);
    setFileInput('');
  };

  const createDeck = async (name, cards) => {
    try {
      // Use a more unique deck name to avoid conflicts
      const timestamp = new Date().getTime();
      const uniqueName = `${name}_${timestamp}`;

      // Limit the size of each card to prevent payload issues
      const processedCards = cards.map(card => {
        if (typeof card === 'string' && card.length > 500) {
          return card.substring(0, 500); // Limit to 500 chars
        }
        return card;
      });

      // Split large decks into chunks to prevent timeouts
      const MAX_CARDS_PER_DECK = 100;
      if (processedCards.length > MAX_CARDS_PER_DECK) {
        const chunks = [];
        for (let i = 0; i < processedCards.length; i += MAX_CARDS_PER_DECK) {
          chunks.push(processedCards.slice(i, i + MAX_CARDS_PER_DECK));
        }
        
        // Create multiple decks
        for (let i = 0; i < chunks.length; i++) {
          const chunkName = chunks.length > 1 ? `${name} (part ${i+1})` : name;
          await createDeckChunk(chunkName, chunks[i]);
          
          // Add a small delay between chunks
          if (i < chunks.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
        
        return { name, chunked: true };
      } else {
        return await createDeckChunk(name, processedCards);
      }
    } catch (err) {
      console.error('Failed to create deck:', err);
      alert('Failed to create deck: ' + err.message);
      throw err;
    }
  };

  // Helper function to create a single deck
  const createDeckChunk = async (name, cards) => {
    try {
      const newDeck = await room.collection('deck').create({
        session_pin: pin,
        name: name,
        cards: cards,
        created_at: new Date().toISOString()
      });

      console.log('Created new deck:', newDeck);

      // Update currentDeck to the newly created deck if no deck is selected
      if (!currentDeck) {
        setCurrentDeck(newDeck.id);
      }

      return newDeck;
    } catch (err) {
      console.error(`Failed to create deck chunk "${name}":`, err);
      throw err;
    }
  };

  const handleTextSubmit = async () => {
    if (!textInput.trim() || !deckName.trim()) {
      alert('Please enter deck name and cards');
      return;
    }

    const cards = textInput.split('\n').filter(line => line.trim());
    if (cards.length === 0) {
      alert('No cards found');
      return;
    }

    setLoading(true);
    await createDeck(deckName, cards);
    setTextInput('');
    setDeckName('');
    setLoading(false);
  };

  const downloadDecks = () => {
    const decksToDownload = {
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
    a.download = 'improv_decks.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getTimeLeft = (expiresAt) => {
    if (!expiresAt) return 0;
    const remaining = new Date(expiresAt).getTime() - Date.now();
    return Math.max(0, Math.floor(remaining / 1000));
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="header">Conductor Panel</h1>

      <div className="card">
        <h2 className="header">Session PIN: {pin}</h2>
        <p>Share this PIN with players to join (max 10)</p>
        <button className="btn" onClick={() => {
          const url = `${window.baseUrl}?pin=${pin}`;
          navigator.clipboard.writeText(url);
          alert('Shareable link copied to clipboard');
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
        </div>

        <div>
          <h3>Available Decks ({decks.length})</h3>
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
                    {deck.name} ({deck.cards.length} cards)
                  </option>
                ))}
              </select>
              <button className="btn" onClick={downloadDecks} style={{ marginTop: '10px' }}>
                Download All Decks as JSON
              </button>
            </>
          )}
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

  // Find player record and subscribe to changes
  useEffect(() => {
    const setupPlayer = async () => {
      try {
        setLoading(true);
        console.log('Looking for player with pin:', pin, 'and name:', playerName);

        // Make sure session exists first
        const sessions = await room.collection('session').filter({ pin }).getList();
        if (sessions.length === 0) {
          setError('Session not found. Please check your PIN.');
          setLoading(false);
          return;
        }

        // First try to find the existing player
        let players = await room.collection('player').filter({ 
          session_pin: pin, 
          name: playerName 
        }).getList();

        console.log('Found players:', players);

        // If no players found, create one with retries
        if (players.length === 0) {
          console.log('Player not found, attempting to create...');
          
          // Try to create the player with retries
          const MAX_RETRIES = 3;
          let retryCount = 0;
          let playerCreated = false;
          
          while (retryCount < MAX_RETRIES && !playerCreated) {
            try {
              const newPlayer = await room.collection('player').create({
                session_pin: pin,
                name: playerName,
                current_card: null,
                expires_at: null,
              });
              console.log('Created new player:', newPlayer);
              setPlayerId(newPlayer.id);
              playerCreated = true;
            } catch (createErr) {
              console.error(`Failed to create player (attempt ${retryCount + 1}):`, createErr);
              retryCount++;
              
              // Wait a bit before retrying
              await new Promise(resolve => setTimeout(resolve, 500 * retryCount));
              
              // Check if player was actually created
              players = await room.collection('player').filter({ 
                session_pin: pin, 
                name: playerName 
              }).getList();
              
              if (players.length > 0) {
                console.log('Player was created despite error');
                setPlayerId(players[0].id);
                playerCreated = true;
                break;
              }
            }
          }
          
          if (!playerCreated) {
            setError('Could not join session after multiple attempts. Please try again.');
            setLoading(false);
            return;
          }
        } else {
          setPlayerId(players[0].id);
        }

        setLoading(false);

        // Subscribe to player changes
        return room.collection('player').filter({ 
          session_pin: pin, 
          name: playerName 
        }).subscribe(playersList => {
          if (playersList.length > 0) {
            const player = playersList[0];
            setCurrentCard(player.current_card);

            if (player.expires_at) {
              const expiry = new Date(player.expires_at).getTime();
              const now = Date.now();
              const remaining = Math.max(0, Math.floor((expiry - now) / 1000));

              // Calculate total time from session
              const sessions = room.collection('session').filter({ pin }).getList();
              if (sessions && sessions.length > 0) {
                const session = sessions[0];
                const maxDuration = session.max_time;
                const minDuration = session.min_time;
                const avgDuration = (maxDuration + minDuration) / 2;
                setTotalTime(avgDuration);
              }

              setTimeLeft(remaining);
            }
          }
        });
      } catch (err) {
        console.error('Failed to setup player:', err);
        setError('Failed to connect to session');
        setLoading(false);
      }
    };

    setupPlayer();
  }, [pin, playerName]);

  // Subscribe to session
  useEffect(() => {
    return room.collection('session').filter({ pin }).subscribe(sessionsList => {
      if (sessionsList.length > 0) {
        setIsSessionActive(sessionsList[0].is_playing);
      } else {
        setError('Session not found');
      }
    });
  }, [pin]);

  // Timer to update time left
  useEffect(() => {
    if (currentCard && currentCard !== 'END' && timeLeft > 0) {
      const timer = setTimeout(() => {
        setTimeLeft(prev => Math.max(0, prev - 1));
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [currentCard, timeLeft]);

  const getProgressWidth = () => {
    if (timeLeft <= 0 || totalTime <= 0) return 0;
    return (timeLeft / totalTime) * 100;
  };

  if (loading) {
    return (
      <div className="fullscreen-card">
        <div>
          <h2 className="header">Connecting to session...</h2>
          <p>Please wait</p>
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
          <div>
            <h1 className="card-text">{currentCard}</h1>
            <div className="timer-bar">
              <div
                className="timer-progress"
                style={{ width: `${getProgressWidth()}%` }}
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
          </div>
        </div>
      )}
    </div>
  );
}

// Render the app
const root = createRoot(document.getElementById('root'));
root.render(<App />);