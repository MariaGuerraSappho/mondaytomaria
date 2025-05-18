// App Version for tracking
const APP_VERSION = "1.21.0";

const { useState, useEffect, useRef, useMemo } = React;
const { createRoot } = ReactDOM;

let room;
try {
  room = new WebsimSocket();
  console.log(`[${APP_VERSION}] WebsimSocket initialized successfully`);
} catch (err) {
  console.error(`[${APP_VERSION}] Error initializing WebsimSocket:`, err);
  room = new WebsimSocket();
}

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
