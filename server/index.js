const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  },
});

const PORT = process.env.PORT || 3001;

// Gestion des sessions (parties)
let sessions = {};

function createSession(sessionName) {
  // Génère un id unique simple (timestamp + random)
  const sessionId = `${Date.now()}_${Math.floor(Math.random()*10000)}`;
  const players = Array(8).fill(null); // slots vides
  sessions[sessionId] = {
    sessionId,
    name: sessionName,
    players: players,
    buildings: [],
    missiles: [],
    drones: [],
    playerHealth: Array(8).fill(100),
    countdown: null,
    countdownValue: 0,
    gameStarted: false,
    missileIdCounter: 0,
    droneIdCounter: 0,
    barrackTimers: new Map(),
    droneFactoryTimers: new Map(),
    buildingIdCounter: 0,
    segmentsByPlayer: new Map(),
    lastAttacker: Array(8).fill(null),
  };
  return sessionId;
}

let players = Array(8).fill(null); // slots fixes
let buildings = []; // Tous les bâtiments placés par tous les joueurs
let missiles = []; // Tous les missiles de toutes les casernes
let drones = []; // Tous les drones de toutes les usines
let playerHealth = Array(8).fill(100); // Vie de chaque joueur (100 = pleine vie)
let countdown = null;
let countdownValue = 0;
let gameStarted = false;
let missileIdCounter = 0;
let droneIdCounter = 0;
let barrackTimers = new Map(); // Timers pour chaque caserne
let droneFactoryTimers = new Map(); // Timers pour chaque usine de drones

// Configuration des missiles
const MISSILE_SPEED = 2; // pixels par frame
const MISSILE_SPAWN_INTERVAL = 3000; // 3 secondes
const MISSILE_DAMAGE = 1; // Dégâts infligés par missile (1% de vie)
const BASE_COLLISION_RANGE = 25; // Distance de collision avec la base (augmentée pour plus de précision)

// Configuration des drones
const DRONE_SPEED = 1; // pixels par frame (plus lent que les missiles)
const DRONE_SPAWN_INTERVAL = 5000; // 5 secondes (plus lent que les missiles)
const DRONE_DAMAGE = 50; // Dégâts élevés aux bâtiments

function startCountdown() {
  if (countdown || gameStarted) return;
  
  console.log('⏰ Starting countdown...');
  countdownValue = 3;
  io.emit('countdown_update', countdownValue);
  
  countdown = setInterval(() => {
    countdownValue--;
    io.emit('countdown_update', countdownValue);
    
    if (countdownValue <= 0) {
      clearInterval(countdown);
      countdown = null;
      startGame();
    }
  }, 1000);
}

function startMissileSystem() {
  console.log('Starting missile system...');
  
  // Créer des missiles depuis toutes les casernes existantes
  const barracks = buildings.filter(b => b.name === 'Lance Missile');
  console.log('Found barracks:', barracks.length, 'barracks at startup');
  
  // Créer un timer pour chaque caserne existante
  barracks.forEach((barrack, index) => {
    console.log(`Starting timer for barrack ${index + 1}:`, barrack.ownerSlot, barrack.x, barrack.y);
    startBarrackTimer(barrack);
  });
  
  // Déplacer tous les missiles toutes les 16ms (60 FPS)
  setInterval(() => {
    if (!gameStarted) return;
    
    // Déplacer tous les missiles selon leur direction
    missiles.forEach(missile => {
      const oldX = missile.x;
      missile.x += missile.direction * MISSILE_SPEED;
      
      // Effet Pacman : réapparition de l'autre côté de l'écran
      // Utiliser la même largeur que pour les collisions
      const screenWidth = 1920; // Largeur cohérente avec les collisions
      
      if (missile.x < 0) {
        // Missile sort à gauche, réapparaît à droite
        console.log('🔄 Missile', missile.id, 'wrapped from left to right: x=', oldX, '->', missile.x, '->', screenWidth);
        missile.x = screenWidth;
      } else if (missile.x > screenWidth) {
        // Missile sort à droite, réapparaît à gauche
        console.log('🔄 Missile', missile.id, 'wrapped from right to left: x=', oldX, '->', missile.x, '->', 0);
        missile.x = 0;
      }
    });
    
    // Déplacer tous les drones vers leurs cibles
    drones.forEach(drone => {
      // Calculer la direction vers la cible
      const dx = drone.targetX - drone.x;
      const dy = drone.targetY - drone.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance > 0) {
        // Normaliser et appliquer la vitesse
        drone.x += (dx / distance) * DRONE_SPEED;
        drone.y += (dy / distance) * DRONE_SPEED;
      }
    });
    
    // Vérifier les collisions entre missiles et bases
    checkMissileCollisions();
    
    // Vérifier les collisions entre missiles
    checkMissileToMissileCollisions();
    
    // Vérifier l'interception par les bâtiments antimissile
    checkAntimissileInterception();
    
    // Vérifier les collisions entre missiles et bâtiments
    checkMissileToBuildingCollisions();
    
    // Vérifier les collisions des drones
    checkDroneCollisions();
    
    // Envoyer la mise à jour à tous les joueurs
    io.emit('missiles_update', missiles);
    io.emit('drones_update', drones);
  }, 16);
}

function startBarrackTimer(barrack) {
  const barrackId = `${barrack.ownerSlot}-${barrack.x}-${barrack.y}`;
  
  // Éviter de créer un timer en double pour la même caserne
  if (barrackTimers.has(barrackId)) {
    console.log('Timer already exists for barrack:', barrackId);
    return;
  }
  
  console.log('Starting timer for barrack:', barrackId);
  
  // Créer un missile immédiatement
  createMissileFromBarrack(barrack);
  
  // Créer un timer pour cette caserne spécifique
  const timer = setInterval(() => {
    if (!gameStarted) return;
    createMissileFromBarrack(barrack);
  }, MISSILE_SPAWN_INTERVAL);
  
  barrackTimers.set(barrackId, timer);
}

function stopBarrackTimer(barrack) {
  const barrackId = `${barrack.ownerSlot}-${barrack.x}-${barrack.y}`;
  const timer = barrackTimers.get(barrackId);
  if (timer) {
    clearInterval(timer);
    barrackTimers.delete(barrackId);
    console.log('🛑 Stopped timer for barrack:', barrackId);
  }
}

