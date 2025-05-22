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

