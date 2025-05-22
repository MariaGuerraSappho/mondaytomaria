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
            rejoined: true
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
  const cardReceivedRef = useRef(false);
  const acknowledgedDistributionIdRef = useRef(null);
  const playerUpdateIntervalRef = useRef(null);
  const playerSubscriptionRef = useRef(null);
  const cardReceivedCheckerRef = useRef(null);
  const waitingAcknowledgedRef = useRef(false);
  const lastCardUpdateTimeRef = useRef(0);

  const updatePlayerStatus = async (statusUpdate) => {
    if (!playerId) return;
    
    try {
      console.log(`[${APP_VERSION}] Updating player status:`, statusUpdate);
      await safeOperation(() => 
        room.collection('player').update(playerId, {
          ...statusUpdate,
          last_seen: new Date().toISOString()
        })
      );
      console.log(`[${APP_VERSION}] Player status updated successfully`);
      return true;
    } catch (error) {
      console.error(`[${APP_VERSION}] Error updating player status:`, error);
      // Retry once after a small delay
      try {
        await new Promise(resolve => setTimeout(resolve, 500));
        await room.collection('player').update(playerId, {
          ...statusUpdate,
          last_seen: new Date().toISOString(),
          update_retry: true
        });
        console.log(`[${APP_VERSION}] Player status updated successfully on retry`);
        return true;
      } catch (retryError) {
        console.error(`[${APP_VERSION}] Error updating player status on retry:`, retryError);
        return false;
      }
    }
  };

  const handleNewCard = async (newCardData) => {
    console.log(`[${APP_VERSION}] Processing new card:`, newCardData);
    
    // Clear any existing timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    
    // Create the card object
    const newCard = {
      text: newCardData.current_card,
      deckName: newCardData.current_deck_name || 'Unknown',
      startTime: new Date(),
      duration: newCardData.card_duration || 30,
      distributionId: newCardData.distribution_id
    };
    
    // Acknowledge receipt only if this is a new distribution ID
    if (acknowledgedDistributionIdRef.current !== newCardData.distribution_id) {
      console.log(`[${APP_VERSION}] Acknowledging new card with distribution ID: ${newCardData.distribution_id}`);
      acknowledgedDistributionIdRef.current = newCardData.distribution_id;
      cardReceivedRef.current = true;
      waitingAcknowledgedRef.current = false;
      lastCardUpdateTimeRef.current = Date.now();
      
      // Update server that we've received the card
      await updatePlayerStatus({
        waiting_for_player_ack: false,
        card_received: true,
        card_start_time: new Date().toISOString(),
        ready_for_card: false,
        card_acknowledge_time: new Date().toISOString()
      });
    }
    
    // Update the UI
    setCard(newCard);
    setTimeLeft(newCard.duration);
    setWaitingForCard(false);
    setTimerStarted(true);
    
    // Start a new timer for this card
    timerRef.current = setInterval(() => {
      setTimeLeft(prevTime => {
        if (prevTime <= 1) {
          clearInterval(timerRef.current);
          timerRef.current = null;
          setTimerStarted(false);
          
          // Mark as ready for next card
          updatePlayerStatus({
            ready_for_card: true,
            card_completed: true,
            card_completion_time: new Date().toISOString()
          });
          setWaitingForCard(true);
          
          return 0;
        }
        return prevTime - 1;
      });
    }, 1000);
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
        const sessions = await safeOperation(() => 
          room.collection('session')
            .filter({ pin })
            .getList()
        );
        
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
        
        // Check if player exists
        let playerData;
        try {
          const players = await safeOperation(() => 
            room.collection('player')
              .filter({ id: playerId })
              .getList()
          );
          
          if (players.length === 0) {
            setError('Player not found. Please rejoin the session.');
            setLoading(false);
            return;
          }
          
          playerData = players[0];
          playerRef.current = playerData;
          
          // Mark player as active
          await updatePlayerStatus({
            active: true,
            last_seen: new Date().toISOString(),
            view_initialized: true
          });
        } catch (playerError) {
          console.error(`[${APP_VERSION}] Error getting player data:`, playerError);
          setError('Error connecting to session. Please try refreshing the page.');
          setLoading(false);
          return;
        }
        
        // Check if player already has a card
        if (playerData.current_card && playerData.current_card !== 'END') {
          console.log(`[${APP_VERSION}] Player already has card: ${playerData.current_card}`);
          
          // Acknowledge that we've received this card to ensure conductor knows
          acknowledgedDistributionIdRef.current = playerData.distribution_id;
          lastCardUpdateTimeRef.current = Date.now();
          
          await updatePlayerStatus({
            waiting_for_player_ack: false,
            card_received: true,
            ready_for_card: false,
            card_acknowledge_time: new Date().toISOString()
          });
          
          setCard({
            text: playerData.current_card,
            deckName: playerData.current_deck_name || 'Unknown',
            startTime: playerData.card_start_time ? new Date(playerData.card_start_time) : new Date(),
            duration: playerData.card_duration || 30,
            distributionId: playerData.distribution_id
          });
          
          setWaitingForCard(false);
          
          // Calculate time left
          if (playerData.card_start_time && playerData.card_duration) {
            const startTime = new Date(playerData.card_start_time).getTime();
            const endTime = startTime + (playerData.card_duration * 1000);
            const now = Date.now();
            const remaining = Math.max(0, endTime - now);
            setTimeLeft(Math.ceil(remaining / 1000));
            
            // If there's still time left, start the timer
            if (remaining > 0) {
              setTimerStarted(true);
              
              timerRef.current = setInterval(() => {
                setTimeLeft(prevTime => {
                  if (prevTime <= 1) {
                    clearInterval(timerRef.current);
                    setTimerStarted(false);
                    
                    // Mark as ready for next card
                    updatePlayerStatus({
                      ready_for_card: true,
                      card_completed: true,
                      card_completion_time: new Date().toISOString()
                    });
                    setWaitingForCard(true);
                    
                    return 0;
                  }
                  return prevTime - 1;
                });
              }, 1000);
            } else {
              // Card has expired, mark as ready for a new one
              updatePlayerStatus({
                ready_for_card: true
              });
              setWaitingForCard(true);
            }
          }
        } else if (playerData.current_card === 'END') {
          setCard({ text: 'Session Ended', isEnd: true });
          setWaitingForCard(false);
        } else {
          setWaitingForCard(true);
          setCard(null);
          
          // Mark player as ready for a card
          await updatePlayerStatus({
            ready_for_card: true,
            waiting_for_player_ack: false,
            card_received: false,
            player_view_ready: true
          });
          
          console.log(`[${APP_VERSION}] Player ready for first card`);
        }
        
        // Set up subscription for player updates - store reference for cleanup
        const unsubscribe = room.collection('player')
          .filter({ id: playerId })
          .subscribe(updatedPlayers => {
            if (updatedPlayers.length === 0) return;
            
            const updatedPlayer = updatedPlayers[0];
            playerRef.current = updatedPlayer;
            
            console.log(`[${APP_VERSION}] Player update received:`, {
              current_card: updatedPlayer.current_card,
              distribution_id: updatedPlayer.distribution_id,
              waiting_for_ack: updatedPlayer.waiting_for_player_ack,
              ready_for_card: updatedPlayer.ready_for_card
            });
            
            // Check if this is a stale update (older than our last processed update)
            if (updatedPlayer.force_render && updatedPlayer.force_render < lastCardUpdateTimeRef.current) {
              console.log(`[${APP_VERSION}] Ignoring stale update with force_render:`, updatedPlayer.force_render);
              return;
            }
            
            // Handle new card
            if (updatedPlayer.current_card && 
                updatedPlayer.current_card !== 'END' && 
                (!card || card.text !== updatedPlayer.current_card || 
                 (updatedPlayer.distribution_id && acknowledgedDistributionIdRef.current !== updatedPlayer.distribution_id))) {
              
              console.log(`[${APP_VERSION}] New card received: ${updatedPlayer.current_card}`);
              handleNewCard(updatedPlayer);
            }
            
            // Handle session end signal
            else if (updatedPlayer.current_card === 'END') {
              if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
              }
              
              setCard({ text: 'Session Ended', isEnd: true });
              setWaitingForCard(false);
              setTimerStarted(false);
            }
          });
        
        // Store the unsubscribe function for cleanup
        playerSubscriptionRef.current = unsubscribe;
        
        // Start a heartbeat interval to update our presence
        playerUpdateIntervalRef.current = setInterval(() => {
          updatePlayerStatus({ 
            ping: Date.now(),
            player_active: true,
            current_timer: timeLeft
          });
        }, 10000);
        
        // Set up a checker to make sure we acknowledge cards quickly
        cardReceivedCheckerRef.current = setInterval(() => {
          const player = playerRef.current;
          
          if (player && player.waiting_for_player_ack && !waitingAcknowledgedRef.current) {
            console.log(`[${APP_VERSION}] Acknowledging waiting card: ${player.current_card}`);
            waitingAcknowledgedRef.current = true;
            lastCardUpdateTimeRef.current = Date.now();
            
            // If we have a current card but haven't acknowledged it yet
            if (player.current_card && player.current_card !== 'END') {
              updatePlayerStatus({
                waiting_for_player_ack: false,
                card_received: true,
                card_start_time: new Date().toISOString(),
                ready_for_card: false,
                card_acknowledge_time: new Date().toISOString()
              });
              
              // If we need to update the UI too
              if (!card || card.text !== player.current_card) {
                handleNewCard(player);
              }
            }
          }
        }, CARD_RECEIVED_CHECK_INTERVAL);
        
        setLoading(false);
      } catch (error) {
        console.error(`[${APP_VERSION}] Error initializing player view:`, error);
        setError('Error connecting to session. Please try refreshing the page.');
        setLoading(false);
      }
    };
    
    initPlayerView();
    
    return () => {
      // Clean up all intervals and subscriptions
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      
      if (playerUpdateIntervalRef.current) {
        clearInterval(playerUpdateIntervalRef.current);
        playerUpdateIntervalRef.current = null;
      }
      
      if (cardReceivedCheckerRef.current) {
        clearInterval(cardReceivedCheckerRef.current);
        cardReceivedCheckerRef.current = null;
      }
      
      // Clean up player subscription
      if (playerSubscriptionRef.current) {
        playerSubscriptionRef.current();
        playerSubscriptionRef.current = null;
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

  const requestNewCard = async () => {
    if (loading || !playerId) return;
    
    try {
      console.log(`[${APP_VERSION}] Player manually requesting new card`);
      await updatePlayerStatus({
        ready_for_card: true,
        manually_requested: true,
        request_time: new Date().toISOString()
      });
      
      setWaitingForCard(true);
    } catch (error) {
      console.error(`[${APP_VERSION}] Error requesting new card:`, error);
    }
  };

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
                
                <button 
                  className="btn btn-outline"
                  onClick={requestNewCard}
                  style={{ marginTop: '15px' }}
                >
                  Request Card
                </button>
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
                            style={{ width: `${(timeLeft / card.duration) * 100}%` }}
                          ></div>
                        </div>
                        
                        <div style={{ textAlign: 'center', fontSize: '18px', fontWeight: 'bold' }}>
                          {timeLeft} seconds
                        </div>
                        
                        {timeLeft === 0 && (
                          <button 
                            className="btn btn-action"
                            onClick={requestNewCard}
                            style={{ marginTop: '15px' }}
                          >
                            Next Card
                          </button>
                        )}
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

  // Distribute cards to a single player - improved for reliability
  const distributeCardToPlayer = async (player) => {
    if (!sessionId || !selectedDeck) {
      console.log(`[${APP_VERSION}] Cannot distribute: missing session or deck`);
      return false;
    }

    try {
      console.log(`[${APP_VERSION}] Distributing new card to player: ${player.name}`);
      
      // Generate a unique distribution ID to track this specific card distribution
      const distributionId = `dist_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
      
      // Get selected deck info before clearing the current card
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
          p.id !== player.id && // Don't use the current player's card
          new Date(p.card_start_time).getTime() + (p.card_duration * 1000) > Date.now()
        );
        
        if (activeUnison && activeUnison.current_card) {
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
          .filter(p => p.current_card && p.current_card !== 'END' && p.id !== player.id)
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
          if (!deck.archived && deck.cards && deck.cards.length > 0) {
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

      // First, clear current card state completely and set to preparation state
      await safeOperation(() =>
        room.collection('player').update(player.id, {
          current_card: null, // Clear the card completely
          card_start_time: null,
          card_duration: null,
          card_received: false,
          ready_for_card: true,
          waiting_for_player_ack: false,
          distribution_pending: true, // Flag to indicate distribution is in progress
          distribution_attempt: (player.distribution_attempt || 0) + 1,
          last_distribution_attempt: new Date().toISOString(),
          distribution_id: distributionId, // Add a unique ID for this distribution
          pending_card: selectedCard,
          pending_deck_name: selectedDeckName,
          pending_deck_id: selectedDeckId,
          pending_duration: randomDuration,
          reset_timestamp: Date.now(), // Add timestamp to force UI refresh
        })
      );
      
      // Small delay to ensure client has time to process the card reset
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Next, send the new card data
      await safeOperation(() =>
        room.collection('player').update(player.id, {
          current_card: selectedCard,
          current_deck_name: selectedDeckName,
          current_deck_id: selectedDeckId,
          card_duration: randomDuration,
          distribution_pending: false,
          distribution_id: distributionId,
          ready_for_card: false,
          waiting_for_player_ack: true, // Flag for conductor to know player hasn't acknowledged yet
          card_sent_at: new Date().toISOString(),
          force_render: Date.now(), // Add timestamp to force UI refresh
        })
      );
      
      console.log(`[${APP_VERSION}] Card distributed to ${player.name}, duration=${randomDuration}s, id=${distributionId}`);
      
      // Update the local player list to reflect the change
      setPlayers(prevPlayers => {
        return prevPlayers.map(p => {
          if (p.id === player.id) {
            return {
              ...p,
              current_card: selectedCard,
              current_deck_name: selectedDeckName,
              current_deck_id: selectedDeckId,
              card_duration: randomDuration,
              distribution_pending: false,
              distribution_id: distributionId,
              needs_sync: true,
              ready_for_card: false,
              waiting_for_player_ack: true,
              card_sent_at: new Date().toISOString(),
            };
          }
          return p;
        });
      });
      
      return true;
    } catch (error) {
      console.error(`[${APP_VERSION}] Error distributing card to ${player.name}:`, error);
      // Try to clear the distribution_pending flag if there was an error
      try {
        await safeOperation(() =>
          room.collection('player').update(player.id, {
            distribution_pending: false,
            card_error: true,
            error_message: error.message
          })
        );
      } catch (e) {
        console.error(`[${APP_VERSION}] Could not clear distribution_pending flag:`, e);
      }
      return false;
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

  // Auto-distribute cards to players with expired timers or stuck players
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
        // Check for players with expired cards or stuck in distribution
        const now = Date.now();
        
        // Force refresh player list to ensure we have the latest state
        try {
          const updatedPlayers = await safeOperation(() =>
            room.collection('player').filter({ session_pin: pin }).getList()
          );
          if (updatedPlayers && updatedPlayers.length > 0) {
            setPlayers(updatedPlayers);
          }
        } catch (err) {
          console.error(`[${APP_VERSION}] Error refreshing players in auto-distribute:`, err);
        }
        
        const playersNeedingCards = players.filter(player => {
          // Skip players without cards or with END signal
          if (!player.current_card || player.current_card === 'END') {
            return true; // New players or players who just joined need cards
          }
          
          // Check for stuck distribution
          if (player.distribution_pending === true) {
            const lastAttemptTime = player.last_distribution_attempt || player.card_start_time;
            if (lastAttemptTime) {
              const timeSinceAttempt = now - new Date(lastAttemptTime).getTime();
              // If it's been more than 5 seconds since we tried to distribute a card
              if (timeSinceAttempt > 5000) return true;
            }
          }
          
          // Check if player has explicitly requested a new card
          if (player.ready_for_card === true) {
            return true;
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
          console.log(`[${APP_VERSION}] Auto-distributing cards to ${playersNeedingCards.length} players:`, 
            playersNeedingCards.map(p => p.name).join(', '));
          
          for (const player of playersNeedingCards) {
            await distributeCardToPlayer(player);
            // Small delay between distributions to avoid overwhelming server
            await new Promise(resolve => setTimeout(resolve, 300));
          }
          
          // Force refresh player list to show updated cards
          setTimeout(refreshPlayerList, 1000);
        }
      }, 2000); // Check every 2 seconds for better responsiveness
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
                
                for (const player of players) {
                  const success = await distributeCardToPlayer(player);
                  if (success) successCount++;
                }

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

                setTimeout(refreshPlayerList, 1000);
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
            {players.map(player => (
              <div key={player.id} className="player-card-mini">
                <div className="player-name">{player.name}</div>
                {player.current_card && player.current_card !== 'END' ? (
                  <div className="player-current-card">
                    <div className="card-text-mini">{player.current_card}</div>
                    <div className="card-source">
                      From: {player.current_deck_name || "Unknown"}
                    </div>
                    <div className="card-status">
                      {player.waiting_for_player_ack ? 
                        <span className="status-waiting">Sending...</span> : 
                        <span className="status-active">Active</span>
                      }
                    </div>
                  </div>
                ) : player.current_card === 'END' ? (
                  <div className="player-card-ended">Session Ended</div>
                ) : (
                  <div className="player-card-waiting">Waiting for card</div>
                )}
                <button 
                  className="player-action-btn"
                  onClick={() => distributeCardToPlayer(player)}
                >
                  Send Card
                </button>
              </div>
            ))}
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