function createMissileFromBarrack(barrack) {
  const barrackId = `${barrack.ownerSlot}-${barrack.x}-${barrack.y}`;
  console.log('🚀 Creating missile from barrack:', barrackId);
  
  // Déterminer la direction du missile en fonction de la position de la caserne
  // Pour chaque joueur, diviser son segment en deux : gauche = missiles vers la gauche, droite = missiles vers la droite
  const screenWidth = 1920; // Largeur typique d'un écran
  const segmentWidth = screenWidth / 8; // Largeur d'un segment (8 joueurs)
  const segmentStart = barrack.ownerSlot * segmentWidth;
  const segmentEnd = segmentStart + segmentWidth;
  const segmentMidpoint = segmentStart + segmentWidth / 2;
  
  // Si la caserne est dans la première moitié du segment, missile vers la gauche
  // Si la caserne est dans la seconde moitié du segment, missile vers la droite
  const direction = barrack.x < segmentMidpoint ? -1 : 1;
  
  console.log(`📍 Barrack at x=${barrack.x}, segment ${barrack.ownerSlot} [${segmentStart}-${segmentEnd}], midpoint=${segmentMidpoint}, direction=${direction === 1 ? 'RIGHT' : 'LEFT'}`);
  
  const missile = {
    id: missileIdCounter++,
    x: barrack.x,
    y: barrack.y,
    ownerSlot: barrack.ownerSlot,
    direction: direction,
    createdAt: Date.now()
  };
  
  missiles.push(missile);
  console.log('✅ Missile created:', missile.id, 'from barrack:', barrackId, 'direction:', direction === 1 ? 'RIGHT' : 'LEFT', 'Total missiles:', missiles.length);
  io.emit('missiles_update', missiles);
}

function resetGame() {
  console.log('🔄 Resetting game...');
  
  // Arrêter tous les timers de casernes
  barrackTimers.forEach(timer => clearInterval(timer));
  barrackTimers.clear();
  
  // Arrêter tous les timers d'usines de drones
  droneFactoryTimers.forEach(timer => clearInterval(timer));
  droneFactoryTimers.clear();
  
  // Arrêter le compte à rebours s'il est actif
  if (countdown) {
    clearInterval(countdown);
    countdown = null;
  }
  countdownValue = 0;
  
  // Réinitialiser toutes les variables sauf les pseudos
  buildings = [];
  missiles = [];
  drones = [];
  playerHealth = Array(8).fill(100);
  gameStarted = false;
  missileIdCounter = 0;
  droneIdCounter = 0;
  // Ne pas toucher à players ici pour conserver les pseudos
  
  // Envoyer la réinitialisation à tous les joueurs
  io.emit('game_reset', {
    buildings: buildings,
    missiles: missiles,
    drones: drones,
    playerHealth: playerHealth
  });
  
  console.log('🔄 Game reset complete');
}

function checkMissileCollisions() {
  // Utiliser la même logique que le client
  const screenWidth = 1920; // Largeur typique d'un écran
  const segmentWidth = screenWidth / 8;
  
  // Parcourir les missiles dans l'ordre inverse pour éviter les problèmes d'index lors de la suppression
  for (let i = missiles.length - 1; i >= 0; i--) {
    const missile = missiles[i];
    let missileHit = false;
    
    // Vérifier si le missile passe sur la position d'un joueur
    for (let playerSlot = 0; playerSlot < 8; playerSlot++) {
      const playerCenterX = playerSlot * segmentWidth + segmentWidth / 2;
      
      // Debug: log la position de chaque joueur
      if (missile.x > playerCenterX - 20 && missile.x < playerCenterX + 20) {
        console.log(`🎯 Missile ${missile.id} at x=${missile.x}, P${playerSlot + 1} center at x=${playerCenterX}, distance: ${Math.abs(missile.x - playerCenterX).toFixed(1)}px`);
      }
      
      // Si le missile passe exactement sur la position du joueur (avec une petite marge)
      if (Math.abs(missile.x - playerCenterX) < 10) {
        // Infliger des dégâts au joueur
        playerHealth[playerSlot] = Math.max(0, playerHealth[playerSlot] - MISSILE_DAMAGE);
        
        console.log(`💥 Missile ${missile.id} hit player ${playerSlot} at x=${missile.x}! Health: ${playerHealth[playerSlot]}/100`);
        
        // Supprimer le missile qui a touché
        missiles.splice(i, 1);
        missileHit = true;
        
        // Envoyer la mise à jour de la vie à tous les joueurs
        io.emit('health_update', playerHealth);
        
        // Sortir de la boucle car ce missile a été supprimé
        break;
      }
    }
  }
}

function checkMissileToMissileCollisions() {
  const collisionDistance = 8; // Distance de collision entre missiles (réduite pour un meilleur effet visuel)
  
  // Parcourir les missiles dans l'ordre inverse pour éviter les problèmes d'index lors de la suppression
  for (let i = missiles.length - 1; i >= 0; i--) {
    const missile1 = missiles[i];
    let missile1Destroyed = false;
    
    // Vérifier la collision avec tous les autres missiles
    for (let j = i - 1; j >= 0; j--) {
      const missile2 = missiles[j];
      
      // Calculer la distance entre les deux missiles
      const distance = Math.sqrt(
        Math.pow(missile1.x - missile2.x, 2) + 
        Math.pow(missile1.y - missile2.y, 2)
      );
      
      // Si les missiles se croisent
      if (distance < collisionDistance) {
        console.log(`💥 Missile ${missile1.id} (P${missile1.ownerSlot + 1}) collided with missile ${missile2.id} (P${missile2.ownerSlot + 1}) at distance ${distance.toFixed(1)}px`);
        
        // Supprimer les deux missiles
        missiles.splice(i, 1);
        missiles.splice(j, 1);
        missile1Destroyed = true;
        break;
      }
    }
    
    // Si le missile a été détruit, sortir de la boucle
    if (missile1Destroyed) break;
  }
}

