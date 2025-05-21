// App version
const APP_VERSION = "2.3.0 (build 248)";

const { useState, useEffect, useRef, useCallback, useSyncExternalStore } = React;
const { createRoot } = ReactDOM;

// Initialize WebsimSocket
let room;
try {
  room = new WebsimSocket();
  console.log(`[${APP_VERSION}] WebsimSocket initialized`);
} catch (err) {
  console.error(`[${APP_VERSION}] WebsimSocket initialization error:`, err);
  room = new WebsimSocketFallback();
  console.log(`[${APP_VERSION}] Using fallback socket`);
}

// Helper Functions
const generatePin = () => Math.floor(100000 + Math.random() * 900000).toString();

const safeOperation = async (operation, retries = 3) => {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      console.error(`Operation failed (attempt ${attempt + 1}/${retries}):`, error);
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw lastError || new Error('Operation failed');
};

// Components
function HomeView({ onNavigate }) {
  return (
    <div className="container">
      <div className="card">
        <h1 className="header">Improv Cards</h1>
        <button className="btn btn-block" onClick={() => onNavigate('conductor')}>
          I am the Conductor
        </button>
        <button className="btn btn-outline btn-block" onClick={() => onNavigate('join')}>
          I am a Player
        </button>
      </div>
    </div>
  );
}

