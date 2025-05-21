// App version
const APP_VERSION = "2.5.0 (build 267)";

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
  const [autoDistribute, setAutoDistribute] = useState(true);
  const [showArchivedDecks, setShowArchivedDecks] = useState(false);
  const fileInputRef = useRef(null);
  const playersSubscriptionRef = useRef(null);
  const autoDistributeIntervalRef = useRef(null);

  // Load decks
  useEffect(() => {
    const loadDecks = async () => {
      try {
        setLoading(true);
        const deckList = await safeOperation(() => room.collection('deck').getList());
        // Filter out archived decks unless showArchivedDecks is true
        const filteredDecks = showArchivedDecks 
          ? deckList 
          : deckList.filter(deck => !deck.archived);
        
        setDecks(filteredDecks);
        if (filteredDecks.length > 0 && !selectedDeck) {
          setSelectedDeck(filteredDecks[0].id);
        }
      } catch (error) {
        setError('Failed to load decks');
        console.error('Error loading decks:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDecks();
  }, [showArchivedDecks]);

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

  // Function to toggle deck archive status
  const toggleDeckArchive = async (deckId, isCurrentlyArchived) => {
    try {
      setLoading(true);
      await safeOperation(() => 
        room.collection('deck').update(deckId, {
          archived: !isCurrentlyArchived
        })
      );
      
      // Update local state to reflect changes
      setDecks(prevDecks => 
        prevDecks.map(deck => 
          deck.id === deckId ? {...deck, archived: !isCurrentlyArchived} : deck
        )
      );
      
      setSuccess(`Deck ${isCurrentlyArchived ? 'restored' : 'archived'}`);
      setTimeout(() => setSuccess(''), 2000);
    } catch (error) {
      setError('Failed to update deck');
      console.error('Error updating deck:', error);
    } finally {
      setLoading(false);
    }
  };

  // Function to delete a deck
  const deleteDeck = async (deckId) => {
    if (!confirm('Are you sure you want to permanently delete this deck?')) {
      return;
    }
    
    try {
      setLoading(true);
      await safeOperation(() => room.collection('deck').delete(deckId));
      
      // Update local state
      setDecks(prevDecks => prevDecks.filter(deck => deck.id !== deckId));
      
      // If the selected deck was deleted, select another one
      if (selectedDeck === deckId) {
        const remainingDecks = decks.filter(deck => deck.id !== deckId);
        if (remainingDecks.length > 0) {
          setSelectedDeck(remainingDecks[0].id);
        } else {
          setSelectedDeck('');
        }
      }
      
      setSuccess('Deck deleted');
      setTimeout(() => setSuccess(''), 2000);
    } catch (error) {
      setError('Failed to delete deck');
      console.error('Error deleting deck:', error);
    } finally {
      setLoading(false);
    }
  };

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
          card_count: cards.length,
          archived: false
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
                    card_count: deck.cards.filter(card => card && card.trim()).length,
                    archived: false
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
          const filteredDecks = showArchivedDecks 
            ? updatedDecks 
            : updatedDecks.filter(deck => !deck.archived);
          setDecks(filteredDecks);
          
          if (filteredDecks.length > 0 && !selectedDeck) {
            setSelectedDeck(filteredDecks[0].id);
          }
        }
        // Handle single deck
        else if (deckData.name && Array.isArray(deckData.cards)) {
          try {
            const deck = await safeOperation(() =>
              room.collection('deck').create({
                name: deckData.name,
                cards: deckData.cards.filter(card => card && card.trim()),
                card_count: deckData.cards.filter(card => card && card.trim()).length,
                archived: false
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
              card_count: cards.length,
              archived: false
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
          ended: false,
          auto_distribute: autoDistribute
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

  // Distribute cards to a single player
  const distributeCardToPlayer = async (player) => {
    if (!sessionId || !selectedDeck) {
      console.log(`[${APP_VERSION}] Cannot distribute: missing session or deck`);
      return false;
    }

    try {
      console.log(`[${APP_VERSION}] Distributing new card to player: ${player.name}`);
      
      // First, clear current card to indicate loading state to the player
      await safeOperation(() =>
        room.collection('player').update(player.id, {
          current_card: '', // This will trigger loading state on player's side
        })
      );
      
      // Reduced wait time to 100ms to speed up card distribution
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Get selected deck info
      let selectedDeckData = decks.find(d => d.id === selectedDeck);
      
      if (!selectedDeckData || !selectedDeckData.cards || selectedDeckData.cards.length === 0) {
        console.error(`[${APP_VERSION}] Selected deck has no cards`);
        return false;
      }

      // Generate random duration between min and max timer settings
      const randomDuration = Math.floor(
        Math.random() * (maxTimerSeconds - minTimerSeconds + 1) + minTimerSeconds
      );

      let selectedCard;
      let selectedDeckName = selectedDeckData.name;
      let selectedDeckId = selectedDeckData.id;

      // Choose a card based on distribution mode
      if (distributionMode === 'unison') {
        // Everyone gets the same card - find what the currently active card is
        // If there's already a unison card being shown, use that
        const activeUnison = players.find(p => 
          p.current_card && p.current_card !== 'END' && 
          new Date(p.card_start_time).getTime() + (p.card_duration * 1000) > Date.now()
        );
        
        if (activeUnison) {
          selectedCard = activeUnison.current_card;
          selectedDeckName = activeUnison.current_deck_name;
          selectedDeckId = activeUnison.current_deck_id;
          console.log(`[${APP_VERSION}] Unison mode: using existing active card "${selectedCard}"`);
        } else {
          // Select a new card for everyone
          const cards = selectedDeckData.cards;
          const randomIndex = Math.floor(Math.random() * cards.length);
          selectedCard = cards[randomIndex];
          console.log(`[${APP_VERSION}] Unison mode: selected new card "${selectedCard}"`);
        }
      } 
      else if (distributionMode === 'unique') {
        // Each player gets a unique card
        const cards = selectedDeckData.cards;
        
        // Try to find a card that no other player currently has
        const activePlayerCards = players
          .filter(p => p.current_card && p.current_card !== 'END')
          .map(p => p.current_card);
        
        const availableCards = cards.filter(card => !activePlayerCards.includes(card));
        
        if (availableCards.length > 0) {
          // We have cards that no one else is using
          const randomIndex = Math.floor(Math.random() * availableCards.length);
          selectedCard = availableCards[randomIndex];
        } else {
          // All cards are in use, just pick a random one
          const randomIndex = Math.floor(Math.random() * cards.length);
          selectedCard = cards[randomIndex];
        }
        
        console.log(`[${APP_VERSION}] Unique mode: selected card "${selectedCard}" for ${player.name}`);
      } 
      else if (distributionMode === 'random') {
        // Each player gets a random card from any available deck
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
          console.error(`[${APP_VERSION}] No cards available in any deck`);
          return false;
        }
        
        const randomIndex = Math.floor(Math.random() * allCards.length);
        const selectedCardObj = allCards[randomIndex];
        
        selectedCard = selectedCardObj.text;
        selectedDeckName = selectedCardObj.deck_name;
        selectedDeckId = selectedCardObj.deck_id;
        
        console.log(`[${APP_VERSION}] Random mode: selected card "${selectedCard}" from deck "${selectedDeckName}" for ${player.name}`);
      }

      // Update the player with their new card and a fresh timestamp
      await safeOperation(() =>
        room.collection('player').update(player.id, {
          current_card: selectedCard,
          current_deck_name: selectedDeckName,
          current_deck_id: selectedDeckId,
          card_start_time: new Date().toISOString(), // Fresh timestamp for accurate timing
          card_duration: randomDuration
        })
      );
      
      console.log(`[${APP_VERSION}] Card distributed to ${player.name}, duration=${randomDuration}s`);
      return true;
    } catch (error) {
      console.error(`[${APP_VERSION}] Error distributing card to ${player.name}:`, error);
      return false;
    }
  };

  // Auto-distribute cards to players with expired timers
  useEffect(() => {
    // Clean up previous interval
    if (autoDistributeIntervalRef.current) {
      clearInterval(autoDistributeIntervalRef.current);
      autoDistributeIntervalRef.current = null;
    }
    
    // Set up new interval if in session and auto-distribute is enabled
    if (step === 'session' && autoDistribute && players.length > 0) {
      console.log(`[${APP_VERSION}] Starting auto-distribution interval`);
      
      autoDistributeIntervalRef.current = setInterval(async () => {
        // Check for players with expired cards
        const now = Date.now();
        const playersNeedingCards = players.filter(player => {
          // Skip players without cards or with END signal
          if (!player.current_card || player.current_card === 'END') {
            return true; // New players or players who just joined need cards
          }
          
          // Check if card timer has expired
          if (!player.card_start_time || !player.card_duration) {
            return true; // Something's wrong with the timer
          }
          
          const cardStartTime = new Date(player.card_start_time).getTime();
          const cardEndTime = cardStartTime + (player.card_duration * 1000);
          
          return now > cardEndTime; // Card has expired
        });
        
        // Distribute new cards to players who need them
        if (playersNeedingCards.length > 0) {
          console.log(`[${APP_VERSION}] Auto-distributing cards to ${playersNeedingCards.length} players`);
          
          for (const player of playersNeedingCards) {
            await distributeCardToPlayer(player);
          }
          
          // Force refresh player list to show updated cards
          setTimeout(refreshPlayerList, 1000);
        }
      }, 5000); // Check every 5 seconds
    }
    
    return () => {
      if (autoDistributeIntervalRef.current) {
        clearInterval(autoDistributeIntervalRef.current);
        autoDistributeIntervalRef.current = null;
      }
    };
  }, [step, autoDistribute, players, selectedDeck, distributionMode, minTimerSeconds, maxTimerSeconds]);

  // Distribute cards (manual trigger)
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

      console.log(`[${APP_VERSION}] Manual distribution started: mode=${distributionMode}, players=${players.length}`);

      // Distribute cards to all players
      let successCount = 0;
      
      for (const player of players) {
        const success = await distributeCardToPlayer(player);
        if (success) successCount++;
      }

      // Update session with latest distribution settings
      await safeOperation(() =>
        room.collection('session').update(sessionId, {
          last_distribution: new Date().toISOString(),
          distribution_mode: distributionMode,
          min_timer_seconds: minTimerSeconds,
          max_timer_seconds: maxTimerSeconds,
          active_deck_id: selectedDeck,
          auto_distribute: autoDistribute
        })
      );

      console.log(`[${APP_VERSION}] Card distribution complete`);

      // Force refresh player list to show updated cards
      setTimeout(refreshPlayerList, 1000);

      setSuccess(`Cards distributed to ${successCount} players`);
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
              
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
                <button 
                  className="btn btn-outline" 
                  style={{ padding: '5px 10px', fontSize: '14px' }}
                  onClick={() => setShowArchivedDecks(!showArchivedDecks)}
                >
                  {showArchivedDecks ? 'Hide Archived' : 'Show Archived'}
                </button>
              </div>
              
              {decks.length > 0 && (
                <div style={{ marginTop: '10px', maxHeight: '150px', overflowY: 'auto' }}>
                  {decks.map(deck => (
                    <div key={deck.id} style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between',
                      alignItems: 'center', 
                      padding: '8px',
                      margin: '5px 0',
                      backgroundColor: deck.archived ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.5)',
                      borderRadius: '4px',
                      border: deck.id === selectedDeck ? '1px solid var(--primary)' : '1px solid var(--border)'
                    }}>
                      <div>
                        <div style={{ fontWeight: deck.id === selectedDeck ? 'bold' : 'normal' }}>
                          {deck.name} {deck.archived && <span style={{ opacity: 0.6 }}>(archived)</span>}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-light)' }}>
                          {deck.card_count || deck.cards.length} cards
                        </div>
                      </div>
                      <div>
                        <button 
                          onClick={() => toggleDeckArchive(deck.id, deck.archived)}
                          style={{ 
                            background: 'none', 
                            border: 'none', 
                            cursor: 'pointer',
                            color: 'var(--text-light)',
                            fontSize: '12px',
                            padding: '4px 8px',
                            marginRight: '5px'
                          }}
                        >
                          {deck.archived ? 'Restore' : 'Archive'}
                        </button>
                        <button 
                          onClick={() => deleteDeck(deck.id)}
                          style={{ 
                            background: 'none', 
                            border: 'none', 
                            cursor: 'pointer',
                            color: 'var(--error)',
                            fontSize: '12px',
                            padding: '4px 8px'
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
              <option value="random">Random - Each player gets a random card from any deck</option>
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
          
          <div style={{ margin: '15px 0' }}>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={autoDistribute}
                onChange={() => setAutoDistribute(!autoDistribute)}
                style={{ marginRight: '10px' }}
              />
              Automatically distribute new cards when timers expire
            </label>
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
              <option value="random">Random - Each player gets a random card from any deck</option>
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
          <div className="distribution-section">
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={autoDistribute}
                onChange={() => {
                  setAutoDistribute(!autoDistribute);
                  // Also update the session settings
                  if (sessionId) {
                    safeOperation(() =>
                      room.collection('session').update(sessionId, {
                        auto_distribute: !autoDistribute
                      })
                    );
                  }
                }}
                style={{ marginRight: '10px' }}
              />
              Automatically distribute new cards when timers expire
            </label>
          </div>
        </div>

        <div className="next-card-notice">
          <span className="emoji">👇</span> Click the button below to immediately distribute cards to all players <span className="emoji">👇</span>
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
  const timerStartTime = useRef(new Date(startTime).getTime());
  const timerDuration = useRef(duration);
  const timerIntervalRef = useRef(null);

  useEffect(() => {
    console.log(`[${APP_VERSION}] PlayerTimer mounted/updated: duration=${duration}s, startTime=${startTime}`);
    
    // Always reset these values when the component is created or updated
    timerStartTime.current = new Date(startTime).getTime();
    timerDuration.current = duration;
    setTimeLeft(duration); // Immediately set to full duration
    setIsExpired(false);
    
    // Clear any existing interval
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
    }
    
    const end = timerStartTime.current + (duration * 1000);

    const updateTimer = () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((end - now) / 1000));
      
      setTimeLeft(remaining);
      
      if (remaining === 0 && !isExpired) {
        setIsExpired(true);
        console.log(`[${APP_VERSION}] Timer expired`);
        
        // Clear interval when expired
        if (timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
        }
      }
    };

    // Immediately call once to initialize correctly
    updateTimer();
    
    // Set up interval and store reference
    timerIntervalRef.current = setInterval(updateTimer, 1000);

    return () => {
      console.log(`[${APP_VERSION}] PlayerTimer unmounting - cleaning up timer`);
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [startTime, duration]); // This will reset when either changes

  // Calculate percentage of time remaining - always between 0 and 100
  // This uses the current timeLeft state and the original duration 
  // to ensure the bar always starts from 100%
  const percentage = Math.min(100, Math.max(0, (timeLeft / timerDuration.current) * 100));

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

  // Track when a card is received
  const [cardReceived, setCardReceived] = useState(false); 
  const [clientStartTime, setClientStartTime] = useState(null); 
  const [clientDuration, setClientDuration] = useState(null);
  
  // Track if timer is expired
  const [isTimerExpired, setIsTimerExpired] = useState(false);
  const cardExpiryTimerRef = useRef(null);
  
  // Keep track of last checked player data
  const lastPlayerDataRef = useRef(null);
  
  // Function to check if card timer is expired
  const checkCardExpiry = useCallback(() => {
    if (!player || !player.card_start_time || !player.card_duration) return false;
    
    const startTime = new Date(player.card_start_time).getTime();
    const duration = player.card_duration * 1000;
    const now = Date.now();
    
    return (now - startTime) >= duration;
  }, [player]);
  
  // Force refresh player data from server
  const forceRefreshPlayerData = useCallback(async () => {
    if (!playerId) return;
    
    try {
      console.log(`[${APP_VERSION}] Force refreshing player data`);
      const playerData = await safeOperation(() => 
        room.collection('player').filter({ id: playerId }).getList()
      );
      
      if (playerData && playerData.length > 0) {
        console.log(`[${APP_VERSION}] Forced refresh player data:`, playerData[0]);
        processPlayerUpdate(playerData[0]);
      }
    } catch (err) {
      console.error(`[${APP_VERSION}] Error in force refresh:`, err);
    }
  }, [playerId]);
  
  // Set up auto refresh interval for player data
  useEffect(() => {
    const interval = setInterval(() => {
      forceRefreshPlayerData();
    }, 5000); // Poll every 5 seconds as a backup
    
    return () => clearInterval(interval);
  }, [forceRefreshPlayerData]);
  
  // Process player data update (moved to a separate function for consistency)
  const processPlayerUpdate = useCallback((updatedPlayer) => {
    if (!updatedPlayer) return;
    
    setPlayer(updatedPlayer);
    setConnectionStatus('Connected');
    setLoading(false);
    
    // Check for session end
    if (updatedPlayer.current_card === 'END') {
      setSessionEnded(true);
      return;
    }
    
    // Check if this is a new card (different from the last one we saw)
    const isNewCard = lastCardRef.current !== updatedPlayer.current_card;
    const cardExists = !!updatedPlayer.current_card;
    
    if (cardExists && isNewCard) {
      console.log(`[${APP_VERSION}] New card received: "${updatedPlayer.current_card}"`);
      setCardReceived(true);
      setCardAnimating(true);
      setIsTimerExpired(false);
      
      // Set client-side timer information with fresh timestamp
      setClientStartTime(new Date().toISOString());
      setClientDuration(updatedPlayer.card_duration);
      
      setTimeout(() => setCardAnimating(false), 500);
      lastCardRef.current = updatedPlayer.current_card;
    } else if (!cardExists) {
      // No card, waiting for one
      setCardReceived(false);
    }
    
    // Update last player data reference
    lastPlayerDataRef.current = updatedPlayer;
  }, []);
  
  // Player subscription 
  useEffect(() => {
    if (!playerId) {
      console.error(`[${APP_VERSION}] No player ID provided`);
      setError('No player identification found. Please rejoin the session.');
      setLoading(false);
      return;
    }
    
    console.log(`[${APP_VERSION}] Setting up player subscription for ID: ${playerId}`);
    setConnectionStatus('Connecting to server...');
    
    // Attempt to fetch player data immediately
    const fetchInitialPlayerData = async () => {
      try {
        const playerData = await safeOperation(() => 
          room.collection('player').filter({ id: playerId }).getList()
        );
        
        if (playerData && playerData.length > 0) {
          console.log(`[${APP_VERSION}] Initial player data loaded:`, playerData[0]);
          processPlayerUpdate(playerData[0]);
        } else {
          console.error(`[${APP_VERSION}] Player not found with ID: ${playerId}`);
          setError('Player not found. You may need to rejoin the session.');
          setLoading(false);
        }
      } catch (err) {
        console.error(`[${APP_VERSION}] Error fetching initial player data:`, err);
        setConnectionStatus('Connection error. Retrying...');
        setTimeout(fetchInitialPlayerData, 2000); // Retry after 2 seconds
      }
    };
    
    fetchInitialPlayerData();
    
    // Set up subscription for real-time updates
    try {
      if (playerSubscriptionRef.current) {
        playerSubscriptionRef.current(); // Clear previous subscription
      }
      
      const unsubscribe = room.collection('player')
        .filter({ id: playerId })
        .subscribe((players) => {
          if (players && players.length > 0) {
            const updatedPlayer = players[0];
            console.log(`[${APP_VERSION}] Player data updated via subscription:`, updatedPlayer);
            processPlayerUpdate(updatedPlayer);
          } else {
            console.log(`[${APP_VERSION}] No player data in subscription update`);
          }
        });
      
      playerSubscriptionRef.current = unsubscribe;
      console.log(`[${APP_VERSION}] Player subscription set up successfully`);
    } catch (err) {
      console.error(`[${APP_VERSION}] Error setting up player subscription:`, err);
      setConnectionStatus('Subscription error');
      setError('Error connecting to session. Please refresh the page.');
      setLoading(false);
    }
    
    return () => {
      if (playerSubscriptionRef.current) {
        playerSubscriptionRef.current();
        playerSubscriptionRef.current = null;
      }
    };
  }, [playerId, processPlayerUpdate]);
  
  // Update timer expiry status
  useEffect(() => {
    if (!player || !player.current_card || player.current_card === 'END') {
      return;
    }
    
    // Clear any existing timer
    if (cardExpiryTimerRef.current) {
      clearTimeout(cardExpiryTimerRef.current);
      cardExpiryTimerRef.current = null;
    }
    
    // Use client-side timer info if available (more accurate)
    const startTime = clientStartTime 
      ? new Date(clientStartTime).getTime() 
      : new Date(player.card_start_time).getTime();
      
    const duration = clientDuration 
      ? clientDuration * 1000 
      : player.card_duration * 1000;
      
    // Check if the card is already expired
    const now = Date.now();
    const isExpired = (now - startTime) >= duration;
    
    if (isExpired) {
      console.log(`[${APP_VERSION}] Card already expired`);
      setIsTimerExpired(true);
      return;
    }
    
    // Reset expired state when we have a valid non-expired card
    setIsTimerExpired(false);
    
    // Set timeout for when card will expire
    const timeLeft = Math.max(0, startTime + duration - now);
    
    console.log(`[${APP_VERSION}] Setting timer expiry for ${timeLeft}ms from now`);
    
    cardExpiryTimerRef.current = setTimeout(() => {
      console.log(`[${APP_VERSION}] Card timer expired via timeout`);
      setIsTimerExpired(true);
      // Force refresh when timer expires to ensure we get the next card
      forceRefreshPlayerData();
    }, timeLeft);
    
    return () => {
      if (cardExpiryTimerRef.current) {
        clearTimeout(cardExpiryTimerRef.current);
        cardExpiryTimerRef.current = null;
      }
    };
  }, [player, clientStartTime, clientDuration, forceRefreshPlayerData]);

  if (loading) {
    return (
      <div className="full-card">
        <h3>Connecting...</h3>
        <div className="waiting-animation">
          <div className="dot"></div>
          <div className="dot"></div>
          <div className="dot"></div>
        </div>
        <p style={{ margin: '15px 0' }}>
          {connectionStatus}
        </p>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="full-card">
        <h3>Error</h3>
        <p style={{ margin: '15px 0', color: 'var(--error)' }}>
          {error}
        </p>
        <button className="btn" onClick={() => window.location.reload()}>
          Reload Page
        </button>
      </div>
    );
  }
  
  if (!player) {
    return (
      <div className="full-card">
        <h3>Connecting to session...</h3>
        <div className="waiting-animation">
          <div className="dot"></div>
          <div className="dot"></div>
          <div className="dot"></div>
        </div>
      </div>
    );
  }
  
  if (sessionEnded || player.current_card === 'END') {
    return (
      <div className="full-card session-ended">
        <h2 className="card-text">Session Ended</h2>
        <p style={{ margin: '15px 0' }}>
          Thank you for participating!
        </p>
        <button className="btn" onClick={() => onNavigate('home')}>
          Return to Home
        </button>
      </div>
    );
  }

  const renderWaitingState = () => (
    <div className="full-card">
      <h3>Waiting for next card...</h3>
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
      <button 
        onClick={forceRefreshPlayerData} 
        style={{ 
          marginTop: '15px',
          fontSize: '14px',
          backgroundColor: 'transparent',
          border: '1px solid var(--border)',
          padding: '5px 10px',
          borderRadius: '4px',
          cursor: 'pointer'
        }}
      >
        Check for new card
      </button>
    </div>
  );

  // Important: We check both conditions - if we have a card AND the timer isn't expired
  if (!player.current_card || isTimerExpired) {
    return renderWaitingState();
  }

  return (
    <div className="full-card">
      <div className={`card-content ${cardAnimating ? 'card-new' : ''}`}>
        <h2 className="card-text">{player.current_card}</h2>

        {clientStartTime && clientDuration ? (
          <PlayerTimer
            key={`${clientStartTime}-${clientDuration}`} // Key forces recreation of timer on new card
            startTime={clientStartTime}
            duration={clientDuration}
          />
        ) : player.card_start_time && player.card_duration ? (
          <PlayerTimer
            key={`${player.card_start_time}-${player.card_duration}`} // Key forces recreation of timer on new card
            startTime={player.card_start_time}
            duration={player.card_duration}
          />
        ) : null}
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
      
      <button 
        onClick={() => forceRefreshPlayerData()} 
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
    const loadingElement = document.getElementById('loading');
    if (loadingElement) {
      loadingElement.style.display = 'none';
    }

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