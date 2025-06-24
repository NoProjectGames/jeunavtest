import React, { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';

const socket = io('https://jeunavtest.onrender.com');

const NB_PLAYERS = 8;
const BASE_VIEW_RATIO = 0.7;
const BUILDINGS = [
  { name: 'Lance Missile', icon: '🚀', cost: 50000 },
  { name: 'Crypto Farm', icon: '💻', cost: 25000 },
  { name: 'Château', icon: '🏛️', cost: 35000 },
  { name: 'Antimissile', icon: '��️', cost: 20000 },
  { name: 'Usine de Drones', icon: '🤖', cost: 55000 },
];
const INITIAL_RESOURCES = { gold: 30000, wood: 50, stone: 50, population: 10, populationMax: 20, cryptoPerSec: 1000 };
const BASE_GOLD_PER_SEC = 1000;
const CRYPTO_FARM_BONUS = 5000;
const BASE_POP_PER_SEC = 0.1;
const CHATEAU_POP_BONUS = 5;
const SOLDIER_SPEED = 5;
const SOLDIER_PROD_TIME = 3000;
const SOLDIER_SIZE = 22;
const SOLDIER_RANGE = 60;
const SOLDIER_FIRE_RATE = 1000;
const EDGE_ZONE = 60;
const CAMERA_SPEED = 20;

// Palette de couleurs pales pour chaque joueur
const PLAYER_COLORS = [
  '#4a90e2', // Bleu pâle (vous)
  '#e24a4a', // Rouge pâle
  '#4ae24a', // Vert pâle
  '#e2e24a', // Jaune pâle
  '#e24ae2', // Magenta pâle
  '#4ae2e2', // Cyan pâle
  '#e2a54a', // Orange pâle
  '#a54ae2'  // Violet pâle
];

function getPlayerIndex(players, myId, myIndex) {
  if (myIndex !== null && myIndex !== undefined) return myIndex;
  return players.findIndex(p => p && p.id === myId);
}
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}
function distance(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function App() {
  const [players, setPlayers] = useState([]);
  const [lobbyFull, setLobbyFull] = useState(false);
  const [lastClick, setLastClick] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [gameStarted, setGameStarted] = useState(false);
  const [myId, setMyId] = useState(null);
  const [myIndex, setMyIndex] = useState(null);
  const [buildMenu, setBuildMenu] = useState(null);
  const [pendingBuilding, setPendingBuilding] = useState(null);
  const [buildings, setBuildings] = useState([]);
  const [resources, setResources] = useState(INITIAL_RESOURCES);
  const [missiles, setMissiles] = useState([]);
  const [drones, setDrones] = useState([]);
  const [playerHealth, setPlayerHealth] = useState(Array(8).fill(100));
  const [zoom, setZoom] = useState(1);
  const [zoomCenter, setZoomCenter] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [mapOffset, setMapOffset] = useState({ x: 0, y: 0 });
  const svgRef = useRef();

  const windowWidth = window.innerWidth;
  const svgHeight = 700;
  const SEGMENT_WIDTH = windowWidth / NB_PLAYERS;
  const totalWidth = windowWidth;

  useEffect(() => {
    console.log('Connecting to server...');
    setMyId(socket.id);
    
    socket.on('connect', () => {
      console.log('Connected to server, socket ID:', socket.id);
    });
    
    socket.on('disconnect', () => {
      console.log('Disconnected from server');
    });
    
    socket.on('players_update', (players) => {
      console.log('Players update received:', players);
      setPlayers(players);
    });
    
    socket.on('lobby_full', () => {
      console.log('Lobby is full');
      setLobbyFull(true);
    });
    
    socket.on('countdown', (count) => {
      console.log('Countdown received:', count);
      setCountdown(count);
    });
    
    socket.on('game_started', (gameState) => {
      console.log('🎮 Game started!');
      setGameStarted(true);
      setBuildings(gameState.buildings || []);
      setMissiles(gameState.missiles || []);
      setDrones(gameState.drones || []);
      setPlayerHealth(gameState.playerHealth || Array(8).fill(100));
    });
    
    socket.on('game_reset', (gameState) => {
      console.log('🔄 Game reset!');
      setGameStarted(false);
      setBuildings(gameState.buildings || []);
      setMissiles(gameState.missiles || []);
      setDrones(gameState.drones || []);
      setPlayerHealth(gameState.playerHealth || Array(8).fill(100));
    });
    
    socket.on('countdown_update', (value) => {
      setCountdown(value);
    });
    
    socket.on('your_index', (index) => {
      console.log('Received my index:', index);
      setMyIndex(index);
    });
    
    // Réception des mises à jour des bâtiments
    socket.on('buildings_update', (buildings) => {
      console.log('Buildings update received:', buildings);
      setBuildings(buildings);
    });
    
    // Réception des mises à jour des missiles
    socket.on('missiles_update', (newMissiles) => {
      console.log('Missiles update received:', newMissiles.length, 'missiles');
      // Log les positions des premiers missiles pour debug
      if (newMissiles.length > 0) {
        console.log('First 3 missiles positions:', newMissiles.slice(0, 3).map(m => `ID:${m.id} x:${m.x} y:${m.y} dir:${m.direction}`));
      }
      setMissiles(newMissiles);
    });
    
    // Réception des mises à jour de la vie
    socket.on('health_update', (newHealth) => {
      console.log('Health update received:', newHealth);
      setPlayerHealth(newHealth);
    });

    socket.on('drones_update', (newDrones) => {
      setDrones(newDrones);
    });
    
    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('players_update', setPlayers);
      socket.off('lobby_full');
      socket.off('countdown', setCountdown);
      socket.off('game_started');
      socket.off('game_reset');
      socket.off('countdown_update');
      socket.off('your_index', setMyIndex);
      socket.off('buildings_update', setBuildings);
      socket.off('missiles_update', setMissiles);
      socket.off('health_update', setPlayerHealth);
      socket.off('drones_update', setDrones);
    };
  }, []);

  const mySlot = getPlayerIndex(players, myId, myIndex);
  const baseX = mySlot * SEGMENT_WIDTH;

  // Gain d'or (crypto) et de population chaque seconde
  useEffect(() => {
    if (!gameStarted) return;
    const interval = setInterval(() => {
      setResources(prev => {
        const myBuildings = buildings.filter(b => b.x >= baseX && b.x < baseX + SEGMENT_WIDTH);
        const nbCryptoFarms = myBuildings.filter(b => b.name === 'Crypto Farm').length;
        const nbChateaux = myBuildings.filter(b => b.name === 'Château').length;
        const goldGain = BASE_GOLD_PER_SEC + nbCryptoFarms * CRYPTO_FARM_BONUS;
        let newPop = prev.population;
        if (prev.population < prev.populationMax) {
          newPop = clamp(prev.population + BASE_POP_PER_SEC, 0, prev.populationMax);
        }
        const newPopMax = INITIAL_RESOURCES.populationMax + nbChateaux * CHATEAU_POP_BONUS;
        return {
          ...prev,
          gold: prev.gold + goldGain,
          population: newPop,
          populationMax: newPopMax,
          cryptoPerSec: goldGain, // Stocker la production par seconde
        };
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [gameStarted, buildings, baseX]);

  function handleMapClick(e) {
    if (!gameStarted) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;
    if (pendingBuilding) {
      // Vérifier que le clic est dans la zone de construction (zone grise)
      const mapTop = svgHeight * 0.2;
      const mapBottom = svgHeight * 0.8;
      
      if (mySlot < 0 || x < baseX || x >= baseX + SEGMENT_WIDTH || y < mapTop || y > mapBottom) {
        setLastClick({ x: Math.round(x), y: Math.round(y), error: true });
        return;
      }
      
      // Vérifier si le joueur a assez de crypto pour construire
      if (resources.gold < pendingBuilding.cost) {
        setLastClick({ x: Math.round(x), y: Math.round(y), error: true });
        return;
      }
      
      // Créer le bâtiment avec l'information du propriétaire
      const building = { x, y, ...pendingBuilding, ownerSlot: mySlot };
      
      // Déduire le coût du bâtiment des ressources
      setResources(prev => ({
        ...prev,
        gold: prev.gold - pendingBuilding.cost
      }));
      
      // Envoyer le bâtiment au serveur
      socket.emit('place_building', building);
      
      setPendingBuilding(null);
      setLastClick({ x: Math.round(x), y: Math.round(y), error: false });
    } else {
      setBuildMenu({ x: e.clientX, y: e.clientY });
      setLastClick({ x: Math.round(x), y: Math.round(y), error: false });
    }
  }

  function handleBuildingSelect(building) {
    setBuildMenu(null);
    setPendingBuilding(building);
  }
  function handleCloseMenu() {
    setBuildMenu(null);
    setPendingBuilding(null);
  }

  // Gestion du zoom avec la molette de la souris
  function handleWheel(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Calculer le centre du zoom relatif au SVG
    const zoomCenterX = (mouseX / rect.width) * 100;
    const zoomCenterY = (mouseY / rect.height) * 100;
    
    const zoomSpeed = 0.15;
    const delta = e.deltaY > 0 ? -zoomSpeed : zoomSpeed;
    const newZoom = Math.max(0.3, Math.min(4, zoom + delta));
    
    setZoom(newZoom);
    setZoomCenter({ x: zoomCenterX, y: zoomCenterY });
  }

  // Gestion du déplacement avec le clic droit
  function handleMouseDown(e) {
    if (e.button === 2) { // Clic droit
      e.preventDefault();
      setIsDragging(true);
      setDragStart({ x: e.clientX - mapOffset.x, y: e.clientY - mapOffset.y });
    }
  }

  function handleMouseMove(e) {
    if (isDragging) {
      e.preventDefault();
      setMapOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  }

  function handleMouseUp(e) {
    if (e.button === 2) { // Clic droit
      setIsDragging(false);
    }
  }

  // Empêcher le menu contextuel du clic droit
  function handleContextMenu(e) {
    e.preventDefault();
  }

  return (
    <div
      style={{ textAlign: 'center', width: '100vw', height: '100vh', margin: 0, padding: 0, overflow: 'hidden', background: '#222' }}
    >
      <h1 style={{ color: '#fff', margin: 0, padding: 10 }}>RTS Navigateur.io</h1>
      {/* Fenêtre ressources */}
      <div style={{
        position: 'fixed',
        left: 20,
        bottom: 20,
        background: 'rgba(30,40,60,0.97)',
        color: '#fff',
        borderRadius: 12,
        boxShadow: '0 2px 12px #0007',
        padding: '18px 22px 14px 18px',
        minWidth: 180,
        zIndex: 2000,
        fontSize: 18,
        textAlign: 'left',
        border: '2px solid #4a90e2',
      }}>
        <div style={{fontWeight:'bold',fontSize:20,marginBottom:8}}>Ressources</div>
        <div>💰 Crypto : <b>{resources.gold}</b> (+{resources.cryptoPerSec || BASE_GOLD_PER_SEC}/s)</div>
        <div>🌲 Bois : <b>{resources.wood}</b></div>
        <div>🪨 Pierre : <b>{resources.stone}</b></div>
        <div style={{marginTop:6}}>👥 Population : <b>{resources.population}</b> / {resources.populationMax}</div>
      </div>
      {lobbyFull ? (
        <div style={{ color: 'red' }}>Lobby plein, réessayez plus tard.</div>
      ) : (
        <>
          {countdown && !gameStarted && (
            <div style={{ color: '#ffeb3b', fontSize: 32, margin: 10 }}>
              La partie commence dans : {countdown}
            </div>
          )}
          {gameStarted && (
            <div style={{ color: '#4caf50', fontSize: 28, margin: 10 }}>
              Partie lancée !
            </div>
          )}
          <div style={{ width: '100vw', overflow: 'hidden', position: 'relative' }}>
            <div style={{ 
              width: '100vw', 
              height: '80vh', 
              overflow: 'hidden', 
              position: 'relative',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center'
            }}>
              <svg
                ref={svgRef}
                width={totalWidth}
                height={svgHeight}
                style={{
                  display: 'block',
                  background: '#181818',
                  borderRadius: 20,
                  boxShadow: '0 0 30px #000a',
                  cursor: isDragging ? 'grabbing' : (pendingBuilding ? 'crosshair' : 'grab'),
                  transform: `scale(${zoom}) translate(${mapOffset.x / zoom}px, ${mapOffset.y / zoom}px)`,
                  transformOrigin: `${zoomCenter.x}% ${zoomCenter.y}%`,
                }}
                onClick={handleMapClick}
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onContextMenu={handleContextMenu}
              >
                {/* Route principale */}
                <rect x={0} y={svgHeight * 0.2} width={totalWidth} height={svgHeight * 0.6} fill="#e0e0e0" rx={30} />
                {/* Segments et bases */}
                {Array.from({ length: NB_PLAYERS }).map((_, segIdx) => {
                  const x = segIdx * SEGMENT_WIDTH;
                  const player = players[segIdx];
                  const isMe = segIdx === mySlot;
                  return (
                    <g key={segIdx}>
                      {/* Séparateur */}
                      {segIdx > 0 && (
                        <line x1={x} y1={svgHeight * 0.2} x2={x} y2={svgHeight * 0.8} stroke="#aaa" strokeWidth={3} />
                      )}
                      {/* Barre verticale pour représenter le joueur */}
                      <g>
                        {/* Barre de fond (vie perdue) */}
                        <rect
                          x={x + SEGMENT_WIDTH / 2 - 8}
                          y={svgHeight * 0.2}
                          width={16}
                          height={svgHeight * 0.6}
                          fill={player ? '#333' : '#666'}
                          stroke="none"
                          rx={4}
                        />
                        {/* Barre de vie (vie restante) */}
                        <rect
                          x={x + SEGMENT_WIDTH / 2 - 8}
                          y={svgHeight * 0.2 + (svgHeight * 0.6) * (1 - playerHealth[segIdx] / 100)}
                          width={16}
                          height={(svgHeight * 0.6) * (playerHealth[segIdx] / 100)}
                          fill={player ? PLAYER_COLORS[segIdx] : '#999'}
                          stroke="none"
                          rx={4}
                        />
                        <text
                          x={x + SEGMENT_WIDTH / 2}
                          y={svgHeight * 0.52}
                          textAnchor="middle"
                          fontSize={20}
                          fontWeight="bold"
                          fill={player ? '#fff' : '#888'}
                        >
                          {`P${segIdx + 1}`}
                        </text>
                        {/* Affichage de la vie en pourcentage */}
                        <text
                          x={x + SEGMENT_WIDTH / 2}
                          y={svgHeight * 0.85}
                          textAnchor="middle"
                          fontSize={14}
                          fontWeight="bold"
                          fill={player ? '#fff' : '#888'}
                        >
                          {`${playerHealth[segIdx]}%`}
                        </text>
                      </g>
                    </g>
                  );
                })}
                {/* Bâtiments placés */}
                {buildings.map((b, i) => (
                  <g key={i}>
                    {/* Cercle de portée pour les antimissiles */}
                    {b.name === 'Antimissile' && (
                      <circle
                        cx={b.x}
                        cy={b.y}
                        r={50}
                        fill="none"
                        stroke={PLAYER_COLORS[b.ownerSlot] || '#999'}
                        strokeWidth={1}
                        strokeDasharray="5,5"
                        opacity={0.3}
                      />
                    )}
                    <text
                      x={b.x}
                      y={b.y}
                      fontSize={24 / 2.5}
                      textAnchor="middle"
                      alignmentBaseline="middle"
                      style={{ 
                        pointerEvents: 'none',
                        filter: `drop-shadow(0 0 8px ${PLAYER_COLORS[b.ownerSlot] || '#999'})`
                      }}
                      fill={PLAYER_COLORS[b.ownerSlot] || '#999'}
                    >
                      {b.icon}
                    </text>
                  </g>
                ))}
                
                {/* Missiles */}
                {missiles.map((missile, i) => (
                  <circle
                    key={`missile-${missile.id}`}
                    cx={missile.x}
                    cy={missile.y}
                    r={3}
                    fill={PLAYER_COLORS[missile.ownerSlot]}
                    stroke="white"
                    strokeWidth={1}
                  />
                ))}
                
                {/* Drones */}
                {drones.map((drone, i) => {
                  // Calculer l'angle vers la cible
                  const dx = drone.targetX - drone.x;
                  const dy = drone.targetY - drone.y;
                  const angle = Math.atan2(dy, dx);
                  
                  // Points du triangle (pointe vers la droite par défaut)
                  const size = 6;
                  const points = [
                    `${drone.x + size * Math.cos(angle)},${drone.y + size * Math.sin(angle)}`,
                    `${drone.x + size * Math.cos(angle + 2.6)},${drone.y + size * Math.sin(angle + 2.6)}`,
                    `${drone.x + size * Math.cos(angle - 2.6)},${drone.y + size * Math.sin(angle - 2.6)}`
                  ].join(' ');
                  
                  return (
                    <polygon
                      key={`drone-${drone.id}`}
                      points={points}
                      fill={PLAYER_COLORS[drone.ownerSlot]}
                      stroke="white"
                      strokeWidth={1}
                    />
                  );
                })}
                
                {/* Fantôme du bâtiment à placer */}
                {pendingBuilding && lastClick && (
                  <text
                    x={lastClick.x}
                    y={lastClick.y}
                    fontSize={24 / 2.5}
                    textAnchor="middle"
                    alignmentBaseline="middle"
                    opacity={0.5}
                    style={{ pointerEvents: 'none' }}
                  >
                    {pendingBuilding.icon}
                  </text>
                )}
                {/* Point rouge pour debug clic */}
                {lastClick && (
                  <circle cx={lastClick.x} cy={lastClick.y} r={8 / 2.5} fill={lastClick.error ? "orange" : "#e53935"} stroke="#fff" strokeWidth={2 / 2.5} />
                )}
              </svg>
            </div>
            {/* Menu de construction */}
            {buildMenu && (
              <div
                style={{
                  position: 'fixed',
                  left: buildMenu.x,
                  top: buildMenu.y,
                  background: '#fff',
                  border: '2px solid #4a90e2',
                  borderRadius: 10,
                  boxShadow: '0 4px 16px #0006',
                  zIndex: 1000,
                  padding: 10,
                  minWidth: 200,
                }}
                onClick={e => e.stopPropagation()}
              >
                <div style={{fontWeight:'bold',marginBottom:8}}>Construire :</div>
                {BUILDINGS.map(b => {
                  const canAfford = resources.gold >= b.cost;
                  return (
                    <div
                      key={b.name}
                      style={{
                        cursor: canAfford ? 'pointer' : 'not-allowed',
                        padding: '8px 10px',
                        borderRadius: 6,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        fontSize: 16,
                        backgroundColor: canAfford ? 'transparent' : '#f0f0f0',
                        color: canAfford ? '#000' : '#999',
                        border: canAfford ? 'none' : '1px solid #ddd'
                      }}
                      onClick={() => canAfford && handleBuildingSelect(b)}
                    >
                      <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                        <span>{b.icon}</span>
                        <span>{b.name}</span>
                      </div>
                      <div style={{
                        fontSize: 14,
                        color: canAfford ? (resources.gold >= b.cost ? '#4caf50' : '#ff9800') : '#999',
                        fontWeight: 'bold'
                      }}>
                        {b.cost.toLocaleString()}
                      </div>
                    </div>
                  );
                })}
                <div
                  style={{marginTop:8,textAlign:'right',fontSize:13,cursor:'pointer',color:'#888'}}
                  onClick={handleCloseMenu}
                >Annuler</div>
              </div>
            )}
            {/* Indication de placement */}
            {pendingBuilding && (
              <div style={{position:'fixed',left:0,right:0,bottom:30,textAlign:'center',color:'#fff',fontSize:20,zIndex:1001}}>
                Cliquez sur la map pour placer : <span style={{fontWeight:'bold'}}>{pendingBuilding.icon} {pendingBuilding.name}</span>
              </div>
            )}
          </div>
        </>
      )}
      <div style={{ marginTop: 20, color: '#fff' }}>
        <b>Joueurs connectés :</b> {players.filter(Boolean).length} / 8
      </div>
      {lastClick && (
        <div style={{ marginTop: 10, color: '#ff5722' }}>
          Clic sur la map : x={lastClick.x}, y={lastClick.y}
        </div>
      )}
      {/* Debug info */}
      <div style={{ marginTop: 10, color: '#fff', fontSize: 12 }}>
        Debug: mySlot={mySlot}, baseX={baseX}, SEGMENT_WIDTH={SEGMENT_WIDTH}, totalWidth={totalWidth}
      </div>
      <div style={{ marginTop: 5, color: '#fff', fontSize: 12 }}>
        Connection: socket.id={socket.id}, myId={myId}, myIndex={myIndex}, connected={socket.connected}
      </div>
      <div style={{ marginTop: 5, color: '#fff', fontSize: 12 }}>
        Zoom: {zoom.toFixed(2)}x (Utilisez la molette de la souris pour zoomer)
      </div>
      {/* Debug info for missiles */}
      <div style={{ marginTop: 5, color: '#fff', fontSize: 12 }}>
        Missiles: {missiles.length} total
      </div>
      {missiles.length > 0 && (
        <div style={{ marginTop: 5, color: '#4a90e2', fontSize: 10, maxHeight: '60px', overflow: 'auto' }}>
          Missile positions: {missiles.slice(0, 5).map(m => `(${Math.round(m.x)},${Math.round(m.y)})`).join(', ')}
          {missiles.length > 5 && ` ... and ${missiles.length - 5} more`}
        </div>
      )}
      <div className="game-controls">
        <button 
          onClick={() => socket.emit('start_countdown')}
          disabled={gameStarted || countdown !== null}
          className="start-button"
        >
          {countdown !== null ? `Démarrage dans ${countdown}s` : 'Démarrer le jeu'}
        </button>
        
        <button 
          onClick={() => socket.emit('reset_game')}
          className="reset-button"
        >
          Réinitialiser
        </button>
      </div>
    </div>
  );
}

export default App;
