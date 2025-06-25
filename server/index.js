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

// Configuration des bots AI
const BOT_NAMES = [
  'AlphaBot', 'BetaBot', 'GammaBot', 'DeltaBot', 
  'EpsilonBot', 'ZetaBot', 'EtaBot', 'ThetaBot'
];

const BOT_BUILDINGS = [
  { name: 'Crypto Farm', icon: '💻', cost: 25000, priority: 1 },
  { name: 'Lance Missile', icon: '🚀', cost: 50000, priority: 2 },
  { name: 'Serveur', icon: '🖥️', cost: 75000, priority: 3 },
  { name: 'Antimissile', icon: '🛡️', cost: 20000, priority: 4 },
  { name: 'Centre Médical', icon: '🏥', cost: 100000, priority: 6 },
  { name: 'Usine de Drones', icon: '🤖', cost: 55000, priority: 7 }
];

// Configuration des ressources
const INITIAL_RESOURCES = { gold: 30000, datas: 100000, cryptoPerSec: 1000, datasPerSec: 20000 };
const BASE_GOLD_PER_SEC = 1000;
const CRYPTO_FARM_BONUS = 5000;

// Gestion des sessions (parties)
let sessions = {};

function createSession(sessionName, mode = 'standard') {
  // Génère un id unique simple (timestamp + random)
  const sessionId = `${Date.now()}_${Math.floor(Math.random()*10000)}`;
  const maxPlayers = mode === '1v1' ? 2 : 8;
  const players = Array(maxPlayers).fill(null); // slots vides
  sessions[sessionId] = {
    sessionId,
    name: sessionName,
    mode,
    players: players,
    buildings: [],
    missiles: [],
    drones: [],
    playerHealth: Array(maxPlayers).fill(100),
    countdown: null,
    countdownValue: 0,
    gameStarted: false,
    missileIdCounter: 0,
    droneIdCounter: 0,
    barrackTimers: new Map(),
    droneFactoryTimers: new Map(),
    buildingIdCounter: 0,
    segmentsByPlayer: new Map(),
    lastAttacker: Array(maxPlayers).fill(null),
    botTimers: new Map(), // Timers pour les bots
  };
  // Ne pas créer les bots ici, ils seront créés quand la partie commence (sauf en 1v1)
  console.log(`[SESSION ${sessionName}] Session créée (${mode})`);
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
  // Adapter la largeur de segment selon le mode de la session
  const session = Object.values(sessions).find(s => 
    s.buildings.some(b => b.id === barrack.id)
  );
  const nbSegments = session && session.mode === '1v1' ? 2 : 8;
  const segmentWidth = screenWidth / nbSegments;
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
  // Adapter la largeur de segment selon le mode de la session
  // Pour l'instant, on utilise le mode standard (8 segments) car cette fonction est globale
  const nbSegments = 8; // Mode standard par défaut
  const segmentWidth = screenWidth / nbSegments;
  
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
  // Adapter la largeur de segment selon le mode de la session
  // Pour l'instant, on utilise le mode standard (8 segments) car cette fonction est globale
  const nbSegments = 8; // Mode standard par défaut
  const segmentWidth = screenWidth / nbSegments;
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
            // Si c'est un Serveur détruit, pas de timer à arrêter mais on peut logger
            if (building.name === 'Serveur') {
              console.log(`💻 Serveur (P${building.ownerSlot + 1}) détruit par drone`);
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
  console.log('🔌 Nouveau socket connecté:', socket.id);
  
  // Test de connexion
  socket.on('test_connection', (data) => {
    console.log('✅ Test de connexion reçu de', socket.id, ':', data);
    socket.emit('test_response', { message: 'Test response from server' });
  });
  
  // Liste des sessions
  socket.on('list_sessions', () => {
    // Envoie la liste des sessions (id + nom + nb joueurs + mode)
    const list = Object.entries(sessions).map(([id, s]) => ({
      id,
      name: s.name,
      mode: s.mode,
      players: s.players.filter(p => p && !p.isBot).length // Ne compter que les vrais joueurs
    }));
    socket.emit('sessions_list', list);
  });

  // Créer une session
  socket.on('create_session', (sessionName, mode, cb) => {
    console.log('[SOCKET] create_session reçu pour', sessionName, 'mode:', mode);
    const sessionId = createSession(sessionName, mode);
    cb && cb(sessionId);
    // Broadcast la nouvelle liste
    io.emit('sessions_list', Object.entries(sessions).map(([id, s]) => ({
      id,
      name: s.name,
      mode: s.mode,
      players: s.players.filter(p => p && !p.isBot).length
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
    console.log(`[SESSION ${session.name}] 📤 Envoi your_index: ${freeIndex} à socket ${socket.id}`);
    console.log(`[SESSION ${session.name}] 📤 Socket dans room ${sessionId}:`, socket.rooms.has(sessionId));
    socket.emit('your_index', freeIndex);
    io.to(sessionId).emit('players_update', session.players);
    socket.emit('buildings_update', session.buildings);
    socket.emit('missiles_update', session.missiles);
    socket.emit('health_update', session.playerHealth);
    // Démarrage du compte à rebours si 2 joueurs ou plus
    if (session.players.filter(p => p && !p.isBot).length >= 2 && !session.gameStarted) {
      startCountdownForSession(sessionId);
    }
  });

  // Place un bâtiment dans une session
  socket.on('place_building', (data) => {
    console.log('[DEBUG PLACE_BUILDING] Reçu du client:', data);
    const { sessionId, ...building } = data;
    const session = sessions[sessionId];
    if (!session) {
      console.log('[DEBUG BLOCK] Session introuvable pour', sessionId);
      return;
    }
    const slot = building.ownerSlot;
    if (slot == null || session.players[slot] == null) {
      console.log('[DEBUG BLOCK] Slot ou joueur invalide:', slot);
      return;
    }
    if (session.players[slot].eliminated || session.playerHealth[slot] === 0) {
      console.log('[DEBUG BLOCK] Joueur éliminé (slot', slot, ')');
      return;
    }
    // Vérification du coût dynamique
    const dynamicCost = getDynamicBuildingCost(session, slot, building.name);
    if (session.players[slot].gold < dynamicCost) {
      console.log('[DEBUG BLOCK] Pas assez de gold:', session.players[slot].gold, '<', dynamicCost);
      if (socket && socket.emit) {
        socket.emit('build_error', { message: "Pas assez de crypto pour ce bâtiment (prix dynamique)." });
      }
      return;
    }
    // Vérification collision ou zone interdite (exemple générique)
    // (ajoute ici d'autres validations spécifiques à ton jeu)
    // ...
    // Si tout est OK, ajout du bâtiment
    session.players[slot].gold -= dynamicCost;
    const buildingToAdd = { ...building };
    buildingToAdd.cost = dynamicCost;
    buildingToAdd.id = session.buildingIdCounter++;
    session.buildings.push(buildingToAdd);
    console.log('[DEBUG BUILD] Bâtiment ajouté à session.buildings:', buildingToAdd, '| Total:', session.buildings.length);
    const countAfter = session.buildings.filter(b => b.ownerSlot === slot && b.name === building.name).length;
    console.log(`[DEBUG BUILD] ${building.name} construit par slot ${slot} | coût: ${dynamicCost} | gold restant: ${session.players[slot].gold} | nb après: ${countAfter} | total buildings: ${session.buildings.length}`);
    io.to(sessionId).emit('buildings_update', session.buildings);
    console.log('[DEBUG BUILDINGS_UPDATE] Envoyé au client:', session.buildings.length, 'bâtiments');
    io.to(sessionId).emit('players_update', session.players);
    // Synchronisation explicite du gold pour le joueur
    if (socket && socket.emit) {
      socket.emit('resources_update', { gold: session.players[slot].gold });
    }
    if (buildingToAdd.name === 'Lance Missile') {
      startBarrackTimerForSession(session, buildingToAdd);
    }
    if (buildingToAdd.name === 'Usine de Drones') {
      startDroneFactoryTimerForSession(session, buildingToAdd);
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
    // Arrêter les timers des bots
    if (session.botTimers) {
      session.botTimers.forEach(timer => clearInterval(timer));
      session.botTimers.clear();
    }
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

    // Supprimer tous les bots des slots (pour qu'ils soient recréés proprement au prochain start)
    session.players = session.players.map(p => (p && p.isBot ? null : p));

    // Ne pas recréer les bots ici, ils seront recréés quand la partie redémarre
    console.log(`[SESSION ${session.name}] Reset sans bots`);

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

  // Ajout : gestion du bombardement aérien
  socket.on('air_strike', ({ x, y, sessionId }) => {
    const session = sessions[sessionId];
    if (!session || !session.gameStarted) return;
    
    console.log(`[SESSION ${session.name}] 🛩️ Air strike at x=${x}, y=${y}`);
    
    const strikeRadius = 100; // Rayon de 100px
    let buildingsDestroyed = 0;
    
    // Parcourir tous les bâtiments dans la session
    for (let i = session.buildings.length - 1; i >= 0; i--) {
      const building = session.buildings[i];
      
      // Calculer la distance entre le point de bombardement et le bâtiment
      const distance = Math.sqrt(
        Math.pow(building.x - x, 2) + 
        Math.pow(building.y - y, 2)
      );
      
      // Si le bâtiment est dans la zone de bombardement
      if (distance <= strikeRadius) {
        console.log(`[SESSION ${session.name}] 💥 Air strike destroyed ${building.name} (P${building.ownerSlot + 1}) at distance ${distance.toFixed(1)}px`);
        
        // Si c'est un Lance Missile détruit, arrêter son timer
        if (building.name === 'Lance Missile') {
          stopBarrackTimerForSession(session, building);
        }
        // Si c'est une Usine de Drones détruite, arrêter son timer
        if (building.name === 'Usine de Drones') {
          stopDroneFactoryTimerForSession(session, building);
        }
        
        // Supprimer le bâtiment
        session.buildings.splice(i, 1);
        buildingsDestroyed++;
      }
    }
    
    if (buildingsDestroyed > 0) {
      console.log(`[SESSION ${session.name}] 🛩️ Air strike completed: ${buildingsDestroyed} buildings destroyed`);
      io.to(sessionId).emit('buildings_update', session.buildings);
    }
  });

  // TODO : Adapter tous les autres événements (place_building, etc.) pour fonctionner par session
  // ...

  // Récupérer l'objet du marché noir courant
  socket.on('get_black_market', ({ sessionId }, cb) => {
    const session = sessions[sessionId];
    if (!session || !session.blackMarket) return cb && cb({ error: 'Session not found' });
    cb && cb(BLACK_MARKET_ITEMS); // Retourner tous les objets au lieu d'un seul
  });

  // Achat d'un objet du marché noir
  socket.on('buy_black_market', ({ sessionId, playerIndex, itemId }, cb) => {
    const session = sessions[sessionId];
    if (!session || !session.blackMarket) return cb && cb({ error: 'Session not found' });
    
    // Trouver l'objet par son ID
    const item = BLACK_MARKET_ITEMS.find(i => i.id === itemId);
    if (!item) return cb && cb({ error: 'Objet introuvable.' });
    
    const player = session.players[playerIndex];
    if (!player) return cb && cb({ error: 'Joueur introuvable.' });
    
    // Vérifier si le joueur a assez de gold
    if (player.gold < item.price) return cb && cb({ error: 'Pas assez de crypto.' });
    
    // Pour la nuke, on ne retire pas le gold immédiatement, juste on active le flag
    if (item.effect === 'nuke_segment') {
      player.pendingNuke = true;
      cb && cb({ success: true, item });
      io.to(session.sessionId).emit('players_update', session.players);
      return;
    }
    
    // Pour les autres objets, retirer le gold immédiatement
    player.gold -= item.price;
    
    // Appliquer l'effet
    if (item.effect === 'heal_base') {
      session.playerHealth[playerIndex] = 100;
      io.to(session.sessionId).emit('health_update', session.playerHealth);
    }
    if (item.effect === 'crypto_boost') {
      // Activer le boost de production pendant 15 secondes
      player.cryptoBoostEndTime = Date.now() + 15000; // 15 secondes
      console.log(`[BOOST] Joueur ${playerIndex} a activé le boost de crypto jusqu'à ${new Date(player.cryptoBoostEndTime)}`);
    }
    // ... autres effets ...
    cb && cb({ success: true, item });
    io.to(session.sessionId).emit('players_update', session.players);
  });

  // Utilisation de la nuke (missile nucléaire)
  socket.on('use_nuke', ({ sessionId, targetSlot }, cb) => {
    const session = sessions[sessionId];
    if (!session || !session.gameStarted) return cb && cb({ error: 'Session introuvable ou partie non démarrée.' });
    if (typeof targetSlot !== 'number' || targetSlot < 0 || targetSlot > 7) return cb && cb({ error: 'Slot cible invalide.' });
    
    // Trouver le joueur qui utilise la nuke
    const player = session.players.find(p => p && p.id === socket.id);
    if (!player || !player.pendingNuke) return cb && cb({ error: 'Vous n\'avez pas de nuke à utiliser.' });
    
    // Vérifier que le joueur a assez de gold pour la nuke
    const nukePrice = 200000;
    if (player.gold < nukePrice) return cb && cb({ error: 'Pas assez de crypto pour utiliser la nuke.' });
    
    // Retirer le gold maintenant que l'utilisation va réussir
    player.gold -= nukePrice;
    
    // Consommer la nuke
    player.pendingNuke = false;
    
    // Trouver tous les bâtiments du slot ciblé
    let destroyed = 0;
    for (let i = session.buildings.length - 1; i >= 0; i--) {
      const building = session.buildings[i];
      if (building.ownerSlot === targetSlot) {
        // Arrêter les timers associés
        if (building.name === 'Lance Missile') {
          stopBarrackTimerForSession(session, building);
        }
        if (building.name === 'Usine de Drones') {
          stopDroneFactoryTimerForSession(session, building);
        }
        session.buildings.splice(i, 1);
        destroyed++;
      }
    }
    
    if (destroyed > 0) {
      io.to(sessionId).emit('buildings_update', session.buildings);
    }
    
    // Mettre à jour les ressources du joueur
    io.to(session.sessionId).emit('players_update', session.players);
    
    cb && cb({ success: true, destroyed });
  });
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
  session.countdownValue = 3;
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

  // --- RANDOMISATION DE TOUS LES JOUEURS (HUMAINS + BOTS) ---
  const allPlayers = session.players.filter(p => p !== null);
  for (let i = allPlayers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allPlayers[i], allPlayers[j]] = [allPlayers[j], allPlayers[i]];
  }
  // Adapter le nombre de slots selon le mode de la session
  const maxPlayers = session.mode === '1v1' ? 2 : 8;
  for (let idx = 0; idx < maxPlayers; idx++) {
    session.players[idx] = allPlayers[idx] || null;
  }
  // Mettre à jour les playerIndex des sockets humains et envoyer le nouvel index
  const ioSockets = Array.from(io.sockets.sockets.values());
  for (let idx = 0; idx < maxPlayers; idx++) {
    const p = session.players[idx];
    if (p && !p.isBot) {
      const sock = ioSockets.find(s => s.id === p.id && s.sessionId === sessionId);
      if (sock) {
        sock.playerIndex = idx;
        sock.emit('your_index', idx);
      }
    }
  }
  // --- FIN RANDOMISATION ---

  // --- RESET & RESTART DES TIMERS DE BOTS ---
  if (session.botTimers) {
    session.botTimers.forEach(timer => clearInterval(timer));
    session.botTimers.clear();
  }
  for (let idx = 0; idx < maxPlayers; idx++) {
    const p = session.players[idx];
    if (p && p.isBot) {
      startBotTimer(sessionId, idx);
    }
  }
  // --- FIN RESET BOTS ---

  // Envoyer la mise à jour des joueurs (incluant les bots)
  io.to(session.sessionId).emit('players_update', session.players);

  // Démarrer la boucle de jeu (missiles, drones, collisions, etc.)
  if (session.loop) clearInterval(session.loop);
  session._lastResourceTick = Date.now();
  session.loop = setInterval(() => {
    if (!session.gameStarted) return;
    // --- Production de ressources pour joueurs humains ---
    const nowResource = Date.now();
    if (!session._lastResourceTick) session._lastResourceTick = nowResource;
    if (nowResource - session._lastResourceTick >= 1000) {
      for (let slot = 0; slot < maxPlayers; slot++) {
        const player = session.players[slot];
        if (player && !player.isBot && session.playerHealth[slot] > 0) {
          // Calculer la production
          // Adapter la largeur de segment selon le mode de la session
          const nbSegments = session.mode === '1v1' ? 2 : 8;
          const SEGMENT_WIDTH = 1920 / nbSegments;
          const myBuildings = session.buildings.filter(b => b.ownerSlot === slot);
          const nbCryptoFarms = myBuildings.filter(b => b.name === 'Crypto Farm').length;
          const nbServeurs = myBuildings.filter(b => b.name === 'Serveur').length;
          const goldGain = BASE_GOLD_PER_SEC + nbCryptoFarms * CRYPTO_FARM_BONUS;
          const datasGain = 20000 + nbServeurs * 10000;
          
          // Appliquer le boost de crypto si actif
          let finalGoldGain = goldGain;
          if (player.cryptoBoostEndTime && Date.now() < player.cryptoBoostEndTime) {
            finalGoldGain = goldGain * 2; // Double la production
            console.log(`[BOOST] Joueur ${slot} - Production boostée: ${goldGain} -> ${finalGoldGain} crypto`);
          } else if (player.cryptoBoostEndTime && Date.now() >= player.cryptoBoostEndTime) {
            // Nettoyer le boost expiré
            console.log(`[BOOST] Boost expiré pour le joueur ${slot}`);
            delete player.cryptoBoostEndTime;
          }
          
          player.gold += finalGoldGain;
          player.datas += datasGain;
          // Envoi au joueur
          const sock = Array.from(io.sockets.sockets.values()).find(s => s.id === player.id && s.sessionId === sessionId);
          if (sock && sock.emit) {
            sock.emit('resources_update', { gold: player.gold, datas: player.datas });
          }
        }
      }
      session._lastResourceTick = nowResource;
    }
    // Déplacer les missiles
    session.missiles.forEach(missile => {
      // Utiliser la vitesse spécifique au type de missile, ou la vitesse par défaut
      const missileSpeed = missile.speed || MISSILE_SPEED;
      missile.x += missile.direction * missileSpeed;
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
    // --- Régénération Centre Médical ---
    if (!session._lastRegenTick) session._lastRegenTick = Date.now();
    const now = Date.now();
    if (now - session._lastRegenTick >= 1000) {
      let healthChanged = false;
      for (let slot = 0; slot < maxPlayers; slot++) {
        if (session.playerHealth[slot] > 0) {
          const hasMedical = session.buildings.some(b => b.ownerSlot === slot && b.name === 'Centre Médical');
          if (hasMedical) {
            const before = session.playerHealth[slot];
            session.playerHealth[slot] = Math.min(100, session.playerHealth[slot] + 1);
            if (session.playerHealth[slot] !== before) healthChanged = true;
          }
        }
      }
      if (healthChanged) {
        io.to(session.sessionId).emit('health_update', session.playerHealth);
      }
      session._lastRegenTick = now;
    }
    // Collisions par session
    checkMissileCollisionsForSession(session);
    checkMissileToMissileCollisionsForSession(session);
    checkAntimissileInterceptionForSession(session);
    checkMissileToBuildingCollisionsForSession(session);
    checkDroneCollisionsForSession(session);
    io.to(session.sessionId).emit('missiles_update', session.missiles);
    io.to(session.sessionId).emit('drones_update', session.drones);
  }, 16);

  // Démarrer la production de datas
  startDatasProductionForSession(sessionId);

  // Envoyer l'état initial à tous les joueurs
  io.to(session.sessionId).emit('game_started', {
    buildings: session.buildings,
    missiles: session.missiles,
    drones: session.drones,
    playerHealth: session.playerHealth
  });

  // --- MARCHÉ NOIR ---
  if (session.blackMarket && session.blackMarket.timer) {
    clearInterval(session.blackMarket.timer);
  }
  initBlackMarketForSession(session);
  io.to(session.sessionId).emit('black_market_update', getCurrentBlackMarketItem(session));
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
  // Adapter la largeur de segment selon le mode de la session
  const nbSegments = session.mode === '1v1' ? 2 : 8;
  const segmentWidth = screenWidth / nbSegments;
  const segmentMidpoint = barrack.ownerSlot * segmentWidth + segmentWidth / 2;
  const direction = barrack.x < segmentMidpoint ? -1 : 1;
  
  // Propriétés des types de missiles
  const MISSILE_TYPES = {
    rapide: { damage: 1, speed: 7, radius: 3, cost: 10000 },
    furtif: { damage: 2, speed: 4, radius: 5, cost: 50000 },
    lourd:  { damage: 5, speed: 2, radius: 7, cost: 100000 }
  };
  
  // Utiliser le type par défaut si aucun n'est défini
  const type = barrack.missileType && MISSILE_TYPES[barrack.missileType] ? barrack.missileType : 'rapide';
  const props = MISSILE_TYPES[type];
  
  // Créer le missile sans vérification de coût (le client gère les ressources)
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
  console.log(`[SESSION ${session.name}] 🚀 Auto-missile créé: ${type} pour P${barrack.ownerSlot + 1}`);
  
  // Envoyer la mise à jour des missiles à la session
  io.to(session.sessionId).emit('missiles_update', session.missiles);
}
// --- Collisions par session ---
function checkMissileCollisionsForSession(session) {
  const screenWidth = 1920;
  // Adapter la largeur de segment selon le mode de la session
  const nbSegments = session.mode === '1v1' ? 2 : 8;
  const segmentWidth = screenWidth / nbSegments;
  for (let i = session.missiles.length - 1; i >= 0; i--) {
    const missile = session.missiles[i];
    // Déterminer la direction du missile
    const direction = missile.direction || 1;
    // Trouver le segment actuel du missile
    let missileSegment = Math.floor(missile.x / segmentWidth);
    // On va parcourir les segments dans la direction du missile
    let segmentsToCheck = [];
    if (direction === 1) {
      for (let s = missileSegment; s < nbSegments; s++) segmentsToCheck.push(s);
    } else {
      for (let s = missileSegment; s >= 0; s--) segmentsToCheck.push(s);
    }
    let lastOwner = null;
    let hit = false;
    for (const playerSlot of segmentsToCheck) {
      const playerCenterX = playerSlot * segmentWidth + segmentWidth / 2;
      // Déterminer le vrai propriétaire du segment via segmentsByPlayer
      let ownerSlot = playerSlot;
      if (session.segmentsByPlayer && session.segmentsByPlayer instanceof Map && session.segmentsByPlayer.size > 0) {
        for (const [slot, segs] of session.segmentsByPlayer.entries()) {
          if (segs instanceof Set && segs.has(playerSlot)) {
            ownerSlot = parseInt(slot);
            break;
          }
        }
      }
      // Si c'est le même owner que le segment précédent, on ignore (le missile traverse)
      if (lastOwner !== null && ownerSlot === lastOwner) continue;
      lastOwner = ownerSlot;
      // Ne pas toucher les bases alliées
      if (missile.ownerSlot === ownerSlot) continue;
      if (Math.abs(missile.x - playerCenterX) < 10) {
        // Stocker le dernier attaquant
        session.lastAttacker[playerSlot] = missile.ownerSlot;
        const prevHealth = session.playerHealth[ownerSlot];
        // Appliquer les dégâts du missile (par défaut 1 si non défini)
        const dmg = typeof missile.damage === 'number' ? missile.damage : 1;
        session.playerHealth[ownerSlot] = Math.max(0, session.playerHealth[ownerSlot] - dmg);
        session.missiles.splice(i, 1);
        io.to(session.sessionId).emit('health_update', session.playerHealth);
        // Si le joueur vient d'être éliminé, annexer son segment
        if (prevHealth > 0 && session.playerHealth[ownerSlot] === 0 && session.lastAttacker[playerSlot] !== null && session.lastAttacker[playerSlot] !== ownerSlot) {
          annexSegmentOnElimination(session, playerSlot, session.lastAttacker[playerSlot]);
        }
        hit = true;
        break;
      }
    }
    if (hit) continue;
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
  // Trouver une cible ennemie (Antimissile uniquement)
  const screenWidth = 1920;
  // Adapter la largeur de segment selon le mode de la session
  const nbSegments = session.mode === '1v1' ? 2 : 8;
  const segmentWidth = screenWidth / nbSegments;
  const segmentStart = factory.ownerSlot * segmentWidth;
  const segmentEnd = segmentStart + segmentWidth;
  const segmentMidpoint = segmentStart + segmentWidth / 2;
  const direction = factory.x < segmentMidpoint ? -1 : 1;

  // Chercher uniquement des bâtiments ennemis de type 'Antimissile' dans la bonne direction
  const enemyAntimissiles = session.buildings.filter(b => {
    if (b.ownerSlot === factory.ownerSlot) return false;
    if (b.name !== 'Antimissile') return false;
    if (direction === 1) {
      return b.x >= segmentMidpoint;
    } else {
      return b.x < segmentMidpoint;
    }
  });

  if (enemyAntimissiles.length === 0) {
    // Aucun antimissile ennemi dans la direction : ne rien faire
    return;
  }

  // Trouver l'antimissile ennemi le plus proche
  let closest = null;
  let minDist = Infinity;
  for (const b of enemyAntimissiles) {
    const dist = Math.sqrt((factory.x - b.x) ** 2 + (factory.y - b.y) ** 2);
    if (dist < minDist) {
      minDist = dist;
      closest = b;
    }
  }
  const target = {
    x: closest.x,
    y: closest.y,
    type: 'building',
    id: closest.id || 'building'
  };

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
        // Si c'est une Usine de Drones détruite, arrêter son timer
        if (building.name === 'Usine de Drones') {
          stopDroneFactoryTimerForSession(session, building);
        }
        // Si c'est un Serveur détruit, pas de timer à arrêter mais on peut logger
        if (building.name === 'Serveur') {
          console.log(`[SESSION ${session.name}] 💻 Serveur (P${building.ownerSlot + 1}) détruit par drone`);
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
  // Récupérer récursivement tous les segments annexés par la victime, même indirectement
  let allSegments = new Set();
  function collectAnnexedSegments(slot) {
    // Trouver tous les segments dont le ownerSlot est 'slot'
    for (const [owner, segs] of session.segmentsByPlayer.entries()) {
      if (parseInt(owner) === slot) {
        for (const seg of segs) {
          if (!allSegments.has(seg)) {
            allSegments.add(seg);
            collectAnnexedSegments(seg);
          }
        }
      }
    }
  }
  allSegments.add(eliminatedSlot);
  collectAnnexedSegments(eliminatedSlot);
  // Ajouter tous les segments à la liste du vainqueur
  if (!session.segmentsByPlayer.has(killerSlot)) session.segmentsByPlayer.set(killerSlot, new Set([killerSlot]));
  for (const seg of allSegments) {
    session.segmentsByPlayer.get(killerSlot).add(seg);
  }
  // Transférer tous les bâtiments des segments annexés
  const screenWidth = 1920;
  // Adapter la largeur de segment selon le mode de la session
  const nbSegments = session.mode === '1v1' ? 2 : 8;
  const segmentWidth = screenWidth / nbSegments;
  for (const seg of allSegments) {
    const segStart = seg * segmentWidth;
    const segEnd = segStart + segmentWidth;
    session.buildings.forEach(b => {
      if (b.x >= segStart && b.x < segEnd) {
        b.ownerSlot = killerSlot;
      }
    });
  }
  // Mettre à jour le pseudo du segment (affiché côté client)
  // Synchroniser la vie : tous les segments du vainqueur affichent la vie de killerSlot
  // (Côté client, il faudra afficher playerHealth[killerSlot] pour tous les segments du vainqueur)
  io.to(session.sessionId || session.id).emit('buildings_update', session.buildings);
  io.to(session.sessionId || session.id).emit('segments_update', Array.from(session.segmentsByPlayer.entries()).map(([slot, segs]) => ({ownerSlot: slot, segments: Array.from(segs)})));
}

// Ajoute la production automatique de datas par session
function startDatasProductionForSession(sessionId) {
  const session = sessions[sessionId];
  if (!session) return;
  // Suppression de la logique complexe - la production se fait côté client comme pour la Crypto Farm
  console.log(`[SESSION ${session.name}] 💻 Production de datas gérée côté client (comme Crypto Farm)`);
}
function stopDatasProductionForSession(sessionId) {
  const session = sessions[sessionId];
  if (session && session.datasProdInterval) {
    clearInterval(session.datasProdInterval);
    session.datasProdInterval = null;
  }
}

// --- FONCTIONS POUR LES BOTS AI ---
function createBotPlayer(sessionId, slot) {
  const session = sessions[sessionId];
  if (!session || session.players[slot]) return;
  
  const botName = BOT_NAMES[slot] || `Bot${slot + 1}`;
  session.players[slot] = {
    id: `bot_${slot}`,
    pseudo: botName,
    isBot: true,
    gold: INITIAL_RESOURCES.gold,
    datas: INITIAL_RESOURCES.datas
  };
  
  console.log(`[SESSION ${session.name}] 🤖 Bot créé: ${botName} sur slot ${slot}`);
  
  // Démarrer le timer du bot
  startBotTimer(sessionId, slot);
}

function startBotTimer(sessionId, slot) {
  const session = sessions[sessionId];
  if (!session) return;
  
  const botTimer = setInterval(() => {
    if (!session.gameStarted) return;
    
    const bot = session.players[slot];
    if (!bot || !bot.isBot) {
      clearInterval(botTimer);
      return;
    }
    
    // Logique du bot
    botThink(sessionId, slot);
  }, 3000); // Le bot pense toutes les 3 secondes
  
  // Stocker le timer pour pouvoir l'arrêter plus tard
  if (!session.botTimers) session.botTimers = new Map();
  session.botTimers.set(slot, botTimer);
}

function stopBotTimer(sessionId, slot) {
  const session = sessions[sessionId];
  if (!session || !session.botTimers) return;
  
  const timer = session.botTimers.get(slot);
  if (timer) {
    clearInterval(timer);
    session.botTimers.delete(slot);
  }
}

function botThink(sessionId, slot) {
  const session = sessions[sessionId];
  if (!session) return;
  
  const bot = session.players[slot];
  if (!bot || !bot.isBot) return;
  
  // Vérifier si le bot est encore en vie
  if (session.playerHealth[slot] <= 0) {
    console.log(`[SESSION ${session.name}] 🤖 ${bot.pseudo} est mort, ne peut plus construire`);
    return;
  }
  
  // Mettre à jour les ressources du bot (production automatique)
  updateBotResources(sessionId, slot);
  
  // Décider quoi construire
  const buildingToBuild = decideBotBuilding(sessionId, slot);
  if (buildingToBuild) {
    placeBotBuilding(sessionId, slot, buildingToBuild);
  }
}

function updateBotResources(sessionId, slot) {
  const session = sessions[sessionId];
  if (!session) return;
  
  const bot = session.players[slot];
  if (!bot || !bot.isBot) return;
  
  // Vérifier si le bot est encore en vie
  if (session.playerHealth[slot] <= 0) {
    console.log(`[SESSION ${session.name}] 🤖 ${bot.pseudo} est mort, pas de production`);
    return;
  }
  
  // Calculer la production du bot
  // Adapter la largeur de segment selon le mode de la session
  const nbSegments = session.mode === '1v1' ? 2 : 8;
  const SEGMENT_WIDTH = 1920 / nbSegments;
  const botBuildings = session.buildings.filter(b => b.ownerSlot === slot);
  const nbCryptoFarms = botBuildings.filter(b => b.name === 'Crypto Farm').length;
  const nbServeurs = botBuildings.filter(b => b.name === 'Serveur').length;
  
  // Production de base + bonus
  const goldGain = BASE_GOLD_PER_SEC + nbCryptoFarms * CRYPTO_FARM_BONUS;
  const datasGain = 20000 + nbServeurs * 10000;
  
  // Mettre à jour les ressources
  bot.gold += goldGain;
  bot.datas += datasGain;
  
  console.log(`[SESSION ${session.name}] 🤖 ${bot.pseudo} - Gold: ${bot.gold}, Datas: ${bot.datas}`);
}

function decideBotBuilding(sessionId, slot) {
  const session = sessions[sessionId];
  if (!session) return null;
  const bot = session.players[slot];
  if (!bot || !bot.isBot) return null;
  // Adapter la largeur de segment selon le mode de la session
  const nbSegments = session.mode === '1v1' ? 2 : 8;
  const SEGMENT_WIDTH = 1920 / nbSegments;
  const segmentStart = slot * SEGMENT_WIDTH;
  const segmentEnd = segmentStart + SEGMENT_WIDTH;
  const botBuildings = session.buildings.filter(b => b.ownerSlot === slot);
  if (botBuildings.length >= 8) return null;

  // --- Priorité absolue : Crypto Farm en tout premier ---
  if (!botBuildings.some(b => b.name === 'Crypto Farm') && bot.gold >= 25000) {
    return { name: 'Crypto Farm', icon: '💻', cost: 25000, priority: 1 };
  }
  // --- Ensuite : Lance Missile dès que possible ---
  if (!botBuildings.some(b => b.name === 'Lance Missile') && bot.gold >= 50000) {
    return { name: 'Lance Missile', icon: '🚀', cost: 50000, priority: 2 };
  }
  // --- Ne jamais construire de Serveur tant qu'il n'y a pas de Lance Missile ---
  if (!botBuildings.some(b => b.name === 'Lance Missile')) {
    return null;
  }
  // --- Stratégie avancée : offensive prioritaire si pas assez de Lance Missiles ou Usine de Drones ---
  const nbLanceMissiles = botBuildings.filter(b => b.name === 'Lance Missile').length;
  const nbUsines = botBuildings.filter(b => b.name === 'Usine de Drones').length;
  if (nbLanceMissiles < 2 && bot.gold >= 50000) {
    return { name: 'Lance Missile', icon: '🚀', cost: 50000, priority: 1 };
  }
  if (nbUsines < 1 && bot.gold >= 55000) {
    return { name: 'Usine de Drones', icon: '🤖', cost: 55000, priority: 2 };
  }
  // --- Production si ressources faibles ---
  if (bot.gold < 40000 && !botBuildings.some(b => b.name === 'Serveur') && bot.gold >= 75000) {
    return { name: 'Serveur', icon: '🖥️', cost: 75000, priority: 2 };
  }
  // ... puis stratégie avancée ...

  // --- 1. Adaptation à la menace ---
  const isUnderThreat = session.playerHealth[slot] < 50 || (session._lastBotHealth && session.playerHealth[slot] < session._lastBotHealth[slot]);
  session._lastBotHealth = session._lastBotHealth || Array(8).fill(100);
  session._lastBotHealth[slot] = session.playerHealth[slot];

  // --- 2. Défense des bases annexées ---
  let annexedSegments = [];
  if (session.segmentsByPlayer && session.segmentsByPlayer.has(slot)) {
    annexedSegments = Array.from(session.segmentsByPlayer.get(slot)).filter(s => s !== slot);
  }

  // --- 3. Offensive si en avance ---
  const nbBases = (session.segmentsByPlayer && session.segmentsByPlayer.has(slot)) ? session.segmentsByPlayer.get(slot).size : 1;
  const isAggressive = nbBases > 2 || bot.gold > 120000;

  // --- 4. Ciblage intelligent ---
  let weakestEnemySlot = null;
  let minHealth = 101;
  for (let i = 0; i < 8; i++) {
    if (i !== slot && session.playerHealth[i] > 0 && session.playerHealth[i] < minHealth) {
      minHealth = session.playerHealth[i];
      weakestEnemySlot = i;
    }
  }

  // --- 5. Répartition spatiale ---
  function isTooCloseToSameType(x, y, type) {
    return botBuildings.some(b => b.name === type && Math.abs(b.x - x) < 40 && Math.abs(b.y - y) < 40);
  }

  // --- 6. Après capture, défendre la base prise ---
  if (annexedSegments.length > 0) {
    for (const seg of annexedSegments) {
      const hasAnti = session.buildings.some(b => b.ownerSlot === slot && Math.abs(b.x - (seg * SEGMENT_WIDTH + SEGMENT_WIDTH/2)) < 60 && b.name === 'Antimissile');
      if (!hasAnti && bot.gold >= 20000) {
        return { name: 'Antimissile', icon: '🛡️', cost: 20000, priority: 0, force: true, xTarget: seg * SEGMENT_WIDTH + SEGMENT_WIDTH/2 };
      }
    }
  }

  // --- 7. Utilisation du bombardement aérien ---
  if (isAggressive && bot.gold >= 150000) {
    // Cibler la base ennemie la plus faible ou un cluster de bâtiments
    let targetSlot = weakestEnemySlot;
    if (targetSlot !== null) {
      const enemyBuildings = session.buildings.filter(b => b.ownerSlot === targetSlot);
      if (enemyBuildings.length >= 2) {
        // Déclencher un bombardement sur le centre de la base
        const avgX = enemyBuildings.reduce((sum, b) => sum + b.x, 0) / enemyBuildings.length;
        const avgY = enemyBuildings.reduce((sum, b) => sum + b.y, 0) / enemyBuildings.length;
        // Simuler l'appel (dans la vraie logique, il faudrait socket.emit côté bot, ici on peut juste placer un marqueur ou log)
        if (!session._lastBotAirStrike || Date.now() - session._lastBotAirStrike > 20000) {
          session._lastBotAirStrike = Date.now();
          // On simule l'appel d'un air_strike (à implémenter côté bot si besoin)
          console.log(`[BOT ${bot.pseudo}] Bombardement aérien sur base P${targetSlot+1} (${Math.round(avgX)},${Math.round(avgY)})`);
          // On pourrait appeler ici une fonction airStrikeBot(session, avgX, avgY);
        }
      }
    }
  }

  // --- Défense prioritaire si sous menace ---
  if (isUnderThreat) {
    if (bot.gold >= 20000 && !botBuildings.some(b => b.name === 'Antimissile')) {
      return { name: 'Antimissile', icon: '🛡️', cost: 20000, priority: 0 };
    }
    if (bot.gold >= 100000 && !botBuildings.some(b => b.name === 'Centre Médical')) {
      return { name: 'Centre Médical', icon: '🏥', cost: 100000, priority: 0 };
    }
  }

  // --- Offensive si en avance ---
  if (isAggressive) {
    if (bot.gold >= 50000 && botBuildings.filter(b => b.name === 'Lance Missile').length < 3) {
      // Répartition spatiale
      let tryX, tryY, attempts = 0;
      do {
        tryX = segmentStart + 40 + Math.random() * (SEGMENT_WIDTH - 80);
        tryY = 140 + Math.random() * 420;
        attempts++;
      } while (isTooCloseToSameType(tryX, tryY, 'Lance Missile') && attempts < 10);
      return { name: 'Lance Missile', icon: '🚀', cost: 50000, priority: 1 };
    }
    if (bot.gold >= 55000 && !botBuildings.some(b => b.name === 'Usine de Drones')) {
      return { name: 'Usine de Drones', icon: '🤖', cost: 55000, priority: 2 };
    }
  }

  // --- Production si ressources faibles ---
  if (bot.gold < 40000 && !botBuildings.some(b => b.name === 'Crypto Farm')) {
    return { name: 'Crypto Farm', icon: '💻', cost: 25000, priority: 1 };
  }
  if (bot.gold < 40000 && !botBuildings.some(b => b.name === 'Serveur')) {
    return { name: 'Serveur', icon: '🖥️', cost: 75000, priority: 2 };
  }

  // --- Logique existante fallback ---
  const sortedBuildings = [...BOT_BUILDINGS].sort((a, b) => a.priority - b.priority);
  for (const building of sortedBuildings) {
    if (bot.gold >= building.cost) {
      const hasBuilding = botBuildings.some(b => b.name === building.name);
      const canHaveMultiple = ['Crypto Farm', 'Serveur', 'Lance Missile', 'Antimissile'].includes(building.name);
      if (building.name === 'Antimissile') {
        const nbAntimissiles = botBuildings.filter(b => b.name === 'Antimissile').length;
        if (nbAntimissiles >= 2) continue;
      }
      if (building.name === 'Lance Missile') {
        if (botBuildings.filter(b => b.name === 'Lance Missile').length >= 3) continue;
      }
      if (!hasBuilding || canHaveMultiple) {
        return building;
      }
    }
  }
  return null;
}

function placeBotBuilding(sessionId, slot, building) {
  const session = sessions[sessionId];
  if (!session) return;
  const bot = session.players[slot];
  if (!bot || !bot.isBot) return;
  // Adapter la largeur de segment selon le mode de la session
  const nbSegments = session.mode === '1v1' ? 2 : 8;
  const SEGMENT_WIDTH = 1920 / nbSegments;
  const segmentStart = slot * SEGMENT_WIDTH;
  const segmentEnd = segmentStart + SEGMENT_WIDTH;
  const segmentCenter = segmentStart + SEGMENT_WIDTH / 2;
  const botBuildings = session.buildings.filter(b => b.ownerSlot === slot);
  let attempts = 0;
  let x, y;
  const minDistance = 50;
  const margin = 30;
  // Placement prioritaire à gauche ou à droite de la barre de vie pour les bâtiments principaux
  const mainBuildings = ['Lance Missile', 'Crypto Farm', 'Serveur', 'Usine de Drones'];
  if (mainBuildings.includes(building.name)) {
    // Placement spécial pour slots extrêmes
    let offset;
    if (slot === 0) offset = -40;
    else if (slot === 7) offset = 40;
    else offset = (slot % 2 === 0) ? -40 : 40;
    x = segmentCenter + offset;
    x = Math.max(segmentStart + margin, Math.min(segmentEnd - margin, x));
    // y aléatoire dans la base, hors barre de vie
    let yAttempts = 0;
    do {
      y = 140 + Math.random() * (560 - 140);
      yAttempts++;
    } while (isOnHealthBar(x, y, slot) && yAttempts < 10);
    if (isOnHealthBar(x, y, slot)) return; // abandonne si impossible
  } else if (building.name === 'Antimissile' && building.xTarget !== undefined) {
    x = Math.max(segmentStart + margin, Math.min(segmentEnd - margin, building.xTarget));
    y = 200 + Math.random() * 200;
    if (isOnHealthBar(x, y, slot)) y = 140;
  } else {
    // Placement standard, toujours dans le segment avec marge
    do {
      x = segmentStart + margin + Math.random() * (SEGMENT_WIDTH - 2 * margin);
      y = 140 + Math.random() * 420;
      if (isOnHealthBar(x, y, slot)) continue;
      const tooClose = botBuildings.some(b => {
        const distance = Math.sqrt((b.x - x) ** 2 + (b.y - y) ** 2);
        return distance < minDistance;
      });
      if (!tooClose) break;
      attempts++;
    } while (attempts < 20);
    if (isOnHealthBar(x, y, slot) || attempts >= 20) return; // Abandonne si impossible
  }
  const buildingToPlace = {
    id: session.buildingIdCounter++,
    x: Math.round(x),
    y: Math.round(y),
    name: building.name,
    icon: building.icon,
    cost: building.cost,
    ownerSlot: slot
  };
  bot.gold -= building.cost;
  session.buildings.push(buildingToPlace);
  console.log(`[SESSION ${session.name}] 🤖 ${bot.pseudo} construit: ${building.name} à (${Math.round(x)}, ${Math.round(y)})`);
  if (building.name === 'Lance Missile') {
    startBarrackTimerForSession(session, buildingToPlace);
  }
  if (building.name === 'Usine de Drones') {
    startDroneFactoryTimerForSession(session, buildingToPlace);
  }
  io.to(session.sessionId).emit('buildings_update', session.buildings);
}

function fillEmptySlotsWithBots(sessionId) {
  const session = sessions[sessionId];
  if (!session) return;
  
  // Adapter le nombre de slots selon le mode de la session
  const maxPlayers = session.mode === '1v1' ? 2 : 8;
  
  for (let slot = 0; slot < maxPlayers; slot++) {
    if (!session.players[slot]) {
      createBotPlayer(sessionId, slot);
    }
  }
}

// Gestion de la déconnexion
io.on('disconnect', (socket) => {
  console.log('Client disconnected:', socket.id);
  
  // Si le joueur était dans une session, le retirer
  if (socket.sessionId) {
    const session = sessions[socket.sessionId];
    if (session && socket.playerIndex !== undefined) {
      // Retirer le joueur du slot
      session.players[socket.playerIndex] = null;
      
      // Si la partie n'a pas commencé, nettoyer les bots
      if (!session.gameStarted) {
        console.log(`[SESSION ${session.name}] Joueur déconnecté, nettoyage des bots`);
        // Arrêter tous les timers de bots
        if (session.botTimers) {
          session.botTimers.forEach(timer => clearInterval(timer));
          session.botTimers.clear();
        }
        // Retirer tous les bots
        session.players = session.players.map(p => p && p.isBot ? null : p);
      }
      
      // Envoyer la mise à jour des joueurs
      io.to(socket.sessionId).emit('players_update', session.players);
      
      // Mettre à jour la liste des sessions
      io.emit('sessions_list', Object.entries(sessions).map(([id, s]) => ({
        id,
        name: s.name,
        players: s.players.filter(p => p && !p.isBot).length
      })));
    }
  }
}); 

// --- UTILITAIRE : Vérifie si une position est sur la barre de vie du joueur (bande verticale centrale du segment) ---
function isOnHealthBar(x, y, slot) {
  // Adapter la largeur de segment selon le mode de la session
  // Pour l'instant, on utilise le mode standard (8 segments) car cette fonction est globale
  const nbSegments = 8; // Mode standard par défaut
  const SEGMENT_WIDTH = 1920 / nbSegments;
  const segmentStart = slot * SEGMENT_WIDTH;
  const segmentCenter = segmentStart + SEGMENT_WIDTH / 2;
  // Coordonnées de la barre de vie côté client :
  // x dans [centre-8, centre+8], y dans [140,560]
  return (
    x >= segmentCenter - 8 &&
    x <= segmentCenter + 8 &&
    y >= 140 &&
    y <= 560
  );
} 

// --- MARCHÉ NOIR ---
const BLACK_MARKET_ITEMS = [
  {
    id: 'nuke',
    name: 'Missile nucléaire',
    description: "Détruit tous les bâtiments d'un segment adverse.",
    price: 200000,
    icon: '☢️',
    effect: 'nuke_segment',
  },
  {
    id: 'crypto_boost',
    name: 'Boost de Production',
    description: "Double votre production de crypto pendant 15 secondes.",
    price: 250000,
    icon: '⚡',
    effect: 'crypto_boost',
  },
  {
    id: 'heal',
    name: 'Sérum de Résurrection',
    description: "Rend toute la vie à votre base principale.",
    price: 120000,
    icon: '💉',
    effect: 'heal_base',
  },
  {
    id: 'spy',
    name: 'Espionnage',
    description: "Révèle tous les bâtiments adverses pendant 30s.",
    price: 80000,
    icon: '🕵️',
    effect: 'reveal',
  },
  // Ajoutez d'autres objets ici
];

// Pour chaque session, on stocke l'index courant et le timer de rotation
function initBlackMarketForSession(session) {
  session.blackMarket = {
    currentIndex: 0,
    timer: null,
  };
  // Suppression de la rotation automatique - tous les objets sont maintenant affichés en permanence
  // session.blackMarket.timer = setInterval(() => {
  //   session.blackMarket.currentIndex = (session.blackMarket.currentIndex + 1) % BLACK_MARKET_ITEMS.length;
  //   io.to(session.sessionId).emit('black_market_update', getCurrentBlackMarketItem(session));
  // }, 2 * 60 * 1000); // 2 minutes
}

function getCurrentBlackMarketItem(session) {
  return BLACK_MARKET_ITEMS[session.blackMarket.currentIndex];
}

function stopBlackMarketForSession(session) {
  if (session.blackMarket && session.blackMarket.timer) {
    clearInterval(session.blackMarket.timer);
    session.blackMarket.timer = null;
  }
}

// Ajout : fonction pour calculer le coût dynamique d'un bâtiment (corrigé)
function getDynamicBuildingCost(session, ownerSlot, buildingName) {
  // Compte le nombre de bâtiments de ce type déjà construits par ce joueur (ne pas inclure le bâtiment en cours de construction)
  const count = session.buildings.filter(b => b.ownerSlot === ownerSlot && b.name === buildingName).length;
  // Trouve le coût de base
  const base = (BOT_BUILDINGS.find(b => b.name === buildingName) || {}).cost || 0;
  return base * Math.pow(2, count);
}