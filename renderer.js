// --- DOM refs ---
const gameList   = document.getElementById('gameList');
const statusEl   = document.getElementById('status');
const searchEl   = document.getElementById('search');
const favOnlyEl  = document.getElementById('favOnly');
const importBtn  = document.getElementById('importZipBtn');
const refreshBtn = document.getElementById('refreshBtn');
const stopBtn    = document.getElementById('stopBtn');
const emptyHint  = document.getElementById('empty');

// Updater banner elements
const updBanner  = document.getElementById('updateBanner');
const updText    = document.getElementById('updateText');
const updBtn     = document.getElementById('updateBtn');

// --- state ---
let running = false;
let runningName = null;
let gamesCache = [];
let query = '';
let favOnly = false;

// --- helpers ---
function setRunningState(isRunning, name = null) {
  running = isRunning;
  runningName = name;

  statusEl.textContent = running
    ? `Running: ${name} — close it to launch another`
    : 'Ready';

  stopBtn.style.display = running ? 'inline-block' : 'none';

  [...gameList.children].forEach(tile => {
    if (running) tile.classList.add('disabled');
    else tile.classList.remove('disabled');
  });
}

function filteredGames() {
  const q = query.trim().toLowerCase();
  return gamesCache.filter(g => {
    const matchName = !q || g.name.toLowerCase().includes(q);
    const matchFav  = !favOnly || g.isFavorite;
    return matchName && matchFav;
  });
}

function renderGames(games) {
  gameList.innerHTML = '';
  if (!games || games.length === 0) {
    emptyHint.style.display = 'block';
  } else {
    emptyHint.style.display = 'none';
  }

  games.forEach(game => {
    const div = document.createElement('div');
    div.className = 'game';

    // Favorite star
    const starWrap = document.createElement('div');
    starWrap.className = 'star';
    const starBtn = document.createElement('button');
    starBtn.title = game.isFavorite ? 'Unfavorite' : 'Favorite';
    starBtn.textContent = game.isFavorite ? '★' : '☆';
    starBtn.onclick = async (e) => {
      e.stopPropagation();
      try {
        await window.api.toggleFavorite(game.name);
        await refreshGames();
        applyFiltersAndRender();
      } catch (err) { console.error('toggleFavorite failed:', err); }
    };
    starWrap.appendChild(starBtn);

    // Cover image
    const img = document.createElement('img');
    img.alt = `${game.name} cover`;
    img.src = game.image
      ? `file://${game.image.replace(/\\/g, '/')}`
      : 'https://via.placeholder.com/200x100?text=No+Image';

    // Title
    const title = document.createElement('p');
    title.className = 'title';
    title.textContent = game.name;

    // Action row (NEW: Delete)
    const actions = document.createElement('div');
    actions.className = 'row';
    const playBtn = document.createElement('button');
    playBtn.textContent = 'Play';
    playBtn.onclick = (e) => { e.stopPropagation(); if (!running) window.api.launchGame(game.name); };

    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete';
    delBtn.className = 'danger';
    delBtn.title = 'Remove this game folder';
    delBtn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${game.name}" from your library?\n\nThis removes the entire folder from disk.`)) return;
      statusEl.textContent = 'Deleting...';
      try {
        const res = await window.api.removeGame(game.name);
        if (res && res.ok) {
          await refreshGames();
          applyFiltersAndRender();
          statusEl.textContent = 'Deleted';
          setTimeout(() => statusEl.textContent = 'Ready', 1200);
        } else {
          statusEl.textContent = 'Delete failed: ' + (res?.reason || '');
          setTimeout(() => statusEl.textContent = 'Ready', 3000);
        }
      } catch (err) {
        console.error(err);
        statusEl.textContent = 'Delete failed';
        setTimeout(() => statusEl.textContent = 'Ready', 3000);
      }
    };

    actions.appendChild(playBtn);
    actions.appendChild(delBtn);

    // Build tile
    div.appendChild(starWrap);
    div.appendChild(img);
    div.appendChild(title);
    div.appendChild(actions);

    // Clicking the card also plays (except when running)
    div.onclick = () => { if (!running) window.api.launchGame(game.name); };

    gameList.appendChild(div);
  });

  setRunningState(running, runningName);
}

async function refreshGames() {
  const games = await window.api.getGames();
  gamesCache = games;
}

function applyFiltersAndRender() {
  renderGames(filteredGames());
}

// --- init ---
async function init() {
  try {
    const status = await window.api.getStatus();
    setRunningState(status.running, status.name);
  } catch (e) { console.error('getStatus error', e); }

  try {
    await refreshGames();
    applyFiltersAndRender();
  } catch (e) { console.error('getGames error', e); }

  window.api.onGameStatus(({ running, name }) => setRunningState(running, name));

  if (window.upd) {
    window.upd.onStatus((s) => {
      if (!s || !s.state) return;
      switch (s.state) {
        case 'checking': updBanner.style.display = 'flex'; updText.textContent = 'Checking for updates…'; updBtn.style.display = 'none'; break;
        case 'available': updBanner.style.display = 'flex'; updText.textContent = 'Update found – downloading…'; updBtn.style.display = 'none'; break;
        case 'none': updBanner.style.display = 'none'; break;
        case 'ready': updBanner.style.display = 'flex'; updText.textContent = 'Update downloaded'; updBtn.style.display = 'inline-block'; break;
        case 'error': updBanner.style.display = 'flex'; updText.textContent = 'Update error'; updBtn.style.display = 'none'; break;
      }
    });
    window.upd.onProgress((p) => {
      if (p && typeof p.percent === 'number') {
        updBanner.style.display = 'flex';
        updText.textContent = `Downloading update… ${Math.round(p.percent)}%`;
      }
    });
    updBtn.onclick = () => window.upd.installNow();
  }
}

// --- UI events ---
searchEl.addEventListener('input', (e) => { query = e.target.value; applyFiltersAndRender(); });
favOnlyEl.addEventListener('change', (e) => { favOnly = !!e.target.checked; applyFiltersAndRender(); });

importBtn.onclick = async () => {
  statusEl.textContent = 'Importing ZIP...';
  try {
    const res = await window.api.importZip();
    if (res && res.ok) {
      await refreshGames();
      applyFiltersAndRender();
      statusEl.textContent = 'Ready';
    } else if (res && res.reason !== 'canceled') {
      statusEl.textContent = `Import failed: ${res.reason}`;
      setTimeout(() => (statusEl.textContent = 'Ready'), 4000);
    } else {
      statusEl.textContent = 'Ready';
    }
  } catch (e) {
    statusEl.textContent = 'Import failed';
    console.error(e);
    setTimeout(() => (statusEl.textContent = 'Ready'), 4000);
  }
};

refreshBtn.onclick = async () => { await refreshGames(); applyFiltersAndRender(); };
stopBtn.onclick = () => window.api.stopGame();

init();