function checkAntimissileInterception() {
  // Vérifier si des bâtiments antimissile interceptent des missiles
  const antimissileBuildings = buildings.filter(b => b.name === 'Antimissile');
  const interceptionRange = 50; // Distance d'interception (réduite de moitié)
  
  for (let i = missiles.length - 1; i >= 0; i--) {
    const missile = missiles[i];
    let missileIntercepted = false;
    
    // Vérifier chaque bâtiment antimissile
    for (const antimissile of antimissileBuildings) {
      // Ne pas intercepter les missiles alliés (même propriétaire)
      if (missile.ownerSlot === antimissile.ownerSlot) {
        continue;
      }
      
      // Calculer la distance entre le missile et le bâtiment antimissile
      const distance = Math.sqrt(
        Math.pow(missile.x - antimissile.x, 2) + 
        Math.pow(missile.y - antimissile.y, 2)
      );
      
      // Si le missile est dans la zone d'interception
      if (distance < interceptionRange) {
        console.log(`🛡️ Antimissile (P${antimissile.ownerSlot + 1}) intercepted enemy missile ${missile.id} (P${missile.ownerSlot + 1}) at distance ${distance.toFixed(1)}px`);
        
        // Supprimer le missile intercepté
        missiles.splice(i, 1);
        missileIntercepted = true;
        break;
      }
    }
    
    // Si le missile a été intercepté, sortir de la boucle
    if (missileIntercepted) break;
  }
}

function checkMissileToBuildingCollisions() {
  const buildingCollisionRange = 20; // Distance de collision avec les bâtiments
  
  for (let i = missiles.length - 1; i >= 0; i--) {
    const missile = missiles[i];
    let missileHit = false;
    
    // Vérifier la collision avec chaque bâtiment
    for (let j = buildings.length - 1; j >= 0; j--) {
      const building = buildings[j];
      
      // Ne pas détruire les bâtiments alliés (même propriétaire)
      if (missile.ownerSlot === building.ownerSlot) {
        continue;
      }
      
      // Calculer la distance entre le missile et le bâtiment
      const distance = Math.sqrt(
        Math.pow(missile.x - building.x, 2) + 
        Math.pow(missile.y - building.y, 2)
      );
      
      // Si le missile touche le bâtiment
      if (distance < buildingCollisionRange) {
        console.log(`💥 Missile ${missile.id} (P${missile.ownerSlot + 1}) destroyed building ${building.name} (P${building.ownerSlot + 1}) at distance ${distance.toFixed(1)}px`);
        
        // Si c'est un Lance Missile détruit, arrêter son timer
        if (building.name === 'Lance Missile') {
          stopBarrackTimer(building);
        }
        
        // Supprimer le bâtiment détruit
        buildings.splice(j, 1);
        
        // Supprimer le missile qui a touché
        missiles.splice(i, 1);
        missileHit = true;
        
        // Envoyer la mise à jour des bâtiments à tous les joueurs
        io.emit('buildings_update', buildings);
        
        break;
      }
    }
    
    // Si le missile a été détruit, sortir de la boucle
    if (missileHit) break;
  }
}

function startDroneSystem() {
  console.log('Starting drone system...');
  
  // Créer des drones depuis toutes les usines existantes
  const droneFactories = buildings.filter(b => b.name === 'Usine de Drones');
  console.log('Found drone factories:', droneFactories.length, 'factories at startup');
  
  // Créer un timer pour chaque usine existante
  droneFactories.forEach((factory, index) => {
    console.log(`Starting timer for drone factory ${index + 1}:`, factory.ownerSlot, factory.x, factory.y);
    startDroneFactoryTimer(factory);
  });
}

function startDroneFactoryTimer(factory) {
  const factoryId = `${factory.ownerSlot}-${factory.x}-${factory.y}`;
  
  // Éviter de créer un timer en double pour la même usine
  if (droneFactoryTimers.has(factoryId)) {
    console.log('Timer already exists for drone factory:', factoryId);
    return;
  }
  
  console.log('Starting timer for drone factory:', factoryId);
  
  // Créer un drone immédiatement
  createDroneFromFactory(factory);
  
  // Créer un timer pour cette usine spécifique
  const timer = setInterval(() => {
    if (!gameStarted) return;
    createDroneFromFactory(factory);
  }, DRONE_SPAWN_INTERVAL);
  
  droneFactoryTimers.set(factoryId, timer);
}

function stopDroneFactoryTimer(factory) {
  const factoryId = `${factory.ownerSlot}-${factory.x}-${factory.y}`;
  const timer = droneFactoryTimers.get(factoryId);
  if (timer) {
    clearInterval(timer);
    droneFactoryTimers.delete(factoryId);
    console.log('Stopped timer for drone factory:', factoryId);
  }
}

function createDroneFromFactory(factory) {
  console.log('🤖 Creating drone from factory:', factory.ownerSlot, factory.x, factory.y);
  
  // Trouver une cible ennemie (bâtiment ou base)
  const target = findDroneTarget(factory.ownerSlot, factory.x);
  
  if (!target) {
    console.log('No target found for drone from factory:', factory.ownerSlot);
    return;
  }
  
  const drone = {
    id: droneIdCounter++,
    x: factory.x,
    y: factory.y,
    ownerSlot: factory.ownerSlot,
    targetX: target.x,
    targetY: target.y,
    targetType: target.type, // 'building' ou 'base'
    targetId: target.id,
    createdAt: Date.now()
  };
  
  drones.push(drone);
  console.log('🤖 Drone created:', drone.id, 'from factory:', factory.ownerSlot, 'targeting:', target.type, 'Total drones:', drones.length);
  io.emit('drones_update', drones);
}

