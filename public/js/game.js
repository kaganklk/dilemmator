// game.js — Yıldırım Hızı (Lightning Fast & Optimistic UI) Destekli Oyun Mantığı

const roomCode = new URLSearchParams(location.search).get('room');
const myPlayerId = parseInt(localStorage.getItem('playerId'), 10);
let isHost = localStorage.getItem('isHost') === 'true';

if (!roomCode || isNaN(myPlayerId)) {
  window.location.href = '/';
}

let supabaseClient = null;
let roomChannel = null;
let currentPlayers = []; 

// ── Event Deduplication (Tekrarlanan Event & State Çakışması Önleyici) ──
const processedEventIds = new Set();
let lastRenderedPlayersHash = "";
let lastSidebarPlayersHash = "";

function isDuplicateEvent(eventId) {
  if (!eventId) return false;
  if (processedEventIds.has(eventId)) {
    console.log(`[Deduplication] Çakışan/tekrarlanan event yoksayıldı: ${eventId}`);
    return true;
  }
  processedEventIds.add(eventId);
  if (processedEventIds.size > 500) {
    const first = processedEventIds.values().next().value;
    processedEventIds.delete(first);
  }
  return false;
}

function getPlayersHash(players) {
  if (!Array.isArray(players) || players.length === 0) return "empty";
  const normalized = players.map(p => ({
    id: Number(p.id),
    name: (p.name || '').trim(),
    color: p.color || '',
    connected: p.connected !== false,
    isHost: !!p.isHost || Number(p.id) === Number(currentHostId)
  })).sort((a, b) => a.id - b.id);
  return JSON.stringify(normalized);
}

function sendClientBroadcast(eventType, payloadData) {
  try {
    if (roomChannel) {
      const timestamp = Date.now();
      const eventId = `client_${eventType}_${timestamp}_${Math.random().toString(36).substr(2, 5)}`;
      roomChannel.send({
        type: 'broadcast',
        event: eventType,
        payload: { type: eventType, eventId, timestamp, ...payloadData }
      });
    }
  } catch (e) { /* Hata yokmuş gibi devam et */ }
}
let currentHostId = null;
let currentQuestionAnswers = [];
let hasAnswered = false;
let currentQuestionId = null;
let currentQuestionIndex = -1;  // Mevcut soru indeksi — geri gidişi engellemek için
let currentResultQuestionText = null;
let lastGameEndData = null;
let gameEndScreenFrozen = false;

