import React, { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';

const socket = io('https://jeunavtest.onrender.com'); //https://jeunavtest.onrender.com //http://localhost:3001

const NB_PLAYERS = 8;
const BASE_VIEW_RATIO = 0.7;
const BUILDINGS = [
  { name: 'Lance Missile', icon: '🚀', cost: 50000 },
  { name: 'Crypto Farm', icon: '💻', cost: 25000 },
  { name: 'Château', icon: '🏛️', cost: 35000 },
  { name: 'Antimissile', icon: '🛡️', cost: 20000 },
  { name: 'Usine de Drones', icon: '🤖', cost: 55000 },
  { name: 'Centre Médical', icon: '🏥', cost: 100000 },
  { name: 'Bombardement aérien', icon: '🛩️', cost: 150000 },
  { name: 'Serveur', icon: '🖥️', cost: 75000 },
];
const INITIAL_RESOURCES = { gold: 30000, datas: 100000, population: 10, populationMax: 20, cryptoPerSec: 1000, datasPerSec: 20000 };
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

const MISSILE_TYPES = [
  { type: 'lourd', label: 'Missile lourd', cost: 100000, speed: 2, damage: 5, color: '#b71c1c', radius: 7 },
  { type: 'rapide', label: 'Missile rapide', cost: 10000, speed: 7, damage: 1, color: '#1976d2', radius: 3 },
  { type: 'furtif', label: 'Missile furtif', cost: 50000, speed: 4, damage: 2, color: '#616161', radius: 5 }
];

// --- Standardisation des coordonnées ---
// Toutes les coordonnées sont exprimées sur une largeur de carte fixe (MAP_WIDTH)
// pour garantir la cohérence entre clients et serveur, peu importe la taille d'écran.
const MAP_WIDTH = 1920;

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}
function distance(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function App() {
  // alert('HELLO FROM APP');
  console.log('TEST LOG');
  console.log('[APP] render');
  const [players, setPlayers] = useState([]);
  const [lobbyFull, setLobbyFull] = useState(false);
  const [lastClick, setLastClick] = useState(null);
  const [countdown, setCountdown] = useState(null);
  const [gameStarted, setGameStarted] = useState(false);
  const [myId, setMyId] = useState(null);
  const [myIndex, setMyIndex] = useState(null);
  const [mySlot, setMySlot] = useState(null);
  const [buildMenu, setBuildMenu] = useState(null);
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
  const [inLobby, setInLobby] = useState(true);
  const [pseudo, setPseudo] = useState("");
  const [sessionList, setSessionList] = useState([]); // Liste des sessions
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [sessionName, setSessionName] = useState(""); // Pour créer une session
  const [sessionId, setSessionId] = useState(null); // Id de la session rejointe
  const [joining, setJoining] = useState(false); // Pour désactiver les boutons pendant la connexion
  const [segmentsByPlayer, setSegmentsByPlayer] = useState({});
  const [forceUpdate, setForceUpdate] = useState(0);
  const [missileMenu, setMissileMenu] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [lastMissileType, setLastMissileType] = useState(null); // Pour mémoriser le dernier type sélectionné
  const [pendingAirStrike, setPendingAirStrike] = useState(false);
  const [airStrikeAnimation, setAirStrikeAnimation] = useState(false);
  const [airStrikeData, setAirStrikeData] = useState(null);
  const [explosionAnimation, setExplosionAnimation] = useState(false);
  const [showBlackMarket, setShowBlackMarket] = useState(false);

  const svgHeight = 700;
  const SEGMENT_WIDTH = MAP_WIDTH / NB_PLAYERS;
  const totalWidth = MAP_WIDTH;

  const baseX = mySlot * SEGMENT_WIDTH;

  // Correction : initialisation locale de segmentsByPlayer si vide
  const effectiveSegmentsByPlayer = Object.keys(segmentsByPlayer).length > 0
    ? segmentsByPlayer
    : (mySlot !== null && mySlot >= 0 ? { [mySlot]: mySlot } : {});

  // Calcul de effectiveMySlot en dehors du useEffect
  const effectiveMySlot = mySlot;

  useEffect(() => {
    console.log('Connecting to server...');
    setMyId(socket.id);
    
    socket.on('connect', () => {
      console.log('Connected to server, socket ID:', socket.id);
      console.log('🔍 Socket info - sessionId:', socket.sessionId, 'playerIndex:', socket.playerIndex);
      
      // Test de connexion : envoyer un événement de test
      socket.emit('test_connection', { message: 'Test from client' });
    });
    
    socket.on('disconnect', () => {
      console.log('Disconnected from server');
    });
    
    // Test de réponse du serveur
    socket.on('test_response', (data) => {
      console.log('✅ Test response reçu du serveur:', data);
    });
    
    socket.on('players_update', (players) => {
      console.log('👥 players_update reçu:', JSON.stringify(players, null, 2));
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
      setResources(INITIAL_RESOURCES);
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
      console.log('📥 Received my index:', index);
      setMyIndex(index);
      setMySlot(index);
    });
    
    // Réception des mises à jour des bâtiments
    socket.on('buildings_update', (buildings) => {
      console.log('🏗️ buildings_update reçu:', buildings.length, 'bâtiments');
      console.log('🏗️ Détails des bâtiments:', buildings.map(b => ({id: b.id, name: b.name, x: b.x, y: b.y, ownerSlot: b.ownerSlot})));
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
    
    // Gestion des sessions (nouveau)
    socket.on('sessions_list', (list) => {
      console.log('sessions_list reçu:', list);
      setSessionList(list);
      setSessionLoading(false);
    });
    
    socket.on('segments_update', (segmentsArr) => {
      // segmentsArr: [{ownerSlot, segments: [segIdx, ...]}, ...]
      const map = {};
      segmentsArr.forEach(({ownerSlot, segments}) => {
        segments.forEach(seg => {
          map[seg] = ownerSlot;
        });
      });
      setSegmentsByPlayer(map);
    });
    
    socket.on('resources_update', (data) => {
      console.log('📊 resources_update reçu:', data);
      console.log('🔍 Debug - mySlot:', mySlot, 'myIndex:', myIndex, 'socket.id:', socket.id);
      
      // Solution de secours : si mySlot n'est pas défini mais qu'on reçoit des resources_update,
      // on peut déduire qu'on est le joueur qui reçoit ces mises à jour
      if (mySlot === null && socket.playerIndex !== undefined) {
        console.log('🆘 Solution de secours : définition de mySlot basé sur socket.playerIndex:', socket.playerIndex);
        setMySlot(socket.playerIndex);
        setMyIndex(socket.playerIndex);
      }
      
      if (typeof data.gold === 'number') {
        console.log('💰 Mise à jour gold:', data.gold);
        setResources(prev => ({ ...prev, gold: data.gold }));
      }
      if (typeof data.datas === 'number') {
        console.log('💾 Mise à jour datas:', data.datas);
        setResources(prev => ({ ...prev, datas: data.datas }));
      }
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
      socket.off('sessions_list');
      socket.off('segments_update');
    };
  }, []);

  useEffect(() => {
    // Envoie le pseudo et l'index au serveur
    if (!inLobby && pseudo.trim() && myIndex !== null) {
      socket.emit('set_pseudo', { pseudo, index: myIndex });
    }
  }, [inLobby, pseudo, myIndex]);

  // Gain d'or (crypto) et de population chaque seconde
  useEffect(() => {
    console.log('[PROD] useEffect called, gameStarted:', gameStarted, 'buildings.length:', buildings.length);
    if (!gameStarted) {
      console.log('[PROD] Game not started, returning');
      return;
    }
    
    // Si effectiveMySlot est null, on ne peut pas calculer la production
    if (effectiveMySlot === null) {
      console.log('[PROD] effectiveMySlot is null, cannot calculate production');
      return;
    }
    
    console.log('[PROD] Game started, setting up production interval');
    
    // Solution de secours encore plus agressive : si mySlot est null, on utilise 0 par défaut
    // car d'après les logs serveur, le client a toujours playerIndex: 0
    console.log('[PROD] effectiveMySlot utilisé:', effectiveMySlot, '(mySlot:', mySlot, ', socket.playerIndex:', socket.playerIndex, ')');
    
    const interval = setInterval(() => {
      console.log('[PROD] setResources called');
      // Utilise directement les states
      const SEGMENT_WIDTH_LOCAL = MAP_WIDTH / NB_PLAYERS;
      let mySegments = Object.entries(effectiveSegmentsByPlayer)
        .filter(([segIdx, owner]) => owner === effectiveMySlot)
        .map(([segIdx]) => parseInt(segIdx));
      // Correction : si aucun segment trouvé, prendre le segment d'origine
      if (mySegments.length === 0 && effectiveMySlot !== null) {
        mySegments = [effectiveMySlot];
      }
      const myBuildings = buildings.filter(b => {
        const segIdx = Math.floor(b.x / SEGMENT_WIDTH_LOCAL);
        return mySegments.includes(segIdx);
      });
      const nbCryptoFarms = myBuildings.filter(b => b.name === 'Crypto Farm').length;
      const nbChateaux = myBuildings.filter(b => b.name === 'Château').length;
      const nbServeurs = myBuildings.filter(b => b.name === 'Serveur').length;
      const goldGain = BASE_GOLD_PER_SEC + nbCryptoFarms * CRYPTO_FARM_BONUS;
      const datasGain = 20000 + nbServeurs * 10000; // 20k base + 10k par Serveur
      // Log debug
      console.log('[PROD][DEBUG] mySegments utilisés pour la prod:', mySegments);
      console.log('[PROD][DEBUG] Bâtiments pris en compte:', myBuildings.map(b => `${b.name} (P${b.ownerSlot})`));
      setResources(prev => {
        let newPop = prev.population;
        if (prev.population < prev.populationMax) {
          newPop = clamp(prev.population + BASE_POP_PER_SEC, 0, prev.populationMax);
        }
        const newPopMax = INITIAL_RESOURCES.populationMax + nbChateaux * CHATEAU_POP_BONUS;
        const newGold = prev.gold + goldGain;
        const newDatas = prev.datas + datasGain;
        return {
          ...prev,
          gold: newGold,
          datas: newDatas,
          population: newPop,
          populationMax: newPopMax,
          cryptoPerSec: goldGain, // Stocker la production par seconde
          datasPerSec: datasGain, // Stocker la production de datas par seconde
        };
      });
      setForceUpdate(f => f + 1); // Force un re-render
    }, 1000);

    return () => clearInterval(interval);
  }, [gameStarted, buildings, effectiveMySlot, socket.playerIndex]);

  // Quand on rejoint une session, reset les états du jeu
  useEffect(() => {
    if (sessionId && !inLobby) {
      setBuildings([]);
      setMissiles([]);
      setDrones([]);
      setPlayerHealth(Array(8).fill(100));
      setCountdown(null);
    }
  }, [sessionId, inLobby]);

  // Ajoute un handler pour le clic sur un Lance Missile
  function handleLanceMissileClick(e, building) {
    console.log('[MISSILE] handleLanceMissileClick called for building:', building.id);
    e.stopPropagation();
    // Vérifie si le joueur a assez de crypto pour le missile le moins cher
    const minCost = Math.min(...MISSILE_TYPES.map(m => m.cost));
    if (resources.gold < minCost) {
      setErrorMsg("Pas assez de crypto pour lancer un missile.");
      setTimeout(() => setErrorMsg(""), 2000);
      return;
    }
    console.log('[MISSILE] Opening missile menu at:', e.clientX, e.clientY);
    setMissileMenu({ x: e.clientX, y: e.clientY, buildingId: building.id });
  }

  // Nouvelle fonction pour tirer un missile immédiatement
  function fireMissile(buildingId, missileType) {
    console.log('[FIRE] fireMissile called:', buildingId, missileType);
    const missileDef = MISSILE_TYPES.find(m => m.type === missileType);
    if (!missileDef) {
      console.log('[FIRE] Missile type not found:', missileType);
      return;
    }
    if (resources.gold < missileDef.cost) {
      setErrorMsg("Pas assez de crypto pour ce missile.");
      setTimeout(() => setErrorMsg(""), 2000);
      return;
    }
    console.log('[FIRE] Firing missile, cost:', missileDef.cost);
    setResources(prev => ({ ...prev, gold: prev.gold - missileDef.cost }));
    socket.emit('launch_missile', {
      fromBuildingId: buildingId,
      missileType: missileDef.type,
      sessionId
    });
    setLastMissileType(missileDef.type);
    console.log('[FIRE] Missile fired successfully');
  }

  function handleMapClickForBuild(e) {
    // S'assurer que SEGMENT_WIDTH est bien défini
    const SEGMENT_WIDTH = MAP_WIDTH / NB_PLAYERS;
    console.log('[CLICK] handleMapClickForBuild called, missileMenu:', missileMenu, 'buildMenu:', buildMenu);
    
    // Fermer le menu des missiles si ouvert
    if (missileMenu) {
      console.log('[CLICK] Closing missile menu');
      setMissileMenu(null);
      return;
    }
    
    // Calculer isEliminated localement
    const isEliminated = mySlot >= 0 && playerHealth[mySlot] === 0;
    
    if (isEliminated) {
      console.log('[CLICK] Player is eliminated, returning');
      return;
    }
    if (!gameStarted) {
      console.log('[CLICK] Game not started, returning');
      return;
    }
    
    // Gestion du bombardement aérien
    if (pendingAirStrike) {
      // Utilisation de getScreenCTM pour une conversion fiable
      const svg = svgRef.current;
      let x, y;
      if (svg && typeof svg.createSVGPoint === 'function') {
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const ctm = svg.getScreenCTM();
        if (ctm) {
          const svgP = pt.matrixTransform(ctm.inverse());
          x = svgP.x;
          y = svgP.y;
        } else {
          // Fallback si getScreenCTM échoue
          const rect = svg.getBoundingClientRect();
          x = ((e.clientX - rect.left) / rect.width) * MAP_WIDTH;
          y = ((e.clientY - rect.top) / rect.height) * svgHeight;
        }
      } else {
        // Fallback pour les navigateurs plus anciens
        const rect = svg.getBoundingClientRect();
        x = ((e.clientX - rect.left) / rect.width) * MAP_WIDTH;
        y = ((e.clientY - rect.top) / rect.height) * svgHeight;
      }
      
      // Déduire le coût du bombardement
      const airStrikeCost = 150000;
      setResources(prev => ({
        ...prev,
        gold: prev.gold - airStrikeCost
      }));
      
      // Démarrer l'animation du bombardement
      const startX = (mySlot * SEGMENT_WIDTH) + (SEGMENT_WIDTH / 2); // Centre du segment du joueur
      const startY = svgHeight * 0.5; // Milieu de la hauteur
      
      setAirStrikeData({
        startX: startX,
        startY: startY,
        targetX: x,
        targetY: y,
        progress: 0
      });
      setAirStrikeAnimation(true);
      setPendingAirStrike(false);
      
      // Animation de 2 secondes
      const animationDuration = 2000; // 2 secondes
      const startTime = Date.now();
      
      const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / animationDuration, 1);
        
        setAirStrikeData(prev => ({
          ...prev,
          progress: progress
        }));
        
        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          // Animation terminée, déclencher l'explosion
          setAirStrikeAnimation(false);
          setExplosionAnimation(true);
          
          // Envoyer le bombardement au serveur
          socket.emit('air_strike', { 
            x: x, 
            y: y, 
            sessionId 
          });
          
          setErrorMsg("Bombardement aérien lancé !");
          setTimeout(() => setErrorMsg(""), 2000);
          
          // Arrêter l'animation d'explosion après 1 seconde
          setTimeout(() => {
            setExplosionAnimation(false);
            setAirStrikeData(null);
          }, 1000);
        }
      };
      
      requestAnimationFrame(animate);
      return;
    }
    
    // Utilisation de getScreenCTM pour une conversion fiable
    const svg = svgRef.current;
    let x, y;
    if (svg && typeof svg.createSVGPoint === 'function') {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const ctm = svg.getScreenCTM();
      if (ctm) {
        const svgP = pt.matrixTransform(ctm.inverse());
        x = svgP.x;
        y = svgP.y;
      } else {
        const rect = svg.getBoundingClientRect();
        x = ((e.clientX - rect.left) / rect.width) * MAP_WIDTH;
        y = ((e.clientY - rect.top) / rect.height) * svgHeight;
      }
    } else {
      const rect = svg.getBoundingClientRect();
      x = ((e.clientX - rect.left) / rect.width) * MAP_WIDTH;
      y = ((e.clientY - rect.top) / rect.height) * svgHeight;
    }
    // Vérifier si le clic est sur la barre de vie
    const segmentStart = mySlot * SEGMENT_WIDTH;
    const segmentCenter = segmentStart + SEGMENT_WIDTH / 2;
    if (x >= segmentCenter - 8 && x <= segmentCenter + 8 && y >= 140 && y <= 560) {
      setErrorMsg("Impossible de construire sur la barre de vie !");
      setTimeout(() => setErrorMsg(""), 2000);
      return;
    }
    
    // Sauvegarder les coordonnées du clic
    setLastClick({ x, y, error: false });
    console.log('[DEBUG CLICK] Clic sur la carte pour construction :', { x, y });
    
    // Vérifier que le clic est dans la zone de construction (zone grise)
    const mapTop = svgHeight * 0.2;
    const mapBottom = svgHeight * 0.8;
    // Trouver le segment cliqué
    const segIdx = Math.floor(x / SEGMENT_WIDTH);
    const ownerSlot = effectiveSegmentsByPlayer[segIdx] !== undefined ? effectiveSegmentsByPlayer[segIdx] : segIdx;
    
    if (mySlot < 0 || ownerSlot !== mySlot || y < mapTop || y > mapBottom) {
      setLastClick({ x: Math.round(x), y: Math.round(y), error: true });
      return;
    }
    
    // Ouvrir le menu de construction
    setBuildMenu({ x: e.clientX, y: e.clientY });
    console.log('[DEBUG CLICK] Menu de construction ouvert');
  }

  function handleBuildingSelect(building) {
    setBuildMenu(null);
    
    // Vérifier si le joueur a assez de crypto pour construire
    if (resources.gold < building.cost) {
      setErrorMsg("Pas assez de crypto pour construire ce bâtiment.");
      setTimeout(() => setErrorMsg(""), 2000);
      return;
    }
    
    // Gestion spéciale pour le bombardement aérien
    if (building.name === 'Bombardement aérien') {
      if (resources.gold < building.cost) {
        setErrorMsg("Pas assez de crypto pour le bombardement aérien.");
        setTimeout(() => setErrorMsg(""), 2000);
        return;
      }
      setPendingAirStrike(true);
      setErrorMsg("Cliquez sur la carte pour choisir la zone de bombardement");
      setTimeout(() => setErrorMsg(""), 3000);
      return;
    }
    if (lastClick && !lastClick.error) {
      const buildingToPlace = { 
        x: lastClick.x, 
        y: lastClick.y, 
        ...building, 
        ownerSlot: mySlot 
      };
      console.log('[DEBUG BUILD] Tentative de construction :', buildingToPlace, '| gold:', resources.gold, '| lastClick:', lastClick);
      setResources(prev => ({
        ...prev,
        gold: prev.gold - building.cost
      }));
      if (playerHealth[buildingToPlace.ownerSlot] === 0) return;
      console.log('🏗️ Envoi place_building au serveur:', { ...buildingToPlace, sessionId });
      socket.emit('place_building', { ...buildingToPlace, sessionId });
    }
  }

  function handleCloseMenu() {
    setBuildMenu(null);
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

  // Log pour debug : voir la structure de players à chaque rendu
  console.log('players for render:', players);

  // Log pour debug : voir la liste des bâtiments à chaque re-render
  console.log('RENDER buildings:', buildings.map(b => b.id));

  // Log pour debug : voir la valeur de gold et de la production à chaque re-render
  console.log('[RENDER] gold:', resources.gold, 'cryptoPerSec:', resources.cryptoPerSec, 'gameStarted:', gameStarted, 'mySlot:', mySlot);

  const isEliminated = mySlot >= 0 && playerHealth[mySlot] === 0;

  // Fonction pour rafraîchir la liste des sessions
  function refreshSessions() {
    setSessionLoading(true);
    socket.emit('list_sessions');
    // Timeout de secours : si pas de réponse en 3s, on débloque
    setTimeout(() => {
      setSessionLoading(false);
    }, 3000);
  }

  // Appel initial de la liste des sessions à l'ouverture du lobby
  useEffect(() => {
    if (inLobby) {
      refreshSessions();
    }
  }, [inLobby]);

  // Fonction pour créer une session
  function handleCreateSession() {
    if (!sessionName.trim()) return;
    setJoining(true);
    socket.emit('create_session', sessionName, (newSessionId) => {
      setSessionId(newSessionId);
      handleJoinSession(newSessionId);
    });
  }

  // Fonction pour rejoindre une session
  function handleJoinSession(id) {
    if (!pseudo.trim()) {
      setSessionError('Veuillez entrer un pseudo.');
      return;
    }
    setJoining(true);
    socket.emit('join_session', { sessionId: id, pseudo }, (res) => {
      if (res && res.error) {
        setSessionError(res.error);
        setJoining(false);
      } else {
        setSessionId(id);
        setMyIndex(res.index);
        setInLobby(false);
        setJoining(false);
        setSessionError("");
      }
    });
  }

  // Fermer le menu des missiles quand on clique en dehors
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (missileMenu) {
        // Vérifier si le clic est en dehors du menu des missiles
        const missileMenuElement = document.querySelector('[data-missile-menu]');
        if (missileMenuElement && !missileMenuElement.contains(e.target)) {
          console.log('[CLICK] Click outside missile menu, closing it');
          setMissileMenu(null);
        }
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [missileMenu]);

  // Ajout : fonction pour calculer le coût dynamique côté client
  function getDynamicBuildingCostClient(buildingName) {
    const myBuildings = buildings.filter(b => b.ownerSlot === mySlot && b.name === buildingName);
    const base = (BUILDINGS.find(b => b.name === buildingName) || {}).cost || 0;
    return base * Math.pow(2, myBuildings.length);
  }

  if (inLobby) {
    return (
      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#222', color: '#fff'}}>
        <h1>Bienvenue sur le jeu !</h1>
        <input
          type="text"
          placeholder="Entrez votre pseudo"
          value={pseudo}
          onChange={e => setPseudo(e.target.value)}
          style={{padding: '10px', fontSize: '1.2em', marginBottom: '20px', borderRadius: '5px', border: 'none'}}
          disabled={joining}
        />
        <div style={{marginBottom: 20}}>
          <button onClick={refreshSessions} disabled={sessionLoading || joining} style={{marginRight: 10}}>🔄 Rafraîchir</button>
        </div>
        <div style={{background:'#333',padding:20,borderRadius:10,minWidth:320}}>
          <h2>Parties disponibles</h2>
          {sessionLoading ? <div>Chargement...</div> : (
            <>
              {sessionList.length === 0 && <div>Aucune partie disponible.</div>}
              <ul style={{listStyle:'none',padding:0}}>
                {sessionList.map(s => (
                  <li key={s.id} style={{marginBottom:10,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                    <span><b>{s.name}</b> ({s.players}/8)</span>
                    <button onClick={() => handleJoinSession(s.id)} disabled={joining || !pseudo.trim() || s.players >= 8} style={{marginLeft:10}}>Rejoindre</button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div style={{marginTop:20}}>
            <input
              type="text"
              placeholder="Nom de la partie"
              value={sessionName}
              onChange={e => setSessionName(e.target.value)}
              style={{padding:'8px',fontSize:'1em',borderRadius:5,border:'none',marginRight:10}}
              disabled={joining}
            />
            <button onClick={handleCreateSession} disabled={joining || !pseudo.trim() || !sessionName.trim()}>
              Créer une partie
            </button>
          </div>
          {sessionError && <div style={{color:'red',marginTop:10}}>{sessionError}</div>}
        </div>
      </div>
    );
  }

  if (isEliminated) {
    return (
      <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100vh',background:'#222',color:'#fff'}}>
        <h1>Vous êtes éliminé !</h1>
        <p>Votre base a été détruite.<br/>Vous ne pouvez plus jouer pour cette partie.</p>
      </div>
    );
  }

  return (
    <div
      style={{ textAlign: 'center', width: '100vw', height: '100vh', margin: 0, padding: 0, overflow: 'hidden', background: '#222' }}
    >
      <h1 style={{ color: '#fff', fontSize: 20, margin: 2, padding: 2, lineHeight: '1.1' }}>RTS Navigateur.io</h1>
      {sessionId && (
        <div style={{color:'#4a90e2',fontWeight:'bold',fontSize:18,marginBottom:8}}>
          Partie : {sessionList.find(s => s.id === sessionId)?.name || sessionId}
        </div>
      )}
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
        <div>💾 Datas : <b>{resources.datas}</b> (+{resources.datasPerSec || INITIAL_RESOURCES.datasPerSec}/s)</div>
        <div>💰 Crypto : <b>{resources.gold}</b> (+{resources.cryptoPerSec || BASE_GOLD_PER_SEC}/s)</div>
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
            null
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
                width={MAP_WIDTH}
                height={svgHeight}
                style={{
                  display: 'block',
                  background: '#181818',
                  borderRadius: 20,
                  boxShadow: '0 0 30px #000a',
                  cursor: isDragging ? 'grabbing' : (pendingAirStrike ? 'crosshair' : 'grab'),
                  transform: `scale(${zoom}) translate(${mapOffset.x / zoom}px, ${mapOffset.y / zoom}px)`,
                  transformOrigin: `${zoomCenter.x}% ${zoomCenter.y}%`,
                  maxWidth: '100vw',
                  height: 'auto',
                  width: '100%'
                }}
                onClick={handleMapClickForBuild}
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onContextMenu={handleContextMenu}
              >
                {/* Route principale */}
                <rect x={0} y={svgHeight * 0.2} width={MAP_WIDTH} height={svgHeight * 0.6} fill="#e0e0e0" rx={30} />
                {/* Segments et bases */}
                {Array.from({ length: NB_PLAYERS }).map((_, segIdx) => {
                  const x = segIdx * SEGMENT_WIDTH;
                  // Déterminer le propriétaire du segment (ownerSlot)
                  const ownerSlot = effectiveSegmentsByPlayer[segIdx] !== undefined ? effectiveSegmentsByPlayer[segIdx] : segIdx;
                  const player = players[ownerSlot];
                  const pseudo = player && typeof player.pseudo === 'string' ? player.pseudo : '';
                  const isMe = ownerSlot === mySlot;
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
                          y={svgHeight * 0.2 + (svgHeight * 0.6) * (1 - playerHealth[ownerSlot] / 100)}
                          width={16}
                          height={(svgHeight * 0.6) * (playerHealth[ownerSlot] / 100)}
                          fill={player ? PLAYER_COLORS[ownerSlot] : '#999'}
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
                          {`P${ownerSlot + 1}`}
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
                          {`${playerHealth[ownerSlot]}%`}
                        </text>
                        {/* Affichage du pseudo sous la vie pour chaque joueur (robuste) */}
                        {pseudo && (
                          <text
                            x={x + SEGMENT_WIDTH / 2}
                            y={pseudo.includes('Bot') ? svgHeight * 0.93 : svgHeight * 0.89}
                            textAnchor="middle"
                            fontSize={14}
                            fontWeight="bold"
                            fill={PLAYER_COLORS[ownerSlot]}
                          >
                            {pseudo}
                          </text>
                        )}
                        {/* Indicateur de bot */}
                        {pseudo && pseudo.includes('Bot') && (
                          <text
                            x={x + SEGMENT_WIDTH / 2}
                            y={svgHeight * 0.89}
                            textAnchor="middle"
                            fontSize={12}
                            fontWeight="bold"
                            fill="#ff6b6b"
                          >
                            🤖 AI
                          </text>
                        )}
                      </g>
                    </g>
                  );
                })}
                {/* Bâtiments placés */}
                {buildings.map((b) => (
                  <g key={b.id + '-' + b.x + '-' + b.y}>
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
                    <circle
                      cx={b.x}
                      cy={b.y}
                      r="8"
                      fill={PLAYER_COLORS[b.ownerSlot] || '#999'}
                      stroke={PLAYER_COLORS[b.ownerSlot] || '#999'}
                      strokeWidth="2"
                    />
                    <text
                      x={b.x}
                      y={b.y}
                      fontSize={24 / 2.5}
                      textAnchor="middle"
                      alignmentBaseline="middle"
                      style={{ 
                        pointerEvents: b.name === 'Lance Missile' ? 'auto' : 'none',
                        filter: `drop-shadow(0 0 8px ${PLAYER_COLORS[b.ownerSlot] || '#999'})`,
                        cursor: b.name === 'Lance Missile' ? 'pointer' : 'default'
                      }}
                      fill={PLAYER_COLORS[b.ownerSlot] || '#999'}
                      onClick={b.name === 'Lance Missile' ? (e) => handleLanceMissileClick(e, b) : undefined}
                    >
                      {b.icon}
                    </text>
                  </g>
                ))}
                
                {/* Animation de l'avion de bombardement */}
                {airStrikeAnimation && airStrikeData && (
                  <g>
                    {/* Trajectoire de l'avion (ligne pointillée) */}
                    <line
                      x1={airStrikeData.startX}
                      y1={airStrikeData.startY}
                      x2={airStrikeData.targetX}
                      y2={airStrikeData.targetY}
                      stroke="#ff8800"
                      strokeWidth="2"
                      strokeDasharray="5,5"
                      opacity="0.6"
                    />
                    
                    {/* Avion en mouvement */}
                    <g
                      transform={`
                        translate(${
                          airStrikeData.startX + (airStrikeData.targetX - airStrikeData.startX) * airStrikeData.progress
                        }, ${
                          airStrikeData.startY + (airStrikeData.targetY - airStrikeData.startY) * airStrikeData.progress
                        })
                        rotate(${
                          Math.atan2(
                            airStrikeData.targetY - airStrikeData.startY,
                            airStrikeData.targetX - airStrikeData.startX
                          ) * 180 / Math.PI
                        })
                      `}
                    >
                      <text
                        x="0"
                        y="0"
                        textAnchor="middle"
                        fontSize="20"
                        fill="#ff8800"
                        fontWeight="bold"
                      >
                        🛩️
                      </text>
                    </g>
                  </g>
                )}
                
                {/* Animation d'explosion */}
                {explosionAnimation && airStrikeData && (
                  <g>
                    {/* Cercle d'explosion qui grandit */}
                    <circle
                      cx={airStrikeData.targetX}
                      cy={airStrikeData.targetY}
                      r="100"
                      fill="none"
                      stroke="#ff4444"
                      strokeWidth="3"
                      opacity="0.8"
                    />
                    
                    {/* Effet d'explosion central */}
                    <circle
                      cx={airStrikeData.targetX}
                      cy={airStrikeData.targetY}
                      r="20"
                      fill="#ff8800"
                      opacity="0.9"
                    >
                      <animate
                        attributeName="r"
                        values="0;30;0"
                        dur="1s"
                        repeatCount="1"
                      />
                      <animate
                        attributeName="opacity"
                        values="1;0"
                        dur="1s"
                        repeatCount="1"
                      />
                    </circle>
                    
                    {/* Icône d'explosion */}
                    <text
                      x={airStrikeData.targetX}
                      y={airStrikeData.targetY + 5}
                      textAnchor="middle"
                      fontSize="24"
                      fill="#ff4444"
                      fontWeight="bold"
                    >
                      💥
                    </text>
                  </g>
                )}
                
                {/* Missiles */}
                {missiles.map((missile, i) => {
                  // Cherche le type de missile pour ajuster la taille
                  const missileDef = MISSILE_TYPES.find(m => m.type === missile.type);
                  const radius = missileDef ? missileDef.radius : 3;
                  return (
                    <circle
                      key={`missile-${missile.id}`}
                      cx={missile.x}
                      cy={missile.y}
                      r={radius}
                      fill={PLAYER_COLORS[missile.ownerSlot]}
                      stroke="white"
                      strokeWidth={1}
                    />
                  );
                })}
                {/* Drones */}
                {drones.map((drone, i) => {
                  const dx = drone.targetX - drone.x;
                  const dy = drone.targetY - drone.y;
                  const angle = Math.atan2(dy, dx);
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
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  background: '#fff',
                  border: '3px solid #4a90e2',
                  borderRadius: 15,
                  boxShadow: '0 8px 32px #0008',
                  zIndex: 1000,
                  padding: '20px 25px',
                  minWidth: 350,
                  maxWidth: 400,
                }}
                onClick={e => e.stopPropagation()}
              >
                <div style={{
                  fontWeight:'bold',
                  fontSize: 24,
                  marginBottom: 20,
                  textAlign: 'center',
                  color: '#4a90e2'
                }}>Construire un bâtiment</div>
                {BUILDINGS.map(b => {
                  const dynamicCost = getDynamicBuildingCostClient(b.name);
                  const canAfford = resources.gold >= dynamicCost;
                  return (
                    <div
                      key={b.name}
                      style={{
                        cursor: canAfford ? 'pointer' : 'not-allowed',
                        padding: '15px 20px',
                        borderRadius: 10,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 15,
                        fontSize: 18,
                        backgroundColor: canAfford ? 'transparent' : '#f5f5f5',
                        color: canAfford ? '#000' : '#999',
                        border: canAfford ? '2px solid #e0e0e0' : '2px solid #ddd',
                        marginBottom: 10,
                        transition: 'all 0.2s ease',
                        ...(canAfford && {
                          ':hover': {
                            backgroundColor: '#f8f9ff',
                            borderColor: '#4a90e2',
                            transform: 'translateY(-2px)',
                            boxShadow: '0 4px 12px #4a90e222'
                          }
                        })
                      }}
                      onClick={() => canAfford && handleBuildingSelect({ ...b, cost: dynamicCost })}
                    >
                      <div style={{display: 'flex', alignItems: 'center', gap: 12}}>
                        <span style={{fontSize: 24}}>{b.icon}</span>
                        <span style={{fontWeight: '600'}}>{b.name}</span>
                      </div>
                      <div style={{
                        fontSize: 16,
                        color: canAfford ? (resources.gold >= dynamicCost ? '#4caf50' : '#ff9800') : '#999',
                        fontWeight: 'bold',
                        backgroundColor: canAfford ? '#f0f8ff' : '#f5f5f5',
                        padding: '8px 12px',
                        borderRadius: 6,
                        border: `1px solid ${canAfford ? '#4caf50' : '#ddd'}`
                      }}>
                        {dynamicCost.toLocaleString()}
                      </div>
                    </div>
                  );
                })}
                <div
                  style={{
                    marginTop: 20,
                    textAlign: 'center',
                    fontSize: 16,
                    cursor: 'pointer',
                    color: '#666',
                    padding: '10px',
                    borderRadius: 8,
                    border: '1px solid #ddd',
                    transition: 'all 0.2s ease'
                  }}
                  onClick={handleCloseMenu}
                >Annuler</div>
              </div>
            )}
            {/* Menu de sélection du type de missile */}
            {missileMenu && (
              <div
                data-missile-menu
                style={{
                  position: 'fixed',
                  left: missileMenu.x,
                  top: missileMenu.y,
                  background: '#fff',
                  border: '2px solid #b71c1c',
                  borderRadius: 10,
                  boxShadow: '0 4px 16px #0006',
                  zIndex: 1001,
                  padding: 10,
                  minWidth: 220,
                }}
                onClick={e => e.stopPropagation()}
              >
                <div style={{fontWeight:'bold',marginBottom:8}}>Choisir le type de missile :</div>
                {MISSILE_TYPES.map(missile => (
                  <div
                    key={missile.type}
                    style={{
                      cursor: resources.gold >= missile.cost ? 'pointer' : 'not-allowed',
                      padding: '8px 10px',
                      borderRadius: 6,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      fontSize: 16,
                      backgroundColor: resources.gold >= missile.cost ? missile.color + '22' : '#f0f0f0',
                      color: resources.gold >= missile.cost ? '#000' : '#999',
                      border: resources.gold >= missile.cost ? 'none' : '1px solid #ddd',
                      marginBottom: 4
                    }}
                    onClick={() => {
                      if (resources.gold >= missile.cost) {
                        fireMissile(missileMenu.buildingId, missile.type);
                        setMissileMenu(null);
                      }
                    }}
                  >
                    <span style={{fontWeight:'bold'}}>{missile.label}</span>
                    <span style={{fontSize:14}}>Coût : {missile.cost.toLocaleString()} crypto</span>
                  </div>
                ))}
                <div
                  style={{marginTop:8,textAlign:'right',fontSize:13,cursor:'pointer',color:'#888'}}
                  onClick={() => {
                    // Si aucun missile n'a été sélectionné, tirer le moins cher
                    const affordable = MISSILE_TYPES.filter(m => resources.gold >= m.cost);
                    const cheapest = affordable.sort((a, b) => a.cost - b.cost)[0];
                    if (cheapest) {
                      fireMissile(missileMenu.buildingId, cheapest.type);
                    }
                    setMissileMenu(null);
                  }}
                >Tirer le moins cher</div>
                <div
                  style={{marginTop:4,textAlign:'right',fontSize:13,cursor:'pointer',color:'#888'}}
                  onClick={() => setMissileMenu(null)}
                >Annuler</div>
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
          onClick={() => socket.emit('start_countdown', { sessionId })}
          disabled={gameStarted || countdown !== null}
          className="start-button"
        >
          {countdown !== null ? `Démarrage dans ${countdown}s` : 'Démarrer le jeu'}
        </button>
        
        <button 
          onClick={() => socket.emit('reset_game', { sessionId })}
          className="reset-button"
        >
          Réinitialiser
        </button>
      </div>
      {/* Message d'erreur */}
      {errorMsg && (
        <div style={{
          position: 'fixed',
          top: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#ff4444',
          color: 'white',
          padding: '10px 20px',
          borderRadius: 10,
          zIndex: 1000,
          fontWeight: 'bold'
        }}>
          {errorMsg}
        </div>
      )}
      
      {/* Indicateur de mode bombardement */}
      {pendingAirStrike && (
        <div style={{
          position: 'fixed',
          top: 80,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#ff8800',
          color: 'white',
          padding: '12px 24px',
          borderRadius: 10,
          zIndex: 1000,
          fontWeight: 'bold',
          fontSize: '16px',
          boxShadow: '0 4px 16px #0006'
        }}>
          🛩️ Mode Bombardement - Cliquez sur la carte pour choisir la zone
        </div>
      )}
      {/* Bouton Marché Noir en bas à droite */}
      <button
        style={{
          position: 'fixed',
          right: 30,
          bottom: 30,
          zIndex: 3000,
          background: '#181818',
          color: '#fff',
          border: '2px solid #333',
          borderRadius: 16,
          fontSize: 22,
          fontWeight: 'bold',
          padding: '16px 28px',
          boxShadow: '0 2px 12px #0007',
          cursor: 'pointer',
          transition: 'all 0.2s',
        }}
        onClick={() => setShowBlackMarket(true)}
      >
        🕳️ Marché Noir
      </button>
      {/* Modale Marché Noir */}
      {showBlackMarket && (
        <div
          style={{
            position: 'fixed',
            left: 0,
            top: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(0,0,0,0.55)',
            zIndex: 4000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setShowBlackMarket(false)}
        >
          <div
            style={{
              background: '#232323',
              borderRadius: 18,
              padding: '38px 44px 32px 44px',
              minWidth: 340,
              minHeight: 180,
              boxShadow: '0 8px 32px #000a',
              position: 'relative',
              color: '#fff',
              border: '3px solid #4a90e2',
              textAlign: 'center',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{fontSize: 28, fontWeight: 'bold', marginBottom: 18, letterSpacing: 1}}>🕳️ Marché Noir</div>
            <div style={{fontSize: 20, marginBottom: 12, fontWeight: 'bold'}}>Missile nucléaire</div>
            <div style={{fontSize: 16, marginBottom: 18}}>Détruit tous les bâtiments d'un segment adverse.<br/>Prix : <b style={{color:'#ffeb3b'}}>200 000 crypto</b></div>
            <button
              style={{
                background: '#b71c1c',
                color: '#fff',
                border: 'none',
                borderRadius: 10,
                fontSize: 18,
                fontWeight: 'bold',
                padding: '12px 28px',
                marginTop: 10,
                cursor: 'pointer',
                boxShadow: '0 2px 8px #0006',
                transition: 'all 0.2s',
              }}
              onClick={() => alert('Achat fictif du missile nucléaire (logique à venir)')}
            >
              Acheter
            </button>
            <button
              style={{
                position: 'absolute',
                top: 10,
                right: 18,
                background: 'none',
                color: '#fff',
                border: 'none',
                fontSize: 26,
                cursor: 'pointer',
              }}
              onClick={() => setShowBlackMarket(false)}
              title="Fermer"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;