function ConductorView({ onNavigate }) {
  const [step, setStep] = useState('setup'); // setup, session
  const [pin, setPin] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [decks, setDecks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [players, setPlayers] = useState([]);
  const [selectedDeck, setSelectedDeck] = useState('');
  const [distributionMode, setDistributionMode] = useState('unison');
  const [minTimerSeconds, setMinTimerSeconds] = useState(30);
  const [maxTimerSeconds, setMaxTimerSeconds] = useState(90);
  const [newDeckName, setNewDeckName] = useState('');
  const [newDeckCards, setNewDeckCards] = useState('');
  const fileInputRef = useRef(null);
  const playersSubscriptionRef = useRef(null);

  // Load decks
  useEffect(() => {
    const loadDecks = async () => {
      try {
        setLoading(true);
        const deckList = await safeOperation(() => room.collection('deck').getList());
        setDecks(deckList);
        if (deckList.length > 0 && !selectedDeck) {
          setSelectedDeck(deckList[0].id);
        }
      } catch (error) {
        setError('Failed to load decks');
        console.error('Error loading decks:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDecks();
  }, []);

  // Manual refresh for player list
  const refreshPlayerList = async () => {
    if (!pin) return;

    try {
      setLoading(true);
      setError('');
      const playerList = await safeOperation(() =>
        room.collection('player')
          .filter({ session_pin: pin })
          .getList()
      );
      console.log(`[${APP_VERSION}] Refreshed player list:`, playerList);
      setPlayers(playerList);
      setSuccess('Player list refreshed');
      setTimeout(() => setSuccess(''), 2000);
    } catch (error) {
      setError('Failed to refresh player list');
      console.error('Error refreshing players:', error);
    } finally {
      setLoading(false);
    }
  };

  // Setup player subscription
  const setupPlayerSubscription = useCallback(() => {
    if (!pin) return;

    // Clean up previous subscription if it exists
    if (playersSubscriptionRef.current) {
      playersSubscriptionRef.current();
      playersSubscriptionRef.current = null;
    }

    try {
      // Create new subscription
      const unsubscribe = room.collection('player')
        .filter({ session_pin: pin })
        .subscribe(updatedPlayers => {
          console.log(`[${APP_VERSION}] Player update received, count:`, updatedPlayers.length);
          setPlayers(updatedPlayers);
        });

      playersSubscriptionRef.current = unsubscribe;
      console.log(`[${APP_VERSION}] Player subscription set up for PIN:`, pin);
    } catch (error) {
      console.error(`[${APP_VERSION}] Error setting up player subscription:`, error);
      setError('Error setting up player tracking. Try refreshing the page.');
    }
  }, [pin]);

  // Create new deck
  const handleCreateDeck = async () => {
    if (!newDeckName.trim() || !newDeckCards.trim()) {
      setError('Please provide both a deck name and cards');
      return;
    }

    try {
      setLoading(true);
      setError('');

      const cards = newDeckCards
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

      if (cards.length === 0) {
        setError('No valid cards found');
        setLoading(false);
        return;
      }

      const deck = await safeOperation(() =>
        room.collection('deck').create({
          name: newDeckName,
          cards: cards,
          card_count: cards.length
        })
      );

      setDecks(prevDecks => [deck, ...prevDecks]);
      setSelectedDeck(deck.id);
      setNewDeckName('');
      setNewDeckCards('');
      setSuccess(`Deck "${newDeckName}" created with ${cards.length} cards`);

      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      setError('Failed to create deck');
      console.error('Error creating deck:', error);
    } finally {
      setLoading(false);
    }
  };

  // Handle file upload
  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    try {
      setLoading(true);
      setError('');

      const text = await file.text();
      let deckData;
      let successCount = 0;
      let errorCount = 0;

      try {
        // Try parsing as JSON
        deckData = JSON.parse(text);

        // Handle array of decks
        if (Array.isArray(deckData)) {
          for (const deck of deckData) {
            if (deck.name && Array.isArray(deck.cards) && deck.cards.length > 0) {
              try {
                await safeOperation(() =>
                  room.collection('deck').create({
                    name: deck.name,
                    cards: deck.cards.filter(card => card && card.trim()),
                    card_count: deck.cards.filter(card => card && card.trim()).length
                  })
                );
                successCount++;
              } catch (err) {
                errorCount++;
                console.error(`Error importing deck ${deck.name}:`, err);
              }
            } else {
              errorCount++;
            }
          }

          // Refresh decks
          const updatedDecks = await safeOperation(() => room.collection('deck').getList());
          setDecks(updatedDecks);
          if (updatedDecks.length > 0 && !selectedDeck) {
            setSelectedDeck(updatedDecks[0].id);
          }
        }
        // Handle single deck
        else if (deckData.name && Array.isArray(deckData.cards)) {
          try {
            const deck = await safeOperation(() =>
              room.collection('deck').create({
                name: deckData.name,
                cards: deckData.cards.filter(card => card && card.trim()),
                card_count: deckData.cards.filter(card => card && card.trim()).length
              })
            );
            
            setDecks(prevDecks => [deck, ...prevDecks]);
            setSelectedDeck(deck.id);
            successCount = 1;
          } catch (err) {
            errorCount = 1;
            console.error(`Error importing deck ${deckData.name}:`, err);
          }
        } else {
          setError('Invalid JSON format');
          errorCount = 1;
        }
      } catch (jsonError) {
        // Try parsing as text (first line is name, rest are cards)
        const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);

        if (lines.length < 2) {
          setError('Not enough content in file');
          setLoading(false);
          return;
        }

        const name = lines[0];
        const cards = lines.slice(1);

        try {
          const deck = await safeOperation(() =>
            room.collection('deck').create({
              name,
              cards,
              card_count: cards.length
            })
          );

          setDecks(prevDecks => [deck, ...prevDecks]);
          setSelectedDeck(deck.id);
          successCount = 1;
        } catch (err) {
          errorCount = 1;
          console.error(`Error importing text deck ${name}:`, err);
        }
      }

      // Clear file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      setSuccess(`Upload complete! Added ${successCount} deck${successCount !== 1 ? 's' : ''}, failed ${errorCount}`);
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      setError('Failed to process file');
      console.error('Error processing file:', error);
    } finally {
      setLoading(false);
    }
  };

  // Create session
  const handleCreateSession = async () => {
    if (!selectedDeck) {
      setError('Please select a deck first');
      return;
    }

    try {
      setLoading(true);
      setError('');

      const sessionPin = generatePin();

      const session = await safeOperation(() =>
        room.collection('session').create({
          pin: sessionPin,
          active: true,
          distribution_mode: distributionMode,
          min_timer_seconds: minTimerSeconds,
          max_timer_seconds: maxTimerSeconds,
          active_deck_id: selectedDeck,
          ended: false
        })
      );

      setSessionId(session.id);
      setPin(sessionPin);
      setStep('session');
      setSuccess(`Session created with PIN: ${sessionPin}`);

      // Set up player subscription immediately after creating session
      setTimeout(() => {
        setupPlayerSubscription();
      }, 500);

      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      setError('Failed to create session');
      console.error('Error creating session:', error);
    } finally {
      setLoading(false);
    }
  };

  // Subscribe to players when pin changes
  useEffect(() => {
    if (pin) {
      setupPlayerSubscription();
      // Initial player list fetch
      refreshPlayerList();
    }

    return () => {
      if (playersSubscriptionRef.current) {
        playersSubscriptionRef.current();
        playersSubscriptionRef.current = null;
      }
    };
  }, [pin, setupPlayerSubscription]);

  // Distribute cards
  const handleDistributeCards = async () => {
    if (!sessionId || !selectedDeck) {
      setError('Session or deck not selected');
      return;
    }

    if (players.length === 0) {
      setError('No players have joined yet');
      return;
    }

    try {
      setLoading(true);
      setError('');

      // Get all available decks for random mode
      let allDecks = decks;
      let selectedDeckData = decks.find(d => d.id === selectedDeck);
      
      if (!selectedDeckData || !selectedDeckData.cards || selectedDeckData.cards.length === 0) {
        setError('Selected deck has no cards');
        setLoading(false);
        return;
      }

      console.log(`[${APP_VERSION}] Distribution started: deck=${selectedDeckData.name}, mode=${distributionMode}, players=${players.length}`);

      // Distribute cards based on mode
      if (distributionMode === 'unison') {
        // Everyone gets the same card
        const cards = selectedDeckData.cards;
        const randomIndex = Math.floor(Math.random() * cards.length);
        const selectedCard = cards[randomIndex];
        console.log(`[${APP_VERSION}] Unison mode: selected card "${selectedCard}"`);

        for (const player of players) {
          // Generate random duration between min and max timer settings
          const randomDuration = Math.floor(
            Math.random() * (maxTimerSeconds - minTimerSeconds + 1) + minTimerSeconds
          );

          console.log(`[${APP_VERSION}] Assigning card to ${player.name}, duration=${randomDuration}s`);
          
          try {
            await safeOperation(() =>
              room.collection('player').update(player.id, {
                current_card: selectedCard,
                current_deck_name: selectedDeckData.name,
                current_deck_id: selectedDeckData.id,
                card_start_time: new Date().toISOString(),
                card_duration: randomDuration
              })
            );
          } catch (err) {
            console.error(`[${APP_VERSION}] Failed to update player ${player.name}:`, err);
          }
        }
      } else if (distributionMode === 'unique') {
        // Each player gets a unique card if possible
        const cards = selectedDeckData.cards;
        const shuffledCards = [...cards].sort(() => Math.random() - 0.5);
        console.log(`[${APP_VERSION}] Unique mode: shuffled ${shuffledCards.length} cards`);

        for (let i = 0; i < players.length; i++) {
          const cardIndex = i % shuffledCards.length; // Wrap around if more players than cards
          const selectedCard = shuffledCards[cardIndex];

          // Generate random duration between min and max timer settings
          const randomDuration = Math.floor(
            Math.random() * (maxTimerSeconds - minTimerSeconds + 1) + minTimerSeconds
          );

          console.log(`[${APP_VERSION}] Assigning card "${selectedCard}" to ${players[i].name}, duration=${randomDuration}s`);
          
          try {
            await safeOperation(() =>
              room.collection('player').update(players[i].id, {
                current_card: selectedCard,
                current_deck_name: selectedDeckData.name,
                current_deck_id: selectedDeckData.id,
                card_start_time: new Date().toISOString(),
                card_duration: randomDuration
              })
            );
          } catch (err) {
            console.error(`[${APP_VERSION}] Failed to update player ${players[i].name}:`, err);
          }
        }
      } else if (distributionMode === 'random') {
        // Each player gets a random card from any available deck (duplicates allowed)
        console.log(`[${APP_VERSION}] Random mode: selecting from all available decks`);
        
        // Create a combined list of all cards from all decks with deck info
        const allCards = [];
        decks.forEach(deck => {
          if (deck.cards && deck.cards.length > 0) {
            deck.cards.forEach(card => {
              allCards.push({
                text: card,
                deck_name: deck.name,
                deck_id: deck.id
              });
            });
          }
        });
        
        if (allCards.length === 0) {
          setError('No cards available in any deck');
          setLoading(false);
          return;
        }
        
        console.log(`[${APP_VERSION}] Random mode: combined ${allCards.length} cards from all decks`);
        
        for (const player of players) {
          const randomIndex = Math.floor(Math.random() * allCards.length);
          const selectedCardObj = allCards[randomIndex];

          // Generate random duration between min and max timer settings
          const randomDuration = Math.floor(
            Math.random() * (maxTimerSeconds - minTimerSeconds + 1) + minTimerSeconds
          );

          console.log(`[${APP_VERSION}] Assigning random card "${selectedCardObj.text}" from deck "${selectedCardObj.deck_name}" to ${player.name}, duration=${randomDuration}s`);
          
          try {
            await safeOperation(() =>
              room.collection('player').update(player.id, {
                current_card: selectedCardObj.text,
                current_deck_name: selectedCardObj.deck_name,
                current_deck_id: selectedCardObj.deck_id,
                card_start_time: new Date().toISOString(),
                card_duration: randomDuration
              })
            );
          } catch (err) {
            console.error(`[${APP_VERSION}] Failed to update player ${player.name}:`, err);
          }
        }
      }

      // Update session with latest distribution settings
      await safeOperation(() =>
        room.collection('session').update(sessionId, {
          last_distribution: new Date().toISOString(),
          distribution_mode: distributionMode,
          min_timer_seconds: minTimerSeconds,
          max_timer_seconds: maxTimerSeconds,
          active_deck_id: selectedDeck
        })
      );

      console.log(`[${APP_VERSION}] Card distribution complete`);

      // Force refresh player list to show updated cards
      setTimeout(refreshPlayerList, 1000);

      setSuccess(`Cards distributed to ${players.length} players`);
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      setError('Failed to distribute cards');
      console.error('Error distributing cards:', error);
    } finally {
      setLoading(false);
    }
  };

  // End session
  const handleEndSession = async () => {
    if (!sessionId) return;

    try {
      setLoading(true);
      setError('');

      console.log(`[${APP_VERSION}] Ending session ${sessionId} for ${players.length} players`);

      // Update all players with END signal
      for (const player of players) {
        try {
          console.log(`[${APP_VERSION}] Sending END signal to ${player.name}`);
          await safeOperation(() =>
            room.collection('player').update(player.id, {
              current_card: 'END',
              card_start_time: new Date().toISOString()
            })
          );
        } catch (err) {
          console.error(`[${APP_VERSION}] Failed to send END to player ${player.name}:`, err);
        }
      }

      // Mark session as ended
      await safeOperation(() =>
        room.collection('session').update(sessionId, {
          ended: true,
          active: false
        })
      );

      setSuccess('Session ended successfully');

      // Navigate back to setup after a delay
      setTimeout(() => {
        setStep('setup');
        setSessionId('');
        setPin('');
      }, 2000);
    } catch (error) {
      setError('Failed to end session');
      console.error('Error ending session:', error);
    } finally {
      setLoading(false);
    }
  };

  if (step === 'setup') {
    return (
      <div className="container">
        <div className="card">
          <h2 className="header">Conductor Setup</h2>

          <h3 className="subheader">Select Deck</h3>
          {decks.length > 0 ? (
            <div className="deck-selector">
              <select
                className="input"
                value={selectedDeck}
                onChange={(e) => setSelectedDeck(e.target.value)}
              >
                {decks.map(deck => (
                  <option key={deck.id} value={deck.id}>
                    {deck.name} ({deck.card_count || deck.cards.length} cards)
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="notice">No decks available. Create one below.</p>
          )}

          <h3 className="subheader">Distribution Settings</h3>
          <div>
            <label>Distribution Mode:</label>
            <select
              className="input"
              value={distributionMode}
              onChange={(e) => setDistributionMode(e.target.value)}
            >
              <option value="unison">Unison - All players get the same card</option>
              <option value="unique">Unique - Each player gets a different card</option>
              <option value="random">Random - Each player gets a random card</option>
            </select>
          </div>
          <div>
            <label>Timer Duration (random between min and max):</label>
            <div style={{ display: 'flex', gap: '10px' }}>
              <div style={{ flex: 1 }}>
                <label>Minimum (seconds):</label>
                <input
                  type="number"
                  className="input"
                  value={minTimerSeconds}
                  min="5"
                  max="300"
                  onChange={(e) => {
                    const value = Math.max(5, parseInt(e.target.value) || 5);
                    setMinTimerSeconds(value);
                    if (value > maxTimerSeconds) {
                      setMaxTimerSeconds(value);
                    }
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label>Maximum (seconds):</label>
                <input
                  type="number"
                  className="input"
                  value={maxTimerSeconds}
                  min="5"
                  max="300"
                  onChange={(e) => {
                    const value = Math.max(
                      minTimerSeconds,
                      parseInt(e.target.value) || minTimerSeconds
                    );
                    setMaxTimerSeconds(value);
                  }}
                />
              </div>
            </div>
          </div>

          <button
            className="btn btn-block"
            onClick={handleCreateSession}
            disabled={loading || decks.length === 0}
          >
            {loading ? 'Creating...' : 'Create Session'}
          </button>

          <hr style={{ margin: '20px 0', border: 'none', borderTop: '1px solid var(--border)' }} />

          <h3 className="subheader">Create New Deck</h3>
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
            value={newDeckCards}
            onChange={(e) => setNewDeckCards(e.target.value)}
          ></textarea>
          <button
            className="btn btn-outline btn-block"
            onClick={handleCreateDeck}
            disabled={loading}
          >
            {loading ? 'Creating...' : 'Create Deck'}
          </button>

          <h3 className="subheader" style={{ marginTop: '20px' }}>
            Import Deck
          </h3>
          <p className="notice">Upload JSON or text files</p>
          <input
            type="file"
            ref={fileInputRef}
            accept=".txt,.json"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
          <button
            className="btn btn-outline btn-block"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
          >
            Select File
          </button>

          {error && <div className="error">{error}</div>}
          {success && <div className="success">{success}</div>}

          <button
            className="btn btn-outline btn-block"
            onClick={() => onNavigate('home')}
            style={{ marginTop: '20px' }}
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  // Active session view
  return (
    <div className="container">
      <div className="card">
        <h2 className="header">Active Session</h2>

        <div
          style={{
            background: '#f0f0f0',
            padding: '10px',
            borderRadius: '4px',
            textAlign: 'center',
            marginBottom: '20px'
          }}
        >
          <div style={{ fontWeight: 'bold', fontSize: '24px' }}>
            PIN: {pin}
          </div>
          <div>Share this link with players:</div>
          <input
            type="text"
            className="input"
            readOnly
            value={`${window.baseUrl || window.location.origin}?pin=${pin}`}
            onClick={(e) => e.target.select()}
            style={{ marginTop: '10px', marginBottom: '5px' }}
          />
          <button
            className="btn"
            onClick={() => {
              const url = `${window.baseUrl || window.location.origin}?pin=${pin}`;
              navigator.clipboard.writeText(url).then(() => {
                setSuccess("Link copied!");
                setTimeout(() => setSuccess(''), 2000);
              }).catch(() => {
                // Fallback
                const textArea = document.createElement("textarea");
                textArea.value = url;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                setSuccess("Link copied!");
                setTimeout(() => setSuccess(''), 2000);
              });
            }}
          >
            Copy Link
          </button>
        </div>

        <h3 className="subheader">
          Players ({players.length})
          <button
            className="btn btn-outline"
            style={{ marginLeft: '10px', padding: '5px 10px', fontSize: '14px' }}
            onClick={refreshPlayerList}
            disabled={loading}
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </h3>
        {players.length > 0 ? (
          <div
            style={{
              maxHeight: '200px',
              overflowY: 'auto',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              marginBottom: '20px'
            }}
          >
            {players.map(player => (
              <div key={player.id} className="player-item">
                <div style={{ flex: 1 }}>
                  <div>
                    <strong>{player.name}</strong>
                  </div>
                  {player.current_card && player.current_card !== 'END' && (
                    <div className="player-card">
                      <div><strong>Card:</strong> {player.current_card}</div>
                      <div><strong>Deck:</strong> {player.current_deck_name || "Unknown"}</div>
                      {player.card_start_time && player.card_duration && (
                        <PlayerTimer
                          startTime={player.card_start_time}
                          duration={player.card_duration}
                        />
                      )}
                    </div>
                  )}
                  {player.current_card === 'END' && (
                    <div className="player-card">SESSION ENDED</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f9f9f9', borderRadius: '4px' }}>
            <p style={{ marginBottom: '10px' }}>No players have joined yet. Share the link/PIN above with players.</p>
            <p className="notice">
              If you believe players have joined but they're not showing here, use the Refresh button above.
              <br />You can also try reopening the session.
            </p>
          </div>
        )}

        <h3 className="subheader">Distribution Controls</h3>
        <div className="distribution-container">
          <div className="distribution-section">
            <label>Distribution Mode:</label>
            <select
              className="input"
              value={distributionMode}
              onChange={(e) => setDistributionMode(e.target.value)}
            >
              <option value="unison">Unison - All players get the same card</option>
              <option value="unique">Unique - Each player gets a different card</option>
              <option value="random">Random - Each player gets a random card</option>
            </select>
          </div>
          <div className="distribution-section">
            <label>Timer Duration (random between min and max):</label>
            <div style={{ display: 'flex', gap: '10px' }}>
              <div style={{ flex: 1 }}>
                <label>Minimum (seconds):</label>
                <input
                  type="number"
                  className="input"
                  value={minTimerSeconds}
                  min="5"
                  max="300"
                  onChange={(e) => {
                    const value = Math.max(5, parseInt(e.target.value) || 5);
                    setMinTimerSeconds(value);
                    if (value > maxTimerSeconds) {
                      setMaxTimerSeconds(value);
                    }
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label>Maximum (seconds):</label>
                <input
                  type="number"
                  className="input"
                  value={maxTimerSeconds}
                  min="5"
                  max="300"
                  onChange={(e) => {
                    const value = Math.max(
                      minTimerSeconds,
                      parseInt(e.target.value) || minTimerSeconds
                    );
                    setMaxTimerSeconds(value);
                  }}
                />
              </div>
            </div>
          </div>
          <div className="distribution-section">
            <label>Select Deck:</label>
            <select
              className="input"
              value={selectedDeck}
              onChange={(e) => setSelectedDeck(e.target.value)}
            >
              {decks.map(deck => (
                <option key={deck.id} value={deck.id}>
                  {deck.name} ({deck.card_count || deck.cards.length} cards)
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="next-card-notice">
          <span className="emoji">👇</span> Click the button below to distribute cards to all players <span className="emoji">👇</span>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
          <button
            className="btn btn-action"
            style={{ flex: 1 }}
            onClick={handleDistributeCards}
            disabled={loading}
          >
            {loading ? 'Sending...' : 'Distribute Cards Now'}
          </button>
          <button
            className="btn btn-outline"
            style={{ flex: 1 }}
            onClick={handleEndSession}
            disabled={loading}
          >
            End Session
          </button>
        </div>

        {error && <div className="error">{error}</div>}
        {success && <div className="success">{success}</div>}
      </div>
    </div>
  );
}

function PlayerTimer({ startTime, duration }) {
  const [timeLeft, setTimeLeft] = useState(duration);
  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => {
    const start = new Date(startTime).getTime();
    const end = start + (duration * 1000);

    const updateTimer = () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((end - now) / 1000));
      setTimeLeft(remaining);
      
      if (remaining === 0 && !isExpired) {
        setIsExpired(true);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [startTime, duration, isExpired]);

  const percentage = (timeLeft / duration) * 100;

  return (
    <div style={{ marginTop: '8px' }}>
      <div className={`timer-bar ${isExpired ? 'timer-expired' : ''}`}>
        <div className="timer-progress" style={{ width: `${percentage}%` }}></div>
      </div>
      <div style={{ fontSize: '12px', textAlign: 'right' }}>
        {isExpired ? 'Time up!' : `${timeLeft} sec`}
      </div>
    </div>
  );
}

function JoinView({ onNavigate, initialPin }) {
  const [pin, setPin] = useState(initialPin || '');
  const [name, setName] = useState(localStorage.getItem('playerName') || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleJoin = async () => {
    if (!pin) {
      setError('Please enter a session PIN');
      return;
    }

    if (!name) {
      setError('Please enter your name');
      return;
    }

    try {
      setLoading(true);
      setError('');

      // Check if session exists
      const sessions = await safeOperation(() =>
        room.collection('session')
          .filter({ pin, active: true, ended: false })
          .getList()
      );

      if (sessions.length === 0) {
        setError('Session not found or has ended');
        setLoading(false);
        return;
      }

      // Create player record
      const player = await safeOperation(() =>
        room.collection('player').create({
          name,
          session_pin: pin,
          current_card: '',
          joined_at: new Date().toISOString()
        })
      );

      console.log(`[${APP_VERSION}] Player joined: ${name}, pin: ${pin}, id: ${player.id}`);

      // Save to localStorage for reconnection
      localStorage.setItem('playerName', name);
      localStorage.setItem('lastPin', pin);
      localStorage.setItem('playerId', player.id);

      // Navigate to player view
      onNavigate('player', { pin, name, playerId: player.id });
    } catch (error) {
      setError('Failed to join session');
      console.error('Error joining session:', error);
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <div className="card">
        <h2 className="header">Join Session</h2>
        <div>
          <label>Session PIN:</label>
          <input
            type="text"
            className="input"
            placeholder="Enter 6-digit PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').substring(0, 6))}
            maxLength={6}
            inputMode="numeric"
          />
        </div>
        <div>
          <label>Your Name:</label>
          <input
            type="text"
            className="input"
            placeholder="Enter your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
          />
        </div>

        {error && <div className="error">{error}</div>}

        <button
          className="btn btn-block"
          onClick={handleJoin}
          disabled={loading}
        >
          {loading ? 'Joining...' : 'Join Session'}
        </button>

        <button
          className="btn btn-outline btn-block"
          onClick={() => onNavigate('home')}
          style={{ marginTop: '20px' }}
        >
          Back to Home
        </button>
      </div>
    </div>
  );
}

function PlayerView({ pin, name, playerId, onNavigate }) {
  const [player, setPlayer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sessionEnded, setSessionEnded] = useState(false);
  const [cardAnimating, setCardAnimating] = useState(false);
  const lastCardRef = useRef('');
  const playerSubscriptionRef = useRef(null);
  
  // Debug state to show connection status
  const [connectionStatus, setConnectionStatus] = useState('Connecting...');

  // Find player and subscribe to updates
  useEffect(() => {
    if (!pin || !name) return;

    const findPlayer = async () => {
      try {
        console.log(`[${APP_VERSION}] Finding player: name=${name}, pin=${pin}, id=${playerId || 'unknown'}`);
        setConnectionStatus(`Finding player record...`);
        
        let players;
        if (playerId) {
          // If we have a player ID (from localStorage), use that first
          const playerById = await safeOperation(() => 
            room.collection('player').filter({ id: playerId }).getList()
          );
          if (playerById.length > 0) {
            players = playerById;
            setConnectionStatus(`Found player by ID`);
          }
        }
        
        // Fallback to finding by name and pin
        if (!players || players.length === 0) {
          setConnectionStatus(`Searching by name and pin...`);
          players = await safeOperation(() =>
            room.collection('player')
              .filter({ name, session_pin: pin })
              .getList()
          );
        }

        if (players.length === 0) {
          setError('Player not found');
          setConnectionStatus(`Error: Player not found`);
          setLoading(false);
          return;
        }

        console.log(`[${APP_VERSION}] Player found:`, players[0]);
        setConnectionStatus(`Connected as: ${players[0].name}`);
        setPlayer(players[0]);

        if (players[0].current_card === 'END') {
          setSessionEnded(true);
        }

        setLoading(false);
      } catch (error) {
        setError('Error connecting to session');
        setConnectionStatus(`Connection error: ${error.message}`);
        console.error('Error finding player:', error);
        setLoading(false);
      }
    };

    findPlayer();

    // Set up subscription to player updates
    const setupSubscription = () => {
      // Clear existing subscription if any
      if (playerSubscriptionRef.current) {
        playerSubscriptionRef.current();
        playerSubscriptionRef.current = null;
      }
      
      try {
        let filterParams = playerId 
          ? { id: playerId }
          : { name, session_pin: pin };
          
        console.log(`[${APP_VERSION}] Setting up player subscription with filter:`, filterParams);
        
        const unsubscribe = room.collection('player')
          .filter(filterParams)
          .subscribe(players => {
            if (players.length > 0) {
              const updatedPlayer = players[0];
              console.log(`[${APP_VERSION}] Player update received:`, updatedPlayer);
              setConnectionStatus(`Connected: ${new Date().toLocaleTimeString()}`);
              
              // Check if card changed
              if (lastCardRef.current !== updatedPlayer.current_card && updatedPlayer.current_card) {
                console.log(`[${APP_VERSION}] Card changed from "${lastCardRef.current}" to "${updatedPlayer.current_card}"`);
                setCardAnimating(true);
                setTimeout(() => setCardAnimating(false), 500);
              }
              
              lastCardRef.current = updatedPlayer.current_card;
              setPlayer(updatedPlayer);

              if (updatedPlayer.current_card === 'END') {
                setSessionEnded(true);
              }
            } else {
              console.warn(`[${APP_VERSION}] Player subscription returned empty result`);
              setConnectionStatus(`Warning: Subscription returned empty result`);
            }
          });
          
        playerSubscriptionRef.current = unsubscribe;
        console.log(`[${APP_VERSION}] Player subscription established`);
      } catch (err) {
        console.error(`[${APP_VERSION}] Error setting up player subscription:`, err);
        setConnectionStatus(`Subscription error: ${err.message}`);
        setError('Connection error. Please try rejoining.');
      }
    };
    
    // Set up subscription and refresh it periodically to ensure it's working
    setupSubscription();
    
    // Refresh subscription every 10 seconds to ensure we're getting updates
    const refreshTimer = setInterval(() => {
      console.log(`[${APP_VERSION}] Refreshing player subscription...`);
      setupSubscription();
    }, 10000);

    return () => {
      if (playerSubscriptionRef.current) {
        playerSubscriptionRef.current();
        playerSubscriptionRef.current = null;
      }
      clearInterval(refreshTimer);
      console.log(`[${APP_VERSION}] Player subscription and refresh timer cleared`);
    };
  }, [pin, name, playerId]);

  // Debug UI for connection issues
  const renderDebugInfo = () => {
    if (!error && player) return null;
    
    return (
      <div style={{ marginTop: '20px', fontSize: '12px', backgroundColor: 'rgba(0,0,0,0.05)', padding: '10px', borderRadius: '5px' }}>
        <div>Status: {connectionStatus}</div>
        <div>Last update: {new Date().toLocaleTimeString()}</div>
        <button 
          style={{ fontSize: '12px', marginTop: '5px', padding: '5px' }}
          onClick={() => window.location.reload()}
        >
          Refresh Connection
        </button>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="full-card">
        <div className="loading-spinner"></div>
        <div style={{ marginTop: '15px' }}>Connecting to session...</div>
        <div style={{ fontSize: '14px', color: 'var(--text-light)', marginTop: '10px' }}>
          {connectionStatus}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="full-card">
        <h3>Connection Error</h3>
        <p style={{ margin: '15px 0' }}>{error}</p>
        <button className="btn" onClick={() => onNavigate('join')}>
          Try Again
        </button>
        {renderDebugInfo()}
      </div>
    );
  }

  if (sessionEnded) {
    return (
      <div className="full-card session-ended">
        <h2 className="card-text">SESSION ENDED</h2>
        <p>Thank you for participating!</p>
        <button
          className="btn"
          onClick={() => onNavigate('home')}
          style={{ marginTop: '20px' }}
        >
          Return to Home
        </button>
      </div>
    );
  }

  if (!player) {
    return (
      <div className="full-card">
        <h3>Connection Error</h3>
        <p>Unable to find your player information</p>
        <button className="btn" onClick={() => onNavigate('join')}>
          Rejoin
        </button>
        {renderDebugInfo()}
      </div>
    );
  }

  // Waiting for card
  if (!player.current_card) {
    return (
      <div className="full-card">
        <h3>Waiting for card...</h3>
        <div className="waiting-animation">
          <div className="dot"></div>
          <div className="dot"></div>
          <div className="dot"></div>
        </div>
        <p style={{ margin: '15px 0' }}>
          The conductor will distribute a card shortly.
        </p>
        <div style={{ fontStyle: 'italic', marginTop: '20px' }}>
          Connected as: {name}
        </div>
        {renderDebugInfo()}
      </div>
    );
  }

  // Show the active card
  return (
    <div className="full-card">
      <div className={`card-content ${cardAnimating ? 'card-new' : ''}`}>
        <h2 className="card-text">{player.current_card}</h2>

        {player.card_start_time && player.card_duration && (
          <PlayerTimer
            startTime={player.card_start_time}
            duration={player.card_duration}
          />
        )}
      </div>

      <div
        style={{
          marginTop: '20px',
          fontSize: '14px',
          color: 'var(--text-light)'
        }}
      >
        Connected as: {name}
      </div>
      
      {/* Small debug button in corner for connection issues */}
      <button 
        onClick={() => window.location.reload()} 
        style={{ 
          position: 'absolute', 
          bottom: '10px', 
          right: '10px', 
          fontSize: '12px', 
          padding: '5px', 
          background: 'transparent',
          border: 'none',
          color: 'var(--text-light)',
          cursor: 'pointer'
        }}
      >
        ↻
      </button>
    </div>
  );
}

function App() {
  const [view, setView] = useState('home');
  const [playerData, setPlayerData] = useState({ pin: '', name: '', playerId: localStorage.getItem('playerId') || '' });

  useEffect(() => {
    // Hide loading indicator
    const loadingElement = document.getElementById('loading');
    if (loadingElement) {
      loadingElement.style.display = 'none';
    }

    // Check URL for PIN parameter
    try {
      const params = new URLSearchParams(window.location.search);
      const pinParam = params.get('pin');

      if (pinParam) {
        setPlayerData(prev => ({ ...prev, pin: pinParam }));
        setView('join');
      }
    } catch (error) {
      console.error('Error processing URL parameters:', error);
    }
  }, []);

  const handleNavigate = (to, data = {}) => {
    if (to === 'player' && data.pin && data.name) {
      setPlayerData({ 
        pin: data.pin, 
        name: data.name,
        playerId: data.playerId || playerData.playerId
      });
    }
    setView(to);
  };

  const renderView = () => {
    switch (view) {
      case 'home':
        return <HomeView onNavigate={handleNavigate} />;
      case 'conductor':
        return <ConductorView onNavigate={handleNavigate} />;
      case 'join':
        return <JoinView onNavigate={handleNavigate} initialPin={playerData.pin} />;
      case 'player':
        return <PlayerView 
          pin={playerData.pin} 
          name={playerData.name}
          playerId={playerData.playerId}
          onNavigate={handleNavigate} 
        />;
      default:
        return <HomeView onNavigate={handleNavigate} />;
    }
  };

  return (
    <>
      {renderView()}
      <div className="version">v{APP_VERSION}</div>
    </>
  );
}

// Render the app
try {
  const root = createRoot(document.getElementById('root'));
  root.render(<App />);
  console.log(`[${APP_VERSION}] App rendered successfully`);
} catch (err) {
  console.error(`[${APP_VERSION}] Error rendering app:`, err);
  document.getElementById('loading').innerHTML = `
    <div style="text-align:center;">
      <h2>Error loading application</h2>
      <p>${err.message}</p>
      <button onclick="window.location.reload()" style="padding:10px 20px; margin-top:20px; cursor:pointer;">
        Reload Page
      </button>
    </div>
  `;
}