// ── Scene management ──
function showScene(name) {
  if (name !== 'end') {
    gameEndScreenFrozen = false; // Oyun bitti ekrandan çıkınca dondurma kilidini kaldır
  }
  document.querySelectorAll('.scene').forEach(s => s.classList.remove('active'));
  const scene = document.getElementById('scene-' + name);
  if (scene) {
    scene.classList.add('active');
  }
  const sidebar = document.querySelector('.players-sidebar');
  if (sidebar) {
    sidebar.style.display = (name === 'end') ? 'none' : '';
  }
  // Global geri butonu: lobi, soru ve sonuç ekranlarında göster; diğerlerinde gizle
  const backBtn = document.getElementById('global-back-btn');
  if (backBtn) {
    const showBackOn = ['lobby', 'question', 'results'];
    backBtn.style.display = showBackOn.includes(name) ? 'flex' : 'none';
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

window.confirmLeaveRoom = function() {
  const modal = document.getElementById('leave-modal');
  if (modal) modal.style.display = 'flex';
};

// ── Sidebar ──
function updateSidebar(players) {
  currentPlayers = players || [];
  const newHash = getPlayersHash(currentPlayers);
  if (newHash === lastSidebarPlayersHash && lastSidebarPlayersHash !== "") {
    // Aynı oyuncu listesi zaten yan menüde ekranda, duplicate render engellendi!
    return;
  }
  lastSidebarPlayersHash = newHash;

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

  if (document.getElementById('scene-end')?.classList.contains('active') && lastGameEndData && !gameEndScreenFrozen) {
    updateGameEndRanking(lastGameEndData);
  }

  const newHash = getPlayersHash(currentPlayers);
  const isLobbyActive = document.getElementById('scene-lobby')?.classList.contains('active');
  const grid = document.getElementById('lobby-players');
  if (newHash === lastRenderedPlayersHash && lastRenderedPlayersHash !== "" && isLobbyActive && grid?.children?.length > 0) {
    // Aynı veri zaten lobi ekranda var, Realtime & polling çakışması sonucu oluşan liste titreşimi engellendi!
    return;
  }
  lastRenderedPlayersHash = newHash;

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
let pendingSettingsPromise = null;

function getQuestionCountValue() {
  const el = document.getElementById('question-count');
  return parseInt(el.value, 10);
}

function isQuestionCountValid() {
  const val = getQuestionCountValue();
  return !isNaN(val) && val >= 1 && val <= 10;
}

function updateQuestionCountValidity() {
  const el = document.getElementById('question-count');
  const startBtn = document.getElementById('start-btn');
  if (!el) return;
  const valid = isQuestionCountValid();
  el.style.color = valid ? '' : '#ff3b30';
  el.style.borderColor = valid ? '' : '#ff3b30';
  if (startBtn && isHost) {
    startBtn.disabled = !valid;
  }
}

function setQuestionCountValue(val) {
  val = Math.max(1, Math.min(10, val));
  const el = document.getElementById('question-count');
  el.value = val;
  updateQuestionCountValidity();
  return val;
}

async function sendSettingsUpdate(val) {
  lastSettingUpdateTime = Date.now();
  sendClientBroadcast('settings_updated', { settings: { questionCount: val } });

  if (updateSettingsTimeout) clearTimeout(updateSettingsTimeout);
  pendingSettingsPromise = new Promise((resolve) => {
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
      resolve();
    }, 250);
  });
}

window.changeQuestionCount = async function(delta) {
  if (!isHost) return;
  const cur = getQuestionCountValue();
  const base = isNaN(cur) ? 10 : cur;
  let val = setQuestionCountValue(base + delta);
  await sendSettingsUpdate(val);
};

window.onQuestionCountInput = async function() {
  if (!isHost) return;
  const el = document.getElementById('question-count');
  const raw = parseInt(el.value, 10);
  updateQuestionCountValidity();
  if (isNaN(raw) || raw < 1 || raw > 10) return; // Geçersiz — kırmızı göster, kaydetme
  await sendSettingsUpdate(raw);
};

// ── Question rendering ──
function showQuestion(question) {
  if (!question) return;
  const qId = question.id ?? question.index ?? '0';
  const incomingIndex = question.index ?? -1;

  // ── GERİ GİDİŞ KORU: Mevcut sorudan daha eski bir soru gelirse yoksay ──
  // (polling/realtime DB'yi geç güncelleyince eski soruyu tekrar göstermesini engeller)
  if (incomingIndex < currentQuestionIndex) {
    console.log(`[Dedup] Eski soru yoksayıldı: gelen index=${incomingIndex}, mevcut=${currentQuestionIndex}`);
    return;
  }

  // ── Aynı soruya cevap verildikten sonra geri dönme ──
  // Kullanıcı bu soruyu zaten cevapladıysa, polling/realtime onu tekrar gösteremesin
  if (hasAnswered && currentQuestionId === question.id) {
    console.log(`[Dedup] Cevaplanan soru yoksayıldı: Q${question.id}`);
    return;
  }

  if (currentQuestionId === question.id && document.getElementById('scene-question')?.classList.contains('active')) {
    return;
  }
  // Bu sorunun sonucu zaten gösterildiyse soruya geri dönme (ID bazlı kontrol)
  if (processedEventIds.has(`state_res_${question.id || qId}`)) {
    console.log(`[Dedup] Sonucu gösterilmiş soru yoksayıldı: Q${question.id}`);
    return;
  }

  currentQuestionId = question.id;
  currentQuestionIndex = incomingIndex;
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
    // Sunucu yanıtından sonuç ekranı TETİKLENMEZ.
    // Optimistic sonuç zaten gösterildi, sunucu broadcast'i de dedup ile engellenir.
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
  const ansFlag = `ans_event_${currentQuestionId}_${data.playerId}`;
  if (isDuplicateEvent(ansFlag)) {
    return; // Realtime & polling aynı cevabı yakalarsa 2. kez eklemiyor
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

  // Tüm oyuncular cevapladıysa ve bu oyuncu da cevap verdiyse optimistic sonuç göster
  // (addLiveAnswer'dan da tetiklenir — "ikinci oyuncunun cevabı gelince birinci oyuncu da görür")
  triggerOptimisticResultsIfNeeded();
}

function triggerOptimisticResultsIfNeeded() {
  if (!currentQuestionId) return;
  const totalAns = currentQuestionAnswers.length;
  const connectedCount = currentPlayers.filter(p => p.connected !== false).length;
  // totalPly: en az toplandığımız cevap sayısı kadar olsun
  // (currentPlayers stale ise ve daha az oyuncu gösteriyorsa erken ateflemeyi önler)
  const totalPly = Math.max(connectedCount, totalAns, 1);

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
    if (total === 0) return; // Cevap yoksa sonuç gösterme
    const yapardimPercent = Math.round((yapardimCount / total) * 100);
    const yapmazdimPercent = 100 - yapardimPercent;

    const counterText = document.getElementById('q-counter')?.textContent || 'Soru 1 / 10';
    const parts = counterText.replace('Soru ', '').split(' / ');
    const currentIdx = parseInt(parts[0], 10);
    const totalCount = parseInt(parts[1], 10);

    const optimisticResults = {
      question: document.getElementById('q-text')?.innerHTML || '',
      questionId: currentQuestionId,
      yapardimPercent,
      yapmazdimPercent,
      playerAnswers,
      isLastQuestion: !isNaN(currentIdx) && !isNaN(totalCount) && currentIdx >= totalCount
    };

    // Tek kişi için gecikmesiz, çok kişi için kısa gecikme
    if (totalPly <= 1) {
      showResults(optimisticResults);
    } else {
      setTimeout(() => {
        showResults(optimisticResults);
      }, 350);
    }
  }
}

// ── Results rendering ──
function showResults(data) {
  if (!data) return;
  // Hiç cevap yoksa sonucu asla gösterme (race condition 50/50 artifact)
  if (!data.playerAnswers || data.playerAnswers.length === 0) {
    console.log('[showResults] Boş playerAnswers, göstermek reddedildi.');
    return;
  }
  // Dedup: soru ID'sine göre kontrol et (metin farklılıklarından etkilenmesin)
  const resQuestionId = data.questionId || currentQuestionId;
  const resFlag = `state_res_${resQuestionId}`;
  if (isDuplicateEvent(resFlag)) {
    return;
  }
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
  nextBtn.disabled = false;
  nextBtn.style.pointerEvents = '';
  if (data.isLastQuestion) {
    nextBtn.textContent = 'Sonucu Gör 🏆';
  } else {
    nextBtn.textContent = 'Sonraki Soru →';
  }
  const activeCount = currentPlayers.filter(p => p.connected !== false).length || 1;
  nextBtn.style.display = (isHost || activeCount <= 1) ? '' : 'none';
}

// ── Next question ──
let isNextQuestionLoading = false;
window.nextQuestion = async function() {
  if (isNextQuestionLoading) return; // Zaten işleniyor, ikinci isteği tamamen yoksay
  const activeCount = currentPlayers.filter(p => p.connected !== false).length || 1;
  if (!isHost && activeCount > 1) return;
  
  isNextQuestionLoading = true;
  const btn = document.getElementById('next-btn');
  if (btn) {
    btn.disabled = true;
    btn.style.pointerEvents = 'none';
    btn.textContent = 'Bekleniyor...';
  }

  try {
    const res = await fetch('/api/next-question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomCode, playerId: myPlayerId })
    });
    const data = await res.json();
    if (res.ok && !data.error) {
      if (data.gameOver && data.results) {
        sendClientBroadcast('game_ended', data.results);
        showGameEnd(data.results);
      } else if (data.question) {
        sendClientBroadcast('new_question', data.question);
        showQuestion(data.question);
      }
      // Başarılı geçişte buton aktif EDİLMEZ — yeni soru/sonuç ekranı kendi butonunu gösterecek
    } else {
      // Hata veya yarış koşulu: butonu geri aç
      if (btn) {
        btn.disabled = false;
        btn.style.pointerEvents = '';
        btn.textContent = 'Sonraki Soru →';
      }
    }
  } catch (err) {
    showError('Sonraki soruya geçilemedi.');
    if (btn) {
      btn.disabled = false;
      btn.style.pointerEvents = '';
      btn.textContent = 'Sonraki Soru →';
    }
  } finally {
    isNextQuestionLoading = false;
  }
};

