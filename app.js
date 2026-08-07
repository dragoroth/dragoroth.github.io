import QrScanner from "https://unpkg.com/qr-scanner/qr-scanner.min.js";

let player; 
let playbackTimer = null; 
let playbackDuration = 30; 
let qrScanner = null;
let csvCache = {}; // path -> { headers, dataRows, columns }
let lastRandomRow = null;
let lastCsvColumns = null;
let appOnlyMode = false;
let youtubeApiLoaded = false;
let alertTimer = null;
let pendingPlayAfterCue = false; // erzwingt Abspielen nach dem Cuen, unabhängig vom Autoplay-Setting

const RECENT_HISTORY_SIZE = 15;
let recentlyPlayedUrls = []; // Wiederholungssperre für den Zufallsmodus (FIFO, letzte 15 Songs)

// Timer-Ring Variablen
let playStartTime = 0;
let targetPlayDuration = 0;

// Visualizer Globale Variablen
let canvas, ctx;
let animId = null;
let phase = 0;
let isPlaying = false;

document.addEventListener('DOMContentLoaded', function () {
    let lastDecodedText = ""; 

    const video = document.getElementById('qr-video');
    canvas = document.getElementById('visualizer');
    if (canvas) {
        ctx = canvas.getContext('2d');
    }

    checkUrlParameters();
    checkConsent();
    applyInitialSettingsState();

    // QR-Scanner Initialisierung
    if (video) {
        qrScanner = new QrScanner(video, result => {
            if (result && result.data && result.data !== lastDecodedText) {
                lastDecodedText = result.data;
                handleScannedLink(result.data);
            }
        }, { 
            highlightScanRegion: true,
            highlightCodeOutline: true,
        });
    }

    async function handleScannedLink(decodedText) {
        let youtubeURL = "";
        if (parseYoutubeLink(decodedText)) {
            youtubeURL = decodedText;
        } else if (isHitsterLink(decodedText)) {
            const hitsterData = parseHitsterUrl(decodedText);
            if (hitsterData) {
                try {
                    const csv = await getCachedCsv(`/hitster-${hitsterData.lang}.csv`);
                    const youtubeLink = lookupYoutubeLink(hitsterData.id, csv);
                    if (youtubeLink) youtubeURL = youtubeLink;
                } catch (error) {
                    console.error("Fehler beim Laden der CSV:", error);
                    showAlert("Song-Liste konnte nicht geladen werden.");
                }
            }
        }

        if (youtubeURL && cueYoutubeUrl(youtubeURL)) {
            stopQrScanner();
            lastDecodedText = "";
        }
    }

    function isHitsterLink(url) {
        return /^(?:http:\/\/|https:\/\/)?(www\.hitstergame|app\.hitsternordics)\.com\/.+/.test(url);
    }

    function parseHitsterUrl(url) {
        const regex = /^(?:http:\/\/|https:\/\/)?www\.hitstergame\.com\/(.+?)\/(\d+)$/;
        const match = url.match(regex);
        if (match) return { lang: match[1].replace(/\//g, "-"), id: match[2] };

        const regexNordics = /^(?:http:\/\/|https:\/\/)?app\.hitsternordics\.com\/resources\/songs\/(\d+)$/;
        const matchNordics = url.match(regexNordics);
        if (matchNordics) return { lang: matchNordics[1], id: matchNordics[2] };

        return null;
    }

    setupEventListeners();
    setupMenuHandlers();
});

/* Helper Funktionen */
function stopQrScanner() {
    if (qrScanner) {
        qrScanner.stop();
    }
    const qrReaderEl = document.getElementById('qr-reader');
    const cancelBtn = document.getElementById('cancelScanButton');
    if (qrReaderEl) qrReaderEl.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'none';
}

function hasConsent() {
    return localStorage.getItem('yt_consent') === 'granted';
}

function checkConsent() {
    if (hasConsent()) {
        loadYouTubeApi();
    }
}

function showConsentBanner() {
    const banner = document.getElementById('consent-banner');
    if (banner) banner.style.display = 'flex';
}

function hideConsentBanner() {
    const banner = document.getElementById('consent-banner');
    if (banner) banner.style.display = 'none';
}

function loadYouTubeApi() {
    if (youtubeApiLoaded) return;
    youtubeApiLoaded = true;

    window.onYouTubeIframeAPIReady = function() {
        player = new YT.Player('player', {
            height: '0',
            width: '0',
            events: {
                'onReady': () => {},
                'onStateChange': onPlayerStateChange,
                'onError': onPlayerError
            }
        });
    };

    const tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    const firstScript = document.getElementsByTagName('script')[0];
    if (firstScript && firstScript.parentNode) {
        firstScript.parentNode.insertBefore(tag, firstScript);
    } else {
        document.head.appendChild(tag);
    }
}

function ensureYouTubeLoaded(callback) {
    if (!hasConsent()) {
        showConsentBanner();
        return;
    }
    if (!youtubeApiLoaded) {
        loadYouTubeApi();
    }

    const maxAttempts = 100; // 100 x 100ms = 10s Timeout
    let attempts = 0;

    const checkInterval = setInterval(() => {
        attempts++;
        if (player && typeof player.cueVideoById === 'function') {
            clearInterval(checkInterval);
            callback();
            return;
        }
        if (attempts >= maxAttempts) {
            clearInterval(checkInterval);
            setLoadingState(false);
            showAlert('YouTube-Player konnte nicht geladen werden. Bitte Verbindung prüfen.');
        }
    }, 100);
}

// Fängt unerwartete Fehler (z.B. in async-Funktionen) ab, statt sie nur in der Konsole verschwinden zu lassen
window.addEventListener('unhandledrejection', function(event) {
    console.error('Unbehandelter Fehler:', event.reason);
    showAlert('Es ist ein unerwarteter Fehler aufgetreten.');
});

function showAlert(message) {
    const alertBox = document.getElementById('alertBox');
    if (!alertBox) return;
    alertBox.innerText = message;
    alertBox.style.display = 'block';
    clearTimeout(alertTimer);
    alertTimer = setTimeout(() => { alertBox.style.display = 'none'; }, 2000);
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
}

/* ---------- CSV: Parsing, Spalten-Abgleich & Caching ---------- */

// Mögliche Spaltenüberschriften je nach CSV-Quelle (Groß-/Kleinschreibung wird ignoriert)
const CSV_COLUMN_ALIASES = {
    card: ['card#', 'card', 'id', 'nr', 'card_number', 'cardnumber'],
    url: ['url', 'link', 'youtube', 'video'],
    artist: ['artist', 'interpret', 'künstler', 'performer', 'author'],
    title: ['title', 'titel', 'song', 'track', 'name'],
    year: ['year', 'jahr', 'release', 'date', 'erscheinungsjahr']
};

// Ermittelt für jede logische Spalte (card/url/artist/...) den passenden Index
// anhand der tatsächlichen Kopfzeile, statt sich auf eine feste Spaltenreihenfolge zu verlassen.
function resolveCsvColumns(headers) {
    const columns = {};
    for (const key of Object.keys(CSV_COLUMN_ALIASES)) {
        columns[key] = findColumnIndex(headers, CSV_COLUMN_ALIASES[key]);
    }
    return columns;
}

// Robuster CSV-Parser (RFC4180-artig): unterstützt Anführungszeichen,
// darin enthaltene Kommas/Zeilenumbrüche sowie escapte Anführungszeichen ("").
function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const next = text[i + 1];

        if (inQuotes) {
            if (char === '"' && next === '"') {
                field += '"';
                i++;
            } else if (char === '"') {
                inQuotes = false;
            } else {
                field += char;
            }
        } else if (char === '"') {
            inQuotes = true;
        } else if (char === ',') {
            row.push(field);
            field = '';
        } else if (char === '\r') {
            // wird ignoriert, \n beendet die Zeile
        } else if (char === '\n') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else {
            field += char;
        }
    }

    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }

    return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

