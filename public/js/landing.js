// landing.js — Ana sayfa mantığı

const previewDilemmas = [
  "Önünde bir buton var. Her bastığında bugüne kadar iletişime geçtiğin herhangi biri ölecek — sokakta yol sorduğun biri de olabilir, annen de. Ama karşılığında 1 milyar dolar alacaksın. Butona basar mıydın?",
  "Ölümsüz olabilirsin ama dünyada tek sen olursun — sevdiğin herkes 30 yıl içinde ölecek. Sonsuz yalnızlık karşılığında ölümsüzlüğü kabul eder miydin?",
  "Bir ilaç seni ömür boyu gerçek mutlu eder ama tüm anıların silinir. Ailenin kim olduğunu bile hatırlamazsın. Alır mıydın?",
  "50 milyon dolar karşılığında rastgele bir ülkede 1000 kişi ölecek — haberlerde bile çıkmayacak. Kabul eder miydin?",
  "Dünyadaki açlığı bitirebilirsin ama karşılığında sen hayatının geri kalanında sadece ekmek ve su tüketebileceksin. Yapar mıydın?"
];

let previewIndex = 0;

// Tab switching
window.switchTab = function(id) {
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + id).classList.add('active');
  document.getElementById('panel-' + id).classList.add('active');
};

// Code input: auto uppercase
document.getElementById('code-input').addEventListener('input', function() {
  this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

// Preview rotation
setInterval(() => {
  const el = document.getElementById('preview-text');
  const dotsEl = document.getElementById('dots');
  el.classList.add('fade-out');

  setTimeout(() => {
    previewIndex = (previewIndex + 1) % previewDilemmas.length;
    el.textContent = previewDilemmas[previewIndex];
    el.classList.remove('fade-out');
    dotsEl.querySelectorAll('.dot').forEach((d, i) => {
      d.classList.toggle('on', i === previewIndex);
    });
  }, 380);
}, 5500);

// Stats
async function fetchStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    document.getElementById('s-players').textContent = data.players;
    document.getElementById('s-rooms').textContent = data.rooms;
  } catch (e) { /* ignore */ }
}
fetchStats();
setInterval(fetchStats, 10000);

// Error
function showError(msg) {
  const toast = document.getElementById('error-toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// WebSocket
let ws = null;

function connectWS() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}`);

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);

    switch (msg.type) {
      case 'room_created':
        // Odaya yönlendir
        sessionStorage.setItem('playerId', msg.playerId);
        sessionStorage.setItem('roomCode', msg.roomCode);
        sessionStorage.setItem('isHost', 'true');
        sessionStorage.setItem('playerName', document.getElementById('create-name').value.trim() || 'Anonim');
        window.location.href = `/game.html?room=${msg.roomCode}`;
        break;

      case 'room_joined':
        sessionStorage.setItem('playerId', msg.playerId);
        sessionStorage.setItem('roomCode', msg.roomCode);
        sessionStorage.setItem('isHost', 'false');
        sessionStorage.setItem('playerName', document.getElementById('join-name').value.trim() || 'Anonim');
        window.location.href = `/game.html?room=${msg.roomCode}`;
        break;

      case 'error':
        showError(msg.message);
        // Butonları geri aç
        document.getElementById('create-btn').textContent = 'Oda Oluştur';
        document.getElementById('create-btn').disabled = false;
        document.getElementById('join-btn').textContent = 'Odaya Gir';
        document.getElementById('join-btn').disabled = false;
        break;
    }
  };

  ws.onclose = () => {
    setTimeout(connectWS, 2000);
  };
}

connectWS();

// Handlers
window.handleCreate = function() {
  const name = document.getElementById('create-name').value.trim();
  const btn = document.getElementById('create-btn');
  btn.textContent = 'Oluşturuluyor...';
  btn.disabled = true;

  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'create_room', name }));
  } else {
    showError('Bağlantı kurulamadı, tekrar dene.');
    btn.textContent = 'Oda Oluştur';
    btn.disabled = false;
  }
};

window.handleJoin = function() {
  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('code-input').value.trim().toUpperCase();
  const btn = document.getElementById('join-btn');

  if (code.length < 4) {
    document.getElementById('code-input').style.borderColor = 'rgba(255,45,85,0.7)';
    setTimeout(() => { document.getElementById('code-input').style.borderColor = ''; }, 1500);
    return;
  }

  btn.textContent = 'Katılınıyor...';
  btn.disabled = true;

  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'join_room', name, code }));
  } else {
    showError('Bağlantı kurulamadı, tekrar dene.');
    btn.textContent = 'Odaya Gir';
    btn.disabled = false;
  }
};

// Enter key support
document.getElementById('create-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleCreate();
});
document.getElementById('code-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleJoin();
});
