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