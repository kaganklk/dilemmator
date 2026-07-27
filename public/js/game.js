// game.js — Oyun ekranı mantığı

const roomCode = new URLSearchParams(location.search).get('room');
const myPlayerId = parseInt(sessionStorage.getItem('playerId'));
let isHost = sessionStorage.getItem('isHost') === 'true';

if (!roomCode || !myPlayerId) {
  window.location.href = '/';
}

let ws = null;
let currentPlayers = []; // mevcut oyuncu listesi
let hasAnswered = false;

// ── Scene management ──
function showScene(name) {
  document.querySelectorAll('.scene').forEach(s => s.classList.remove('active'));
  const scene = document.getElementById('scene-' + name);
  if (scene) {
    scene.classList.add('active');
    // Re-trigger animation
    scene.style.animation = 'none';
    scene.offsetHeight; // reflow
    scene.style.animation = '';
  }

  // Sidebar'ı oyun bitiş ekranında gizle
  const sidebar = document.querySelector('.players-sidebar');
  if (sidebar) {
    sidebar.style.display = (name === 'end') ? 'none' : '';
  }
}

// ── Helpers ──
function showError(msg) {
  const toast = document.getElementById('error-toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

window.copyCode = function() {
  navigator.clipboard.writeText(roomCode).catch(() => {});
  const toast = document.getElementById('copied-toast');
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
};

// ── Sidebar — sağ üst oyuncu paneli ──
function updateSidebar(players) {
  currentPlayers = players;
  const list = document.getElementById('sidebar-list');
  const count = document.getElementById('sidebar-count');

  count.textContent = players.length;

  list.innerHTML = players.map(p => `
    <div class="sidebar-player ${p.connected ? '' : 'disconnected'}">
      <div class="sidebar-avatar" style="background:${p.color}">${p.name.charAt(0).toUpperCase()}</div>
      <span class="sidebar-name">${p.name}</span>
      ${p.isHost ? '<span class="sidebar-host">👑</span>' : ''}
    </div>
  `).join('');
}

// ── Lobby rendering ──
function renderPlayers(players) {
  currentPlayers = players;
  updateSidebar(players);

  const grid = document.getElementById('lobby-players');
  grid.innerHTML = players.map(p => `
    <div class="player-chip">
      <div class="player-avatar" style="background:${p.color}">${p.name.charAt(0).toUpperCase()}</div>
      <span>${p.name}</span>
      ${p.isHost ? '<span class="player-host-icon">👑</span>' : ''}
    </div>
  `).join('');

  // Start button state
  const startBtn = document.getElementById('start-btn');
  const waitingText = document.getElementById('waiting-text');

  if (isHost) {
    startBtn.style.display = '';
    waitingText.style.display = 'none';
    startBtn.disabled = false;
    startBtn.textContent = 'Oyunu Başlat';
  } else {
    startBtn.style.display = 'none';
    waitingText.style.display = '';
  }
}

// ── Settings ──
window.changeQuestionCount = function(delta) {
  if (!isHost) return;
  const el = document.getElementById('question-count');
  let val = parseInt(el.textContent) + delta;
  val = Math.max(3, Math.min(20, val));
  el.textContent = val;

  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'update_settings', questionCount: val }));
  }
};

// ── Question rendering ──
function showQuestion(question) {
  hasAnswered = false;
  showScene('question');

  document.getElementById('q-counter').textContent = `Soru ${question.index + 1} / ${question.total}`;
  document.getElementById('q-text').textContent = question.text;

  // Reset buttons
  document.getElementById('btn-yapardim').className = 'choice-btn yapardim';
  document.getElementById('btn-yapmazdim').className = 'choice-btn yapmazdim';

  // Clear avatar areas
  document.getElementById('avatars-yapardim').innerHTML = '';
  document.getElementById('avatars-yapmazdim').innerHTML = '';
  document.getElementById('answer-count').textContent = '';
}

// ── Submit answer ──
window.submitAnswer = function(answer) {
  if (hasAnswered) return;
  hasAnswered = true;

  // Visual feedback
  const selected = document.getElementById('btn-' + answer);
  const other = document.getElementById('btn-' + (answer === 'yapardim' ? 'yapmazdim' : 'yapardim'));
  selected.classList.add('selected');
  other.classList.add('not-selected');

  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'submit_answer', answer }));
  }
};

// ── Live answer — avatar buton altına ekleme ──
function addLiveAnswer(data) {
  const player = currentPlayers.find(p => p.id === data.playerId);
  const name = data.name || player?.name || 'Anonim';
  const color = data.color || player?.color || '#666';
  const initial = name.charAt(0).toUpperCase();

  // İlgili butonun altındaki avatar container'ına ekle
  const containerId = data.answer === 'yapardim' ? 'avatars-yapardim' : 'avatars-yapmazdim';
  const container = document.getElementById(containerId);

  const avatar = document.createElement('div');
  avatar.className = 'choice-avatar';
  avatar.style.background = color;
  avatar.textContent = initial;
  avatar.title = name;

  container.appendChild(avatar);

  // Update count
  if (data.totalPlayers > 1) {
    document.getElementById('answer-count').textContent =
      `${data.totalAnswered} / ${data.totalPlayers} kişi cevapladı`;
  } else {
    document.getElementById('answer-count').textContent = '';
  }
}

