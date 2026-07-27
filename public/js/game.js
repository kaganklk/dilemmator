// game.js — Oyun ekranı mantığı (Supabase Realtime & Vercel Serverless API)

const roomCode = new URLSearchParams(location.search).get('room');
const myPlayerId = parseInt(sessionStorage.getItem('playerId'), 10);
let isHost = sessionStorage.getItem('isHost') === 'true';

if (!roomCode || isNaN(myPlayerId)) {
  window.location.href = '/';
}

let supabaseClient = null;
let currentPlayers = []; // mevcut oyuncu listesi
let hasAnswered = false;

// ── Scene management ──
function showScene(name) {
  document.querySelectorAll('.scene').forEach(s => s.classList.remove('active'));
  const scene = document.getElementById('scene-' + name);
  if (scene) {
    scene.classList.add('active');
    scene.style.animation = 'none';
    scene.offsetHeight; // reflow
    scene.style.animation = '';
  }

  const sidebar = document.querySelector('.players-sidebar');
  if (sidebar) {
    sidebar.style.display = (name === 'end') ? 'none' : '';
  }
}

// ── Helpers ──
function showError(msg) {
  if (!msg) return;
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

// ── Sidebar ──
function updateSidebar(players) {
  currentPlayers = players || [];
  const list = document.getElementById('sidebar-list');
  const count = document.getElementById('sidebar-count');

  count.textContent = currentPlayers.length;

  list.innerHTML = currentPlayers.map(p => `
    <div class="sidebar-player ${p.connected !== false ? '' : 'disconnected'}">
      <div class="sidebar-avatar" style="background:${p.color || '#666'}">${(p.name || '?').charAt(0).toUpperCase()}</div>
      <span class="sidebar-name">${p.name || 'Anonim'}</span>
      ${p.isHost ? '<span class="sidebar-host">👑</span>' : ''}
    </div>
  `).join('');
}

// ── Lobby rendering ──
function renderPlayers(players) {
  currentPlayers = players || [];
  updateSidebar(currentPlayers);

  const grid = document.getElementById('lobby-players');
  grid.innerHTML = currentPlayers.map(p => `
    <div class="player-chip">
      <div class="player-avatar" style="background:${p.color || '#666'}">${(p.name || '?').charAt(0).toUpperCase()}</div>
      <span>${p.name || 'Anonim'}</span>
      ${p.isHost ? '<span class="player-host-icon">👑</span>' : ''}
    </div>
  `).join('');

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
window.changeQuestionCount = async function(delta) {
  if (!isHost) return;
  const el = document.getElementById('question-count');
  let val = parseInt(el.textContent, 10) + delta;
  val = Math.max(3, Math.min(20, val));
  el.textContent = val;

  try {
    await fetch('/api/update-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode, playerId: myPlayerId, questionCount: val })
    });
  } catch (err) {
    console.error('Ayar güncelleme hatası:', err);
  }
};

// ── Question rendering ──
function showQuestion(question) {
  if (!question) return;
  hasAnswered = false;
  showScene('question');

  document.getElementById('q-counter').textContent = `Soru ${(question.index || 0) + 1} / ${question.total || 10}`;
  document.getElementById('q-text').textContent = question.text || '';

  document.getElementById('btn-yapardim').className = 'choice-btn yapardim';
  document.getElementById('btn-yapmazdim').className = 'choice-btn yapmazdim';

  document.getElementById('avatars-yapardim').innerHTML = '';
  document.getElementById('avatars-yapmazdim').innerHTML = '';
  document.getElementById('answer-count').textContent = '';
}

// ── Submit answer ──
window.submitAnswer = async function(answer) {
  if (hasAnswered) return;
  hasAnswered = true;

  const selected = document.getElementById('btn-' + answer);
  const other = document.getElementById('btn-' + (answer === 'yapardim' ? 'yapmazdim' : 'yapardim'));
  selected.classList.add('selected');
  other.classList.add('not-selected');

  try {
    await fetch('/api/submit-answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode, playerId: myPlayerId, answer })
    });
  } catch (err) {
    showError('Cevap gönderilemedi, tekrar denenebilir.');
  }
};