// Lädt eine CSV-Datei (mit Cache), validiert die Kopfzeile und liefert
// { headers, dataRows, columns } zurück. Wirft einen Fehler, wenn die
// Datei nicht geladen werden kann oder Pflichtspalten (Card#/URL) fehlen.
async function getCachedCsv(path) {
    if (csvCache[path]) {
        return csvCache[path];
    }

    const response = await fetch(path);
    if (!response.ok) {
        throw new Error(`CSV "${path}" konnte nicht geladen werden (HTTP ${response.status}).`);
    }

    const text = await response.text();
    const allRows = parseCsv(text);

    if (allRows.length < 2) {
        throw new Error(`CSV "${path}" enthält keine verwertbaren Daten.`);
    }

    const headers = allRows[0];
    const columns = resolveCsvColumns(headers);

    if (columns.card === -1 || columns.url === -1) {
        throw new Error(`CSV "${path}": Pflichtspalten "Card#"/"URL" nicht gefunden (gefunden: ${headers.join(', ')}).`);
    }

    const result = {
        headers,
        dataRows: allRows.slice(1),
        columns
    };

    csvCache[path] = result;
    return result;
}

// Sucht in einer geladenen CSV die Zeile mit passender Card-ID und liefert den YouTube-Link.
function lookupYoutubeLink(id, csv) {
    if (!csv || !csv.dataRows || csv.dataRows.length === 0) return null;
    const { card, url } = csv.columns;
    if (card === -1 || url === -1) return null;

    const targetId = parseInt(id, 10);
    for (const row of csv.dataRows) {
        if (parseInt(row[card], 10) === targetId) {
            return row[url] ? row[url].trim() : null;
        }
    }
    return null;
}

