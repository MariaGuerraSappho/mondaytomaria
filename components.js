// Home View Component
function HomeView({ onNavigate }) {
  return (
    <div className="container">
      <div className="card">
        <h1 className="header">From Monday to Maria</h1>
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
      
      // More flexible PIN handling - try both original and cleaned versions
      const rawPin = pin.trim();
      const cleanPin = rawPin.replace(/\D/g, ''); // Remove any non-digit characters
      
      console.log(`[${APP_VERSION}] Trying to find session with PIN formats - Raw: "${rawPin}", Clean: "${cleanPin}"`);
      
      // Try all possible formats of the PIN to ensure QR code works
      let sessions = [];
      
      // First try with the raw PIN as is
      sessions = await safeOperation(() => 
        room.collection('session')
          .filter({ pin: rawPin })
          .getList()
      );
      
      // If no sessions found, try with cleaned PIN
      if (sessions.length === 0 && cleanPin !== rawPin) {
        console.log(`[${APP_VERSION}] No session found with raw PIN, trying cleaned PIN: ${cleanPin}`);
        sessions = await safeOperation(() => 
          room.collection('session')
            .filter({ pin: cleanPin })
            .getList()
        );
      }
      
      // As a last resort, try with the PIN as part of URL 
      if (sessions.length === 0) {
        console.log(`[${APP_VERSION}] Trying to extract PIN from full URL in case QR code was scanned incorrectly`);
        // This handles case where the whole URL might be interpreted as the PIN by some QR scanners
        const urlMatch = rawPin.match(/[?&]pin=([^&]+)/);
        if (urlMatch && urlMatch[1]) {
          const extractedPin = urlMatch[1];
          console.log(`[${APP_VERSION}] Extracted PIN from URL parameter: ${extractedPin}`);
          sessions = await safeOperation(() => 
            room.collection('session')
              .filter({ pin: extractedPin })
              .getList()
          );
          
          // If we found a session this way, update the pin value
          if (sessions.length > 0) {
            setPin(extractedPin);
          }
        }
      }
      
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
      
      // Ensure we're using the clean PIN format consistently
      const cleanPin = pin.trim().replace(/\D/g, '');
      
      // Check if player has an existing ID in this session
      const existingPlayers = await safeOperation(() => 
        room.collection('player')
          .filter({ session_pin: cleanPin, name: name.trim() })
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
            session_pin: cleanPin,
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
      onNavigate('player', { pin: cleanPin, name: name.trim(), playerId });
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

// Player View Component - Simplified
function PlayerView({ pin, name, playerId, onNavigate }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [session, setSession] = useState(null);
  const [card, setCard] = useState(null);
  const [waitingForCard, setWaitingForCard] = useState(true);
  const timerRef = useRef(null);
  const playerRef = useRef(null);
  const playerSubscriptionRef = useRef(null);
  const cardEndTimeRef = useRef(null);
  const lastCardRef = useRef(null);
  
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

  // Simplified card display - no timer shown to player
  const handleCardDisplay = (playerData) => {
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
      
      return;
    }
    
    // Handle session end signal - this is now persistent with session_ended flag
    if (playerData.current_card === 'END' || playerData.session_ended === true) {
      console.log(`[${APP_VERSION}] Session ended notification received`);
      setCard({ text: 'Session Ended', isEnd: true });
      setWaitingForCard(false);
      cardEndTimeRef.current = null;
      
      // Clear any existing timer
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      
      return;
    }
    
    // Check if this is the same card we're already displaying (to avoid timer resets)
    const isSameCard = lastCardRef.current && 
                      lastCardRef.current.text === playerData.current_card && 
                      lastCardRef.current.startTime === playerData.card_start_time;
                      
    if (isSameCard) {
      console.log(`[${APP_VERSION}] Received duplicate card update, ignoring`);
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
    const startTime = new Date(playerData.card_start_time || new Date());
    const duration = playerData.card_duration || 30;
    
    console.log(`[${APP_VERSION}] Displaying card: "${cardText}" with duration ${duration}s, start time: ${startTime.toISOString()}`);
    
    // Create the new card object
    const newCard = {
      text: cardText,
      startTime: startTime,
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
    
    setWaitingForCard(false);
    
    // Send acknowledgment that card was received and displayed
    updatePlayerStatus({ 
      card_received: true,
      card_acknowledged_at: new Date().toISOString()
    });
    
    // Timer for internal use only (not displayed to player)
    if (cardEndTime > Date.now()) {
      timerRef.current = setInterval(() => {
        const currentTime = Date.now();
        const timeRemaining = Math.max(0, cardEndTimeRef.current - currentTime);
        
        // Only end the timer when we're truly at zero
        if (timeRemaining <= 50) {
          console.log(`[${APP_VERSION}] Timer completed naturally at ${new Date().toISOString()}`);
          
          // Clear the interval first to prevent multiple triggers
          clearInterval(timerRef.current);
          timerRef.current = null;
          
          // Update state
          setWaitingForCard(true);
          setCard(null);
          
          // Mark as ready for next card when timer actually completes
          updatePlayerStatus({ 
            ready_for_card: true,
            card_ended_at: new Date().toISOString()
          });
        }
      }, 100);
    } else {
      // Card already expired
      console.log(`[${APP_VERSION}] Card already expired`);
      setWaitingForCard(true);
      updatePlayerStatus({ 
        ready_for_card: true,
        card_ended_at: new Date().toISOString()
      });
    }
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
          // Session is ended, show the END state immediately
          setCard({ text: 'Session Ended', isEnd: true });
          setWaitingForCard(false);
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
            card_duration: playerData.card_duration,
            session_ended: playerData.session_ended
          });
          
          // Check for session ended state first
          if (playerData.session_ended === true || playerData.current_card === 'END') {
            console.log(`[${APP_VERSION}] Session ended state detected for player`);
            setCard({ text: 'Session Ended', isEnd: true });
            setWaitingForCard(false);
            setLoading(false);
            return;
          }
          
          // Process any existing card immediately
          if (playerData.current_card) {
            console.log(`[${APP_VERSION}] Found existing card to display: ${playerData.current_card}`);
            handleCardDisplay(playerData);
          } else {
            console.log(`[${APP_VERSION}] No initial card found, waiting for card`);
            setWaitingForCard(true);
          }
          
          // Mark player as active and ready for cards if needed
          const readyForCard = !playerData.current_card || 
                              playerData.current_card === 'END' || 
                              (playerData.card_start_time && playerData.card_duration && 
                               new Date(playerData.card_start_time).getTime() + 
                               (playerData.card_duration * 1000) < Date.now());
          
          await updatePlayerStatus({
            active: true,
            last_seen: new Date().toISOString(),
            ready_for_card: readyForCard
          });
        } catch (playerError) {
          console.error(`[${APP_VERSION}] Error getting player data:`, playerError);
          setError('Error connecting to session');
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
        
        // Additional periodic check for card updates in case subscription fails
        const cardCheckInterval = setInterval(async () => {
          try {
            const latestPlayers = await room.collection('player')
              .filter({ id: playerId })
              .getList();
              
            if (latestPlayers.length > 0) {
              const latestPlayer = latestPlayers[0];
              
              // Only process if different from current
              if (playerRef.current?.current_card !== latestPlayer.current_card ||
                  playerRef.current?.card_start_time !== latestPlayer.card_start_time) {
                
                console.log(`[${APP_VERSION}] Detected card change from periodic check:`, {
                  id: latestPlayer.id,
                  current_card: latestPlayer.current_card,
                  card_start_time: latestPlayer.card_start_time
                });
                
                playerRef.current = latestPlayer;
                handleCardDisplay(latestPlayer);
              }
            }
          } catch (error) {
            console.error(`[${APP_VERSION}] Error in periodic card check:`, error);
          }
        }, 8000);
        
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
          clearInterval(cardCheckInterval);
        };
      } catch (error) {
        console.error(`[${APP_VERSION}] Error initializing player view:`, error);
        setError('Error connecting to session');
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

  // Simplified player view - just the card text or loading dots
  return (
    <div className="container">
      <div className="card">
        {loading ? (
          <div className="waiting-animation">
            <div className="dot"></div>
            <div className="dot"></div>
            <div className="dot"></div>
          </div>
        ) : error ? (
          <div className="error">{error}</div>
        ) : (
          <>
            {waitingForCard ? (
              <div className="waiting-animation">
                <div className="dot"></div>
                <div className="dot"></div>
                <div className="dot"></div>
              </div>
            ) : (
              <div className={`card-content ${card !== null ? 'card-new' : ''}`}>
                {card && (
                  <div className="card-text">
                    {card.text}
                  </div>
                )}
              </div>
            )}
          </>
        )}
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
  const [endingSession, setEndingSession] = useState(false);
  const [endCountdown, setEndCountdown] = useState(5);
  const fileInputRef = useRef(null);
  const playersSubscriptionRef = useRef(null);
  const autoDistributeIntervalRef = useRef(null);
  const endCountdownRef = useRef(null);
  const pendingDistributionsRef = useRef(new Set()); // Track players with pending distribution
  const [unisonCardSequence, setUnisonCardSequence] = useState([]);
  const [unisonCardIndex, setUnisonCardIndex] = useState(0);
  const qrCodeRef = useRef(null);

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
  const refreshPlayerList = async (showSuccess = true) => {
    if (!pin) return;

    try {
      setLoading(true);
      setError('');
      const playerList = await safeOperation(() =>
        room.collection('player')
          .filter({ session_pin: pin })
          .getList()
      );
      
      // Enhanced logging for debugging card information
      console.log(`[${APP_VERSION}] Refreshed player list:`, playerList.map(p => ({
        id: p.id,
        name: p.name, 
        card: p.current_card,
        start: p.card_start_time,
        duration: p.card_duration
      })));
      
      setPlayers(playerList);
      if (showSuccess) {
        setSuccess('Player list refreshed');
        setTimeout(() => setSuccess(''), 2000);
      }
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
          console.log(`[${APP_VERSION}] Player subscription update received with ${updatedPlayers.length} players`);
          setPlayers(prevPlayers => {
            // Always update to ensure we get fresh data
            console.log(`[${APP_VERSION}] Updating players state with new data`);
            return updatedPlayers;
          });
        });

      playersSubscriptionRef.current = unsubscribe;
      
      // Add more frequent periodic forced refresh to ensure view stays updated
      const periodicRefresh = setInterval(() => {
        refreshPlayerList(false); // Silent refresh (no success message)
      }, 3000); // More frequent refreshes
      
      return () => {
        clearInterval(periodicRefresh);
        if (playersSubscriptionRef.current) {
          playersSubscriptionRef.current();
          playersSubscriptionRef.current = null;
        }
      };
    } catch (error) {
      console.error(`[${APP_VERSION}] Error setting up player subscription:`, error);
      setError('Error setting up player tracking');
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
          setNewDeckName('');
          setNewDeckCards('');
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

      setSuccess(`Upload complete! Added ${successCount} deck${successCount !== 1 ? 's' : ''}`);
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

      // Generate numeric PIN and ensure it's clean
      const sessionPin = generatePin().replace(/\D/g, '');
      console.log(`[${APP_VERSION}] Creating session with clean numeric PIN: ${sessionPin}`);

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

  // End session with countdown
  const endSession = async () => {
    if (!sessionId) return;
    if (!confirm('Are you sure you want to end the session?')) return;

    try {
      setEndingSession(true);
      setEndCountdown(5);
      
      // Start countdown
      if (endCountdownRef.current) {
        clearInterval(endCountdownRef.current);
      }
      
      endCountdownRef.current = setInterval(() => {
        setEndCountdown(prev => {
          const newCount = prev - 1;
          if (newCount <= 0) {
            clearInterval(endCountdownRef.current);
            
            // Actually end the session after countdown
            finalizeSessionEnd();
          }
          return newCount;
        });
      }, 1000);
      
    } catch (error) {
      setError('Failed to start session end countdown');
      setEndingSession(false);
    }
  };
  
  // Actually end the session after countdown
  const finalizeSessionEnd = async () => {
    try {
      setLoading(true);
      
      // Send END signal to all players with multiple retries for reliability
      for (let attempt = 0; attempt < 3; attempt++) {
        for (const player of players) {
          if (player.active) {
            try {
              await safeOperation(() =>
                room.collection('player').update(player.id, {
                  current_card: 'END',
                  card_start_time: new Date().toISOString(),
                  ready_for_card: false,
                  session_ended: true,  // Add persistent flag for session end
                  session_ended_at: new Date().toISOString()
                })
              );
            } catch (err) {
              console.error(`Failed to send END to player ${player.name} on attempt ${attempt + 1}:`, err);
            }
          }
        }
        
        // Brief delay between retries
        if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 800));
        }
      }

      // Update session status
      await safeOperation(() =>
        room.collection('session').update(sessionId, {
          ended: true,
          active: false,
          ended_at: new Date().toISOString()
        })
      );

      setSuccess('Session ended');
      
      // Return to setup after a delay
      setTimeout(() => {
        setStep('setup');
        setSessionId('');
        setPin('');
        setEndingSession(false);
      }, 2000);
    } catch (error) {
      setError('Failed to end session');
      setEndingSession(false);
    } finally {
      setLoading(false);
    }
  };

  // Card distribution function
  const distributeCardToPlayer = async (player, sharedCard = null) => {
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

      console.log(`[${APP_VERSION}] Distributing card to player ${player.id} (${player.name}) in mode: ${distributionMode}`);
      
      const result = await distributeCard(
        player, 
        selectedDeckData, 
        distributionMode, 
        players,
        minTimerSeconds, 
        maxTimerSeconds,
        sharedCard
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
      return result.success ? result.card : null;
    } catch (error) {
      console.error(`[${APP_VERSION}] Error distributing card to ${player.name}:`, error);
      pendingDistributionsRef.current.delete(player.id);
      return false;
    }
  };

  // Handle distribution mode change with immediate redistribution
  const handleDistributionModeChange = async (newMode) => {
    if (loading || !sessionId) return;
    
    try {
      setLoading(true);
      setDistributionMode(newMode);
      
      // Reset unison sequence when switching modes
      if (newMode === 'unison') {
        // Only reset if switching to unison
        setUnisonCardSequence([]);
        setUnisonCardIndex(0);
      }
      
      // Update session with new mode
      await safeOperation(() =>
        room.collection('session').update(sessionId, {
          distribution_mode: newMode
        })
      );
      
      console.log(`[${APP_VERSION}] Distribution mode changed to: ${newMode}`);
      
      // Force immediate redistribution to all players
      await distributeCardsToAllPlayers(newMode);
      
      // Ensure player list is refreshed after distribution
      setTimeout(() => refreshPlayerList(), 1500);
      setTimeout(() => refreshPlayerList(), 3000); // Second refresh for reliability
      
      setSuccess(`Switched to ${newMode} mode and redistributed cards`);
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      setError(`Failed to switch to ${newMode} mode`);
      console.error('Error switching distribution mode:', error);
    } finally {
      setLoading(false);
    }
  };

  // Distribute cards to all players with proper mode handling
  const distributeCardsToAllPlayers = async (mode = distributionMode) => {
    if (!sessionId || !selectedDeck || players.length === 0) {
      setError('No players or deck selected');
      return;
    }

    try {
      console.log(`[${APP_VERSION}] Distributing cards to all players in ${mode} mode`);
      
      // Force all players to be ready
      for (const player of players) {
        if (player.active) {
          await safeOperation(() =>
            room.collection('player').update(player.id, {
              ready_for_card: true
            })
          );
        }
      }
      
      // Brief delay to allow updates to process
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // For unison mode, select one card for all players and maintain sequence
      let sharedCard = null;
      if (mode === 'unison') {
        const selectedDeckData = decks.find(d => d.id === selectedDeck);
        if (selectedDeckData && selectedDeckData.cards && selectedDeckData.cards.length > 0) {
          if (unisonCardSequence.length === 0) {
            // Initialize a new card sequence
            const newSequence = generateCardSequence(selectedDeckData.cards, 10);
            setUnisonCardSequence(newSequence);
            sharedCard = newSequence[0];
            setUnisonCardIndex(0);
          } else {
            // Reset to first card in sequence for manual distribution
            sharedCard = unisonCardSequence[0];
            setUnisonCardIndex(0);
          }
          console.log(`[${APP_VERSION}] Selected shared unison card: "${sharedCard}" (from sequence)`);
        }
      }
      
      // Distribute to each active player
      for (const player of players) {
        if (player.active) {
          if (mode === 'unison') {
            await distributeCardToPlayer(player, sharedCard);
          } else {
            await distributeCardToPlayer(player);
          }
          // Add delay between distributions
          await new Promise(resolve => setTimeout(resolve, 800));
        }
      }
      
      // Refresh player list
      setTimeout(refreshPlayerList, 2000);
      
    } catch (error) {
      console.error(`[${APP_VERSION}] Error distributing cards to all players:`, error);
      throw error;
    }
  };

  // Helper function to generate card sequence
  const generateCardSequence = (cards, count = 10) => {
    const sequence = [];
    for (let i = 0; i < count; i++) {
      const randomIndex = Math.floor(Math.random() * cards.length);
      sequence.push(cards[randomIndex]);
    }
    return sequence;
  };

  // Auto-distribution setup
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
        
        // Find players who genuinely need cards
        const playersNeedingCards = players.filter(player => {
          // Skip inactive players
          if (!player.active) return false;
          
          // If explicitly ready for a card, allow distribution
          if (player.ready_for_card === true) {
            return true;
          }
          
          // If no card, player needs one
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
          
          // Add a 1-second buffer to ensure the timer has fully completed
          return now > (cardEndTime + 1000);
        });
        
        // Only proceed if we found players genuinely needing cards
        if (playersNeedingCards.length > 0) {
          console.log(`[${APP_VERSION}] Auto-distributing cards to ${playersNeedingCards.length} players:`, 
            playersNeedingCards.map(p => p.name));
          
          // For unison mode, maintain card sequence
          let sharedCard = null;
          if (distributionMode === 'unison') {
            const selectedDeckData = decks.find(d => d.id === selectedDeck);
            if (selectedDeckData && selectedDeckData.cards && selectedDeckData.cards.length > 0) {
              // Use the card sequence if it exists, otherwise create a new one
              if (unisonCardSequence.length === 0) {
                // Initialize card sequence
                const newSequence = generateCardSequence(selectedDeckData.cards, 10); // Generate 10 cards
                setUnisonCardSequence(newSequence);
                sharedCard = newSequence[0];
                setUnisonCardIndex(0);
              } else {
                // Get next card in sequence
                const nextIndex = unisonCardIndex < unisonCardSequence.length - 1 ? 
                                  unisonCardIndex + 1 : 0;
                sharedCard = unisonCardSequence[nextIndex];
                setUnisonCardIndex(nextIndex);
              }
              console.log(`[${APP_VERSION}] Using unison card sequence: card ${unisonCardIndex + 1}/${unisonCardSequence.length}: "${sharedCard}"`);
            }
          }
          
          // Process one player at a time with delays to prevent race conditions
          for (const player of playersNeedingCards) {
            // Skip if already in the process of distributing to this player
            if (pendingDistributionsRef.current.has(player.id)) {
              console.log(`[${APP_VERSION}] Skipping player ${player.name} - distribution already in progress`);
              continue;
            }
            
            console.log(`[${APP_VERSION}] Auto-distributing card to player ${player.name} (${player.id})`);
            if (distributionMode === 'unison') {
              await distributeCardToPlayer(player, sharedCard);
            } else {
              await distributeCardToPlayer(player);
            }
            
            // Small delay between distributions to prevent overloading
            await new Promise(resolve => setTimeout(resolve, 800));
          }
        }
      }, 2000); // Check frequently but not too frequently
    }
    
    return () => {
      if (autoDistributeIntervalRef.current) {
        clearInterval(autoDistributeIntervalRef.current);
        autoDistributeIntervalRef.current = null;
      }
    };
  }, [step, autoDistribute, players, selectedDeck, distributionMode, minTimerSeconds, maxTimerSeconds, pin, unisonCardSequence, unisonCardIndex]);

  // Conductor View Component - QR Code generation fix
  const generateQRCode = useCallback(() => {
    if (!pin || !qrCodeRef.current) return;
    
    // Ensure we're using the clean numeric PIN format consistently
    const cleanPin = pin.trim().replace(/\D/g, '');
    const joinUrl = `${window.baseUrl || window.location.origin}?pin=${cleanPin}`;
    
    console.log(`[${APP_VERSION}] Generating QR code with URL: ${joinUrl}`);
    
    // Generate QR code
    QRCode.toCanvas(qrCodeRef.current, joinUrl, {
      width: 200,
      margin: 2,
      color: {
        dark: '#ff4e8a',
        light: '#ffffff'
      }
    }, (error) => {
      if (error) console.error(`[${APP_VERSION}] QR Code error:`, error);
    });
  }, [pin]);

  // Use effect to generate QR code when pin changes
  useEffect(() => {
    if (pin && step === 'session') {
      setTimeout(generateQRCode, 100);
    }
  }, [pin, step, generateQRCode]);

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
            Back
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

        {/* Share section with QR code */}
        <div style={{ 
          backgroundColor: '#f9f9f9', 
          padding: '15px', 
          borderRadius: '8px', 
          marginBottom: '15px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center'
        }}>
          <div style={{ marginBottom: '10px', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%' }}>
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
          </div>
          
          <div className="qr-container">
            <canvas ref={qrCodeRef} className="qr-code"></canvas>
            <div style={{ textAlign: 'center', fontSize: '14px', fontWeight: 'bold' }}>
              Scan to join or enter PIN: <span style={{ color: 'var(--primary)' }}>{pin}</span>
            </div>
          </div>
        </div>
        
        {/* Distribution Mode Buttons */}
        <div style={{ marginBottom: '15px' }}>
          <h3 className="subheader" style={{ marginBottom: '8px' }}>Distribution Mode</h3>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button 
              className={`btn ${distributionMode === 'unison' ? '' : 'btn-outline'}`}
              style={{ flex: 1, margin: 0 }}
              onClick={() => handleDistributionModeChange('unison')}
              disabled={loading || distributionMode === 'unison'}
            >
              Unison
            </button>
            <button 
              className={`btn ${distributionMode === 'unique' ? '' : 'btn-outline'}`}
              style={{ flex: 1, margin: 0 }}
              onClick={() => handleDistributionModeChange('unique')}
              disabled={loading || distributionMode === 'unique'}
            >
              Unique
            </button>
            <button 
              className={`btn ${distributionMode === 'random' ? '' : 'btn-outline'}`}
              style={{ flex: 1, margin: 0 }}
              onClick={() => handleDistributionModeChange('random')}
              disabled={loading || distributionMode === 'random'}
            >
              Random
            </button>
          </div>
          <p className="notice" style={{ marginTop: '5px', textAlign: 'center' }}>
            {distributionMode === 'unison' ? 'All players get the same card' : 
             distributionMode === 'unique' ? 'Each player gets a different card' : 
             'Each player gets a random card'}
          </p>
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
              const value = Math.max(5, parseInt(e.target.value) || 5);
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

                console.log(`[${APP_VERSION}] Manual distribution started in ${distributionMode} mode`);
                
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
                
                // Distribute cards to all players using current mode
                await distributeCardsToAllPlayers();
                
                setSuccess(`Cards distributed to players in ${distributionMode} mode`);
                setTimeout(() => setSuccess(''), 3000);
              } catch (error) {
                setError('Distribution failed');
                console.error('Error:', error);
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading || endingSession}
          >
            {loading ? 'Sending...' : 'Distribute Cards Now'}
          </button>
          
          <button
            className="btn btn-outline"
            style={{ width: '120px', margin: 0 }}
            onClick={endSession}
            disabled={loading || endingSession}
          >
            {endingSession ? `Ending in ${endCountdown}s` : 'End Session'}
          </button>
        </div>
        
        {/* Status messages */}
        {error && <div className="error" style={{ margin: '5px 0', padding: '8px' }}>{error}</div>}
        {success && <div className="success" style={{ margin: '5px 0', padding: '8px' }}>{success}</div>}

        {/* Players grid - enhanced to show more details about cards */}
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
              // Calculate remaining time for conductor view only
              let timeRemaining = null;
              if (player.current_card && player.current_card !== 'END' && player.card_start_time && player.card_duration) {
                const cardStartTime = new Date(player.card_start_time).getTime();
                const cardEndTime = cardStartTime + (player.card_duration * 1000);
                const now = Date.now();
                timeRemaining = Math.max(0, Math.ceil((cardEndTime - now) / 1000));
              }
              
              return (
                <div key={player.id} className="player-card-mini" style={{
                  border: player.current_card ? '2px solid var(--primary)' : '1px solid var(--border)',
                  opacity: player.active ? 1 : 0.6,
                  backgroundColor: player.current_card ? 'rgba(255, 78, 138, 0.05)' : '#fff'
                }}>
                  <div className="player-name" style={{
                    display: 'flex',
                    justifyContent: 'space-between'
                  }}>
                    <span>{player.name}</span>
                    {!player.active && <span style={{fontSize: '11px', color: 'var(--text-light)'}}>(inactive)</span>}
                  </div>
                  
                  {player.current_card && player.current_card !== 'END' ? (
                    <div className="player-current-card">
                      <div className="card-text-mini">{player.current_card}</div>
                      <div className="card-source" style={{
                        display: 'flex',
                        justifyContent: 'space-between'
                      }}>
                        <span>From: {player.current_deck_name || "Unknown"}</span>
                        {timeRemaining !== null && (
                          <span style={{
                            fontWeight: 'bold',
                            color: timeRemaining < 5 ? 'var(--error)' : 'var(--accent)'
                          }}>
                            {timeRemaining}s
                          </span>
                        )}
                      </div>
                      <div style={{
                        marginTop: '5px',
                        height: '4px',
                        backgroundColor: '#eee',
                        borderRadius: '2px',
                        overflow: 'hidden'
                      }}>
                        {timeRemaining !== null && player.card_duration && (
                          <div style={{
                            height: '100%',
                            width: `${(timeRemaining / player.card_duration) * 100}%`,
                            backgroundColor: 'var(--primary)',
                            transition: 'width 1s linear'
                          }}></div>
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