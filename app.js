// OP Swiss (Bo1) — UI-safe + backups + anti-rematch swaps
// - 2-tap confirm for reporting winners (avoids misclicks on mobile)
// - Backup + restore
// - beforeunload warning
// - Same Swiss pairing engine (no "true swiss" rewrite)

const KEY = "op_swiss_bo1_v2";
const BACKUP_KEY = "op_swiss_bo1_v2_backup";

const WIN_PTS = 3;

const el = (id) => document.getElementById(id);

function pid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function load() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function save(state) {
  const prev = localStorage.getItem(KEY);
  if (prev) localStorage.setItem(BACKUP_KEY, prev);
  localStorage.setItem(KEY, JSON.stringify(state));
}

function recommendRounds(n) {
  if (n <= 1) return 0;
  if (n <= 4) return 2;
  if (n <= 8) return 3;
  if (n <= 16) return 4;
  if (n <= 32) return 5;
  if (n <= 64) return 6;
  return 7;
}

function freshTournament(name) {
  return { name, suggestedRounds: 0, currentRound: 0, players: [], matches: [] };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function getPlayer(t, id) { return t.players.find(p => p.id === id); }
function playerName(t, id) { const p = getPlayer(t, id); return p ? p.name : "(?)"; }
function activePlayers(t) { return t.players.filter(p => !p.dropped); }

function playerMatches(t, playerId) {
  return t.matches.filter(m => m.p1Id === playerId || m.p2Id === playerId);
}

function opponents(t, playerId) {
  return playerMatches(t, playerId)
    .filter(m => m.p2Id !== null)
    .map(m => (m.p1Id === playerId ? m.p2Id : m.p1Id));
}

function recordAndPoints(t, playerId) {
  let w = 0, l = 0, pts = 0;
  for (const m of playerMatches(t, playerId)) {
    if (!m.reported) continue;

    if (m.p2Id === null) {
      w++; pts += WIN_PTS;
      continue;
    }

    if (m.winnerId === playerId) {
      w++; pts += WIN_PTS;
    } else {
      l++;
    }
  }
  return { w, l, pts };
}

function mwPercent(t, playerId) {
  const { w, l } = recordAndPoints(t, playerId);
  const played = w + l;
  if (played === 0) return 0;
  return w / played;
}

function omwPercent(t, playerId) {
  const opps = opponents(t, playerId);
  if (!opps.length) return 0;
  const vals = opps.map(o => mwPercent(t, o));
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function sosPoints(t, playerId) {
  const opps = opponents(t, playerId);
  if (!opps.length) return 0;
  return opps.reduce((sum, oid) => sum + recordAndPoints(t, oid).pts, 0);
}

function standings(t) {
  const rows = activePlayers(t).map(p => {
    const rec = recordAndPoints(t, p.id);
    return { id: p.id, player: p.name, ...rec, mw: mwPercent(t, p.id), omw: omwPercent(t, p.id), sos: sosPoints(t, p.id) };
  });

  rows.sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.omw !== a.omw) return b.omw - a.omw;
    if (b.sos !== a.sos) return b.sos - a.sos;
    if (b.mw !== a.mw) return b.mw - a.mw;
    return a.player.toLowerCase().localeCompare(b.player.toLowerCase());
  });

  return rows;
}

function playedBefore(t, aId, bId) {
  return t.matches.some(m =>
    m.p2Id !== null &&
    ((m.p1Id === aId && m.p2Id === bId) || (m.p1Id === bId && m.p2Id === aId))
  );
}

/* ---------- Rematch optimizer (swap) ---------- */
function countRematches(t, pairs) {
  let c = 0;
  for (const [a, b] of pairs) {
    if (b == null) continue;
    if (playedBefore(t, a, b)) c++;
  }
  return c;
}