function findDroneTarget(ownerSlot, factoryX) {
  // Calculer le point médian du segment pour filtrer les bâtiments
  const screenWidth = 1920;
  const segmentWidth = screenWidth / 8;
  const segmentStart = ownerSlot * segmentWidth;
  const segmentEnd = segmentStart + segmentWidth;
  const segmentMidpoint = segmentStart + segmentWidth / 2;
  
  // Déterminer la direction selon la position de l'usine
  const direction = factoryX < segmentMidpoint ? -1 : 1;
  
  // Chercher d'abord des bâtiments ennemis dans la bonne direction
  const enemyBuildings = buildings.filter(b => {
    // Filtrer par propriétaire
    if (b.ownerSlot === ownerSlot) return false;
    
    // Filtrer par position dans le segment
    if (direction === 1) {
      // Drones vers la droite : ignorer les bâtiments à gauche du point médian
      return b.x >= segmentMidpoint;
    } else {
      // Drones vers la gauche : ignorer les bâtiments à droite du point médian
      return b.x < segmentMidpoint;
    }
  });
  
  if (enemyBuildings.length > 0) {
    // Choisir un bâtiment ennemi aléatoire dans la bonne direction
    const randomBuilding = enemyBuildings[Math.floor(Math.random() * enemyBuildings.length)];
    return {
      x: randomBuilding.x,
      y: randomBuilding.y,
      type: 'building',
      id: randomBuilding.id || 'building'
    };
  }
  
  // Si pas de bâtiments ennemis dans la bonne direction, cibler une base ennemie
  console.log(`🤖 Drone factory at x=${factoryX}, segment ${ownerSlot} [${segmentStart}-${segmentEnd}], midpoint=${segmentMidpoint}, direction=${direction === 1 ? 'RIGHT' : 'LEFT'}`);
  
  // Chercher la cible selon la direction
  if (direction === 1) {
    // Chercher l'ennemi le plus proche à droite (avec effet Pacman)
    for (let i = ownerSlot + 1; i < 8; i++) {
      if (playerHealth[i] > 0) {
        const baseX = i * segmentWidth + segmentWidth / 2;
        return {
          x: baseX,
          y: 350, // Centre vertical de la base
          type: 'base',
          id: `player_${i}`
        };
      }
    }
    // Si pas d'ennemi à droite, chercher le joueur 8 (effet Pacman) - sauf si on est le joueur 8
    if (ownerSlot !== 7 && playerHealth[7] > 0) {
      const baseX = 7 * segmentWidth + segmentWidth / 2;
      return {
        x: baseX,
        y: 350,
        type: 'base',
        id: `player_7`
      };
    }
  } else {
    // Chercher l'ennemi le plus proche à gauche (avec effet Pacman)
    for (let i = ownerSlot - 1; i >= 0; i--) {
      if (playerHealth[i] > 0) {
        const baseX = i * segmentWidth + segmentWidth / 2;
        return {
          x: baseX,
          y: 350, // Centre vertical de la base
          type: 'base',
          id: `player_${i}`
        };
      }
    }
    // Si pas d'ennemi à gauche, chercher le joueur 1 (effet Pacman) - sauf si on est le joueur 1
    if (ownerSlot !== 0 && playerHealth[0] > 0) {
      const baseX = 0 * segmentWidth + segmentWidth / 2;
      return {
        x: baseX,
        y: 350,
        type: 'base',
        id: `player_0`
      };
    }
  }
  
  // Si aucune cible trouvée, créer une cible par défaut dans la direction
  if (direction === 1) {
    // Cible par défaut à droite
    const defaultTargetSlot = (ownerSlot + 1) % 8;
    const baseX = defaultTargetSlot * segmentWidth + segmentWidth / 2;
    return {
      x: baseX,
      y: 350,
      type: 'base',
      id: `player_${defaultTargetSlot}`
    };
  } else {
    // Cible par défaut à gauche
    const defaultTargetSlot = (ownerSlot - 1 + 8) % 8;
    const baseX = defaultTargetSlot * segmentWidth + segmentWidth / 2;
    return {
      x: baseX,
      y: 350,
      type: 'base',
      id: `player_${defaultTargetSlot}`
    };
  }
}

function checkDroneCollisions() {
  const droneCollisionRange = 15; // Distance de collision des drones
  
  for (let i = drones.length - 1; i >= 0; i--) {
    const drone = drones[i];
    let droneHit = false;
    
    // Vérifier la collision avec la cible
    const distance = Math.sqrt(
      Math.pow(drone.x - drone.targetX, 2) + 
      Math.pow(drone.y - drone.targetY, 2)
    );
    
    if (distance < droneCollisionRange) {
      console.log(`💥 Drone ${drone.id} (P${drone.ownerSlot + 1}) hit target ${drone.targetType} at distance ${distance.toFixed(1)}px`);
      
      // Appliquer les dégâts selon le type de cible
      if (drone.targetType === 'building') {
        // Chercher le bâtiment ciblé et le détruire
        for (let j = buildings.length - 1; j >= 0; j--) {
          const building = buildings[j];
          const buildingDistance = Math.sqrt(
            Math.pow(drone.x - building.x, 2) + 
            Math.pow(drone.y - building.y, 2)
          );
          
          if (buildingDistance < droneCollisionRange) {
            console.log(`💥 Drone destroyed building ${building.name} (P${building.ownerSlot + 1})`);
            
            // Si c'est un Lance Missile détruit, arrêter son timer
            if (building.name === 'Lance Missile') {
              stopBarrackTimer(building);
            }
            // Si c'est une Usine de Drones détruite, arrêter son timer
            if (building.name === 'Usine de Drones') {
              stopDroneFactoryTimer(building);
            }
            
            buildings.splice(j, 1);
            io.emit('buildings_update', buildings);
            break;
          }
        }
      } else if (drone.targetType === 'base') {
        // Infliger des dégâts à la base (joueur)
        const targetPlayerSlot = parseInt(drone.targetId.split('_')[1]);
        playerHealth[targetPlayerSlot] = Math.max(0, playerHealth[targetPlayerSlot] - DRONE_DAMAGE);
        console.log(`💥 Drone hit player ${targetPlayerSlot}! Health: ${playerHealth[targetPlayerSlot]}/100`);
        io.emit('health_update', playerHealth);
      }
      
      // Supprimer le drone qui a explosé
      drones.splice(i, 1);
      droneHit = true;
    }
    
    // Si le drone a été détruit, sortir de la boucle
    if (droneHit) break;
  }
}