// ── Live answer ──
function addLiveAnswer(data) {
  const player = currentPlayers.find(p => Number(p.id) === Number(data.playerId));
  const name = data.name || player?.name || 'Anonim';
  const color = data.color || player?.color || '#666';
  const initial = name.charAt(0).toUpperCase();

  const containerId = data.answer === 'yapardim' ? 'avatars-yapardim' : 'avatars-yapmazdim';
  const container = document.getElementById(containerId);

  const avatar = document.createElement('div');
  avatar.className = 'choice-avatar';
  avatar.style.background = color;
  avatar.textContent = initial;
  avatar.title = name;

  if (container) container.appendChild(avatar);

  if (data.totalPlayers > 1) {
    document.getElementById('answer-count').textContent =
      `${data.totalAnswered} / ${data.totalPlayers} kişi cevapladı`;
  } else {
    document.getElementById('answer-count').textContent = '';
  }
}

// ── Results rendering ──
function showResults(data) {
  if (!data) return;
  showScene('results');

  document.getElementById('results-question').textContent = data.question || '';

  const yapardimBar = document.getElementById('r-yapardim-bar');
  const yapmazdimBar = document.getElementById('r-yapmazdim-bar');
  const yapardimPct = document.getElementById('r-yapardim-pct');
  const yapmazdimPct = document.getElementById('r-yapmazdim-pct');

  yapardimBar.style.width = '0';
  yapmazdimBar.style.width = '0';
  yapardimPct.textContent = (data.yapardimPercent || 0) + '%';
  yapmazdimPct.textContent = (data.yapmazdimPercent || 0) + '%';

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      yapardimBar.style.width = (data.yapardimPercent || 0) + '%';
      yapmazdimBar.style.width = (data.yapmazdimPercent || 0) + '%';
    });
  });

  const container = document.getElementById('results-players');
  const list = data.playerAnswers || [];
  container.innerHTML = list.map(p => `
    <div class="result-player ${p.answer}">
      <div class="mini-avatar" style="background:${p.color || '#666'}">${(p.name || '?').charAt(0).toUpperCase()}</div>
      <span>${p.name || 'Anonim'}</span>
    </div>
  `).join('');

  const nextBtn = document.getElementById('next-btn');
  nextBtn.style.display = isHost ? '' : 'none';
}

// ── Next question ──
window.nextQuestion = async function() {
  if (!isHost) return;
  try {
    await fetch('/api/next-question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode, playerId: myPlayerId })
    });
  } catch (err) {
    showError('Sonraki soruya geçilemedi.');
  }
};

// ── Game end ──
function showGameEnd(data) {
  if (!data) return;
  showScene('end');

  const awardsGrid = document.getElementById('awards-grid');
  const awardConfigs = [
    { key: 'enCani', emoji: '🔪', title: 'En Cani' },
    { key: 'enParagoz', emoji: '💰', title: 'En Paragöz' },
    { key: 'enBencil', emoji: '🎭', title: 'En Bencil' },
  ];

  awardsGrid.innerHTML = awardConfigs
    .filter(a => data.awards && data.awards[a.key])
    .map(a => {
      const award = data.awards[a.key];
      return `
        <div class="award-card">
          <div class="award-emoji">${a.emoji}</div>
          <div class="award-title">${a.title}</div>
          <div class="award-name" style="color:${award.color || '#FF2D55'}">${award.name}</div>
          <div class="award-score">${award.score} soru</div>
        </div>
      `;
    }).join('');

  const rankingList = document.getElementById('ranking-list');
  const playersList = data.players || [];
  rankingList.innerHTML = playersList.map((p, i) => `
    <div class="ranking-item">
      <div class="ranking-pos">${i + 1}</div>
      <div class="ranking-avatar" style="background:${p.color || '#666'}">${(p.name || '?').charAt(0).toUpperCase()}</div>
      <div class="ranking-info">
        <div class="ranking-name">${p.name || 'Anonim'}</div>
        <div class="ranking-bar-track">
          <div class="ranking-bar-fill" data-width="${p.canililkYuzdesi || 0}"></div>
        </div>
      </div>
      <div class="ranking-percent">${p.canililkYuzdesi || 0}%</div>
    </div>
  `).join('');

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.querySelectorAll('.ranking-bar-fill').forEach(bar => {
        bar.style.width = (bar.dataset.width || '0') + '%';
      });
    });
  });

  const playAgainBtn = document.getElementById('play-again-btn');
  playAgainBtn.style.display = '';
  playAgainBtn.disabled = false;
  playAgainBtn.textContent = 'Tekrar Oyna';
}