function improvePairsBySwaps(t, pairs, tries = 250) {
  let best = pairs.map(p => [...p]);
  let bestScore = countRematches(t, best);
  if (bestScore === 0) return best;

  for (let k = 0; k < tries; k++) {
    const i = Math.floor(Math.random() * pairs.length);
    const j = Math.floor(Math.random() * pairs.length);
    if (i === j) continue;

    const a1 = pairs[i][0], b1 = pairs[i][1];
    const a2 = pairs[j][0], b2 = pairs[j][1];
    if (!b1 || !b2) continue;

    const cand = pairs.map(p => [...p]);
    cand[i] = [a1, b2];
    cand[j] = [a2, b1];

    if (cand[i][0] === cand[i][1] || cand[j][0] === cand[j][1]) continue;

    const score = countRematches(t, cand);
    if (score < bestScore) {
      best = cand;
      bestScore = score;
      if (bestScore === 0) break;
    }
  }
  return best;
}

/* ---------- Pairings ---------- */
function chooseByeCandidate(t, orderedIds) {
  if (t.currentRound === 0) {
    return orderedIds[Math.floor(Math.random() * orderedIds.length)];
  }
  for (let i = orderedIds.length - 1; i >= 0; i--) {
    const p = getPlayer(t, orderedIds[i]);
    if (p && !p.hadBye) return p.id;
  }
  return orderedIds[orderedIds.length - 1];
}

function pairGroupNoRematch(t, groupIds) {
  function bt(list) {
    if (!list.length) return [];
    const a = list[0];

    for (let i = 1; i < list.length; i++) {
      const b = list[i];
      if (playedBefore(t, a, b)) continue;

      const rest = list.slice(1, i).concat(list.slice(i + 1));
      const sub = bt(rest);
      if (sub !== null) return [[a, b], ...sub];
    }
    return null;
  }

  const res = bt([...groupIds]);
  if (res) return res;

  // fallback: minimal rematches
  const out = [];
  const g = [...groupIds];
  while (g.length) {
    const a = g.shift();
    let j = g.findIndex(b => !playedBefore(t, a, b));
    if (j === -1) j = 0;
    const b = g.splice(j, 1)[0];
    out.push([a, b]);
  }
  return out;
}

function swissPairingsNextRound(t) {
  const rows = standings(t);
  const orderedIds = rows.map(r => r.id);
  if (orderedIds.length < 2) throw new Error("Necesitas al menos 2 jugadores activos.");

  let pool = [...orderedIds];

  // BYE only if odd active
  let byeId = null;
  if (pool.length % 2 === 1) {
    byeId = chooseByeCandidate(t, pool);
    pool = pool.filter(x => x !== byeId);
  }

  // score groups by points
  const ptsMap = new Map();
  for (const id of pool) {
    const pts = recordAndPoints(t, id).pts;
    if (!ptsMap.has(pts)) ptsMap.set(pts, []);
    ptsMap.get(pts).push(id);
  }

  const levels = [...ptsMap.keys()].sort((a, b) => b - a);

  let carry = null;
  let pairs = [];

  for (const pts of levels) {
    let group = ptsMap.get(pts);
    if (carry) { group = [carry, ...group]; carry = null; }
    if (group.length % 2 === 1) carry = group.pop();
    pairs.push(...pairGroupNoRematch(t, group));
  }

  if (carry) {
    if (byeId === null) byeId = carry;
    // if bye already exists and carry remains, the fallback pairing logic already paired all groups;
    // this is very rare. We keep carry as bye if possible.
  }

  // swap optimizer to reduce rematches
  pairs = improvePairsBySwaps(t, pairs, 320);

  const nextRound = t.currentRound + 1;
  const matches = pairs.map(([a, b]) => ({
    roundNo: nextRound, p1Id: a, p2Id: b, winnerId: null, reported: false
  }));

  if (byeId !== null) {
    matches.push({ roundNo: nextRound, p1Id: byeId, p2Id: null, winnerId: byeId, reported: true });
    const p = getPlayer(t, byeId);
    if (p) p.hadBye = true;
  }

  return matches;
}

/* ---------- Tournament end / helpers ---------- */
function isUndefeated(t, playerId) {
  const { l } = recordAndPoints(t, playerId);
  return l === 0;
}