// ── Results rendering ──
function showResults(data) {
  showScene('results');

  document.getElementById('results-question').textContent = data.question;

  // Animate bars
  const yapardimBar = document.getElementById('r-yapardim-bar');
  const yapmazdimBar = document.getElementById('r-yapmazdim-bar');
  const yapardimPct = document.getElementById('r-yapardim-pct');
  const yapmazdimPct = document.getElementById('r-yapmazdim-pct');

  yapardimBar.style.width = '0';
  yapmazdimBar.style.width = '0';
  yapardimPct.textContent = data.yapardimPercent + '%';
  yapmazdimPct.textContent = data.yapmazdimPercent + '%';

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      yapardimBar.style.width = data.yapardimPercent + '%';
      yapmazdimBar.style.width = data.yapmazdimPercent + '%';
    });
  });

  // Player answers
  const container = document.getElementById('results-players');
  container.innerHTML = data.playerAnswers.map(p => `
    <div class="result-player ${p.answer}">
      <div class="mini-avatar" style="background:${p.color}">${p.name.charAt(0).toUpperCase()}</div>
      <span>${p.name}</span>
    </div>
  `).join('');

  // Host next button
  const nextBtn = document.getElementById('next-btn');
  nextBtn.style.display = isHost ? '' : 'none';
}

// ── Next question ──
window.nextQuestion = function() {
  if (!isHost) return;
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'next_question' }));
  }
};

// ── Game end ──
function showGameEnd(data) {
  showScene('end');

  // Awards
  const awardsGrid = document.getElementById('awards-grid');
  const awardConfigs = [
    { key: 'enCani', emoji: '🔪', title: 'En Cani' },
    { key: 'enParagoz', emoji: '💰', title: 'En Paragöz' },
    { key: 'enBencil', emoji: '🎭', title: 'En Bencil' },
  ];

  awardsGrid.innerHTML = awardConfigs
    .filter(a => data.awards[a.key])
    .map(a => {
      const award = data.awards[a.key];
      return `
        <div class="award-card">
          <div class="award-emoji">${a.emoji}</div>
          <div class="award-title">${a.title}</div>
          <div class="award-name" style="color:${award.color}">${award.name}</div>
          <div class="award-score">${award.score} soru</div>
        </div>
      `;
    }).join('');

  // Ranking
  const rankingList = document.getElementById('ranking-list');
  rankingList.innerHTML = data.players.map((p, i) => `
    <div class="ranking-item">
      <div class="ranking-pos">${i + 1}</div>
      <div class="ranking-avatar" style="background:${p.color}">${p.name.charAt(0).toUpperCase()}</div>
      <div class="ranking-info">
        <div class="ranking-name">${p.name}</div>
        <div class="ranking-bar-track">
          <div class="ranking-bar-fill" data-width="${p.canililkYuzdesi}"></div>
        </div>
      </div>
      <div class="ranking-percent">${p.canililkYuzdesi}%</div>
    </div>
  `).join('');

  // Animate ranking bars
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.querySelectorAll('.ranking-bar-fill').forEach(bar => {
        bar.style.width = bar.dataset.width + '%';
      });
    });
  });

  // Play again button (for everyone)
  const playAgainBtn = document.getElementById('play-again-btn');
  playAgainBtn.style.display = '';
  playAgainBtn.disabled = false;
  playAgainBtn.textContent = 'Tekrar Oyna';
}

// ── Play again ──
window.playAgain = function() {
  const btn = document.getElementById('play-again-btn');
  btn.disabled = true;
  btn.textContent = 'Bekleniyor...';
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'play_again' }));
  }
};

// ── Start game ──
window.startGame = function() {
  if (!isHost) return;
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'start_game' }));
  }
};

// ── WebSocket ──
function connectWS() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onopen = () => {
    const name = sessionStorage.getItem('playerName') || 'Anonim';
    ws.send(JSON.stringify({ type: 'rejoin_room', code: roomCode, name }));
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);

    switch (msg.type) {
      case 'room_joined':
        sessionStorage.setItem('playerId', msg.playerId);
        // Host bilgisini sunucudan güncelle
        if (msg.isHost !== undefined) {
          isHost = msg.isHost;
          sessionStorage.setItem('isHost', isHost ? 'true' : 'false');
        }
        document.getElementById('lobby-code').textContent = msg.roomCode;
        document.getElementById('question-count').textContent = msg.settings.questionCount;
        renderPlayers(msg.players);

        // Oyun devam ediyorsa lobiye düşme — game_started mesajı gelecek
        if (!msg.gameState || msg.gameState === 'lobby') {
          showScene('lobby');
          // Settings sadece host görsün
          if (!isHost) {
            document.getElementById('lobby-settings').querySelectorAll('.setting-btn').forEach(b => {
              b.style.display = 'none';
            });
          }
        }
        break;

      case 'player_joined':
        renderPlayers(msg.players);
        break;

      case 'player_left':
        renderPlayers(msg.players);
        // Sidebar'ı da güncelle (oyun sırasında)
        updateSidebar(msg.players);
        break;

      case 'settings_updated':
        document.getElementById('question-count').textContent = msg.settings.questionCount;
        break;

      case 'game_started':
        showQuestion(msg.question);
        break;

      case 'player_answered':
        addLiveAnswer(msg);
        break;

      case 'question_results':
        const delay = currentPlayers.length === 1 ? 0 : 1000;
        setTimeout(() => {
          showResults(msg);
        }, delay);
        break;

      case 'new_question':
        showQuestion(msg);
        break;

      case 'game_ended':
        showGameEnd(msg);
        break;

      case 'back_to_lobby':
        showScene('lobby');
        renderPlayers(msg.players);
        document.getElementById('question-count').textContent = msg.settings.questionCount;
        break;

      case 'play_again_update':
        const playBtn = document.getElementById('play-again-btn');
        if (playBtn.disabled) {
          playBtn.textContent = `${msg.votes}/${msg.total} Onayladı`;
        }
        break;

      case 'error':
        showError(msg.message);
        break;
    }
  };

  ws.onclose = () => {
    setTimeout(connectWS, 2000);
  };
}

// Init
document.getElementById('lobby-code').textContent = roomCode;
connectWS();
