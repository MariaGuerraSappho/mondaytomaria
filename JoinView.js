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