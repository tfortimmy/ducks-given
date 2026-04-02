const socket = io();

const params = new URLSearchParams(window.location.search);
const isCreateFlow = params.get('create') === '1';
const sessionId = params.get('id');

// State
let isCreator = false;
let hasJoined = false;
let selectedScore = null;
let currentSessionId = null;

// Screen elements
const joinScreen = document.getElementById('join-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const votingScreen = document.getElementById('voting-screen');
const resultsScreen = document.getElementById('results-screen');
const errorScreen = document.getElementById('error-screen');

function hideAllScreens() {
  joinScreen.style.display = 'none';
  lobbyScreen.style.display = 'none';
  votingScreen.style.display = 'none';
  resultsScreen.style.display = 'none';
  errorScreen.style.display = 'none';
}

// --- Duck button generation ---
// Slider setup
const duckSlider = document.getElementById('duck-slider');
const duckIcons = document.getElementById('duck-icons');

function updateDuckDisplay(n) {
  duckIcons.textContent = getDuckLabel(n);
  const status = document.getElementById('vote-status');
  const scoreLine = n === 0 ? 'You give zero ducks.' : `You give ${n} duck${n !== 1 ? 's' : ''}.`;
  status.innerHTML = `${scoreLine}<br><span class="tier-copy">${getSliderTierCopy(n)}</span>`;
}

duckSlider.addEventListener('input', () => {
  const n = parseInt(duckSlider.value, 10);
  updateDuckDisplay(n);
});

duckSlider.addEventListener('change', () => {
  const n = parseInt(duckSlider.value, 10);
  selectedScore = n;
  socket.emit('submit-score', { score: n });
  updateDuckDisplay(n);
});

function getDuckLabel(n) {
  if (n === 0) return '🚫';
  return '🦆'.repeat(n);
}

function getSliderTierCopy(n) {
  switch (n) {
    case 0:  return 'Zero ducks given';
    case 1:  return 'Barely gives a duck';
    case 2:  return "Could give a duck, won't";
    case 3:  return 'What the duck';
    case 4:  return 'Starting to give a duck';
    case 5:  return 'Give or take a duck';
    case 6:  return 'Ducking invested';
    case 7:  return 'Holy duck';
    case 8:  return 'Absolutely ducking yes';
    case 9:  return 'All the ducks';
    case 10: return 'MAXIMUM DUCK ENERGY 🔥';
    default: return '';
  }
}

// --- Initialization ---
if (isCreateFlow) {
  // Creator flow: create the session
  const topic = params.get('topic');
  const name = params.get('name');
  const timer = parseInt(params.get('timer'), 10) || 30;

  socket.emit('create-session', { topic, timerDuration: timer, name });

  socket.on('session-created', ({ sessionId: newId }) => {
    currentSessionId = newId;
    isCreator = true;
    hasJoined = true;

    // Update URL to the shareable version (without create params)
    const shareUrl = `${window.location.origin}/session.html?id=${newId}`;
    window.history.replaceState({}, '', shareUrl);
  });
} else if (sessionId) {
  // Joiner flow: peek at the session first
  currentSessionId = sessionId;
  socket.emit('peek-session', { sessionId });
} else {
  // No session ID and not creating — go home
  window.location.href = '/';
}

// --- Peek response (joiners only) ---
socket.on('session-peek', (data) => {
  if (hasJoined) return;

  document.getElementById('join-topic').textContent = data.topic;

  if (data.state === 'results') {
    showResults(data);
  } else {
    hideAllScreens();
    joinScreen.style.display = 'block';
  }
});

// --- Join button ---
document.getElementById('join-btn').addEventListener('click', () => {
  const name = document.getElementById('join-name').value.trim();
  if (!name) return;

  hasJoined = true;
  socket.emit('join-session', { sessionId: currentSessionId, name });
});

// Handle enter key on join input
document.getElementById('join-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('join-btn').click();
  }
});

// --- Copy share URL ---
document.getElementById('copy-btn').addEventListener('click', () => {
  const urlInput = document.getElementById('share-url');
  urlInput.select();
  navigator.clipboard.writeText(urlInput.value).then(() => {
    document.getElementById('copy-btn').textContent = 'Copied!';
    setTimeout(() => {
      document.getElementById('copy-btn').textContent = 'Copy';
    }, 2000);
  });
});

// --- Start button (creator only) ---
document.getElementById('start-btn').addEventListener('click', () => {
  socket.emit('start-timer');
});