io.on('connection', (socket) => {
  // Liste des sessions
  socket.on('list_sessions', () => {
    // Envoie la liste des sessions (id + nom + nb joueurs)
    const list = Object.entries(sessions).map(([id, s]) => ({
      id,
      name: s.name,
      players: s.players.filter(Boolean).length
    }));
    socket.emit('sessions_list', list);
  });

  // Créer une session
  socket.on('create_session', (sessionName, cb) => {
    console.log('[SOCKET] create_session reçu pour', sessionName);
    const sessionId = createSession(sessionName);
    cb && cb(sessionId);
    // Broadcast la nouvelle liste
    io.emit('sessions_list', Object.entries(sessions).map(([id, s]) => ({
      id,
      name: s.name,
      players: s.players.filter(Boolean).length
    })));
  });

  // Rejoindre une session
  socket.on('join_session', ({ sessionId, pseudo }, cb) => {
    const session = sessions[sessionId];
    if (!session) {
      cb && cb({ error: 'Session not found' });
      return;
    }
    // Cherche une place libre
    const freeIndex = session.players.findIndex(p => p === null);
    if (freeIndex === -1) {
      cb && cb({ error: 'Session full' });
      return;
    }
    // Place le joueur dans le slot
    session.players[freeIndex] = { id: socket.id, pseudo, gold: 30000, datas: 100000 };
    socket.join(sessionId);
    socket.sessionId = sessionId;
    socket.playerIndex = freeIndex;
    cb && cb({ index: freeIndex });
    // Envoie l'état de la session au joueur
    socket.emit('your_index', freeIndex);
    io.to(sessionId).emit('players_update', session.players);
    socket.emit('buildings_update', session.buildings);
    socket.emit('missiles_update', session.missiles);
    socket.emit('health_update', session.playerHealth);
    // Démarrage du compte à rebours si 2 joueurs ou plus
    if (session.players.filter(Boolean).length >= 2 && !session.gameStarted) {
      startCountdownForSession(sessionId);
    }
  });

  // Place un bâtiment dans une session
  socket.on('place_building', (data) => {
    const { sessionId, ...building } = data;
    const session = sessions[sessionId];
    if (!session || !session.gameStarted) return;
    // Toujours écraser l'id pour garantir l'unicité côté serveur
    building.id = session.buildingIdCounter++;
    session.buildings.push(building);
    io.to(sessionId).emit('buildings_update', session.buildings);
    // Si c'est une caserne, démarrer le timer de missiles pour cette session
    if (building.name === 'Lance Missile') {
      startBarrackTimerForSession(session, building);
    }
    // Si c'est une Usine de Drones, démarrer le timer de drones pour cette session
    if (building.name === 'Usine de Drones') {
      startDroneFactoryTimerForSession(session, building);
    }
  });

  // Reset game
  socket.on('reset_game', ({ sessionId }) => {
    const session = sessions[sessionId];
    if (!session) return;
    // Arrêter tous les timers
    session.barrackTimers.forEach(timer => clearInterval(timer));
    session.barrackTimers.clear();
    session.droneFactoryTimers.forEach(timer => clearInterval(timer));
    session.droneFactoryTimers.clear();
    if (session.countdown) {
      clearInterval(session.countdown);
      session.countdown = null;
    }
    session.countdownValue = 0;
    session.buildings = [];
    session.missiles = [];
    session.drones = [];
    session.playerHealth = Array(8).fill(100);
    session.gameStarted = false;
    session.missileIdCounter = 0;
    session.droneIdCounter = 0;
    stopDatasProductionForSession(sessionId);
    io.to(sessionId).emit('game_reset', {
      buildings: session.buildings,
      missiles: session.missiles,
      drones: session.drones,
      playerHealth: session.playerHealth
    });
  });

  // Ajout : gestion du tir de missile personnalisé
  socket.on('launch_missile', ({ fromBuildingId, missileType, sessionId }) => {
    const session = sessions[sessionId];
    if (!session || !session.gameStarted) return;
    // Trouver la caserne
    const barrack = session.buildings.find(b => b.id === fromBuildingId && b.name === 'Lance Missile');
    if (!barrack) return;
    // Déterminer la direction
    const screenWidth = 1920;
    const segmentWidth = screenWidth / 8;
    const segmentMidpoint = barrack.ownerSlot * segmentWidth + segmentWidth / 2;
    const direction = barrack.x < segmentMidpoint ? -1 : 1;
    // Propriétés des types de missiles
    const MISSILE_TYPES = {
      rapide: { damage: 1, speed: 7, radius: 3 },
      furtif: { damage: 2, speed: 4, radius: 5 },
      lourd:  { damage: 5, speed: 2, radius: 7 }
    };
    const type = MISSILE_TYPES[missileType] ? missileType : 'rapide';
    const props = MISSILE_TYPES[type];
    const missile = {
      id: session.missileIdCounter++,
      x: barrack.x,
      y: barrack.y,
      ownerSlot: barrack.ownerSlot,
      direction,
      createdAt: Date.now(),
      type,
      damage: props.damage,
      speed: props.speed,
      radius: props.radius
    };
    session.missiles.push(missile);
    io.to(sessionId).emit('missiles_update', session.missiles);
  });

  // Ajout : gestion du changement de type de missile d'une caserne
  socket.on('set_barrack_missile_type', ({ buildingId, missileType, sessionId }) => {
    const session = sessions[sessionId];
    if (!session || !session.gameStarted) return;
    const barrack = session.buildings.find(b => b.id === buildingId && b.name === 'Lance Missile');
    if (!barrack) return;
    barrack.missileType = missileType;
  });

  // TODO : Adapter tous les autres événements (place_building, etc.) pour fonctionner par session
  // ...
});

app.get('/', (req, res) => {
  res.send('RTS Server running');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
}); 

function startGame() {
  console.log('🎮 Starting game...');
  gameStarted = true;
  
  // Démarrer le système de missiles
  startMissileSystem();
  
  // Démarrer le système de drones
  startDroneSystem();
  
  // Envoyer l'état initial à tous les joueurs
  io.emit('game_started', {
    buildings: buildings,
    missiles: missiles,
    drones: drones,
    playerHealth: playerHealth
  });
  
  console.log('🎮 Game started successfully!');
} 

// Lance le compte à rebours pour une session donnée
function startCountdownForSession(sessionId) {
  const session = sessions[sessionId];
  if (!session || session.countdown || session.gameStarted) return;
  console.log(`⏰ [${session.name}] Starting countdown...`);
  session.countdownValue = 10;
  io.to(sessionId).emit('countdown_update', session.countdownValue);
  session.countdown = setInterval(() => {
    session.countdownValue--;
    io.to(sessionId).emit('countdown_update', session.countdownValue);
    if (session.countdownValue <= 0) {
      clearInterval(session.countdown);
      session.countdown = null;
      startGameForSession(sessionId);
    }
  }, 1000);
}

