
const SUPABASE_URL = window.MAZAHUA_SUPABASE?.url || "https://txjlunezuptlugbohgqy.supabase.co";
const SUPABASE_KEY = window.MAZAHUA_SUPABASE?.key || "sb_publishable_SpkK-E2D17pyKwlqLPxcow_8kT0m10S";
let db = null;
try {
  if (window.supabase) db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
} catch (e) { console.warn("Supabase no disponible:", e); }
const $ = id => document.getElementById(id);

const clientId = (() => {
  let value = localStorage.getItem("mazahua-client");
  if (!value) { value = crypto.randomUUID(); localStorage.setItem("mazahua-client", value); }
  return value;
})();
let cards = [], board = null, state = null, lastEventKey = null, loading = false, saveTimer = 0, noticeTimer = 0, demoMode = false;
let currentId = null, view = "menu";   // view: "menu" | "play"

// Muestra el menú o la partida (si aún no hay señal del ESP32, la pantalla de espera).
function showView(next) {
  view = next || view;
  const ready = !!(state?.online && board);
  document.body.classList.toggle("view-menu", view === "menu");
  $("menu").hidden = view !== "menu";
  $("wait").hidden = !(view === "play" && !ready);
  $("game").hidden = !(view === "play" && ready);
}
// cls: "online" | "offline" | ""
function setConnection(text, cls) {
  const el = $("connection");
  el.textContent = text;
  el.className = "pill" + (cls ? " " + cls : "");
}
window.startDemo = startDemo;

/* =========================================================
   AUDIO
   - Un solo <audio> reutilizado (necesario para que el
     desbloqueo por gesto funcione en celulares).
   - Cada reproducción tiene un "token": si llega una carta
     nueva, el token cambia y todo lo anterior se descarta.
   - Si la carta no tiene mp3 (o falla), se lee el nombre con
     la voz del navegador en español.
   ========================================================= */
const player = new Audio();
player.preload = "auto";
let audioUnlocked = false, playToken = 0, pendingPlay = false;
const SILENT_WAV = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

function updateSoundButton() { $("soundBtn").hidden = audioUnlocked && !pendingPlay; }