// --- Socket events ---
socket.on('session-update', (data) => {
  isCreator = data.creatorId === socket.id;
  hasJoined = true;
  currentSessionId = data.id;

  if (data.state === 'lobby') {
    showLobby(data);
  } else if (data.state === 'voting') {
    showVoting(data);
  } else if (data.state === 'results') {
    showResults(data);
  }
});

socket.on('timer-tick', ({ remaining }) => {
  const timerNumber = document.getElementById('timer-number');
  if (timerNumber) {
    timerNumber.textContent = remaining;
    if (remaining <= 5) {
      timerNumber.classList.add('timer-urgent');
    }
  }
});

socket.on('score-confirmed', ({ score }) => {
  selectedScore = score;
});

socket.on('error-msg', ({ message }) => {
  hideAllScreens();
  errorScreen.style.display = 'block';
  document.getElementById('error-message').textContent = message;
});

// --- Screen renderers ---
function showLobby(data) {
  hideAllScreens();
  lobbyScreen.style.display = 'block';

  document.getElementById('lobby-topic').textContent = data.topic;

  const count = data.participants.length;
  document.getElementById('pond-count').textContent = getPondCopy(count);

  const list = document.getElementById('participant-list');
  list.innerHTML = data.participants
    .map(p => `<div class="participant-item">🦆 ${escapeHtml(p.name)}${p.id === data.creatorId ? ' <span class="creator-badge">Head Duck</span>' : ''}</div>`)
    .join('');

  // Share URL
  const shareUrl = `${window.location.origin}/session.html?id=${data.id}`;
  document.getElementById('share-url').value = shareUrl;

  if (isCreator) {
    document.getElementById('start-btn').style.display = 'block';
    document.getElementById('waiting-msg').style.display = 'none';
  } else {
    document.getElementById('start-btn').style.display = 'none';
    document.getElementById('waiting-msg').style.display = 'block';
  }
}

function showVoting(data) {
  hideAllScreens();
  votingScreen.style.display = 'block';

  document.getElementById('voting-topic').textContent = data.topic;

  if (data.timerEnd) {
    const remaining = Math.max(0, Math.ceil((data.timerEnd - data.serverTime) / 1000));
    document.getElementById('timer-number').textContent = remaining;
    if (remaining <= 5) {
      document.getElementById('timer-number').classList.add('timer-urgent');
    }
  }

  // Restore slider position if already voted
  const sliderVal = selectedScore !== null ? selectedScore : 5;
  duckSlider.value = sliderVal;
  updateDuckDisplay(sliderVal);
  if (selectedScore !== null) {
    updateDuckDisplay(selectedScore);
  }
}

function showResults(data) {
  hideAllScreens();
  resultsScreen.style.display = 'block';

  document.getElementById('results-topic').textContent = data.topic;

  const list = document.getElementById('results-list');
  list.innerHTML = data.participants
    .map((p, index) => {
      const score = p.score !== null ? p.score : '—';
      const tierCopy = getResultTierCopy(p.score);
      const duckIcons = p.score !== null && p.score > 0 ? '🦆'.repeat(p.score) : '';
      const rank = index + 1;

      return `
        <div class="result-item ${rank === 1 ? 'result-top' : ''}" style="animation-delay: ${index * 0.1}s">
          <div class="result-rank">#${rank}</div>
          <div class="result-info">
            <div class="result-name">${escapeHtml(p.name)}</div>
            <div class="result-tier">${tierCopy}</div>
            <div class="result-ducks">${duckIcons || (p.score === 0 ? '🚫' : '')}</div>
          </div>
          <div class="result-score">${score}</div>
        </div>
      `;
    })
    .join('');
}

// --- Helpers ---
function getPondCopy(count) {
  if (count === 1) return 'Just 1 lonely duck in the pond...';
  if (count === 2) return '2 ducks in the pond. A pair!';
  if (count <= 5) return `${count} ducks in the pond. Gathering the flock...`;
  return `${count} ducks in the pond. It's getting quackers in here!`;
}

function getResultTierCopy(score) {
  if (score === null || score === undefined) return 'Flew the coop (didn\'t vote)';
  if (score === 10) return 'MAXIMUM DUCKS — this is their hill to quack on';
  if (score === 9) return 'MAXIMUM DUCKS — all-in, feathers ruffled';
  if (score >= 7) return 'Gives a whole flock';
  if (score >= 5) return 'Ducks are firmly in a row';
  if (score >= 3) return 'A few ducks in the pond';
  if (score >= 1) return 'Barely a quack';
  return 'Zero ducks given';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}
