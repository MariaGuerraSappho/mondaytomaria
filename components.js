// Home View Component
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

// Join View Component
function JoinView({ onNavigate, initialPin = '' }) {
  const [pin, setPin] = useState(initialPin);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [validating, setValidating] = useState(false);
  const [session, setSession] = useState(null);

  // Auto-validate pin when provided in URL
  useEffect(() => {
    // If we have an initialPin from the URL, validate it automatically
    if (initialPin && !session && !validating && !loading) {
      validateSession();
    }
  }, [initialPin]);

  // Validate session PIN
  const validateSession = async () => {
    if (!pin.trim()) {
      setError('Please enter a PIN');
      return false;
    }

    setLoading(true);
    setValidating(true);
    setError('');

    try {
      console.log(`[${APP_VERSION}] Validating session PIN: ${pin}`);
      
      const sessions = await safeOperation(() => 
        room.collection('session')
          .filter({ pin: pin.trim() })
          .getList()
      );
      
      if (sessions.length === 0) {
        setError('No active session found with this PIN');
        setLoading(false);
        setValidating(false);
        return false;
      }
      
      const activeSession = sessions[0];
      
      if (activeSession.ended) {
        setError('This session has ended');
        setLoading(false);
        setValidating(false);
        return false;
      }
      
      setSession(activeSession);
      setValidating(false);
      setLoading(false);
      console.log(`[${APP_VERSION}] Session validated:`, activeSession);
      return true;
    } catch (error) {
      console.error(`[${APP_VERSION}] Session validation error:`, error);
      setError('Error validating session. Please try again.');
      setLoading(false);
      setValidating(false);
      return false;
    }
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!name.trim()) {
      setError('Please enter your name');
      return;
    }
    
    if (loading) return;
    
    // Validate the session first if we haven't already
    if (!session && !validating) {
      const valid = await validateSession();
      if (!valid) return;
    }
    
    try {
      console.log(`[${APP_VERSION}] Joining session as: ${name}`);
      setLoading(true);
      setError('');
      
      // Check if player has an existing ID in this session
      const existingPlayers = await safeOperation(() => 
        room.collection('player')
          .filter({ session_pin: pin.trim(), name: name.trim() })
          .getList()
      );
      
      let playerId = '';
      
      if (existingPlayers.length > 0) {
        // Reuse existing player record
        playerId = existingPlayers[0].id;
        await safeOperation(() => 
          room.collection('player').update(playerId, {
            active: true,
            last_seen: new Date().toISOString(),
            rejoined: true,
            ready_for_card: true,
            current_card: null, // Reset card when rejoining
            card_start_time: null
          })
        );
        console.log(`[${APP_VERSION}] Rejoining as existing player: ${playerId}`);
      } else {
        // Create new player
        const player = await safeOperation(() => 
          room.collection('player').create({
            name: name.trim(),
            session_pin: pin.trim(),
            active: true,
            last_seen: new Date().toISOString(),
            current_card: null,
            card_start_time: null,
            ready_for_card: true
          })
        );
        playerId = player.id;
        console.log(`[${APP_VERSION}] Created new player: ${playerId}`);
      }
      
      // Save player ID to local storage
      localStorage.setItem('playerId', playerId);
      
      // Navigate to player view
      onNavigate('player', { pin: pin.trim(), name: name.trim(), playerId });
    } catch (error) {
      console.error(`[${APP_VERSION}] Error joining session:`, error);
      setError('Error joining session. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <div className="full-card">
        <h2 className="header">Join Session</h2>
        
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            className="input"
            placeholder="Session PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            disabled={loading || validating || session}
          />
          
          {(session || validating) && (
            <input
              type="text"
              className="input"
              placeholder="Your Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={loading}
            />
          )}
          
          {error && <div className="error">{error}</div>}
          
          {!session && !validating && (
            <button 
              type="button" 
              className="btn btn-block" 
              onClick={validateSession}
              disabled={loading || !pin.trim()}
            >
              {loading ? 'Checking...' : 'Next'}
            </button>
          )}
          
          {(session || validating) && (
            <button 
              type="submit" 
              className="btn btn-block" 
              disabled={loading || validating || !name.trim()}
            >
              {loading ? 'Joining...' : 'Join Session'}
            </button>
          )}
        </form>
        
        <button
          className="btn btn-outline btn-block"
          onClick={() => onNavigate('home')}
          style={{ marginTop: '15px' }}
          disabled={loading}
        >
          Back
        </button>
      </div>
    </div>
  );
}

// Player View Component
function PlayerView({ pin, name, playerId, onNavigate }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [session, setSession] = useState(null);
  const [card, setCard] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [timerStarted, setTimerStarted] = useState(false);
  const [waitingForCard, setWaitingForCard] = useState(true);
  const timerRef = useRef(null);
  const playerRef = useRef(null);
  const playerSubscriptionRef = useRef(null);
  const cardEndTimeRef = useRef(null); // Store the absolute end time for accuracy
  const lastCardRef = useRef(null); // Track the last card to avoid duplicates
  const processingCardRef = useRef(false); // Flag to prevent processing a card while already processing one

  // Update player status
  const updatePlayerStatus = async (statusUpdate) => {
    if (!playerId) return;
    
    try {
      await safeOperation(() => 
        room.collection('player').update(playerId, {
          ...statusUpdate,
          last_seen: new Date().toISOString()
        })
      );
      return true;
    } catch (error) {
      console.error(`[${APP_VERSION}] Error updating player status:`, error);
      return false;
    }
  };

  // FIXED: Complete rewrite of card display logic to ensure timers work correctly
  const handleCardDisplay = (playerData) => {
    // Prevent processing a card if we're already processing one
    if (processingCardRef.current) {
      console.log(`[${APP_VERSION}] Already processing a card update, skipping this update`);
      return;
    }
    
    processingCardRef.current = true;
    console.log(`[${APP_VERSION}] Processing card update for player:`, playerData);
    
    // Check if player has a card
    if (!playerData.current_card) {
      console.log(`[${APP_VERSION}] No card present, waiting for card`);
      setWaitingForCard(true);
      setCard(null);
      cardEndTimeRef.current = null;
      
      // Clear any existing timer
      if (timerRef.current) {
        console.log(`[${APP_VERSION}] Clearing existing timer as no card is present`);
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      
      processingCardRef.current = false;
      return;
    }
    
    // Handle session end signal
    if (playerData.current_card === 'END') {
      console.log(`[${APP_VERSION}] Session ended notification received`);
      setCard({ text: 'Session Ended', isEnd: true });
      setWaitingForCard(false);
      cardEndTimeRef.current = null;
      
      // Clear any existing timer
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      
      processingCardRef.current = false;
      return;
    }
    
    // Check if this is the same card we're already displaying (to avoid timer resets)
    const isSameCard = lastCardRef.current && 
                      lastCardRef.current.text === playerData.current_card && 
                      lastCardRef.current.startTime === playerData.card_start_time;
                      
    if (isSameCard) {
      console.log(`[${APP_VERSION}] Received duplicate card update, ignoring`);
      processingCardRef.current = false;
      return;
    }
    
    // Clear any existing timer to avoid multiple timers
    if (timerRef.current) {
      console.log(`[${APP_VERSION}] Clearing existing timer for new card`);
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    
    // Create the card object
    const cardText = playerData.current_card;
    const deckName = playerData.current_deck_name || 'Unknown';
    const startTime = new Date(playerData.card_start_time || new Date());
    const duration = playerData.card_duration || 30;
    
    console.log(`[${APP_VERSION}] Displaying card: "${cardText}" from deck "${deckName}" with duration ${duration}s, start time: ${startTime.toISOString()}`);
    
    // Create the new card object
    const newCard = {
      text: cardText,
      deckName: deckName,
      startTime: playerData.card_start_time,
      duration: duration,
    };
    
    // Store as last card to avoid duplicates
    lastCardRef.current = newCard;
    
    // Update the UI to show the card
    setCard(newCard);
    
    // Calculate exact end time and store it for consistency
    const cardStartTime = startTime.getTime();
    const cardEndTime = cardStartTime + (duration * 1000);
    cardEndTimeRef.current = cardEndTime;
    
    // Calculate initial time remaining more precisely
    const now = Date.now();
    const remaining = Math.max(0, cardEndTime - now);
    const secondsRemaining = Math.ceil(remaining / 1000);
    
    console.log(`[${APP_VERSION}] Card timer: ${secondsRemaining}s remaining out of ${duration}s (ends at ${new Date(cardEndTime).toISOString()})`);
    
    setTimeLeft(secondsRemaining);
    setWaitingForCard(false);
    
    // Send acknowledgment that card was received and displayed
    updatePlayerStatus({ 
      card_received: true,
      card_acknowledged_at: new Date().toISOString()
    });
    
    // Only start a timer if there's time remaining
    if (remaining > 0) {
      setTimerStarted(true);
      
      // FIXED: Use a fixed interval timer that verifies against absolute end time
      // Using a faster interval for more accurate countdown but with strict checks
      timerRef.current = setInterval(() => {
        const currentTime = Date.now();
        const timeRemaining = Math.max(0, cardEndTimeRef.current - currentTime);
        const secondsLeft = Math.ceil(timeRemaining / 1000);
        
        // Update the displayed time
        setTimeLeft(secondsLeft);
        
        // Only end the timer when we're truly at zero with a small buffer for interval timing
        if (timeRemaining <= 50) { // Small buffer for interval timing
          console.log(`[${APP_VERSION}] Timer completed at ${new Date().toISOString()} (end time was ${new Date(cardEndTimeRef.current).toISOString()})`);
          
          // Clear the interval first to prevent multiple triggers
          clearInterval(timerRef.current);
          timerRef.current = null;
          
          // Update state
          setTimerStarted(false);
          setTimeLeft(0);
          setWaitingForCard(true);
          
          // CRITICAL: Add a small delay before marking as ready for next card
          // This ensures the UI has updated and prevents race conditions
          setTimeout(() => {
            console.log(`[${APP_VERSION}] Marking player as ready for next card after delay`);
            updatePlayerStatus({ 
              ready_for_card: true,
              card_ended_at: new Date().toISOString()
            });
          }, 1000);
        }
      }, 100); // Update very frequently for smoother countdown and accuracy
    } else {
      // Card already expired
      console.log(`[${APP_VERSION}] Card already expired`);
      setTimerStarted(false);
      setWaitingForCard(true);
      
      // CRITICAL: Add a small delay before marking as ready for next card
      setTimeout(() => {
        updatePlayerStatus({ 
          ready_for_card: true,
          card_ended_at: new Date().toISOString()
        });
      }, 1000);
    }
    
    processingCardRef.current = false;
  };

  useEffect(() => {
    const initPlayerView = async () => {
      if (!pin || !playerId) {
        setError('Invalid session data');
        setLoading(false);
        return;
      }
      
      try {
        console.log(`[${APP_VERSION}] Initializing player view for player ${name} (${playerId}) in session ${pin}`);
        
        // Get session data
        const sessions = await room.collection('session')
          .filter({ pin })
          .getList();
        
        if (sessions.length === 0) {
          setError('Session not found');
          setLoading(false);
          return;
        }
        
        const sessionData = sessions[0];
        
        if (sessionData.ended) {
          setError('This session has ended');
          setLoading(false);
          return;
        }
        
        setSession(sessionData);
        
        // Get player data directly first thing
        try {
          // Important: Make sure we get the player data directly first
          const players = await room.collection('player')
            .filter({ id: playerId })
            .getList();
          
          if (players.length === 0) {
            setError('Player not found. Please rejoin the session.');
            setLoading(false);
            return;
          }
          
          const playerData = players[0];
          playerRef.current = playerData;
          
          console.log(`[${APP_VERSION}] Retrieved player data:`, {
            id: playerData.id,
            name: playerData.name,
            current_card: playerData.current_card,
            card_start_time: playerData.card_start_time,
            card_duration: playerData.card_duration
          });
          
          // Process any existing card immediately
          if (playerData.current_card) {
            console.log(`[${APP_VERSION}] Found existing card to display: ${playerData.current_card}`);
            handleCardDisplay(playerData);
          } else {
            console.log(`[${APP_VERSION}] No initial card found, waiting for card`);
            setWaitingForCard(true);
            
            // Mark as ready for card if no current card
            await updatePlayerStatus({
              active: true,
              ready_for_card: true
            });
          }
        } catch (playerError) {
          console.error(`[${APP_VERSION}] Error getting player data:`, playerError);
          setError('Error connecting to session. Please try refreshing the page.');
          setLoading(false);
          return;
        }
        
        // Set up player subscription
        console.log(`[${APP_VERSION}] Setting up player subscription for id: ${playerId}`);
        
        if (playerSubscriptionRef.current) {
          playerSubscriptionRef.current();
        }
        
        const unsubscribe = room.collection('player')
          .filter({ id: playerId })
          .subscribe(updatedPlayers => {
            if (!updatedPlayers || updatedPlayers.length === 0) return;
            
            const updatedPlayer = updatedPlayers[0];
            
            // Check if there's an actual change to avoid duplicate processing
            const isNewCard = !playerRef.current || 
                              playerRef.current.current_card !== updatedPlayer.current_card || 
                              playerRef.current.card_start_time !== updatedPlayer.card_start_time;
                              
            console.log(`[${APP_VERSION}] Player subscription update received:`, {
              id: updatedPlayer.id,
              current_card: updatedPlayer.current_card,
              card_start_time: updatedPlayer.card_start_time,
              isNewCard: isNewCard
            });
            
            // Store the latest player data
            playerRef.current = updatedPlayer;
            
            // Only process card updates when there's actually a new card
            if (isNewCard) {
              handleCardDisplay(updatedPlayer);
            }
          });
        
        playerSubscriptionRef.current = unsubscribe;
        
        // Heartbeat to keep player active
        const heartbeatInterval = setInterval(async () => {
          await updatePlayerStatus({ 
            ping: Date.now(),
            player_active: true
          });
        }, 10000);
        
        setLoading(false);
        
        return () => {
          clearInterval(heartbeatInterval);
        };
      } catch (error) {
        console.error(`[${APP_VERSION}] Error initializing player view:`, error);
        setError('Error connecting to session. Please try refreshing the page.');
        setLoading(false);
      }
    };
    
    initPlayerView();
    
    return () => {
      // Clean up timer and subscription
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      
      if (playerSubscriptionRef.current) {
        playerSubscriptionRef.current();
      }
      
      // Update player status on dismount
      if (playerId) {
        updatePlayerStatus({
          active: false,
          left_at: new Date().toISOString()
        });
      }
    };
  }, [pin, name, playerId]);

  return (
    <div className="container">
      <div className={`card ${card && card.isEnd ? 'session-ended' : ''}`}>
        <h2 className="header">
          {loading ? 'Connecting...' : name}
        </h2>
        
        {loading && (
          <div className="waiting-animation">
            <div className="dot"></div>
            <div className="dot"></div>
            <div className="dot"></div>
          </div>
        )}
        
        {error && (
          <div className="error">{error}</div>
        )}
        
        {!loading && !error && (
          <>
            {waitingForCard ? (
              <div className="card-content">
                <div className="next-card-notice">
                  <span className="emoji">⏳</span> Waiting for next card...
                  <br />
                  The conductor will distribute a card shortly.
                </div>
                
                <div className="waiting-animation">
                  <div className="dot"></div>
                  <div className="dot"></div>
                  <div className="dot"></div>
                </div>
              </div>
            ) : (
              <div className={`card-content ${card !== null ? 'card-new' : ''}`}>
                {card && (
                  <>
                    <div className="card-text">
                      {card.text}
                    </div>
                    
                    {!card.isEnd && (
                      <>
                        <div style={{ textAlign: 'center', margin: '10px 0', color: 'var(--text-light)' }}>
                          {card.deckName}
                        </div>
                        
                        <div className="timer-bar">
                          <div 
                            className={`timer-progress ${timeLeft === 0 ? 'timer-expired' : ''}`}
                            style={{ 
                              width: `${Math.max(0, Math.min(100, (timeLeft / card.duration) * 100))}%` 
                            }}
                          ></div>
                        </div>
                        
                        <div style={{ textAlign: 'center', fontSize: '18px', fontWeight: 'bold' }}>
                          {timeLeft} seconds
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
        
        <button
          className="btn btn-outline btn-block"
          onClick={() => {
            if (timerRef.current) {
              clearInterval(timerRef.current);
            }
            
            if (playerId) {
              updatePlayerStatus({
                active: false,
                left_at: new Date().toISOString()
              });
            }
            
            onNavigate('home');
          }}
          style={{ marginTop: '20px' }}
        >
          Leave Session
        </button>
      </div>
    </div>
  );
}

// Conductor View Component
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
  const pendingDistributionsRef = useRef(new Set()); // Track players with pending distribution

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
          setPlayers(updatedPlayers);
        });

      playersSubscriptionRef.current = unsubscribe;
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
          auto_distribute: autoDistribute,
          created_at: new Date().toISOString()
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

  // IMPROVED: Completely rewritten card distribution with strict timing enforcement
  const distributeCardToPlayer = async (player) => {
    if (!sessionId || !selectedDeck) {
      console.log(`[${APP_VERSION}] Cannot distribute: missing session or deck`);
      return false;
    }
    
    // Skip if already distributing to this player
    if (pendingDistributionsRef.current.has(player.id)) {
      console.log(`[${APP_VERSION}] Already distributing to player ${player.id}, skipping`);
      return false;
    }

    try {
      // Add to pending distributions
      pendingDistributionsRef.current.add(player.id);
      
      // Get selected deck info
      const selectedDeckData = decks.find(d => d.id === selectedDeck);
      
      if (!selectedDeckData || !selectedDeckData.cards || selectedDeckData.cards.length === 0) {
        console.error(`[${APP_VERSION}] Selected deck has no cards`);
        pendingDistributionsRef.current.delete(player.id);
        return false;
      }

      console.log(`[${APP_VERSION}] IMPROVED: Distributing card to player ${player.id} (${player.name})`);
      
      // Use the improved distributeCard function from utils.js
      const result = await distributeCard(
        player, 
        selectedDeckData, 
        distributionMode, 
        players,
        minTimerSeconds, 
        maxTimerSeconds
      );
      
      console.log(`[${APP_VERSION}] Distribution result:`, result);
      
      if (result.success) {
        // Immediately refresh the player's data to verify the update worked
        try {
          const updatedPlayer = await room.collection('player')
            .filter({ id: player.id })
            .getList();
            
          if (updatedPlayer.length > 0) {
            console.log(`[${APP_VERSION}] Verified player update:`, {
              id: updatedPlayer[0].id,
              current_card: updatedPlayer[0].current_card,
              card_start_time: updatedPlayer[0].card_start_time,
              card_duration: updatedPlayer[0].card_duration
            });
          }
        } catch (err) {
          console.error(`[${APP_VERSION}] Verification check failed:`, err);
        }
      } else if (result.reason === 'CARD_STILL_ACTIVE') {
        console.log(`[${APP_VERSION}] Skipped distribution - player ${player.name} has an active card with ${result.timeRemaining}s remaining`);
      }
      
      // Remove from pending distributions
      pendingDistributionsRef.current.delete(player.id);
      return result.success;
    } catch (error) {
      console.error(`[${APP_VERSION}] Error distributing card to ${player.name}:`, error);
      pendingDistributionsRef.current.delete(player.id);
      return false;
    }
  };

  // Subscribe to players when pin changes
  useEffect(() => {
    if (pin) {
      setupPlayerSubscription();
      refreshPlayerList(); // Initial fetch only
    }

    return () => {
      if (playersSubscriptionRef.current) {
        playersSubscriptionRef.current();
        playersSubscriptionRef.current = null;
      }
    };
  }, [pin, setupPlayerSubscription]);

  // FIXED: Completely rewritten auto-distribution to prevent premature card distribution
  useEffect(() => {
    // Clean up previous interval
    if (autoDistributeIntervalRef.current) {
      clearInterval(autoDistributeIntervalRef.current);
      autoDistributeIntervalRef.current = null;
    }
    
    // Set up new interval if in session and auto-distribute is enabled
    if (step === 'session' && autoDistribute && players.length > 0) {
      console.log(`[${APP_VERSION}] Setting up auto-distribution for ${players.length} players`);
      
      autoDistributeIntervalRef.current = setInterval(async () => {
        // Get precise current time
        const now = Date.now();
        
        // Find players who genuinely need cards with strict validation
        const playersNeedingCards = players.filter(player => {
          // Skip inactive players
          if (!player.active) return false;
          
          // CRITICAL: Only distribute to players explicitly marked as ready
          if (player.ready_for_card !== true) {
            return false;
          }
          
          // If no card, player needs one (as long as they're ready)
          if (!player.current_card) {
            return true;
          }
          
          // End signal is not a real card
          if (player.current_card === 'END') {
            return false;
          }
          
          // If there's no start time or duration, something's wrong
          if (!player.card_start_time || !player.card_duration) {
            return true;
          }
          
          // Calculate the precise end time and check if it's passed
          const cardStartTime = new Date(player.card_start_time).getTime();
          const cardEndTime = cardStartTime + (player.card_duration * 1000);
          
          // Add a significant buffer (3 seconds) to ensure the timer has fully completed
          // and any network delays in updating ready_for_card have resolved
          return now > (cardEndTime + 3000);
        });
        
        // Only proceed if we found players genuinely needing cards
        if (playersNeedingCards.length > 0) {
          console.log(`[${APP_VERSION}] Auto-distributing cards to ${playersNeedingCards.length} players:`, 
            playersNeedingCards.map(p => p.name));
          
          // Process one player at a time with delays to prevent race conditions
          for (const player of playersNeedingCards) {
            // Skip if already in the process of distributing to this player
            if (pendingDistributionsRef.current.has(player.id)) {
              console.log(`[${APP_VERSION}] Skipping player ${player.name} - distribution already in progress`);
              continue;
            }
            
            console.log(`[${APP_VERSION}] Auto-distributing card to player ${player.name} (${player.id})`);
            await distributeCardToPlayer(player);
            
            // Increased delay between distributions to prevent overloading and race conditions
            await new Promise(resolve => setTimeout(resolve, 1500));
          }
        }
      }, 3000); // Reduced check frequency to prevent rapid distribution
    }
    
    return () => {
      if (autoDistributeIntervalRef.current) {
        clearInterval(autoDistributeIntervalRef.current);
        autoDistributeIntervalRef.current = null;
      }
    };
  }, [step, autoDistribute, players, selectedDeck, distributionMode, minTimerSeconds, maxTimerSeconds, pin]);

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
      <div className="card" style={{ paddingBottom: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h2 className="header" style={{ margin: 0 }}>Active Session</h2>
          <div style={{ 
            backgroundColor: 'var(--primary)', 
            color: 'white', 
            borderRadius: '20px', 
            padding: '5px 15px',
            fontWeight: 'bold',
            fontSize: '20px'
          }}>
            PIN: {pin}
          </div>
        </div>

        {/* Share section - compact */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '10px', 
          backgroundColor: '#f9f9f9', 
          padding: '10px', 
          borderRadius: '8px', 
          marginBottom: '15px' 
        }}>
          <input
            type="text"
            className="input"
            readOnly
            value={`${window.baseUrl || window.location.origin}?pin=${pin}`}
            onClick={(e) => e.target.select()}
            style={{ margin: 0, flex: 1 }}
          />
          <button
            className="btn"
            style={{ margin: 0, whiteSpace: 'nowrap' }}
            onClick={() => {
              const url = `${window.baseUrl || window.location.origin}?pin=${pin}`;
              navigator.clipboard.writeText(url)
                .then(() => {
                  setSuccess("Link copied!");
                  setTimeout(() => setSuccess(''), 2000);
                })
                .catch(() => {
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

        {/* Controls - compact row */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          gap: '10px', 
          marginBottom: '15px',
          flexWrap: 'wrap'
        }}>
          <select
            style={{ 
              flex: '1', 
              padding: '8px 12px', 
              borderRadius: '8px', 
              border: '1px solid var(--border)' 
            }}
            value={distributionMode}
            onChange={(e) => setDistributionMode(e.target.value)}
          >
            <option value="unison">Unison Mode</option>
            <option value="unique">Unique Mode</option>
            <option value="random">Random Mode</option>
          </select>
          
          <select
            style={{ 
              flex: '1', 
              padding: '8px 12px', 
              borderRadius: '8px', 
              border: '1px solid var(--border)' 
            }}
            value={selectedDeck}
            onChange={(e) => setSelectedDeck(e.target.value)}
          >
            {decks.map(deck => (
              <option key={deck.id} value={deck.id}>{deck.name}</option>
            ))}
          </select>
          
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '5px', 
            backgroundColor: autoDistribute ? 'rgba(46, 204, 113, 0.1)' : 'rgba(255, 255, 255, 0.1)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '0 10px',
            cursor: 'pointer'
          }} onClick={() => setAutoDistribute(!autoDistribute)}>
            <input
              type="checkbox"
              checked={autoDistribute}
              onChange={() => {
                setAutoDistribute(!autoDistribute);
                if (sessionId) {
                  safeOperation(() =>
                    room.collection('session').update(sessionId, {
                      auto_distribute: !autoDistribute
                    })
                  );
                }
              }}
              style={{ margin: 0 }}
            />
            <span style={{ fontSize: '14px', whiteSpace: 'nowrap' }}>Auto</span>
          </div>
        </div>
        
        {/* Timer settings row */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '10px', 
          marginBottom: '15px',
          backgroundColor: '#f9f9f9',
          padding: '8px',
          borderRadius: '8px'
        }}>
          <div style={{ fontSize: '14px', whiteSpace: 'nowrap' }}>Timer:</div>
          <input
            type="range"
            min="5"
            max="60"
            value={minTimerSeconds}
            onChange={(e) => {
              const value = parseInt(e.target.value);
              setMinTimerSeconds(value);
              if (value > maxTimerSeconds) {
                setMaxTimerSeconds(value);
              }
            }}
            style={{ flex: 1, margin: 0 }}
          />
          <span style={{ fontSize: '14px' }}>{minTimerSeconds}s</span>
          <span style={{ fontSize: '14px' }}>-</span>
          <input
            type="range"
            min={minTimerSeconds}
            max="180"
            value={maxTimerSeconds}
            onChange={(e) => {
              setMaxTimerSeconds(parseInt(e.target.value));
            }}
            style={{ flex: 1, margin: 0 }}
          />
          <span style={{ fontSize: '14px' }}>{maxTimerSeconds}s</span>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
          <button
            className="btn btn-action"
            style={{ flex: 1, margin: 0 }}
            onClick={async () => {
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

                console.log(`[${APP_VERSION}] Manual distribution started`);
                let successCount = 0;
                
                // Save current settings to session
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
                
                // Force all players to be ready for a new card
                for (const player of players) {
                  if (player.active) {
                    await safeOperation(() =>
                      room.collection('player').update(player.id, {
                        ready_for_card: true
                      })
                    );
                  }
                }
                
                // Wait a moment for updates to process
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Distribute cards to each active player
                for (const player of players) {
                  if (player.active) {
                    const success = await distributeCardToPlayer(player);
                    if (success) successCount++;
                    // Add delay between distributions
                    await new Promise(resolve => setTimeout(resolve, 800));
                  }
                }

                setTimeout(refreshPlayerList, 2000);
                setSuccess(`Cards distributed to ${successCount} players`);
                setTimeout(() => setSuccess(''), 3000);
              } catch (error) {
                setError('Distribution failed');
                console.error('Error:', error);
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading}
          >
            {loading ? 'Sending...' : 'Distribute Cards Now'}
          </button>
          
          <button
            className="btn btn-outline"
            style={{ width: '120px', margin: 0 }}
            onClick={async () => {
              if (!sessionId) return;
              if (!confirm('Are you sure you want to end the session?')) return;

              try {
                setLoading(true);
                
                for (const player of players) {
                  await safeOperation(() =>
                    room.collection('player').update(player.id, {
                      current_card: 'END',
                      card_start_time: new Date().toISOString()
                    })
                  );
                }

                await safeOperation(() =>
                  room.collection('session').update(sessionId, {
                    ended: true,
                    active: false
                  })
                );

                setSuccess('Session ended');
                
                setTimeout(() => {
                  setStep('setup');
                  setSessionId('');
                  setPin('');
                }, 2000);
              } catch (error) {
                setError('Failed to end session');
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading}
          >
            End Session
          </button>
        </div>
        
        {/* Status messages */}
        {error && <div className="error" style={{ margin: '5px 0', padding: '8px' }}>{error}</div>}
        {success && <div className="success" style={{ margin: '5px 0', padding: '8px' }}>{success}</div>}

        {/* Players grid - optimized to show more at once */}
        <h3 className="subheader" style={{ marginBottom: '5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Players ({players.length})</span>
          <button
            className="btn btn-outline"
            style={{ padding: '4px 8px', fontSize: '13px', margin: 0 }}
            onClick={refreshPlayerList}
          >
            Refresh
          </button>
        </h3>

        {players.length > 0 ? (
          <div className="player-grid">
            {players.map(player => {
              // Calculate remaining time for display
              let timeRemaining = null;
              if (player.current_card && player.current_card !== 'END' && player.card_start_time && player.card_duration) {
                const cardStartTime = new Date(player.card_start_time).getTime();
                const cardEndTime = cardStartTime + (player.card_duration * 1000);
                const now = Date.now();
                timeRemaining = Math.max(0, Math.ceil((cardEndTime - now) / 1000));
              }
              
              return (
                <div key={player.id} className="player-card-mini">
                  <div className="player-name">{player.name}</div>
                  {player.current_card && player.current_card !== 'END' ? (
                    <div className="player-current-card">
                      <div className="card-text-mini">{player.current_card}</div>
                      <div className="card-source">
                        From: {player.current_deck_name || "Unknown"}
                      </div>
                      <div className="card-status">
                        {timeRemaining !== null ? (
                          <span className="status-active">{timeRemaining}s remaining</span>
                        ) : (
                          <span className="status-active">Active</span>
                        )}
                      </div>
                    </div>
                  ) : player.current_card === 'END' ? (
                    <div className="player-card-ended">Session Ended</div>
                  ) : (
                    <div className="player-card-waiting">Waiting for card</div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ padding: '15px', backgroundColor: '#f9f9f9', borderRadius: '8px', textAlign: 'center' }}>
            <p>No players have joined yet. Share the PIN/link to invite players.</p>
          </div>
        )}
      </div>
    </div>
  );
}