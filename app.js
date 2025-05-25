// App version
const APP_VERSION = "2.27.0";

const { useState, useEffect } = React;
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

function App() {
  const [view, setView] = useState('home');
  const [playerData, setPlayerData] = useState({ pin: '', name: '', playerId: localStorage.getItem('playerId') || '' });

  useEffect(() => {
    const loadingElement = document.getElementById('loading');
    if (loadingElement) {
      loadingElement.style.display = 'none';
    }
    
    console.log(`[${APP_VERSION}] App initialized, checking URL parameters`);

    try {
      const params = new URLSearchParams(window.location.search);
      const pinParam = params.get('pin');

      if (pinParam) {
        console.log(`[${APP_VERSION}] Found PIN in URL: ${pinParam}`);
        setPlayerData(prev => ({ ...prev, pin: pinParam }));
        setView('join');
      }
    } catch (error) {
      console.error('Error processing URL parameters:', error);
    }
  }, []);

  const handleNavigate = (to, data = {}) => {
    console.log(`[${APP_VERSION}] Navigating to: ${to}`, data);
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