// Lance la partie pour une session donnée
function startGameForSession(sessionId) {
  const session = sessions[sessionId];
  if (!session || session.gameStarted) return;
  console.log(`🎮 [${session.name}] Starting game!`);
  session.gameStarted = true;

  // Démarrer la boucle de jeu (missiles, drones, collisions, etc.)
  if (session.loop) clearInterval(session.loop);
  session.loop = setInterval(() => {
    if (!session.gameStarted) return;
    // Déplacer les missiles
    session.missiles.forEach(missile => {
      missile.x += missile.direction * MISSILE_SPEED;
      const screenWidth = 1920;
      if (missile.x < 0) missile.x = screenWidth;
      else if (missile.x > screenWidth) missile.x = 0;
    });
    // Déplacer les drones
    session.drones.forEach(drone => {
      const dx = drone.targetX - drone.x;
      const dy = drone.targetY - drone.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist > 0) {
        drone.x += (dx/dist) * DRONE_SPEED;
        drone.y += (dy/dist) * DRONE_SPEED;
      }
    });
    // Collisions par session
    checkMissileCollisionsForSession(session);
    checkMissileToMissileCollisionsForSession(session);
    checkAntimissileInterceptionForSession(session);
    checkMissileToBuildingCollisionsForSession(session);
    checkDroneCollisionsForSession(session);
    io.to(sessionId).emit('missiles_update', session.missiles);
    io.to(sessionId).emit('drones_update', session.drones);
  }, 16);

  // Démarrer la production de datas
  startDatasProductionForSession(sessionId);

  // Envoyer l'état initial à tous les joueurs
  io.to(sessionId).emit('game_started', {
    buildings: session.buildings,
    missiles: session.missiles,
    drones: session.drones,
    playerHealth: session.playerHealth
  });
} 

