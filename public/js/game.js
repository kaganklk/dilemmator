// game.js — Yıldırım Hızı (Lightning Fast & Optimistic UI) Destekli Oyun Mantığı

const roomCode = new URLSearchParams(location.search).get('room');
const myPlayerId = parseInt(sessionStorage.getItem('playerId'), 10);
let isHost = sessionStorage.getItem('isHost') === 'true';

if (!roomCode || isNaN(myPlayerId)) {
  window.location.href = '/';
}

let supabaseClient = null;
let currentPlayers = []; 
let hasAnswered = false;
let currentQuestionId = null;
let currentResultQuestionText = null;

// ── Scene management ──
function showScene(name) {
  document.querySelectorAll('.scene').forEach(s => s.classList.remove('active'));
  const scene = document.getElementById('scene-' + name);
  if (scene) {
    scene.classList.add('active');
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
  if (currentQuestionId === question.id && document.getElementById('scene-question')?.classList.contains('active')) {
    return;
  }
  currentQuestionId = question.id;
  currentResultQuestionText = null;
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

// ── Submit answer (Anında Görsel Tepki ve Sonuç Yönlendirmesi) ──
window.submitAnswer = async function(answer) {
  if (hasAnswered) return;
  hasAnswered = true;

  const selected = document.getElementById('btn-' + answer);
  const other = document.getElementById('btn-' + (answer === 'yapardim' ? 'yapmazdim' : 'yapardim'));
  selected.classList.add('selected');
  other.classList.add('not-selected');

  const myPlayer = currentPlayers.find(p => Number(p.id) === Number(myPlayerId)) || { name: 'Siz', color: '#30D158' };
  addLiveAnswer({
    playerId: myPlayerId,
    name: myPlayer.name,
    color: myPlayer.color,
    answer,
    totalPlayers: currentPlayers.length
  });

  try {
    const res = await fetch('/api/submit-answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode, playerId: myPlayerId, answer })
    });
    const data = await res.json();
    if (res.ok && data.allAnswered && data.qResults) {
      // Broadcast gecikmesine dahi maruz kalmadan ekranı anında sonuç paneline taşı!
      const delay = (currentPlayers.length <= 1) ? 0 : 600;
      setTimeout(() => {
        showResults(data.qResults);
      }, delay);
    }
  } catch (err) {
    showError('Cevap gönderilemedi, tekrar denenebilir.');
    hasAnswered = false;
    selected.classList.remove('selected');
    other.classList.remove('not-selected');
  }
};

// ── Live answer ──
const addedAvatars = new Set();
function addLiveAnswer(data) {
  const avatarKey = `${data.playerId}_${data.answer}_${currentQuestionId}`;
  if (addedAvatars.has(avatarKey)) return;
  addedAvatars.add(avatarKey);

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

  if (data.totalPlayers > 1 && data.totalAnswered) {
    document.getElementById('answer-count').textContent =
      `${data.totalAnswered} / ${data.totalPlayers} kişi cevapladı`;
  }
}

// ── Results rendering ──
function showResults(data) {
  if (!data) return;
  if (currentResultQuestionText === data.question && document.getElementById('scene-results')?.classList.contains('active')) {
    return;
  }
  currentResultQuestionText = data.question;
  showScene('results');

  document.getElementById('results-question').textContent = data.question || '';

  const yapardimBar = document.getElementById('r-yapardim-bar');
  const yapmazdimBar = document.getElementById('r-yapmazdim-bar');
  const yapardimPct = document.getElementById('r-yapardim-pct');
  const yapmazdimPct = document.getElementById('r-yapmazdim-pct');

  yapardimBar.style.width = (data.yapardimPercent || 0) + '%';
  yapmazdimBar.style.width = (data.yapmazdimPercent || 0) + '%';
  yapardimPct.textContent = (data.yapardimPercent || 0) + '%';
  yapmazdimPct.textContent = (data.yapmazdimPercent || 0) + '%';

  const container = document.getElementById('results-players');
  const list = data.playerAnswers || [];
  container.innerHTML = list.map(p => `
    <div class="result-player ${p.answer}">
      <div class="mini-avatar" style="background:${p.color || '#666'}">${(p.name || '?').charAt(0).toUpperCase()}</div>
      <span>${p.name || 'Anonim'}</span>
    </div>
  `).join('');

  const nextBtn = document.getElementById('next-btn');
  if (data.isLastQuestion) {
    nextBtn.textContent = 'Sonucu Gör 🏆';
  } else {
    nextBtn.textContent = 'Sonraki Soru →';
  }
  nextBtn.style.display = isHost ? '' : 'none';
}

// ── Next question ──
window.nextQuestion = async function() {
  if (!isHost) return;
  try {
    const res = await fetch('/api/next-question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode, playerId: myPlayerId })
    });
    const data = await res.json();
    if (res.ok) {
      if (data.gameOver && data.results) {
        showGameEnd(data.results);
      } else if (data.question) {
        showQuestion(data.question);
      }
    }
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
          <div class="ranking-bar-fill" style="width: ${p.canililkYuzdesi || 0}%"></div>
        </div>
      </div>
      <div class="ranking-percent">${p.canililkYuzdesi || 0}%</div>
    </div>
  `).join('');

  const playAgainBtn = document.getElementById('play-again-btn');
  playAgainBtn.style.display = '';
  playAgainBtn.disabled = false;
  playAgainBtn.textContent = 'Tekrar Oyna';
}

// ── Play again (Anında Lobiye Dönüş veya Canlı Oy Durumu) ──
window.playAgain = async function() {
  const btn = document.getElementById('play-again-btn');
  btn.disabled = true;
  btn.textContent = 'Bekleniyor...';
  try {
    const res = await fetch('/api/play-again', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode, playerId: myPlayerId })
    });
    const data = await res.json();
    if (res.ok && data.reset) {
      // Herkes onayladıysa veya odada tek kişiysek, radyo sinyali beklemeksizin anında lobiye geri uç!
      currentQuestionId = null;
      currentResultQuestionText = null;
      showScene('lobby');
      if (data.lobbyData && data.lobbyData.players) {
        renderPlayers(data.lobbyData.players);
      } else {
        renderPlayers(currentPlayers);
      }
      if (data.lobbyData?.settings?.questionCount) {
        document.getElementById('question-count').textContent = data.lobbyData.settings.questionCount;
      }
    } else if (res.ok && data.votes !== undefined) {
      btn.textContent = `${data.votes}/${data.total} Onayladı`;
    } else {
      showError(data.error || 'İşlem gerçekleştirilemedi.');
      btn.disabled = false;
      btn.textContent = 'Tekrar Oyna';
    }
  } catch (err) {
    showError('İsteğin gönderilemedi.');
    btn.disabled = false;
    btn.textContent = 'Tekrar Oyna';
  }
};

// ── Start game (Anında Host Başlatması - WebSocket Beklenmez) ──
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
    if (res.ok && data.question) {
      showQuestion(data.question);
    } else {
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
        // Yarış durumu koruması: Eğer oyuncu çoktan oyuna girdiyse (soru, sonuç vb) geç gelen lobby mesajıyla geriye atma!
        const isInGame = document.getElementById('scene-question')?.classList.contains('active') ||
                         document.getElementById('scene-results')?.classList.contains('active') ||
                         document.getElementById('scene-end')?.classList.contains('active');
        if (!isInGame) {
          showScene('lobby');
          if (!isHost) {
            document.getElementById('lobby-settings').querySelectorAll('.setting-btn').forEach(b => {
              b.style.display = 'none';
            });
          }
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
      const delay = (currentPlayers.length <= 1) ? 0 : 600;
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
      currentQuestionId = null;
      currentResultQuestionText = null;
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

// ── Sıfır Gecikmeli Başlatma ──
async function initGame() {
  document.getElementById('lobby-code').textContent = roomCode;
  const name = sessionStorage.getItem('playerName') || 'Anonim';

  fetch('/api/rejoin-room', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: roomCode, name })
  }).then(r => r.json()).then(data => {
    if (data && data.type === 'room_joined') {
      handleServerMessage(data);
    } else {
      showError(data.error || 'Odaya bağlanılamadı.');
    }
  }).catch(() => showError('Yeniden bağlantı sağlanamadı.'));

  try {
    const configRes = await fetch('/api/config');
    const config = await configRes.json();
    if (config.url && config.anonKey) {
      supabaseClient = window.supabase.createClient(config.url, config.anonKey);
      supabaseClient
        .channel(`room:${roomCode}`)
        .on('broadcast', { event: '*' }, (payload) => {
          handleServerMessage(payload.payload);
        })
        .subscribe();
    }
  } catch (err) {
    console.error('Realtime abonelik hatası:', err);
  }
}

initGame();