// ── Game end (Tek Seferlik Doğrudan Veritabanı Sorgusu ve Dondurma) ──
async function showGameEnd(data) {
  if (!data && !roomCode) return;
  
  // Kural: Ekrana bas ve BİR DAHA GÜNCELLEME (Realtime ve polling tetiklemeleri engellenir)
  if (gameEndScreenFrozen) {
    console.log("[Oyun Bitti] Oyun sonu cevap tablosu çekildi, hesaplandı ve donduruldu. Yeni güncelleme yoksayıtıldı.");
    return;
  }
  if (isDuplicateEvent('state_game_end_scene') && document.getElementById('scene-end')?.classList.contains('active')) {
    return;
  }
  
  gameEndScreenFrozen = true;
  lastGameEndData = data || {};
  showScene('end');
  renderGameEndUI(lastGameEndData);

  // Açılır açılmaz Supabase'deki answers tablosu ve odanın soru etiketlerini tek seferlik çek
  let allAnswers = null;
  let roomQuestions = null;
  if (supabaseClient && roomCode) {
    try {
      const [ansRes, roomRes] = await Promise.all([
        supabaseClient.from('answers').select('*').eq('room_code', roomCode),
        supabaseClient.from('rooms').select('questions').eq('code', roomCode).maybeSingle()
      ]);
      if (!ansRes.error && ansRes.data && ansRes.data.length > 0) {
        allAnswers = ansRes.data;
      }
      if (!roomRes.error && roomRes.data && Array.isArray(roomRes.data.questions)) {
        roomQuestions = roomRes.data.questions;
      }
    } catch (err) {
      console.error("Oyun bitti cevap verisi çekilemedi:", err);
    }
  }

  // Çekilen veriden gerçek tagleri ('cani', 'paragoz', 'bencil') sayarak ödülleri adilce hesapla!
  if (allAnswers && allAnswers.length > 0) {
    const totalQCount = roomQuestions ? roomQuestions.length : parseInt(document.getElementById('question-count')?.value || '10', 10);
    const playerStats = {};
    const playersList = (lastGameEndData.players && lastGameEndData.players.length > 0 ? lastGameEndData.players : currentPlayers).map(p => ({
      id: Number(p.id),
      name: p.name || 'Anonim',
      color: p.color || '#666',
      canililkYuzdesi: 0
    }));

    playersList.forEach(p => { playerStats[p.id] = { yapardim: 0, yapmazdim: 0, cani: 0, paragoz: 0, bencil: 0 }; });

    allAnswers.forEach(ans => {
      const pid = Number(ans.player_id);
      if (!playerStats[pid]) {
        playerStats[pid] = { yapardim: 0, yapmazdim: 0, cani: 0, paragoz: 0, bencil: 0 };
        if (!playersList.some(p => p.id === pid)) {
          playersList.push({
            id: pid,
            name: ans.player_name || 'Anonim',
            color: ans.player_color || '#666',
            canililkYuzdesi: 0
          });
        }
      }
      if (ans.answer === 'yapardim') {
        playerStats[pid].yapardim++;
        const qObj = (roomQuestions || []).find(q => String(q.id) === String(ans.question_id));
        if (qObj && Array.isArray(qObj.tags)) {
          if (qObj.tags.includes('cani')) playerStats[pid].cani++;
          if (qObj.tags.includes('paragoz')) playerStats[pid].paragoz++;
          if (qObj.tags.includes('bencil')) playerStats[pid].bencil++;
        }
      } else {
        playerStats[pid].yapmazdim++;
      }
    });

    playersList.forEach(p => {
      const st = playerStats[p.id] || { yapardim: 0, yapmazdim: 0, cani: 0, paragoz: 0, bencil: 0 };
      const totalAnswered = Math.max(1, st.yapardim + st.yapmazdim);
      p.canililkYuzdesi = Math.round((st.yapardim / totalAnswered) * 100);
      p.katilimYuzdesi = Math.round((totalAnswered / Math.max(1, totalQCount)) * 100);
    });

    playersList.sort((a, b) => b.canililkYuzdesi - a.canililkYuzdesi);

    const buildAward = (categoryKey) => {
      let maxScore = 0;
      playersList.forEach(p => {
        const score = playerStats[p.id]?.[categoryKey] || 0;
        if (score > maxScore) maxScore = score;
      });
      if (maxScore <= 0) return undefined;

      const winners = playersList.filter(p => (playerStats[p.id]?.[categoryKey] || 0) === maxScore);
      const nameText = winners.map(w => w.name || 'Anonim').join(winners.length === 2 ? ' & ' : ', ');
      return {
        name: nameText,
        score: maxScore,
        total: totalQCount,
        color: winners[0]?.color || '#FF2D55',
      };
    };

    const awards = {};
    const caniAward = buildAward('cani');
    if (caniAward) awards.enCani = caniAward;
    const paragozAward = buildAward('paragoz');
    if (paragozAward) awards.enParagoz = paragozAward;
    const bencilAward = buildAward('bencil');
    if (bencilAward) awards.enBencil = bencilAward;

    lastGameEndData = {
      players: playersList,
      awards: awards
    };

    // Hesaplanan kesin verileri ekrana bas ve KESİNLİKLE bir daha güncelleme!
    renderGameEndUI(lastGameEndData);
  }
}