/* ---------- YouTube-Link Parsing ---------- */

function parseYoutubeTimeParam(raw) {
    if (!raw) return 0;
    if (/^\d+$/.test(raw)) return parseInt(raw, 10);
    const match = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
    if (!match) return 0;
    const h = parseInt(match[1] || '0', 10);
    const m = parseInt(match[2] || '0', 10);
    const s = parseInt(match[3] || '0', 10);
    return h * 3600 + m * 60 + s;
}

// Extrahiert Video-ID und optionalen Startzeitpunkt aus einer YouTube-URL.
// Unterstützt youtube.com/watch?v=, youtu.be/, music.youtube.com, m.youtube.com und /embed/.
function parseYoutubeLink(url) {
    if (!url) return null;
    try {
        const urlObj = new URL(url);
        let videoId = null;

        if (urlObj.hostname === 'youtu.be') {
            videoId = urlObj.pathname.slice(1);
        } else if (urlObj.hostname === 'youtube.com' || urlObj.hostname.endsWith('.youtube.com')) {
            videoId = urlObj.searchParams.get('v');
            if (!videoId && urlObj.pathname.startsWith('/embed/')) {
                videoId = urlObj.pathname.split('/embed/')[1];
            }
        }

        if (!videoId) return null;

        const rawStart = urlObj.searchParams.get('t') || urlObj.searchParams.get('start');
        return { videoId, startTime: parseYoutubeTimeParam(rawStart) };
    } catch (error) {
        return null;
    }
}

// Bereitet einen YouTube-Link fürs Abspielen vor (Video-ID anzeigen, Consent prüfen, cuen).
// Mit thenPlay:true wird nach dem Cuen automatisch abgespielt, unabhängig vom Autoplay-Setting.
// Gibt true zurück, wenn die URL gültig war, sonst false.
function cueYoutubeUrl(youtubeURL, { thenPlay = false } = {}) {
    const youtubeLinkData = parseYoutubeLink(youtubeURL);
    if (!youtubeLinkData) return false;

    const videoIdEl = document.getElementById('video-id');
    if (videoIdEl) videoIdEl.textContent = youtubeLinkData.videoId;

    if (hasConsent()) {
        setLoadingState(true);
        ensureYouTubeLoaded(() => {
            if (thenPlay) pendingPlayAfterCue = true;
            player.cueVideoById(youtubeLinkData.videoId, youtubeLinkData.startTime || 0);
        });
    } else {
        showConsentBanner();
    }
    return true;
}

// Wählt eine zufällige Zeile, die nicht unter den zuletzt gespielten RECENT_HISTORY_SIZE Songs ist.
// Fällt auf die volle Liste zurück, falls die Playlist zu kurz ist, um die Sperre einzuhalten.
function pickRandomRow(dataRows, urlColumnIndex) {
    const candidates = urlColumnIndex === -1
        ? dataRows
        : dataRows.filter(row => {
            const url = row[urlColumnIndex] ? row[urlColumnIndex].trim() : '';
            return url && !recentlyPlayedUrls.includes(url);
        });

    const pool = candidates.length > 0 ? candidates : dataRows;
    return pool[Math.floor(Math.random() * pool.length)];
}

function rememberPlayedUrl(url) {
    if (!url) return;
    recentlyPlayedUrls.push(url);
    if (recentlyPlayedUrls.length > RECENT_HISTORY_SIZE) {
        recentlyPlayedUrls.shift();
    }
}