// --- NOUVELLES FONCTIONS PAR SESSION ---
function startBarrackTimerForSession(session, barrack) {
  const barrackId = `${barrack.ownerSlot}-${barrack.x}-${barrack.y}`;
  if (session.barrackTimers.has(barrackId)) return;
  // Créer un missile immédiatement
  createMissileFromBarrackForSession(session, barrack);
  // Timer pour cette caserne
  const timer = setInterval(() => {
    if (!session.gameStarted) return;
    createMissileFromBarrackForSession(session, barrack);
  }, MISSILE_SPAWN_INTERVAL);
  session.barrackTimers.set(barrackId, timer);
}
function stopBarrackTimerForSession(session, barrack) {
  const barrackId = `${barrack.ownerSlot}-${barrack.x}-${barrack.y}`;
  const timer = session.barrackTimers.get(barrackId);
  if (timer) {
    clearInterval(timer);
    session.barrackTimers.delete(barrackId);
  }
}
function createMissileFromBarrackForSession(session, barrack) {
  const screenWidth = 1920;
  const segmentWidth = screenWidth / 8;
  const segmentMidpoint = barrack.ownerSlot * segmentWidth + segmentWidth / 2;
  const direction = barrack.x < segmentMidpoint ? -1 : 1;
  // Propriétés des types de missiles
  const MISSILE_TYPES = {
    rapide: { damage: 1, speed: 7, radius: 3, cost: 10000 },
    furtif: { damage: 2, speed: 4, radius: 5, cost: 50000 },
    lourd:  { damage: 5, speed: 2, radius: 7, cost: 100000 }
  };
  const type = MISSILE_TYPES[barrack.missileType] ? barrack.missileType : 'rapide';
  const props = MISSILE_TYPES[type];
  // Vérifie la datas du joueur
  const player = session.players[barrack.ownerSlot];
  if (!player || typeof player.datas !== 'number' || player.datas < props.cost) {
    // Pas assez de datas, ne tire pas
    return;
  }
  // Déduis le coût
  player.datas -= props.cost;
  // Crée le missile
  const missile = {
    id: session.missileIdCounter++,
    x: barrack.x,
    y: barrack.y,
    ownerSlot: barrack.ownerSlot,
    direction,
    createdAt: Date.now(),
    type,
    damage: props.damage,
    speed: props.speed,
    radius: props.radius
  };
  session.missiles.push(missile);
  io.to(session.sessionId || session.id).emit('missiles_update', session.missiles);
  // Envoie la nouvelle valeur de datas au joueur concerné
  const playerIndex = barrack.ownerSlot;
  const sockets = Array.from(io.sockets.sockets.values());
  for (const s of sockets) {
    if (s.sessionId === session.sessionId && s.playerIndex === playerIndex && session.players[playerIndex]) {
      s.emit('resources_update', { datas: player.datas });
    }
  }
}
// --- Collisions par session ---
function checkMissileCollisionsForSession(session) {
  const screenWidth = 1920;
  const segmentWidth = screenWidth / 8;
  for (let i = session.missiles.length - 1; i >= 0; i--) {
    const missile = session.missiles[i];
    for (let playerSlot = 0; playerSlot < 8; playerSlot++) {
      const playerCenterX = playerSlot * segmentWidth + segmentWidth / 2;
      // Déterminer le vrai propriétaire du segment via segmentsByPlayer
      let ownerSlot = playerSlot;
      if (session.segmentsByPlayer && session.segmentsByPlayer instanceof Map && session.segmentsByPlayer.size > 0) {
        for (const [slot, segs] of session.segmentsByPlayer.entries()) {
          if (segs.has(playerSlot)) {
            ownerSlot = slot;
            break;
          }
        }
      }
      // Ne pas toucher les bases alliées
      if (missile.ownerSlot === parseInt(ownerSlot)) continue;
      if (Math.abs(missile.x - playerCenterX) < 10) {
        // Stocker le dernier attaquant
        session.lastAttacker[playerSlot] = missile.ownerSlot;
        const prevHealth = session.playerHealth[playerSlot];
        // Appliquer les dégâts du missile (par défaut 1 si non défini)
        const dmg = typeof missile.damage === 'number' ? missile.damage : 1;
        session.playerHealth[playerSlot] = Math.max(0, session.playerHealth[playerSlot] - dmg);
        session.missiles.splice(i, 1);
        io.to(session.sessionId || session.id).emit('health_update', session.playerHealth);
        // Si le joueur vient d'être éliminé, annexer son segment
        if (prevHealth > 0 && session.playerHealth[playerSlot] === 0 && session.lastAttacker[playerSlot] !== null && session.lastAttacker[playerSlot] !== playerSlot) {
          annexSegmentOnElimination(session, playerSlot, session.lastAttacker[playerSlot]);
        }
        break;
      }
    }
  }
}
// --- Ajout : gestion des usines de drones par session ---
function startDroneFactoryTimerForSession(session, factory) {
  const factoryId = `${factory.ownerSlot}-${factory.x}-${factory.y}`;
  if (session.droneFactoryTimers.has(factoryId)) return;
  createDroneFromFactoryForSession(session, factory);
  const timer = setInterval(() => {
    if (!session.gameStarted) return;
    createDroneFromFactoryForSession(session, factory);
  }, DRONE_SPAWN_INTERVAL);
  session.droneFactoryTimers.set(factoryId, timer);
}
function stopDroneFactoryTimerForSession(session, factory) {
  const factoryId = `${factory.ownerSlot}-${factory.x}-${factory.y}`;
  const timer = session.droneFactoryTimers.get(factoryId);
  if (timer) {
    clearInterval(timer);
    session.droneFactoryTimers.delete(factoryId);
  }
}
function createDroneFromFactoryForSession(session, factory) {
  // Trouver une cible ennemie (bâtiment ou base)
  const screenWidth = 1920;
  const segmentWidth = screenWidth / 8;
  const segmentStart = factory.ownerSlot * segmentWidth;
  const segmentEnd = segmentStart + segmentWidth;
  const segmentMidpoint = segmentStart + segmentWidth / 2;
  const direction = factory.x < segmentMidpoint ? -1 : 1;

  // Chercher d'abord des bâtiments ennemis dans la bonne direction
  const enemyBuildings = session.buildings.filter(b => {
    if (b.ownerSlot === factory.ownerSlot) return false;
    if (direction === 1) {
      return b.x >= segmentMidpoint;
    } else {
      return b.x < segmentMidpoint;
    }
  });

  let target = null;
  if (enemyBuildings.length > 0) {
    const randomBuilding = enemyBuildings[Math.floor(Math.random() * enemyBuildings.length)];
    target = {
      x: randomBuilding.x,
      y: randomBuilding.y,
      type: 'building',
      id: randomBuilding.id || 'building'
    };
  } else {
    // Sinon, cibler une base ennemie
    if (direction === 1) {
      for (let i = factory.ownerSlot + 1; i < 8; i++) {
        if (session.playerHealth[i] > 0) {
          const baseX = i * segmentWidth + segmentWidth / 2;
          target = { x: baseX, y: 350, type: 'base', id: `player_${i}` };
          break;
        }
      }
      if (!target && factory.ownerSlot !== 7 && session.playerHealth[7] > 0) {
        const baseX = 7 * segmentWidth + segmentWidth / 2;
        target = { x: baseX, y: 350, type: 'base', id: `player_7` };
      }
    } else {
      for (let i = factory.ownerSlot - 1; i >= 0; i--) {
        if (session.playerHealth[i] > 0) {
          const baseX = i * segmentWidth + segmentWidth / 2;
          target = { x: baseX, y: 350, type: 'base', id: `player_${i}` };
          break;
        }
      }
      if (!target && factory.ownerSlot !== 0 && session.playerHealth[0] > 0) {
        const baseX = 0 * segmentWidth + segmentWidth / 2;
        target = { x: baseX, y: 350, type: 'base', id: `player_0` };
      }
    }
    // Si aucune cible trouvée, cible par défaut
    if (!target) {
      if (direction === 1) {
        const defaultTargetSlot = (factory.ownerSlot + 1) % 8;
        const baseX = defaultTargetSlot * segmentWidth + segmentWidth / 2;
        target = { x: baseX, y: 350, type: 'base', id: `player_${defaultTargetSlot}` };
      } else {
        const defaultTargetSlot = (factory.ownerSlot - 1 + 8) % 8;
        const baseX = defaultTargetSlot * segmentWidth + segmentWidth / 2;
        target = { x: baseX, y: 350, type: 'base', id: `player_${defaultTargetSlot}` };
      }
    }
  }
  if (!target) return;
  const drone = {
    id: session.droneIdCounter++,
    x: factory.x,
    y: factory.y,
    ownerSlot: factory.ownerSlot,
    targetX: target.x,
    targetY: target.y,
    targetType: target.type,
    targetId: target.id,
    createdAt: Date.now()
  };
  session.drones.push(drone);
  io.to(session.sessionId || session.id).emit('drones_update', session.drones);
}
// --- Collisions drones, missiles/bâtiments, etc. par session ---
function checkMissileToMissileCollisionsForSession(session) {
  const collisionDistance = 8;
  for (let i = session.missiles.length - 1; i >= 0; i--) {
    const missile1 = session.missiles[i];
    let missile1Destroyed = false;
    for (let j = i - 1; j >= 0; j--) {
      const missile2 = session.missiles[j];
      const distance = Math.sqrt(
        Math.pow(missile1.x - missile2.x, 2) +
        Math.pow(missile1.y - missile2.y, 2)
      );
      if (distance < collisionDistance) {
        // Supprimer les deux missiles
        session.missiles.splice(i, 1);
        session.missiles.splice(j, 1);
        missile1Destroyed = true;
        break;
      }
    }
    if (missile1Destroyed) break;
  }
}

// Ajout : interception antimissile par session
function checkAntimissileInterceptionForSession(session) {
  const antimissileBuildings = session.buildings.filter(b => b.name === 'Antimissile');
  const interceptionRange = 50;
  for (let i = session.missiles.length - 1; i >= 0; i--) {
    const missile = session.missiles[i];
    let missileIntercepted = false;
    for (const antimissile of antimissileBuildings) {
      if (missile.ownerSlot === antimissile.ownerSlot) continue;
      const distance = Math.sqrt(
        Math.pow(missile.x - antimissile.x, 2) +
        Math.pow(missile.y - antimissile.y, 2)
      );
      if (distance < interceptionRange) {
        console.log(`[SESSION ${session.name}] 🛡️ Antimissile (P${antimissile.ownerSlot + 1}) intercepted enemy missile ${missile.id} (P${missile.ownerSlot + 1}) at distance ${distance.toFixed(1)}px`);
        session.missiles.splice(i, 1);
        missileIntercepted = true;
        break;
      }
    }
    if (missileIntercepted) break;
  }
}