function renderGameEndUI(data) {
  if (!data) return;
  const awardsGrid = document.getElementById('awards-grid');
  const awardConfigs = [
    { key: 'enCani', emoji: '🔪', title: 'En Cani' },
    { key: 'enParagoz', emoji: '💰', title: 'En Paragöz' },
    { key: 'enBencil', emoji: '🎭', title: 'En Bencil' },
  ];

  if (awardsGrid) {
    awardsGrid.innerHTML = awardConfigs
      .filter(a => data.awards && data.awards[a.key])
      .map(a => {
        const award = data.awards[a.key];
        const scoreText = award.total > 0
          ? `${Math.round((award.score / award.total) * 100)}% (${award.score}/${award.total})`
          : `${award.score} soru`;
        return `
          <div class="award-card">
            <div class="award-emoji">${a.emoji}</div>
            <div class="award-title">${a.title}</div>
            <div class="award-name" style="color:${award.color || '#FF2D55'}">${award.name}</div>
            <div class="award-score">${scoreText}</div>
          </div>
        `;
      }).join('');
  }

  updateGameEndRanking(data);

  const playAgainBtn = document.getElementById('play-again-btn');
  if (playAgainBtn) {
    playAgainBtn.style.display = '';
    playAgainBtn.disabled = false;
    playAgainBtn.textContent = 'Tekrar Oyna';
  }
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
      // Yeni oyun için tüm state ve dedup önbelleğini sıfırla
      processedEventIds.clear();
      hasAnswered = false;
      currentQuestionAnswers = [];
      currentQuestionId = null;
      currentQuestionIndex = -1;
      currentResultQuestionText = null;
      gameEndScreenFrozen = false;
      lastGameEndData = null;
      sendClientBroadcast('new_question', data.firstQ);
      showQuestion(data.firstQ);
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

  // Geçersiz soru sayısı varsa oyunu başlatma
  if (!isQuestionCountValid()) {
    updateQuestionCountValidity(); // Kırmızı göster
    showError('Geçerli bir soru sayısı gir (1–10).');
    return;
  }

  const startBtn = document.getElementById('start-btn');
  startBtn.disabled = true;
  startBtn.textContent = 'Başlatılıyor...';

  // Bekleyen ayar güncellemesi varsa önce onu tamamla
  if (pendingSettingsPromise) {
    await pendingSettingsPromise;
    pendingSettingsPromise = null;
  }
  // Debounce timer'ı hâlâ bekliyorsa anında çalıştır
  if (updateSettingsTimeout) {
    clearTimeout(updateSettingsTimeout);
    updateSettingsTimeout = null;
    const val = getQuestionCountValue();
    try {
      await fetch('/api/update-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode, playerId: myPlayerId, questionCount: val })
      });
    } catch (err) {}
  }

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

  // Unique ID veya Timestamp mekanizması ile çift işleme yasağı
  const eventUniqueId = msg.eventId || msg.timestamp || msg.id;
  if (eventUniqueId) {
    if (isDuplicateEvent(`msg_${msg.type}_${eventUniqueId}`)) {
      return;
    }
  }

  switch (msg.type) {
    case 'room_joined':
      localStorage.setItem('playerId', msg.playerId);
      if (msg.isHost !== undefined) {
        isHost = msg.isHost;
        localStorage.setItem('isHost', isHost ? 'true' : 'false');
      }
      document.getElementById('lobby-code').textContent = msg.roomCode || roomCode;
      if (msg.settings && msg.settings.questionCount) {
        document.getElementById('question-count').value = msg.settings.questionCount;
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
        document.getElementById('question-count').value = msg.settings.questionCount;
      }
      break;

    case 'game_started':
      showQuestion(msg.question);
      break;

    case 'player_answered':
      addLiveAnswer(msg);
      break;

    case 'question_results':
      // Boş cevap listesi = race condition artifact, gösterme
      if (!msg.playerAnswers || msg.playerAnswers.length === 0) {
        console.log('[question_results] Boş playerAnswers, yoksayıldı.');
        break;
      }
      // Eski sorudan kalan gecikmış broadcast'ı yoksay
      if (msg.questionId && currentQuestionId && String(msg.questionId) !== String(currentQuestionId)) {
        console.log(`[Dedup] Eski sorunun sonucu yoksayıldı: broadcast Q${msg.questionId}, mevcut Q${currentQuestionId}`);
        break;
      }
      const delay = (currentPlayers.length <= 1) ? 0 : 600;
      setTimeout(() => {
        showResults(msg);
      }, delay);
      break;

    case 'new_question':
      // index=0 + oyun sonu ekranı = Tekrar Oyna tarafından tetiklenen yeni oyun başlangıcı
      // HTTP yanıtı { votes:1 } gelen ilk oylayan da yeni oyuna girmeli
      if (msg.index === 0 && document.getElementById('scene-end')?.classList.contains('active')) {
        console.log('[new_question] Tekrar Oyna yeni oyun algılandı, state sıfırlanıyor.');
        processedEventIds.clear();
        hasAnswered = false;
        currentQuestionAnswers = [];
        currentQuestionId = null;
        currentQuestionIndex = -1;
        currentResultQuestionText = null;
        gameEndScreenFrozen = false;
        lastGameEndData = null;
      }
      showQuestion(msg);
      break;

    case 'game_ended':
      showGameEnd(msg);
      break;

    case 'back_to_lobby':
      if (isDuplicateEvent('state_back_to_lobby_scene') && document.getElementById('scene-lobby')?.classList.contains('active')) {
        return;
      }
      processedEventIds.clear(); // Yeni oyun turu için önceki tüm state ve event ID'lerini sıfırla!
      currentQuestionId = null;
      currentQuestionIndex = -1;
      currentResultQuestionText = null;
      showScene('lobby');
      if (msg.players) renderPlayers(msg.players);
      if (msg.settings && msg.settings.questionCount) {
        document.getElementById('question-count').value = msg.settings.questionCount;
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
let isSyncing = false; // Aynı anda iki polling isteği gitmesin

async function syncStateFromDatabase() {
  if (isSyncing) return; // Önceki istek bitmeden yeni istek gönderme
  isSyncing = true;
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
      localStorage.setItem('isHost', isHost ? 'true' : 'false');
    }
    // currentPlayers'u sadece doluysa güncelle (boş dizi ile stale veriyi üzerine yazma)
    if (data.players && data.players.length > 0) {
      currentPlayers = data.players;
      renderPlayers(currentPlayers);
      updateSidebar(currentPlayers);
    }
    if (data.settings?.questionCount && (!isHost || Date.now() - lastSettingUpdateTime > 1500)) {
      const qc = document.getElementById('question-count');
      if (qc) qc.value = data.settings.questionCount;
    }
    if (data.playAgainVotes && Array.isArray(data.playAgainVotes)) {
      const playBtn = document.getElementById('play-again-btn');
      const activeCount = currentPlayers.filter(p => p.connected !== false).length || 1;
      if (playBtn && playBtn.disabled && data.playAgainVotes.length > 0) {
        playBtn.textContent = `${data.playAgainVotes.length}/${activeCount} Onayladı`;
      }
    }

    const isInEndScene = document.getElementById('scene-end')?.classList.contains('active');
    // Soru veya sonuç ekranındayken asla lobi'ye dönme (startGame DB gecikmesi race condition'ı)
    const isInGameScene =
      document.getElementById('scene-question')?.classList.contains('active') ||
      document.getElementById('scene-results')?.classList.contains('active') ||
      isInEndScene;

    if (data.state === 'lobby' && !document.getElementById('scene-lobby')?.classList.contains('active')) {
      if (!isInGameScene) {
        currentQuestionId = null;
        currentQuestionIndex = -1;
        currentResultQuestionText = null;
        showScene('lobby');
        if (!isHost) {
          document.getElementById('lobby-settings')?.querySelectorAll('.setting-btn').forEach(b => {
            b.style.display = 'none';
          });
        }
      }
    } else if (data.state === 'playing') {
      // Polling/sync'ten sonuç ekranı TETİKLENMEZ. Sadece soru göster.
      if (data.currentQuestion) {
        showQuestion(data.currentQuestion);
        // Mevcut cevapları göster ama sonuç ekranını tetikleme
        if (data.answers && !hasAnswered) {
          data.answers.forEach(a => addLiveAnswer(a));
        }
      }
    } else if (data.state === 'results') {
      // Sayfa yenilendiğinde oda 'results' durumundaysa sonuçları göster
      // Ama sadece gerçek cevap varsa (cevaplar silinmiş olabilir → 50/50 sahte veri)
      if (data.qResults && data.qResults.playerAnswers && data.qResults.playerAnswers.length > 0) {
        showResults(data.qResults);
      } else if (data.currentQuestion) {
        // Sonuç verisi yoksa veya boşsa soruyu göster
        showQuestion(data.currentQuestion);
      }
    } else if (data.state === 'end') {
      // Sayfa yenilendiğinde oda 'end' durumundaysa oyun sonu ekranını göster
      showGameEnd(data);
    }
  } catch (err) {
    console.error('Veritabanı state sync hatası:', err);
  } finally {
    isSyncing = false;
  }
}

