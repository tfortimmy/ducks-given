const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// In-memory session store
const sessions = new Map();

function generateId() {
  return crypto.randomBytes(3).toString('hex'); // 6-char hex string
}

function getSessionData(session) {
  const participants = [];
  for (const [socketId, p] of session.participants) {
    participants.push({
      id: socketId,
      name: p.name,
      score: session.state === 'results' ? p.score : null,
      hasVoted: p.score !== null,
    });
  }

  // Sort by score descending for results
  if (session.state === 'results') {
    participants.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  }

  return {
    id: session.id,
    topic: session.topic,
    timerDuration: session.timerDuration,
    state: session.state,
    creatorId: session.creatorId,
    participants,
    timerEnd: session.timerEnd,
    serverTime: Date.now(),
  };
}

io.on('connection', (socket) => {
  let currentSessionId = null;

  socket.on('create-session', ({ topic, timerDuration, name }) => {
    const id = generateId();
    const session = {
      id,
      topic,
      timerDuration: Math.max(5, Math.min(300, timerDuration || 30)),
      creatorId: socket.id,
      state: 'lobby',
      participants: new Map(),
      timerEnd: null,
      timerInterval: null,
    };

    session.participants.set(socket.id, { name, score: null });
    sessions.set(id, session);
    currentSessionId = id;

    socket.join(id);
    socket.emit('session-created', { sessionId: id });
    io.to(id).emit('session-update', getSessionData(session));
  });

  socket.on('peek-session', ({ sessionId }) => {
    const session = sessions.get(sessionId);
    if (!session) {
      socket.emit('error-msg', { message: 'Session not found. This duck pond doesn\'t exist!' });
      return;
    }
    socket.emit('session-peek', getSessionData(session));
  });

  socket.on('join-session', ({ sessionId, name }) => {
    const session = sessions.get(sessionId);
    if (!session) {
      socket.emit('error-msg', { message: 'Session not found. This duck pond doesn\'t exist!' });
      return;
    }

    currentSessionId = sessionId;
    socket.join(sessionId);

    // If session is in results state, let them view but don't add as participant
    if (session.state === 'results') {
      socket.emit('session-update', getSessionData(session));
      return;
    }

    session.participants.set(socket.id, { name, score: null });
    io.to(sessionId).emit('session-update', getSessionData(session));
  });

  socket.on('start-timer', () => {
    if (!currentSessionId) return;
    const session = sessions.get(currentSessionId);
    if (!session) return;
    if (socket.id !== session.creatorId) return;
    if (session.state !== 'lobby') return;

    session.state = 'voting';
    session.timerEnd = Date.now() + session.timerDuration * 1000;

    io.to(currentSessionId).emit('session-update', getSessionData(session));

    // Tick every second
    session.timerInterval = setInterval(() => {
      const remaining = Math.max(0, session.timerEnd - Date.now());

      if (remaining <= 0) {
        clearInterval(session.timerInterval);
        session.state = 'results';
        io.to(currentSessionId).emit('session-update', getSessionData(session));
      } else {
        io.to(currentSessionId).emit('timer-tick', {
          remaining: Math.ceil(remaining / 1000),
        });
      }
    }, 1000);
  });

  socket.on('submit-score', ({ score }) => {
    if (!currentSessionId) return;
    const session = sessions.get(currentSessionId);
    if (!session) return;
    if (session.state !== 'voting') return;

    const participant = session.participants.get(socket.id);
    if (!participant) return;

    const numScore = parseInt(score, 10);
    if (isNaN(numScore) || numScore < 0 || numScore > 10) return;

    participant.score = numScore;
    socket.emit('score-confirmed', { score: numScore });
  });

  socket.on('disconnect', () => {
    if (!currentSessionId) return;
    const session = sessions.get(currentSessionId);
    if (!session) return;

    // Only remove from lobby; keep in voting/results so scores persist
    if (session.state === 'lobby') {
      session.participants.delete(socket.id);
      io.to(currentSessionId).emit('session-update', getSessionData(session));
    }

    // Clean up empty sessions
    if (session.participants.size === 0) {
      if (session.timerInterval) clearInterval(session.timerInterval);
      sessions.delete(currentSessionId);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🦆 Ducks Given is running at http://localhost:${PORT}`);
});
