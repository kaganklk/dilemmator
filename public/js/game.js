// game.js — Yıldırım Hızı (Lightning Fast & Optimistic UI) Destekli Oyun Mantığı

const roomCode = new URLSearchParams(location.search).get('room');
const myPlayerId = parseInt(sessionStorage.getItem('playerId'), 10);
let isHost = sessionStorage.getItem('isHost') === 'true';

if (!roomCode || isNaN(myPlayerId)) {
  window.location.href = '/';
}

let supabaseClient = null;
let roomChannel = null;
let currentPlayers = []; 

function sendClientBroadcast(eventType, payloadData) {
  try {
    if (roomChannel) {
      roomChannel.send({
        type: 'broadcast',
        event: eventType,
        payload: { type: eventType, ...payloadData }
      });
    }
  } catch (e) { /* Hata yokmuş gibi devam et */ }
}
let currentHostId = null;
let currentQuestionAnswers = [];
let hasAnswered = false;
let currentQuestionId = null;
let currentResultQuestionText = null;
let lastGameEndData = null;

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
    <div class="sidebar-player">
      <div class="sidebar-avatar" style="background:${p.color || '#666'}">${(p.name || '?').charAt(0).toUpperCase()}</div>
      <span class="sidebar-name">${p.name || 'Anonim'}</span>
      ${p.isHost ? '<span class="sidebar-host">👑</span>' : ''}
    </div>
  `).join('');
}

// ── Lobby rendering ──
function renderPlayers(players) {
  currentPlayers = players || [];
  const hostP = currentPlayers.find(p => p.isHost);
  if (hostP) currentHostId = Number(hostP.id);
  updateSidebar(currentPlayers);

  if (document.getElementById('scene-end')?.classList.contains('active') && lastGameEndData) {
    updateGameEndRanking(lastGameEndData);
  }

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
let lastSettingUpdateTime = 0;
let updateSettingsTimeout = null;

window.changeQuestionCount = async function(delta) {
  if (!isHost) return;
  const el = document.getElementById('question-count');
  let val = parseInt(el.textContent, 10) + delta;
  val = Math.max(3, Math.min(20, val));
  el.textContent = val;
  lastSettingUpdateTime = Date.now();
  sendClientBroadcast('settings_updated', { settings: { questionCount: val } });

  if (updateSettingsTimeout) clearTimeout(updateSettingsTimeout);
  updateSettingsTimeout = setTimeout(async () => {
    try {
      await fetch('/api/update-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode, playerId: myPlayerId, questionCount: val })
      });
    } catch (err) {
      console.error('Ayar güncelleme hatası:', err);
    }
  }, 250);
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
  currentQuestionAnswers = [];
  
  showScene('question');

  document.getElementById('q-counter').textContent = `Soru ${(question.index || 0) + 1} / ${question.total || 10}`;
  document.getElementById('q-text').innerHTML = question.text || '';

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
    totalPlayers: currentPlayers.filter(p => p.connected !== false).length || 1
  });
  sendClientBroadcast('player_answered', {
    playerId: Number(myPlayerId),
    name: myPlayer.name,
    color: myPlayer.color,
    answer,
    questionId: currentQuestionId,
    totalPlayers: currentPlayers.filter(p => p.connected !== false).length || 1
  });

  // ── OPTIMISTIC UI: Veritabanı HTTP yanıtını BEKLEMEDEN anında sonuçları yansıt! ──
  triggerOptimisticResultsIfNeeded();

  try {
    const res = await fetch('/api/submit-answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode, playerId: myPlayerId, answer })
    });
    const data = await res.json();
    if (res.ok && data.allAnswered && data.qResults) {
      sendClientBroadcast('question_results', data.qResults);
      const delay = (currentPlayers.length <= 1) ? 0 : 300;
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

// ── Live answer & Optimistic Tracker ──
function addLiveAnswer(data) {
  if (!data || !data.playerId) return;
  if (data.questionId && currentQuestionId && String(data.questionId) !== String(currentQuestionId)) {
    return;
  }

  const alreadyAnswered = currentQuestionAnswers.some(a => Number(a.playerId) === Number(data.playerId));
  if (!alreadyAnswered) {
    currentQuestionAnswers.push({
      playerId: Number(data.playerId),
      name: data.name,
      color: data.color,
      answer: data.answer
    });

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
  }

  const totalAns = currentQuestionAnswers.length;
  const activeCount = currentPlayers.filter(p => p.connected !== false).length || 1;
  const totalPly = Math.max(data.totalPlayers || activeCount, activeCount);

  if (totalPly > 1 && totalAns > 0) {
    const countEl = document.getElementById('answer-count');
    if (countEl) countEl.textContent = `${totalAns} / ${totalPly} kişi cevapladı`;
  }

  triggerOptimisticResultsIfNeeded();
}

function triggerOptimisticResultsIfNeeded() {
  if (!currentQuestionId || currentPlayers.length === 0) return;
  const totalAns = currentQuestionAnswers.length;
  const totalPly = currentPlayers.filter(p => p.connected !== false).length || 1;

  if (hasAnswered && (totalPly <= 1 || totalAns >= totalPly)) {
    let yapardimCount = 0;
    let yapmazdimCount = 0;
    const playerAnswers = currentQuestionAnswers.map(ans => {
      const p = currentPlayers.find(p => Number(p.id) === Number(ans.playerId)) || {};
      if (ans.answer === 'yapardim') yapardimCount++;
      else yapmazdimCount++;
      return {
        playerId: Number(ans.playerId),
        name: ans.name || p.name || 'Anonim',
        color: ans.color || p.color || '#666',
        answer: ans.answer
      };
    });
    const total = yapardimCount + yapmazdimCount;
    const yapardimPercent = total > 0 ? Math.round((yapardimCount / total) * 100) : 50;
    const yapmazdimPercent = total > 0 ? (100 - yapardimPercent) : 50;

    const counterText = document.getElementById('q-counter')?.textContent || 'Soru 1 / 10';
    const parts = counterText.replace('Soru ', '').split(' / ');
    const currentIdx = parseInt(parts[0], 10);
    const totalCount = parseInt(parts[1], 10);

    const optimisticResults = {
      question: document.getElementById('q-text')?.innerHTML || '',
      yapardimPercent,
      yapmazdimPercent,
      playerAnswers,
      isLastQuestion: !isNaN(currentIdx) && !isNaN(totalCount) && currentIdx >= totalCount
    };

    const delay = (totalPly <= 1) ? 0 : 350;
    setTimeout(() => {
      showResults(optimisticResults);
    }, delay);
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

  document.getElementById('results-question').innerHTML = data.question || '';

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
  const activeCount = currentPlayers.filter(p => p.connected !== false).length || 1;
  nextBtn.style.display = (isHost || activeCount <= 1) ? '' : 'none';
}

// ── Next question ──
window.nextQuestion = async function() {
  const activeCount = currentPlayers.filter(p => p.connected !== false).length || 1;
  if (!isHost && activeCount > 1) return;
  try {
    const res = await fetch('/api/next-question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode, playerId: myPlayerId })
    });
    const data = await res.json();
    if (res.ok) {
      if (data.gameOver && data.results) {
        sendClientBroadcast('game_ended', data.results);
        showGameEnd(data.results);
      } else if (data.question) {
        sendClientBroadcast('new_question', data.question);
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
  lastGameEndData = data;
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

  updateGameEndRanking(data);

  const playAgainBtn = document.getElementById('play-again-btn');
  playAgainBtn.style.display = '';
  playAgainBtn.disabled = false;
  playAgainBtn.textContent = 'Tekrar Oyna';
}

function updateGameEndRanking(data) {
  const rankingList = document.getElementById('ranking-list');
  const playersList = data.players || [];
  if (!rankingList) return;
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
      sendClientBroadcast('back_to_lobby', data.lobbyData || {});
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
      sendClientBroadcast('play_again_update', { votes: data.votes, total: data.total });
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
  const activeCount = currentPlayers.filter(p => p.connected !== false).length || 1;
  if (!isHost && activeCount > 1) return;
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
      sendClientBroadcast('game_started', { question: data.question });
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
      if (msg.leftPlayerId) {
        currentPlayers = currentPlayers.filter(p => Number(p.id) !== Number(msg.leftPlayerId));
      }
      if (msg.players) {
        currentPlayers = msg.players;
      }
      renderPlayers(currentPlayers);
      updateSidebar(currentPlayers);
      break;

    case 'settings_updated':
      if (msg.settings && msg.settings.questionCount && (!isHost || Date.now() - lastSettingUpdateTime > 1500)) {
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

// ── Veritabanından Güncel Durumu Çek ve Ekrana Yansıt (Polling & Reconnect için) ──
let isReconnecting = false;
let pollingTimer = null;
let lastRealtimeMsgTime = 0;

async function syncStateFromDatabase() {
  try {
    const res = await fetch('/api/get-room-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: roomCode, playerId: myPlayerId })
    });
    const data = await res.json();
    if (!res.ok || !data.success) return;

    if (data.hostId !== undefined) {
      currentHostId = Number(data.hostId);
      isHost = Number(myPlayerId) === Number(currentHostId);
      sessionStorage.setItem('isHost', isHost ? 'true' : 'false');
    }
    if (data.players) {
      currentPlayers = data.players;
      renderPlayers(currentPlayers);
      updateSidebar(currentPlayers);
    }
    if (data.settings?.questionCount && (!isHost || Date.now() - lastSettingUpdateTime > 1500)) {
      const qc = document.getElementById('question-count');
      if (qc) qc.textContent = data.settings.questionCount;
    }
    if (data.playAgainVotes && Array.isArray(data.playAgainVotes)) {
      const playBtn = document.getElementById('play-again-btn');
      const activeCount = currentPlayers.filter(p => p.connected !== false).length || 1;
      if (playBtn && playBtn.disabled && data.playAgainVotes.length > 0) {
        playBtn.textContent = `${data.playAgainVotes.length}/${activeCount} Onayladı`;
      }
    }

    const isInEndScene = document.getElementById('scene-end')?.classList.contains('active');
    if (data.state === 'lobby' && !document.getElementById('scene-lobby')?.classList.contains('active')) {
      if (!isInEndScene) {
        currentQuestionId = null;
        currentResultQuestionText = null;
        showScene('lobby');
        if (!isHost) {
          document.getElementById('lobby-settings')?.querySelectorAll('.setting-btn').forEach(b => {
            b.style.display = 'none';
          });
        }
      }
    } else if (data.state === 'playing') {
      if (data.allAnswered && data.qResults) {
        const delay = (currentPlayers.length <= 1) ? 0 : 300;
        setTimeout(() => showResults(data.qResults), delay);
      } else if (data.currentQuestion) {
        showQuestion(data.currentQuestion);
        if (data.answers) {
          data.answers.forEach(a => addLiveAnswer(a));
        }
      }
    }
  } catch (err) {
    console.error('Veritabanı state sync hatası:', err);
  }
}

// ── Polling & Realtime Yedekleme Mekanizması (2 Saniye Kuralı) ──
function resetPollingTimer() {
  lastRealtimeMsgTime = Date.now();
  if (pollingTimer) clearInterval(pollingTimer);
  // Realtime gelirse polling iptal edilir, Realtime gelmezse 2 saniye sonra devreye girer
  pollingTimer = setInterval(async () => {
    if (Date.now() - lastRealtimeMsgTime >= 2000) {
      await syncStateFromDatabase();
    }
  }, 2000);
}

// ── Supabase Realtime Otomatik Yeniden Bağlanma & Loglama ──
function setupRealtimeChannel(config) {
  if (!config.url || !config.anonKey) return;
  if (!supabaseClient) {
    supabaseClient = window.supabase.createClient(config.url, config.anonKey);
  }
  if (roomChannel) {
    supabaseClient.removeChannel(roomChannel);
  }

  roomChannel = supabaseClient
    .channel(`room:${roomCode}`, { config: { broadcast: { self: false, ack: false } } });
  roomChannel
    .on('broadcast', { event: '*' }, (payload) => {
      resetPollingTimer();
      handleServerMessage(payload.payload);
    })
    // ── SUPABASE REALTIME (postgres_changes) DOĞRUDAN PAYLOAD.NEW KULLANIMI (0-REFETCH) ──
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `room_code=eq.${roomCode}` }, (payload) => {
      resetPollingTimer();
      if (payload.eventType === 'DELETE' || (payload.old && !payload.new?.id)) {
        const deletedId = Number(payload.old?.id);
        if (!isNaN(deletedId)) {
          currentPlayers = currentPlayers.filter(p => Number(p.id) !== deletedId);
          renderPlayers(currentPlayers);
        }
      } else if (payload.new && payload.new.id) {
        const newP = {
          id: Number(payload.new.id),
          name: payload.new.name || 'Anonim',
          color: payload.new.color || '#666',
          connected: payload.new.connected !== false,
          isHost: Number(payload.new.id) === Number(currentHostId)
        };
        const idx = currentPlayers.findIndex(p => Number(p.id) === Number(newP.id));
        if (idx >= 0) {
          currentPlayers[idx] = { ...currentPlayers[idx], ...newP };
        } else {
          currentPlayers.push(newP);
        }
        renderPlayers(currentPlayers);
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'answers', filter: `room_code=eq.${roomCode}` }, (payload) => {
      resetPollingTimer();
      if (payload.new && payload.new.question_id && (Number(payload.new.question_id) === Number(currentQuestionId) || String(payload.new.question_id) === String(currentQuestionId))) {
        addLiveAnswer({
          playerId: Number(payload.new.player_id),
          name: payload.new.player_name || 'Anonim',
          color: payload.new.player_color || '#666',
          answer: payload.new.answer,
          questionId: payload.new.question_id,
          totalPlayers: currentPlayers.filter(p => p.connected !== false).length || 1
        });
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `code=eq.${roomCode}` }, (payload) => {
      resetPollingTimer();
      if (payload.new) {
        const room = payload.new;
        if (room.host_player_id) currentHostId = Number(room.host_player_id);
        if (room.settings && room.settings.questionCount && (!isHost || Date.now() - lastSettingUpdateTime > 1500)) {
          const countEl = document.getElementById('question-count');
          if (countEl) countEl.textContent = room.settings.questionCount;
        }
        if (room.play_again_votes && Array.isArray(room.play_again_votes)) {
          const playBtn = document.getElementById('play-again-btn');
          const activeCount = currentPlayers.filter(p => p.connected !== false).length || 1;
          if (playBtn && playBtn.disabled && room.play_again_votes.length > 0) {
            playBtn.textContent = `${room.play_again_votes.length}/${activeCount} Onayladı`;
          }
        }
        if (room.state === 'playing' && room.questions && room.current_question_index >= 0) {
          const q = room.questions[room.current_question_index];
          if (q && q.id !== currentQuestionId) {
            showQuestion({
              id: q.id,
              text: q.text,
              index: room.current_question_index,
              total: room.questions.length
            });
          }
        } else if (room.state === 'lobby' && !document.getElementById('scene-lobby')?.classList.contains('active')) {
          currentQuestionId = null;
          currentResultQuestionText = null;
          showScene('lobby');
          renderPlayers(currentPlayers);
          if (room.settings?.questionCount) {
            const qc = document.getElementById('question-count');
            if (qc) qc.textContent = room.settings.questionCount;
          }
        }
      }
    })
    .subscribe((status, err) => {
      console.log(`[Supabase Realtime] Bağlantı durumu: ${status}`, err || '');
      if (status === 'SUBSCRIBED') {
        resetPollingTimer();
        if (isReconnecting) {
          console.log("[Supabase Realtime] Yeniden bağlandı, veritabanından güncel state çekiliyor...");
          syncStateFromDatabase();
          isReconnecting = false;
        } else {
          syncStateFromDatabase();
        }
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn("Realtime bağlantısı koptu, yeniden bağlanıyor");
        isReconnecting = true;
        setTimeout(() => setupRealtimeChannel(config), 1500);
      }
    });
}

// ── Sıfır Gecikmeli Başlatma ──
async function initGame() {
  document.getElementById('lobby-code').textContent = roomCode;
  const name = sessionStorage.getItem('playerName') || 'Anonim';

  fetch('/api/rejoin-room', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: roomCode, playerId: myPlayerId, name })
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
    setupRealtimeChannel(config);
  } catch (err) {
    console.error('Realtime abonelik hatası:', err);
  }
}

initGame();


// ── Sayfa Kapandığında veya Sekme Terk Edildiğinde Çıkış Bildirimi ──
function notifyPlayerLeft() {
  if (!roomCode || !myPlayerId) return;
  const url = '/api/leave-room';
  const body = JSON.stringify({ roomCode, playerId: myPlayerId });
  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: 'application/json' });
    navigator.sendBeacon(url, blob);
  } else {
    try {
      fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true });
    } catch (e) {}
  }
}

window.addEventListener('beforeunload', notifyPlayerLeft);
window.addEventListener('pagehide', notifyPlayerLeft);