// Wählt zufällig einen Song aus der aktuell gewählten Song-Liste (Zufall-statt-Scan-Modus)
// und cued ihn. Setzt lastRandomRow/lastCsvColumns für den Solve-Button.
// Mit { thenPlay: true } wird der Song direkt abgespielt (z.B. wenn über den Play-Button ausgelöst).
async function getRandomPlaylistSong({ thenPlay = false } = {}) {
    const picker = document.getElementById('songlist-picker');
    const selectedFile = (picker && picker.value) ? picker.value : 'hitster-de.csv';
    const path = `/${selectedFile}`;

    let csv;
    try {
        csv = await getCachedCsv(path);
    } catch (error) {
        console.error('Fehler beim Laden der CSV:', error);
        showAlert('Song-Liste konnte nicht geladen werden.');
        return;
    }

    if (!csv.dataRows.length) {
        showAlert('Song-Liste ist leer.');
        return;
    }

    const { url } = csv.columns;
    const row = pickRandomRow(csv.dataRows, url);
    const youtubeURL = (url !== -1 && row[url]) ? row[url].trim() : '';

    if (!youtubeURL || !cueYoutubeUrl(youtubeURL, { thenPlay })) {
        showAlert('Kein gültiger YouTube-Link in der Song-Liste gefunden.');
        return;
    }

    rememberPlayedUrl(youtubeURL);
    lastRandomRow = row;
    lastCsvColumns = csv.columns;
}

function checkUrlParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    for (const [key, value] of urlParams.entries()) {
        if ((key.toLowerCase() === 'mode' && value.toLowerCase() === 'ohyes') || key.toUpperCase() === 'OHYES') {
            enableAppOnlyMode(true);
            break;
        }
    }
}

function enableAppOnlyMode(enable) {
    appOnlyMode = enable;
    const checkbox = document.getElementById('appOnlyMode');
    if (checkbox) checkbox.checked = enable;
    
    const startScanBtn = document.getElementById("startScanButton");
    if (startScanBtn) startScanBtn.innerHTML = enable ? "Next" : "Scan";
    
    const solveBtn = document.getElementById("solveButton");
    if (solveBtn) solveBtn.style.display = enable ? 'block' : 'none';
}

// Wendet den Anzeigezustand von Settings-Toggles beim Start an (Song-Infos, Zeitlimit-Feld)
function applyInitialSettingsState() {
    updateSongInfoVisibility();
    updatePlaybackDurationInputState();
}

// "Song-Infos anzeigen": blendet Video-ID/-Titel/-Dauer ein bzw. aus
function updateSongInfoVisibility() {
    const checkbox = document.getElementById('songinfo');
    const show = checkbox ? checkbox.checked : false;
    ['videoid', 'videotitle', 'videoduration'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = show ? 'block' : 'none';
    });
}

// Deaktiviert das Zeitlimit-Eingabefeld, solange der zugehörige Toggle aus ist
function updatePlaybackDurationInputState() {
    const toggle = document.getElementById('playback-duration-limit');
    const input = document.getElementById('playback-duration');
    if (input) input.disabled = toggle ? !toggle.checked : true;
}

function setLoadingState(loading) {
    const playBtn = document.getElementById('startstop-video');
    if (!playBtn) return;
    if (loading) {
        playBtn.classList.add('is-loading');
    } else {
        playBtn.classList.remove('is-loading');
    }
}

function onPlayerError(event) {
    setLoadingState(false);
    isPlaying = false;
    const playBtn = document.getElementById('startstop-video');
    if (playBtn) playBtn.classList.remove('is-playing');
    if (playbackTimer) {
        clearTimeout(playbackTimer);
        playbackTimer = null;
    }
    showAlert('Video konnte nicht abgespielt werden (evtl. gesperrt oder gelöscht).');
}