// ── Polling & Realtime Yedekleme Mekanizması (2s, Realtime'dan sonra 2s sustur) ──
function resetPollingTimer() {
  lastRealtimeMsgTime = Date.now();
  if (pollingTimer) clearInterval(pollingTimer);
  // Realtime gelince polling 2 saniye dondurulur; Realtime gelmezse polling devreye girer
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
      // Supabase'den gelen cevap güncellemeleri sadece avatar göstermek için kullanılır,
      // sonuç ekranını TETİKLEMEZ. Sadece kendi cevabımız sonuç tetikler.
      if (payload.new && payload.new.question_id && (Number(payload.new.question_id) === Number(currentQuestionId) || String(payload.new.question_id) === String(currentQuestionId))) {
        // Kendi cevabımızı zaten yerel olarak ekliyoruz, tekrar eklemeyelim
        if (Number(payload.new.player_id) !== Number(myPlayerId)) {
          addLiveAnswer({
            playerId: Number(payload.new.player_id),
            name: payload.new.player_name || 'Anonim',
            color: payload.new.player_color || '#666',
            answer: payload.new.answer,
            questionId: payload.new.question_id,
            totalPlayers: currentPlayers.filter(p => p.connected !== false).length || 1
          });
        }
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `code=eq.${roomCode}` }, (payload) => {
      resetPollingTimer();
      if (payload.new) {
        const room = payload.new;
        if (room.host_player_id) currentHostId = Number(room.host_player_id);
        if (room.settings && room.settings.questionCount && (!isHost || Date.now() - lastSettingUpdateTime > 1500)) {
          const countEl = document.getElementById('question-count');
          if (countEl) countEl.value = room.settings.questionCount;
        }
        if (room.play_again_votes && Array.isArray(room.play_again_votes)) {
          const playBtn = document.getElementById('play-again-btn');
          const activeCount = currentPlayers.filter(p => p.connected !== false).length || 1;
          if (playBtn && playBtn.disabled && room.play_again_votes.length > 0) {
            playBtn.textContent = `${room.play_again_votes.length}/${activeCount} Onayladı`;
          }
        }
        // Supabase realtime rooms güncellemesinden soru değiştirme YAPILMAZ.
        // Soru değişimi sadece broadcast event'leri (new_question, game_started) ile olur.
        if (room.state === 'lobby' && !document.getElementById('scene-lobby')?.classList.contains('active')) {
          currentQuestionId = null;
          currentResultQuestionText = null;
          showScene('lobby');
          renderPlayers(currentPlayers);
          if (room.settings?.questionCount) {
            const qc = document.getElementById('question-count');
            if (qc) qc.value = room.settings.questionCount;
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

// ── Başlatma ──
async function initGame() {
  document.getElementById('lobby-code').textContent = roomCode;
  const name = localStorage.getItem('playerName') || 'Anonim';

  // rejoin-room ve config aynı anda paralel başlat (hız kazanımı)
  const rejoinPromise = fetch('/api/rejoin-room', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: roomCode, playerId: myPlayerId, name })
  });
  const configPromise = fetch('/api/config');

  // Config gelir gelmez Realtime'ı kur (rejoin'i bekleme)
  configPromise
    .then(r => r.json())
    .then(config => setupRealtimeChannel(config))
    .catch(err => console.error('Realtime abonelik hatası:', err));

  // rejoin-room yanıtı gelince lobi/soru ekranına geç
  rejoinPromise
    .then(r => r.json())
    .then(data => {
      if (data && data.type === 'room_joined') {
        handleServerMessage(data);
      } else {
        localStorage.removeItem('roomCode');
        localStorage.removeItem('playerId');
        localStorage.removeItem('isHost');
        localStorage.removeItem('playerName');
        window.location.href = '/';
      }
    })
    .catch(() => {
      localStorage.removeItem('roomCode');
      localStorage.removeItem('playerId');
      localStorage.removeItem('isHost');
      localStorage.removeItem('playerName');
      window.location.href = '/';
    });
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