function undefeatedActivePlayers(t) {
  return activePlayers(t).filter(p => isUndefeated(t, p.id));
}

function tournamentEnded(t) {
  if (!t || t.currentRound === 0) return false;
  return undefeatedActivePlayers(t).length === 1;
}

function allReportedCurrentRound(t) {
  if (!t || t.currentRound === 0) return true;
  const ms = t.matches.filter(m => m.roundNo === t.currentRound && m.p2Id !== null);
  return ms.every(m => m.reported);
}

function refreshDropSelect(t) {
  const sel = el("dropSelect");
  if (!sel) return;
  sel.innerHTML = "";
  if (!t) return;

  const sorted = [...t.players].sort((a, b) => {
    if ((a.dropped ? 1 : 0) !== (b.dropped ? 1 : 0)) return (a.dropped ? 1 : 0) - (b.dropped ? 1 : 0);
    return a.name.localeCompare(b.name);
  });

  for (const p of sorted) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.dropped ? `❌ ${p.name} (dropped)` : p.name;
    sel.appendChild(opt);
  }
}

function setStatus(t) {
  const pill = el("statusPill");
  const text = el("statusText");
  const champLabel = el("champLabel");

  if (!t) {
    pill.textContent = "Sin torneo";
    text.textContent = "Crea o importa un torneo.";
    champLabel.textContent = "";
    el("playersCount").textContent = "0 jugadores";
    el("tRounds").value = "";
    return;
  }

  const active = activePlayers(t).length;
  const total = t.players.length;
  const inv = undefeatedActivePlayers(t).length;

  pill.textContent = `${t.name} • Ronda ${t.currentRound} • Activos ${active}/${total}`;
  text.textContent = `Rondas sugeridas: ${t.suggestedRounds || "-"} • Invictos: ${inv}`;

  if (tournamentEnded(t)) {
    const champ = undefeatedActivePlayers(t)[0];
    champLabel.textContent = `🏆 Campeón invicto: ${champ.name}`;
  } else champLabel.textContent = "";

  el("playersCount").textContent = `${total} jugadores (${active} activos)`;
  el("tRounds").value = t.suggestedRounds || "";
}