function onPlayerStateChange(event) {
    const playBtn = document.getElementById('startstop-video');
    const autoPlayChecked = document.getElementById('autoplay') ? document.getElementById('autoplay').checked : false;

    if (event.data == YT.PlayerState.BUFFERING) {
        setLoadingState(true);
        if (autoPlayChecked && !isPlaying) {
            playVideoWithSettingsOptions();
        }
    }
    else if (event.data == YT.PlayerState.CUED) {
        setLoadingState(false);
        const videoData = player.getVideoData();
        const titleEl = document.getElementById('video-title');
        const durationEl = document.getElementById('video-duration');

        if (titleEl) titleEl.textContent = videoData.title || '';
        if (durationEl) durationEl.textContent = formatDuration(player.getDuration());

        if (autoPlayChecked || pendingPlayAfterCue) {
            pendingPlayAfterCue = false;
            playVideoWithSettingsOptions();
        }
    }
    else if (event.data == YT.PlayerState.PLAYING) {
        setLoadingState(false);
        if (playBtn) playBtn.classList.add('is-playing');
        isPlaying = true;
        if (playStartTime === 0) playStartTime = Date.now();
        renderVisualizer();
    }
    else if (event.data == YT.PlayerState.PAUSED || event.data == YT.PlayerState.ENDED) {
        setLoadingState(false);
        if (playBtn) playBtn.classList.remove('is-playing');
        isPlaying = false;
        if (playbackTimer) {
            clearTimeout(playbackTimer);
            playbackTimer = null;
        }
    }
}

function formatDuration(duration) {
    if (!duration || isNaN(duration)) return "0:00";
    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

async function playVideoWithSettingsOptions() {
    if (!hasConsent()) {
        showConsentBanner();
        return;
    }

    const minStartPercentage = 0.10;
    const maxEndPercentage = 0.90;
    let videoDuration = player.getDuration() || 0;
    let startTime = player.getCurrentTime() || 0; 
    
    const playbackInput = document.getElementById('playback-duration');
    playbackDuration = playbackInput ? (parseInt(playbackInput.value, 10) || 30) : 30;
    let endTime = startTime + playbackDuration;

    const minStartTime = Math.max(startTime, videoDuration * minStartPercentage);
    const maxEndTime = videoDuration * maxEndPercentage;

    if (endTime > maxEndTime) {
        endTime = maxEndTime;
        startTime = Math.max(minStartTime, endTime - playbackDuration);
    }

    if (startTime <= minStartTime) {
        const range = Math.max(0, maxEndTime - minStartTime - playbackDuration);
        startTime = minStartTime + (Math.random() * range);
        endTime = startTime + playbackDuration;
    }

    const randomPlaybackChecked = document.getElementById('randomplayback') ? document.getElementById('randomplayback').checked : false;
    if (randomPlaybackChecked) {
        player.seekTo(startTime, true);
    }

    player.playVideo();

    const durationLimitActive = document.getElementById('playback-duration-limit') ? document.getElementById('playback-duration-limit').checked : false;
    if (durationLimitActive) {
        targetPlayDuration = endTime - startTime;
        playStartTime = Date.now();

        if (playbackTimer) clearTimeout(playbackTimer);
        playbackTimer = setTimeout(() => {
            player.pauseVideo();
        }, targetPlayDuration * 1000);
    } else {
        targetPlayDuration = 0;
    }
}

// Visualizer & Canvas
function drawGlowingSineRing({ cx, cy, baseRadius, frequency, amplitude, phaseShift, color, glowColor, glowBlur, lineWidth }) {
    if (!ctx) return;
    const points = 180;
    ctx.beginPath();

    for (let i = 0; i <= points; i++) {
        const angle = (Math.PI * 2 / points) * i;
        const wave = Math.sin(angle * frequency + phaseShift) * amplitude
                   + Math.sin(angle * (frequency * 0.5) - phaseShift) * (amplitude * 0.25);
        
        const r = baseRadius + wave;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }

    ctx.closePath();
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = glowBlur;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    ctx.shadowBlur = 0;
}

function drawTimerRing(cx, cy, radius) {
    if (!ctx) return;
    const limitEl = document.getElementById('playback-duration-limit');
    const isTimerActive = limitEl ? limitEl.checked : false;
    if (!isTimerActive || targetPlayDuration <= 0) return;

    const elapsed = (Date.now() - playStartTime) / 1000;
    const progress = Math.min(1, Math.max(0, elapsed / targetPlayDuration));
    
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + (Math.PI * 2 * (1 - progress));

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 6;
    ctx.stroke();

    if (progress < 1) {
        ctx.beginPath();
        ctx.arc(cx, cy, radius, startAngle, endAngle, false);
        ctx.strokeStyle = '#FF5400';
        ctx.shadowColor = '#FF5400';
        ctx.shadowBlur = 12;
        ctx.lineWidth = 8;
        ctx.stroke();
    }
    
    ctx.restore();
}

function renderVisualizer() {
    if (!ctx || !canvas) return;
    if (!isPlaying) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (animId) cancelAnimationFrame(animId);
        return;
    }

    animId = requestAnimationFrame(renderVisualizer);
    phase += 0.01;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    ctx.globalCompositeOperation = 'screen';

    const glowCyan = 'rgba(0, 212, 255, 0.8)';
    const glowIce = 'rgba(176, 242, 255, 0.6)';

    drawGlowingSineRing({ cx, cy, baseRadius: 80, frequency: 8, amplitude: 4, phaseShift: phase, color: 'rgba(0, 150, 220, 0.7)', glowColor: glowCyan, glowBlur: 15, lineWidth: 3 });
    drawGlowingSineRing({ cx, cy, baseRadius: 95, frequency: 12, amplitude: 5, phaseShift: -phase * 1.1, color: 'rgba(0, 200, 255, 0.6)', glowColor: glowCyan, glowBlur: 12, lineWidth: 2.5 });
    drawGlowingSineRing({ cx, cy, baseRadius: 110, frequency: 16, amplitude: 6, phaseShift: phase * 1.4, color: 'rgba(100, 230, 255, 0.5)', glowColor: glowIce, glowBlur: 10, lineWidth: 2 });

    drawTimerRing(cx, cy, 65);
}

