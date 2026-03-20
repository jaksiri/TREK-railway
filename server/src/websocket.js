const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./config');
const { db, canAccessTrip } = require('./db/database');

// Room management: tripId → Set<WebSocket>
const rooms = new Map();

// Track which rooms each socket is in
const socketRooms = new WeakMap();

// Track user info per socket
const socketUser = new WeakMap();

// Track unique socket ID
const socketId = new WeakMap();
let nextSocketId = 1;

let wss;

function setupWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  // Heartbeat: ping every 30s, terminate if no pong
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(heartbeat));

  wss.on('connection', (ws, req) => {
    // Extract token from query param
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(4001, 'Authentication required');
      return;
    }

    let user;
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      user = db.prepare(
        'SELECT id, username, email, role FROM users WHERE id = ?'
      ).get(decoded.id);
      if (!user) {
        ws.close(4001, 'User not found');
        return;
      }
    } catch (err) {
      ws.close(4001, 'Invalid or expired token');
      return;
    }

    ws.isAlive = true;
    const sid = nextSocketId++;
    socketId.set(ws, sid);
    socketUser.set(ws, user);
    socketRooms.set(ws, new Set());
    ws.send(JSON.stringify({ type: 'welcome', socketId: sid }));

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      if (msg.type === 'join' && msg.tripId) {
        const tripId = Number(msg.tripId);
        // Verify the user has access to this trip
        if (!canAccessTrip(tripId, user.id)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Access denied' }));
          return;
        }
        // Add to room
        if (!rooms.has(tripId)) rooms.set(tripId, new Set());
        rooms.get(tripId).add(ws);
        socketRooms.get(ws).add(tripId);
        ws.send(JSON.stringify({ type: 'joined', tripId }));
      }

      if (msg.type === 'leave' && msg.tripId) {
        const tripId = Number(msg.tripId);
        leaveRoom(ws, tripId);
        ws.send(JSON.stringify({ type: 'left', tripId }));
      }
    });

    ws.on('close', () => {
      // Clean up all rooms this socket was in
      const myRooms = socketRooms.get(ws);
      if (myRooms) {
        for (const tripId of myRooms) {
          leaveRoom(ws, tripId);
        }
      }
    });
  });

  console.log('WebSocket server attached at /ws');
}

function leaveRoom(ws, tripId) {
  const room = rooms.get(tripId);
  if (room) {
    room.delete(ws);
    if (room.size === 0) rooms.delete(tripId);
  }
  const myRooms = socketRooms.get(ws);
  if (myRooms) myRooms.delete(tripId);
}

/**
 * Broadcast an event to all sockets in a trip room, optionally excluding a user.
 * @param {number} tripId
 * @param {string} eventType  e.g. 'place:created'
 * @param {object} payload    the data to send
 * @param {number} [excludeUserId]  don't send to this user (the one who triggered the change)
 */
function broadcast(tripId, eventType, payload, excludeSid) {
  tripId = Number(tripId);
  const room = rooms.get(tripId);
  if (!room || room.size === 0) return;

  const excludeNum = excludeSid ? Number(excludeSid) : null;

  for (const ws of room) {
    if (ws.readyState !== 1) continue; // WebSocket.OPEN === 1
    // Exclude the specific socket that triggered the change
    if (excludeNum && socketId.get(ws) === excludeNum) continue;
    ws.send(JSON.stringify({ type: eventType, tripId, ...payload }));
  }
}

function broadcastToUser(userId, payload) {
  if (!wss) return;
  for (const ws of wss.clients) {
    if (ws.readyState !== 1) continue;
    const user = socketUser.get(ws);
    if (user && user.id === userId) {
      ws.send(JSON.stringify(payload));
    }
  }
}

function getOnlineUserIds() {
  const ids = new Set();
  if (!wss) return ids;
  for (const ws of wss.clients) {
    if (ws.readyState !== 1) continue;
    const user = socketUser.get(ws);
    if (user) ids.add(user.id);
  }
  return ids;
}

module.exports = { setupWebSocket, broadcast, broadcastToUser, getOnlineUserIds };