function stopAudio() {
  playToken++;
  player.onerror = null;
  player.onended = null;
  try { player.pause(); player.currentTime = 0; } catch (_) {}
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

function speak(text, token) {
  if (!window.speechSynthesis || !text) return;
  window.speechSynthesis.cancel();
  // pequeña espera: Chrome a veces ignora speak() justo después de cancel()
  setTimeout(() => {
    if (token !== playToken) return;
    const voice = new SpeechSynthesisUtterance(text);
    voice.lang = "es-MX";
    voice.rate = 0.95;
    const esVoice = speechSynthesis.getVoices().find(v => (v.lang || "").toLowerCase().startsWith("es"));
    if (esVoice) voice.voice = esVoice;
    voice.onerror = event => {
      if (event.error === "not-allowed" && token === playToken) { pendingPlay = true; updateSoundButton(); }
    };
    speechSynthesis.speak(voice);
  }, 60);
}

function playFile(url, token, onFail) {
  player.onerror = () => { if (token === playToken) onFail(); };
  player.onended = () => { if (token === playToken) { player.onended = null; } };
  player.src = url;
  player.play().then(() => {
    if (token === playToken) { audioUnlocked = true; pendingPlay = false; updateSoundButton(); }
  }).catch(error => {
    if (token !== playToken) return;               // ya llegó otra carta
    if (error.name === "AbortError") return;       // lo interrumpió otra reproducción
    if (error.name === "NotAllowedError") { pendingPlay = true; updateSoundButton(); return; }
    onFail();
  });
}

// Convierte cualquier extensión a .ogg (los audios ahora son .ogg con la misma ruta y nombre).
function toOgg(path) {
  if (!path) return "";
  const slash = path.lastIndexOf("/"), dot = path.lastIndexOf(".");
  return (dot > slash ? path.slice(0, dot) : path) + ".ogg";
}
// Rutas a probar en orden: .ogg de la ruta del catálogo, la ruta original y /carpeta/NNN.ogg
function audioCandidates(card, lang) {
  const given = lang === "es" ? card.audio_es : card.audio_mazahua;
  const folder = lang === "es" ? "/audio_espanol" : "/audio_mazahua";
  const num = String(card.id).padStart(3, "0");
  return [...new Set([toOgg(given), given, folder + "/" + num + ".ogg"].filter(Boolean))];
}
function playFirst(urls, token, onAllFail) {
  const next = i => {
    if (token !== playToken) return;
    if (i >= urls.length) { onAllFail(); return; }
    playFile(urls[i], token, () => next(i + 1));
  };
  next(0);
}
let lastLang = "maz";
// lang "maz" (principal, suena solo) o "es" (opcional, con el botón). Siempre corta el audio anterior.
function playCard(card, lang) {
  stopAudio();
  if (!card) return;
  lastLang = lang;
  const token = playToken;
  playFirst(audioCandidates(card, lang), token, () => {
    if (lang === "es") speak(card.name_es, token);
    else setNotice("Esta carta aún no tiene audio en mazahua.");
  });
}

// Los navegadores bloquean el audio hasta que la persona toca la pantalla una vez.
function unlockAudio() {
  if (audioUnlocked && !pendingPlay) return;
  const wasPending = pendingPlay;
  audioUnlocked = true;
  pendingPlay = false;
  updateSoundButton();
  if (window.speechSynthesis) speechSynthesis.getVoices();
  if (wasPending) {
    playCard(cardFor(currentId), lastLang);   // reproduce la carta que se quedó sin sonar
  } else {
    player.src = SILENT_WAV;
    player.play().catch(() => { audioUnlocked = false; updateSoundButton(); });
  }
}
["pointerdown", "touchstart", "keydown", "click"].forEach(type =>
  document.addEventListener(type, unlockAudio, { capture: true, passive: true }));

/* =========================================================
   CATÁLOGO Y AVISOS
   ========================================================= */
function normalizeCard(card) {
  return {
    id: Number(card.id ?? card.numero),
    name_es: card.name_es ?? card.nombre_es ?? "Carta",
    name_mazahua: card.name_mazahua ?? card.nombre_maz ?? "",
    image: card.image ?? card.imagen ?? "",
    audio_es: card.audio_es ?? "",
    audio_mazahua: card.audio_mazahua ?? card.audio_maz ?? ""
  };
}
// Une las tablas del export de phpMyAdmin (tarjetas, imagenes, audios, nombres_mazahua) por numero_tarjeta.
// El uid de las tarjetas RFID no se copia: la página no lo necesita.
function cardsFromExport(tables) {
  const data = name => (tables.find(t => t.type === "table" && t.name === name) || {}).data || [];
  const img = new Map(data("imagenes").map(r => [Number(r.numero_tarjeta), r.ruta]));
  const nom = new Map(data("nombres_mazahua").map(r => [Number(r.numero_tarjeta), r.nombre_maz]));
  const aud = { es: new Map(), maz: new Map() };
  data("audios").forEach(r => { if (aud[r.idioma]) aud[r.idioma].set(Number(r.numero_tarjeta), r.ruta); });
  return data("tarjetas").map(t => {
    const id = Number(t.numero);
    return {
      id,
      name_es: t.nombre_es,
      name_mazahua: nom.get(id) || "",
      image: (img.get(id) || "").replace(/\.jpg$/i, ".webp"),
      audio_es: aud.es.get(id) || "",
      audio_mazahua: aud.maz.get(id) || ""
    };
  }).sort((a, b) => a.id - b.id);
}
async function loadCatalog() {
  if (db) {
    try {
      const remote = await db.from("mazahua_cards")
        .select("id,name_es,name_mazahua,image,audio_es,audio_mazahua,sample")
        .order("id");
      if (!remote.error && remote.data?.length) { cards = remote.data.map(normalizeCard); }
    } catch (e) { /* cae al fallback local */ }
  }
  if (!cards.length) {
    const response = await fetch("/loteria_mazahua.json", { cache: "no-store" });
    if (!response.ok) throw new Error("No se pudo cargar el catálogo local.");
    const json = await response.json();
    // acepta el export de phpMyAdmin (arreglo de tablas) o el formato { cards: [...] }
    cards = (Array.isArray(json) ? cardsFromExport(json) : (json.cards || [])).map(normalizeCard);
  }
  if (!cards.length) throw new Error("El catálogo no tiene cartas.");
}
function cardFor(id) { return cards.find(card => card.id === Number(id)); }

// kind: "" | "warning" | "success". sticky = no se oculta solo.
function setNotice(message, kind, sticky) {
  const el = $("notice");
  clearTimeout(noticeTimer);
  el.textContent = message || "";
  el.className = message && kind ? "notice-" + kind : "";
  if (message && !sticky) noticeTimer = setTimeout(() => { el.textContent = ""; el.className = ""; }, 10000);
}
$("notice").onclick = () => setNotice("");

/* =========================================================
   MARCAS DEL TABLERO
   ========================================================= */
function setMarks(ids) {
  const unique = [...new Set((ids || []).map(Number))];
  board.marks = unique.filter(id => board.cards.includes(id));
  localStorage.setItem("marks-" + board.gameKey + "-" + board.number, JSON.stringify(board.marks));
}
async function saveMarks(claim) {
  if (demoMode) { setNotice("Modo demo: no se valida contra el servidor.", "warning"); return; }
  if (!db) { setNotice("Sin conexión con Supabase.", "warning"); return; }
  clearTimeout(saveTimer);
  const result = await db.rpc("mazahua_update_board", {
    p_client: clientId,
    p_marks: board.marks,
    p_claim: !!claim
  });
  if (result.error) throw result.error;
  if (result.data?.marks) setMarks(result.data.marks);
  if (claim) {
    if (result.data?.winner) {
      setNotice("¡LOTERÍA VALIDADA! La línea está marcada y todas sus cartas ya salieron.", "success", true);
      await loadState();
    } else {
      const fresh = await db.rpc("mazahua_public_state", { p_client: clientId });
      if (!fresh.error) state = fresh.data;
      const called = new Set((state?.events || []).map(event => Number(event.cardId)));
      const pending = board.marks.map(cardFor).filter(card => card && !called.has(card.id));
      if (pending.length) {
        const names = pending.map(card => card.id + " · " + card.name_es).join(", ");
        setNotice("AÚN NO PUEDES CANTAR LOTERÍA. Tienes " + pending.length + " carta" + (pending.length === 1 ? " marcada" : "s marcadas") + " que todavía no han salido: " + names + ". Desmárcalas o espera a que aparezcan.", "warning");
      } else setNotice("AÚN NO PUEDES CANTAR LOTERÍA. Falta completar una línea marcada con cartas que ya hayan salido.", "warning");
    }
  }
}

/* =========================================================
   PANTALLA
   ========================================================= */
function showCard(id, autoPlay) {
  const card = cardFor(id);
  if (!card) return;
  currentId = card.id;
  $("currentImage").src = card.image;
  $("currentImage").alt = card.name_es;
  $("currentName").textContent = card.name_es;
  $("currentMaz").textContent = card.name_mazahua || "Nombre en mazahua pendiente";
  $("currentNumber").textContent = String(card.id).padStart(2, "0");
  $("cardMaz").textContent = card.name_mazahua || "";
  $("cardName").textContent = card.name_es;
  if (autoPlay) playCard(card, "maz");   // corta el audio anterior; suena primero en mazahua
  else stopAudio();
}
function render() {
  if (!demoMode) setConnection("ESP32 conectado", "online");
  showView();
  $("boardTitle").textContent = "Tablero " + board.number;
  const events = state.events || [];
  $("progress").textContent = "Van " + events.length + " de " + cards.length + " cartas";
  $("progressBar").style.width = (cards.length ? Math.min(100, events.length / cards.length * 100) : 0) + "%";
  $("beanCount").textContent = String(board.marks.length);

  // Detecta carta nueva aunque los eventos no traigan "id" propio
  const latest = events[events.length - 1];
  if (!latest) lastEventKey = null;
  else {
    const key = [latest.id ?? "", events.length, latest.cardId].join("|");
    if (key !== lastEventKey) { lastEventKey = key; showCard(latest.cardId, true); }
  }

  const tiles = board.cards.map(id => {
    const card = cardFor(id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tile" + (board.marks.includes(Number(id)) ? " marked" : "");
    button.setAttribute("aria-pressed", String(board.marks.includes(Number(id))));
    button.append(...tileParts(card, id));
    button.onclick = () => {
      const n = Number(id);
      setMarks(board.marks.includes(n) ? board.marks.filter(x => x !== n) : [...board.marks, n]);
      render();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => saveMarks(false).catch(error => setNotice("No se guardó el frijolito: " + error.message, "warning")), 250);
    };
    return button;
  });
  $("board").replaceChildren(...tiles);
  $("boardStatus").textContent = board.marks.length ? board.marks.length + " frijolito" + (board.marks.length === 1 ? "" : "s") + " puesto" + (board.marks.length === 1 ? "" : "s") : "Toca una carta para poner su frijolito";
  $("history").replaceChildren(...[...events].reverse().map(event => {
    const item = document.createElement("li");
    item.textContent = cardFor(event.cardId)?.name_es || "Carta " + event.cardId;
    return item;
  }));
  if (state.player?.winner || board.winner) {
    setNotice("¡LOTERÍA VALIDADA! Este tablero completó una línea de cartas que ya salieron.", "success", true);
  }
}
// Solo la imagen de la carta (ya trae su número y nombre dibujados)
function tileParts(card, id) {
  const image = document.createElement("img");
  image.src = card?.image || "";
  image.alt = card?.name_es || "Carta " + id;
  image.draggable = false;
  return [image];
}
async function loadState() {
  if (!db) { setConnection("Sin conexión con Supabase", "offline"); showView(); return; }
  const result = await db.rpc("mazahua_public_state", { p_client: clientId });
  if (result.error) throw result.error;
  state = result.data;
  if (!state?.online) {
    setConnection("Esperando señal del ESP32");
    showView();
    return;
  }
  if (!board || board.gameKey !== state.gameId) {
    const assigned = await db.rpc("mazahua_board", { p_client: clientId });
    if (assigned.error) throw assigned.error;
    if (assigned.data?.waiting) return;
    board = {
      ...assigned.data,
      gameKey: assigned.data.gameKey || assigned.data.game || state.gameId,
      cards: (assigned.data.cards || assigned.data.board || []).map(Number),
      marks: (assigned.data.marks || []).map(Number)
    };
    const stored = localStorage.getItem("marks-" + board.gameKey + "-" + board.number);
    if (!board.marks.length && stored) setMarks(JSON.parse(stored));
  } else if (state.player) {
    board.marks = (state.player.marks || board.marks).map(Number);
    board.winner = !!state.player.winner;
  }
  render();
}
async function startDemo() {
  try {
    demoMode = true;
    if (!cards.length) await loadCatalog();
    state = { online: true, gameId: "demo", events: [{ id: 1, cardId: cards[0]?.id || 1 }], player: null };
    board = {
      gameKey: "demo",
      number: 1,
      cards: cards.slice(0, 16).map(c => c.id),
      marks: []
    };
    const stored = localStorage.getItem("marks-demo-1");
    if (stored) { try { setMarks(JSON.parse(stored)); } catch (_) {} }
    setConnection("Modo demo (sin ESP32)");
    lastEventKey = null;
    showView("play");
    render();
    const winBtn = $("win");
    if (winBtn) { winBtn.disabled = true; winBtn.title = "Deshabilitado en modo demo"; }
    setNotice("Modo demo: tablero de ejemplo. Las marcas se guardan solo en este navegador.", "success");
  } catch (e) {
    console.error(e);
    setNotice("Error en demo: " + (e && e.message ? e.message : e), "warning");
  }
}
async function load() {
  if (loading || demoMode) return;
  loading = true;
  try { if (!cards.length) await loadCatalog(); await loadState(); }
  catch (error) {
    setConnection("Sin conexión con Supabase", "offline");
    setNotice("Reintentando: " + (error.message || "no se pudo actualizar el juego"), "warning");
  } finally { loading = false; }
}

/* =========================================================
   BOTONES
   ========================================================= */
$("soundBtn").onclick = unlockAudio;
$("playEs").onclick = () => playCard(cardFor(currentId), "es");
$("playMaz").onclick = () => playCard(cardFor(currentId), "maz");
$("win").onclick = () => saveMarks(true).catch(error => setNotice("No se pudo comprobar la Lotería: " + error.message, "warning"));
updateSoundButton();

// Paneles: solo uno abierto a la vez; "Cerrar" y Esc los cierran
const panels = ["historyPanel", "galleryPanel", "albumPanel", "rulesPanel", "settingsPanel"];
function openPanel(id) { panels.forEach(p => { $(p).hidden = p !== id; }); }
function closePanels() { panels.forEach(p => { $(p).hidden = true; }); }
document.querySelectorAll(".closeBtn").forEach(btn => { btn.onclick = closePanels; });
document.addEventListener("keydown", e => { if (e.key === "Escape") closePanels(); });

// Menú principal
$("playBtn").onclick = () => { closePanels(); showView("play"); };
document.querySelectorAll(".backBtn").forEach(btn => { btn.onclick = () => { closePanels(); showView("menu"); }; });
$("demoBtn").onclick = () => startDemo();
$("demoBtn2").onclick = () => { closePanels(); startDemo(); };

$("audioBtn").onclick = () => {
  if (currentId) playCard(cardFor(currentId), "maz");
  else setNotice("Sonido activado. Cada carta sonará en mazahua al salir.", "success");
};
$("testSoundBtn").onclick = async () => {
  try { if (!cards.length) await loadCatalog(); playCard(cardFor(currentId) || cards[0], "maz"); }
  catch (e) { setNotice("No se pudo cargar el catálogo.", "warning"); }
};

const toggleHistory = () => {
  if ($("historyPanel").hidden) {
    if (!$("history").childElementCount) setNotice("Todavía no ha salido ninguna carta.");
    else openPanel("historyPanel");
  } else closePanels();
};
$("historyOpen").onclick = toggleHistory;
$("historyMenuBtn").onclick = toggleHistory;
$("rulesBtn").onclick = () => openPanel("rulesPanel");
$("settingsBtn").onclick = () => openPanel("settingsPanel");

$("shareBtn").onclick = async () => {
  const data = { title: "Lotería Mazahua", text: "¡Juega Lotería en mazahua!", url: location.origin + "/" };
  try {
    if (navigator.share) await navigator.share(data);
    else { await navigator.clipboard.writeText(data.url); setNotice("Enlace copiado.", "success"); }
  } catch (_) { /* la persona canceló */ }
};

$("clearBtn").onclick = () => {
  if (!board || !board.marks.length) { setNotice("No tienes frijolitos puestos."); return; }
  if (!confirm("¿Quitar todos tus frijolitos del tablero?")) return;
  setMarks([]);
  render();
  saveMarks(false).catch(error => setNotice("No se guardó el cambio: " + error.message, "warning"));
};

// Galería de tableros (imágenes PNG)
$("galleryBtn").onclick = () => {
  const grid = $("galleryGrid");
  if (!grid.childElementCount) {
    for (let i = 1; i <= 30; i++) {
      const img = document.createElement("img");
      img.src = "/tableros/" + String(i).padStart(2, "0") + ".png";
      img.alt = "Tablero " + i;
      img.loading = "lazy";
      grid.append(img);
    }
  }
  openPanel("galleryPanel");
};

// Álbum: las 54 cartas; al tocar una suena en mazahua
$("albumBtn").onclick = async () => {
  try { if (!cards.length) await loadCatalog(); }
  catch (e) { setNotice("No se pudo cargar el catálogo.", "warning"); return; }
  const grid = $("albumGrid");
  if (!grid.childElementCount) {
    grid.append(...cards.map(card => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tile";
      button.setAttribute("aria-label", card.name_es + (card.name_mazahua ? ", " + card.name_mazahua : ""));
      button.append(...tileParts(card, card.id));
      button.onclick = () => playCard(card, "maz");
      return button;
    }));
  }
  openPanel("albumPanel");
};
if (new URLSearchParams(location.search).has("demo")) startDemo(); else load();
let fallbackTimer = 0;
function setFallbackRefresh(ms) {
  clearInterval(fallbackTimer);
  fallbackTimer = setInterval(load, ms);
}
setFallbackRefresh(1500);
if (db) db.channel("mazahua-live-game")
  .on("postgres_changes", { event: "UPDATE", schema: "public", table: "mazahua_rooms" }, () => load())
  .subscribe(status => {
    // Realtime refresca al instante; conserva una consulta de respaldo por si el socket cae.
    setFallbackRefresh(status === "SUBSCRIBED" ? 5000 : 1000);
  });