function cleanHeaderString(str) {
    if (!str) return '';
    return str.replace(/^\ufeff/, '').trim().toLowerCase();
}

function findColumnIndex(headers, possibleNames) {
    if (!headers || headers.length === 0) return -1;
    const cleanHeaders = headers.map(cleanHeaderString);
    for (const name of possibleNames) {
        const idx = cleanHeaders.indexOf(name.toLowerCase());
        if (idx !== -1) return idx;
    }
    return -1;
}

// Global sichtbare Hilfsfunktionen für Menü-Schließung
function closeMenu() {
    const menuToggle = document.getElementById('menu-toggle');
    if (menuToggle) menuToggle.checked = false;
}

function hideSection(id) {
    const el = document.getElementById(id);
    if (el) {
        el.style.display = 'none';
    }
}

function closeMenuAndOverlays() {
    closeMenu();
    hideSection('settings_div');
    hideSection('credits_div');
}

// Event Listeners Setup
function setupEventListeners() {
    // Consent Banner Listeners
    const acceptBtn = document.getElementById('acceptConsent');
    if (acceptBtn) {
        acceptBtn.addEventListener('click', function() {
            localStorage.setItem('yt_consent', 'granted');
            hideConsentBanner();
            loadYouTubeApi();
        });
    }

    const denyBtn = document.getElementById('denyConsent');
    if (denyBtn) {
        denyBtn.addEventListener('click', function() {
            localStorage.setItem('yt_consent', 'denied');
            hideConsentBanner();
        });
    }

    const revokeBtn = document.getElementById('revokeConsentBtn');
    if (revokeBtn) {
        revokeBtn.addEventListener('click', function() {
            localStorage.removeItem('yt_consent');
            showConsentBanner();
        });
    }

    // Settings-Toggles: Song-Infos anzeigen / Zeitlimit-Feld aktivieren
    const songInfoToggle = document.getElementById('songinfo');
    if (songInfoToggle) {
        songInfoToggle.addEventListener('change', updateSongInfoVisibility);
    }

    const durationLimitToggle = document.getElementById('playback-duration-limit');
    if (durationLimitToggle) {
        durationLimitToggle.addEventListener('change', updatePlaybackDurationInputState);
    }

    // Play/Stop Button
    const playStopBtn = document.getElementById('startstop-video');
    if (playStopBtn) {
        playStopBtn.addEventListener('click', function() {
            if (!hasConsent()) {
                showConsentBanner();
                return;
            }

            if (!isPlaying) {
                const playerState = (player && typeof player.getPlayerState === 'function') ? player.getPlayerState() : -1;
                
                if (playerState === -1) {
                    if (appOnlyMode) {
                        getRandomPlaylistSong({ thenPlay: true });
                        return;
                    }
                    showAlert("Bitte erst scannen!");
                    return;
                }
                playVideoWithSettingsOptions();
            } else {
                player.pauseVideo();
            }
        });
    }

    // Scan / Next Button
    const startScanBtn = document.getElementById('startScanButton');
    if (startScanBtn) {
        startScanBtn.addEventListener('click', function() {
            if (appOnlyMode) {
                getRandomPlaylistSong();
                return;
            }
            const cancelBtn = document.getElementById('cancelScanButton');
            const qrReaderEl = document.getElementById('qr-reader');
            if (cancelBtn) cancelBtn.style.display = 'block';
            if (qrReaderEl) qrReaderEl.style.display = 'block'; 
            
            if (qrScanner) {
                qrScanner.start().then(() => {
                    qrScanner.setInversionMode('both'); 
                }).catch(err => console.error('QR-Scanner Start fehlgeschlagen:', err));
            }
        });
    }

    const cancelScanBtn = document.getElementById('cancelScanButton');
    if (cancelScanBtn) {
        cancelScanBtn.addEventListener('click', stopQrScanner);
    }

    // Solve Overlay
    const solveBtn = document.getElementById('solveButton');
    if (solveBtn) {
        solveBtn.addEventListener('click', function() {
            if (lastRandomRow && lastCsvColumns) {
                const { artist: artistIdx, title: titleIdx, year: yearIdx } = lastCsvColumns;

                const artist = (artistIdx !== -1 && lastRandomRow[artistIdx]) ? lastRandomRow[artistIdx] : '';
                const title = (titleIdx !== -1 && lastRandomRow[titleIdx]) ? lastRandomRow[titleIdx] : '';
                const year = (yearIdx !== -1 && lastRandomRow[yearIdx]) ? lastRandomRow[yearIdx] : '';

                const overlayText = document.getElementById("solveButton-overlay-text");
                const overlay = document.getElementById("solveButton-overlay");
                // escapeHtml verhindert, dass HTML/JS aus der CSV (z.B. manipulierte Song-Liste) ausgeführt wird
                if (overlayText) overlayText.innerHTML = `${escapeHtml(artist)}<br>${escapeHtml(title)}<br>${escapeHtml(year)}`;
                if (overlay) overlay.style.display = "block";
            }
        });
    }

    const solveOverlay = document.getElementById('solveButton-overlay');
    if (solveOverlay) {
        solveOverlay.addEventListener('click', function() {
            this.style.display = "none";
        });
    }
}