function checkMissileToBuildingCollisionsForSession(session) {
  const buildingCollisionRange = 20;
  let buildingsChanged = false;
  for (let i = session.missiles.length - 1; i >= 0; i--) {
    const missile = session.missiles[i];
    let missileHit = false;
    for (let j = session.buildings.length - 1; j >= 0; j--) {
      const building = session.buildings[j];
      if (missile.ownerSlot === building.ownerSlot) continue;
      const distance = Math.sqrt(
        Math.pow(missile.x - building.x, 2) +
        Math.pow(missile.y - building.y, 2)
      );
      if (distance < buildingCollisionRange) {
        // Si c'est un Lance Missile détruit, arrêter son timer
        if (building.name === 'Lance Missile') {
          stopBarrackTimerForSession(session, building);
        }
        // Supprimer le bâtiment détruit
        session.buildings.splice(j, 1);
        // Supprimer le missile qui a touché
        session.missiles.splice(i, 1);
        missileHit = true;
        buildingsChanged = true;
        break;
      }
    }
    if (missileHit) break;
  }
  // Toujours envoyer la mise à jour après la boucle si des bâtiments ont changé
  if (buildingsChanged) {
    console.log(`[SESSION ${session.name}] buildings_update envoyé, nb bâtiments restants:`, session.buildings.length);
    io.to(session.sessionId || session.id).emit('buildings_update', session.buildings);
  }
}

function checkDroneCollisionsForSession(session) {
  const droneCollisionRange = 15;
  for (let i = session.drones.length - 1; i >= 0; i--) {
    const drone = session.drones[i];
    let droneHit = false;
    // Vérifier la collision avec la cible
    const distance = Math.sqrt(
      Math.pow(drone.x - drone.targetX, 2) +
      Math.pow(drone.y - drone.targetY, 2)
    );
    if (distance < droneCollisionRange) {
      // Appliquer les dégâts selon le type de cible
      if (drone.targetType === 'building') {
        // Chercher le bâtiment ciblé et le détruire
        for (let j = session.buildings.length - 1; j >= 0; j--) {
          const building = session.buildings[j];
          const buildingDistance = Math.sqrt(
            Math.pow(drone.x - building.x, 2) +
            Math.pow(drone.y - building.y, 2)
          );
          if (buildingDistance < droneCollisionRange) {
            // Si c'est un Lance Missile détruit, arrêter son timer
            if (building.name === 'Lance Missile') {
              stopBarrackTimerForSession(session, building);
            }
            // Si c'est une Usine de Drones détruite, arrêter son timer
            if (building.name === 'Usine de Drones') {
              stopDroneFactoryTimerForSession(session, building);
            }
            session.buildings.splice(j, 1);
            io.to(session.sessionId || session.id).emit('buildings_update', session.buildings);
            break;
          }
        }
      }
      if (drone.targetType === 'base') {
        const targetPlayerSlot = parseInt(drone.targetId.split('_')[1]);
        // Stocker le dernier attaquant
        session.lastAttacker[targetPlayerSlot] = drone.ownerSlot;
        const prevHealth = session.playerHealth[targetPlayerSlot];
        session.playerHealth[targetPlayerSlot] = Math.max(0, session.playerHealth[targetPlayerSlot] - DRONE_DAMAGE);
        io.to(session.sessionId || session.id).emit('health_update', session.playerHealth);
        // Si le joueur vient d'être éliminé, annexer son segment
        if (prevHealth > 0 && session.playerHealth[targetPlayerSlot] === 0 && session.lastAttacker[targetPlayerSlot] !== null && session.lastAttacker[targetPlayerSlot] !== targetPlayerSlot) {
          annexSegmentOnElimination(session, targetPlayerSlot, session.lastAttacker[targetPlayerSlot]);
        }
      }
      // Supprimer le drone qui a explosé
      session.drones.splice(i, 1);
      droneHit = true;
    }
    if (droneHit) break;
  }
}

// Ajout : gestion des segments possédés par chaque joueur (par session)
function annexSegmentOnElimination(session, eliminatedSlot, killerSlot) {
  if (!session.segmentsByPlayer) session.segmentsByPlayer = new Map();
  // Ajouter le segment éliminé à la liste du vainqueur
  if (!session.segmentsByPlayer.has(killerSlot)) session.segmentsByPlayer.set(killerSlot, new Set([killerSlot]));
  session.segmentsByPlayer.get(killerSlot).add(eliminatedSlot);
  // Transférer tous les bâtiments du segment
  const screenWidth = 1920;
  const segmentWidth = screenWidth / 8;
  const segStart = eliminatedSlot * segmentWidth;
  const segEnd = segStart + segmentWidth;
  session.buildings.forEach(b => {
    if (b.x >= segStart && b.x < segEnd) {
      b.ownerSlot = killerSlot;
    }
  });
  // Mettre à jour le pseudo du segment (affiché côté client)
  // (Le client affichera le pseudo du killerSlot pour ce segment)
  // Fusionner la vie : tous les segments du vainqueur affichent la vie de killerSlot
  // (Côté client, il faudra afficher playerHealth[killerSlot] pour tous les segments du vainqueur)
  // Envoyer les updates
  io.to(session.sessionId || session.id).emit('buildings_update', session.buildings);
  io.to(session.sessionId || session.id).emit('segments_update', Array.from(session.segmentsByPlayer.entries()).map(([slot, segs]) => ({ownerSlot: slot, segments: Array.from(segs)})));
}

// Ajoute la production automatique de datas par session
function startDatasProductionForSession(sessionId) {
  const session = sessions[sessionId];
  if (!session) return;
  if (session.datasProdInterval) clearInterval(session.datasProdInterval);
  session.datasProdInterval = setInterval(() => {
    for (let i = 0; i < session.players.length; i++) {
      const player = session.players[i];
      if (player && typeof player.datas === 'number') {
        player.datas += 20000;
        // Envoie la nouvelle valeur au client
        const sockets = Array.from(io.sockets.sockets.values());
        for (const s of sockets) {
          if (s.sessionId === sessionId && s.playerIndex === i) {
            s.emit('resources_update', { datas: player.datas });
          }
        }
      }
    }
  }, 1000);
}
function stopDatasProductionForSession(sessionId) {
  const session = sessions[sessionId];
  if (session && session.datasProdInterval) {
    clearInterval(session.datasProdInterval);
    session.datasProdInterval = null;
  }
} 