function renderStandings(t) {
  const tbody = el("standingsTable")?.querySelector("tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!t) return;

  const rows = standings(t);
  rows.forEach((r, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${escapeHtml(r.player)}</td>
      <td class="right">${r.pts}</td>
      <td class="right">${r.w}-${r.l}</td>
      <td class="right">${(r.mw * 100).toFixed(1)}%</td>
      <td class="right">${(r.omw * 100).toFixed(1)}%</td>
      <td class="right sos">${r.sos}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ---------- UI: safer reporting (2-tap confirm) ---------- */
let confirmPick = null;
// shape: { roundNo, p1Id, p2Id, pick: "P1"|"P2", expiresAt }

function matchKey(m) {
  return `${m.roundNo}:${m.p1Id}:${m.p2Id}`;
}

function clearConfirmIfExpired() {
  if (!confirmPick) return;
  if (Date.now() > confirmPick.expiresAt) confirmPick = null;
}

function armConfirm(m, pick) {
  confirmPick = {
    key: matchKey(m),
    pick,
    expiresAt: Date.now() + 3500 // 3.5 seconds to confirm
  };
}

function isConfirmArmed(m, pick) {
  clearConfirmIfExpired();
  return !!confirmPick && confirmPick.key === matchKey(m) && confirmPick.pick === pick;
}

function renderRound(t) {
  const list = el("matchesList");
  const label = el("roundLabel");
  if (!list || !label) return;

  list.innerHTML = "";
  if (!t || t.currentRound === 0) {
    label.textContent = "Aún no has generado rondas.";
    return;
  }

  label.textContent = `Ronda ${t.currentRound}`;
  const ms = t.matches.filter(m => m.roundNo === t.currentRound);

  ms.forEach((m) => {
    const div = document.createElement("div");
    div.className = "match";

    const left = document.createElement("div");
    const p1 = playerName(t, m.p1Id);
    const p2 = (m.p2Id === null) ? "BYE" : playerName(t, m.p2Id);

    left.innerHTML = `
      <div><strong>${escapeHtml(p1)}</strong>
      <span class="muted"> vs </span>
      <strong>${escapeHtml(p2)}</strong></div>
      <div class="meta">${m.p2Id === null ? "Auto-win" : "Best of 1 (sin empates)"}</div>
    `;

    const right = document.createElement("div");

    if (m.p2Id === null) {
      right.innerHTML = `<div class="ok">✅ BYE</div>`;
    } else if (!m.reported) {
      // 2-tap confirm UI
      const armedP1 = isConfirmArmed(m, "P1");
      const armedP2 = isConfirmArmed(m, "P2");

      right.innerHTML = `
        <div class="pending">${(armedP1 || armedP2) ? "✅ Confirma" : "⏳"}</div>
        <div class="row">
          <button data-k="${escapeHtml(matchKey(m))}" data-win="P1" class="${armedP1 ? "primary" : ""}">
            ${armedP1 ? "Confirmar P1" : "Gana P1"}
          </button>
          <button data-k="${escapeHtml(matchKey(m))}" data-win="P2" class="${armedP2 ? "primary" : ""}">
            ${armedP2 ? "Confirmar P2" : "Gana P2"}
          </button>
        </div>
      `;
    } else {
      const winName = playerName(t, m.winnerId);
      right.innerHTML = `
        <div class="ok">✅</div>
        <div class="meta">Gana ${escapeHtml(winName)}</div>
        <button class="ghost" data-k="${escapeHtml(matchKey(m))}" data-win="UNDO">Editar</button>
      `;
    }

    div.appendChild(left);
    div.appendChild(right);
    list.appendChild(div);
  });

  // Wire buttons
  list.querySelectorAll("button").forEach(btn => {
    const key = btn.getAttribute("data-k");
    const win = btn.getAttribute("data-win");

    const m = ms.find(x => matchKey(x) === key);
    if (!m) return;

    btn.onclick = () => {
      if (m.p2Id === null) return;

      if (win === "UNDO") {
        m.reported = false;
        m.winnerId = null;
        confirmPick = null;
        save(t);
        renderAll(t);
        return;
      }

      if (win === "P1" || win === "P2") {
        // 2-tap confirm: first tap arms, second tap confirms
        if (!isConfirmArmed(m, win)) {
          armConfirm(m, win);
          renderAll(t);
          return;
        }

        // confirmed
        m.reported = true;
        m.winnerId = (win === "P1") ? m.p1Id : m.p2Id;
        confirmPick = null;
        save(t);
        renderAll(t);
      }
    };
  });
}

function renderAll(t) {
  setStatus(t);
  renderStandings(t);
  renderRound(t);
  refreshDropSelect(t);

  const btnNext = el("btnNextRound");
  if (btnNext) btnNext.disabled = !t || tournamentEnded(t);

  // clear confirm if it expired (keeps UI clean)
  clearConfirmIfExpired();
}

/* ---------- App actions ---------- */
let T = load();

// restore from backup if main is empty/corrupt
if (!T) {
  const b = localStorage.getItem(BACKUP_KEY);
  if (b) {
    try { T = JSON.parse(b); } catch {}
  }
}

renderAll(T);

el("btnCreate")?.addEventListener("click", () => {
  const name = el("tName")?.value?.trim() || "One Piece Local";
  T = freshTournament(name);
  save(T);
  renderAll(T);
});

el("btnAdd")?.addEventListener("click", () => {
  if (!T) { alert("Primero crea el torneo."); return; }
  const name = el("playerName")?.value?.trim();
  if (!name) return;

  if (T.players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
    alert("Ese jugador ya existe (mismo nombre).");
    return;
  }

  T.players.push({ id: pid(), name, dropped: false, hadBye: false });
  el("playerName").value = "";

  if (T.currentRound === 0) {
    T.suggestedRounds = recommendRounds(activePlayers(T).length);
  }

  save(T);
  renderAll(T);
});

el("btnDrop")?.addEventListener("click", () => {
  if (!T) return;
  const id = el("dropSelect")?.value;
  if (!id) return;

  const pending = T.matches.some(m =>
    m.roundNo === T.currentRound &&
    !m.reported &&
    (m.p1Id === id || m.p2Id === id)
  );
  if (pending) {
    alert("Ese jugador tiene un match pendiente en la ronda actual. Reporta primero.");
    return;
  }

  const p = getPlayer(T, id);
  if (p) p.dropped = true;

  if (T.currentRound === 0) {
    T.suggestedRounds = recommendRounds(activePlayers(T).length);
  }

  save(T);
  renderAll(T);
});

el("btnUndrop")?.addEventListener("click", () => {
  if (!T) return;
  const id = el("dropSelect")?.value;
  if (!id) return;

  const p = getPlayer(T, id);
  if (p) p.dropped = false;

  if (T.currentRound === 0) {
    T.suggestedRounds = recommendRounds(activePlayers(T).length);
  }

  save(T);
  renderAll(T);
});

el("btnNextRound")?.addEventListener("click", () => {
  if (!T) { alert("Primero crea el torneo."); return; }

  if (tournamentEnded(T)) {
    const champ = undefeatedActivePlayers(T)[0];
    alert(`Torneo terminado ✅\nCampeón invicto: ${champ.name}`);
    return;
  }

  if (T.currentRound > 0 && !allReportedCurrentRound(T)) {
    alert("Aún hay matches sin reportar en la ronda actual.");
    return;
  }

  if (activePlayers(T).length < 2) {
    alert("Necesitas al menos 2 jugadores activos.");
    return;
  }

  try {
    const matches = swissPairingsNextRound(T);
    T.currentRound += 1;
    T.matches.push(...matches);
    confirmPick = null;
    save(T);
    renderAll(T);
  } catch (e) {
    alert("No se pudo generar pairings: " + e.message);
  }
});

el("btnShowRound")?.addEventListener("click", () => {
  if (!T) { alert("Primero crea el torneo."); return; }
  renderRound(T);
});

el("btnRefresh")?.addEventListener("click", () => {
  T = load();
  if (!T) {
    const b = localStorage.getItem(BACKUP_KEY);
    if (b) { try { T = JSON.parse(b); } catch {} }
  }
  renderAll(T);
});

el("btnReset")?.addEventListener("click", () => {
  if (!confirm("¿Borrar el torneo guardado en este dispositivo?")) return;
  localStorage.removeItem(KEY);
  // no borramos el backup automáticamente, por si se equivocaron:
  // localStorage.removeItem(BACKUP_KEY);
  T = null;
  confirmPick = null;
  renderAll(T);
});

el("btnExport")?.addEventListener("click", () => {
  if (!T) { alert("No hay torneo."); return; }
  const blob = new Blob([JSON.stringify(T, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(T.name || "tournament").replace(/\s+/g, "_")}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

el("importFile")?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const obj = JSON.parse(text);
    if (!obj || !Array.isArray(obj.players) || !Array.isArray(obj.matches)) {
      throw new Error("JSON inválido.");
    }
    if (typeof obj.currentRound !== "number") obj.currentRound = 0;
    if (typeof obj.suggestedRounds !== "number") obj.suggestedRounds = recommendRounds(obj.players.filter(p => !p.dropped).length);

    T = obj;
    confirmPick = null;
    save(T);
    renderAll(T);
  } catch (err) {
    alert("No se pudo importar: " + err.message);
  } finally {
    e.target.value = "";
  }
});

/* ---------- Refresh protection ---------- */
function hasTournamentData(t) {
  return !!t && ((t.players?.length || 0) > 0 || (t.matches?.length || 0) > 0);
}

window.addEventListener("beforeunload", (e) => {
  const t = load();
  if (hasTournamentData(t)) {
    e.preventDefault();
    e.returnValue = "";
  }
});