// Menü & Akkordeon-Steuerung
function setupMenuHandlers() {
    const navElement = document.querySelector('nav');
    const settingsDiv = document.getElementById('settings_div');
    const creditsDiv = document.getElementById('credits_div');

    if (!navElement) return;

    // 1. Verhindere, dass Klicks INNERHALB von Settings & Credits das Hauptmenü schließen
    if (settingsDiv) {
        settingsDiv.addEventListener('click', function(event) {
            event.stopPropagation();
        });
    }

    if (creditsDiv) {
        creditsDiv.addEventListener('click', function(event) {
            event.stopPropagation();
        });
    }

    // 2. Klick-Steuerung für Navigations-Links
    navElement.addEventListener('click', function(event) {
        const link = event.target.closest('a');
        
        if (!link) return;

        const id = link.id;

        // Klick auf "Einstellungen": Untermenü umschalten, Menü BLEIBT OFFEN
        if (id === 'cb_settings') {
            event.preventDefault();
            event.stopPropagation();
            const isOpen = settingsDiv && settingsDiv.style.display === 'block';
            if (settingsDiv) settingsDiv.style.display = isOpen ? 'none' : 'block';
            if (creditsDiv) creditsDiv.style.display = 'none';
            return;
        }

        // Klick auf "Credits": Untermenü umschalten, Menü BLEIBT OFFEN
        if (id === 'credits') {
            event.preventDefault();
            event.stopPropagation();
            const isOpen = creditsDiv && creditsDiv.style.display === 'block';
            if (creditsDiv) creditsDiv.style.display = isOpen ? 'none' : 'block';
            if (settingsDiv) settingsDiv.style.display = 'none';
            return;
        }

        // Klick auf "Home" oder externe Seiten (Impressum / Privacy): Menü schließen
        if (id === 'menu-home-button' || link.getAttribute('href') !== '#') {
            closeMenuAndOverlays();
        }
    });

    // 3. Klick AUSSERHALB von <nav> schließt das Menü
    document.addEventListener('click', function(event) {
        if (!navElement.contains(event.target)) {
            closeMenuAndOverlays();
        }
    });
}