// ── Play again ──
window.playAgain = async function() {
  const btn = document.getElementById('play-again-btn');
  btn.disabled = true;
  btn.textContent = 'Bekleniyor...';
  try {
    await fetch('/api/play-again', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode, playerId: myPlayerId })
    });
  } catch (err) {
    showError('İsteğin gönderilemedi.');
    btn.disabled = false;
    btn.textContent = 'Tekrar Oyna';
  }
};

// ── Start game ──
window.startGame = async function() {
  if (!isHost) return;
  const startBtn = document.getElementById('start-btn');
  startBtn.disabled = true;
  startBtn.textContent = 'Başlatılıyor...';
  try {
    const res = await fetch('/api/start-game', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode, playerId: myPlayerId })
    });
    const data = await res.json();
    if (!res.ok) {
      showError(data.error || 'Oyun başlatılamadı.');
      startBtn.disabled = false;
      startBtn.textContent = 'Oyunu Başlat';
    }
  } catch (err) {
    showError('Oyun başlatılırken bağlantı hatası oluştu.');
    startBtn.disabled = false;
    startBtn.textContent = 'Oyunu Başlat';
  }
};

// ── Server message router ──
function handleServerMessage(msg) {
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case 'room_joined':
      sessionStorage.setItem('playerId', msg.playerId);
      if (msg.isHost !== undefined) {
        isHost = msg.isHost;
        sessionStorage.setItem('isHost', isHost ? 'true' : 'false');
      }
      document.getElementById('lobby-code').textContent = msg.roomCode || roomCode;
      if (msg.settings && msg.settings.questionCount) {
        document.getElementById('question-count').textContent = msg.settings.questionCount;
      }
      if (msg.players) renderPlayers(msg.players);

      if (!msg.gameState || msg.gameState === 'lobby') {
        showScene('lobby');
        if (!isHost) {
          document.getElementById('lobby-settings').querySelectorAll('.setting-btn').forEach(b => {
            b.style.display = 'none';
          });
        }
      } else if (msg.gameState === 'playing' && msg.currentQuestion) {
        showQuestion(msg.currentQuestion);
      }
      break;

    case 'player_joined':
    case 'player_left':
      if (msg.players) {
        renderPlayers(msg.players);
        updateSidebar(msg.players);
      }
      break;

    case 'settings_updated':
      if (msg.settings && msg.settings.questionCount) {
        document.getElementById('question-count').textContent = msg.settings.questionCount;
      }
      break;

    case 'game_started':
      showQuestion(msg.question);
      break;

    case 'player_answered':
      addLiveAnswer(msg);
      break;

    case 'question_results':
      const delay = (currentPlayers.length <= 1) ? 0 : 1000;
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
      if (msg.players) renderPlayers(msg.players);
      if (msg.settings && msg.settings.questionCount) {
        document.getElementById('question-count').textContent = msg.settings.questionCount;
      }
      break;

    case 'play_again_update':
      const playBtn = document.getElementById('play-again-btn');
      if (playBtn && playBtn.disabled) {
        playBtn.textContent = `${msg.votes || 1}/${msg.total || 1} Onayladı`;
      }
      break;

    case 'error':
      showError(msg.message);
      break;
  }
}

// ── Rejoin room over HTTP & Setup Supabase Realtime ──
async function initGame() {
  document.getElementById('lobby-code').textContent = roomCode;
  const name = sessionStorage.getItem('playerName') || 'Anonim';

  try {
    // 1) Supabase ayarlarını al
    const configRes = await fetch('/api/config');
    const config = await configRes.json();

    if (!config.url || !config.anonKey) {
      showError('Supabase bağlantı bilgileri eksik (.env kontrol edin).');
      return;
    }

    // 2) Realtime Kanalını Başlat
    supabaseClient = window.supabase.createClient(config.url, config.anonKey);
    
    supabaseClient
      .channel(`room:${roomCode}`)
      .on('broadcast', { event: '*' }, (payload) => {
        handleServerMessage(payload.payload);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          // Kanal hazır, sunucuya odaya geldiğimizi söyleyelim
          try {
            const res = await fetch('/api/rejoin-room', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code: roomCode, name })
            });
            const data = await res.json();
            if (res.ok && data.type === 'room_joined') {
              handleServerMessage(data);
            } else {
              showError(data.error || 'Odaya bağlanılamadı.');
            }
          } catch (e) {
            showError('Yeniden bağlantı sağlanamadı.');
          }
        }
      });
  } catch (err) {
    showError('Sunucu ile etkileşim kurulamadı.');
    console.error(err);
  }
}

initGame();
