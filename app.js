import QrScanner from "https://unpkg.com/qr-scanner/qr-scanner.min.js";

let player; 
let playbackTimer = null; 
let playbackDuration = 30; 
let qrScanner = null;
let csvCache = {};
let lastRandomRow = null;
let lastCsvHeaders = [];
let appOnlyMode = false;
let youtubeApiLoaded = false;

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
        if (isYoutubeLink(decodedText)) {
            youtubeURL = decodedText;
        } else if (isHitsterLink(decodedText)) {
            const hitsterData = parseHitsterUrl(decodedText);
            if (hitsterData) {
                try {
                    const csvContent = await getCachedCsv(`/hitster-${hitsterData.lang}.csv`);
                    const youtubeLink = lookupYoutubeLink(hitsterData.id, csvContent);
                    if (youtubeLink) youtubeURL = youtubeLink;
                } catch (error) {
                    console.error("Fehler beim Laden der CSV:", error);
                }
            }
        }

        const youtubeLinkData = parseYoutubeLink(youtubeURL);
        if (youtubeLinkData) {
            stopQrScanner();
            lastDecodedText = ""; 

            const videoIdEl = document.getElementById('video-id');
            if (videoIdEl) videoIdEl.textContent = youtubeLinkData.videoId;  
            
            if (hasConsent()) {
                setLoadingState(true);
                ensureYouTubeLoaded(() => {
                    player.cueVideoById(youtubeLinkData.videoId, youtubeLinkData.startTime || 0);
                });
            } else {
                showConsentBanner();
            }
        }
    }

    function isHitsterLink(url) {
        return /^(?:http:\/\/|https:\/\/)?(www\.hitstergame|app\.hitsternordics)\.com\/.+/.test(url);
    }

    function isYoutubeLink(url) {
        return url.startsWith("https://www.youtube.com") || url.startsWith("https://youtu.be") || url.startsWith("https://music.youtube.com/");
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

    function lookupYoutubeLink(id, csvContent) {
        if (!csvContent || csvContent.length === 0) return null;
        const headers = csvContent[0];
        lastCsvHeaders = headers;
        
        const cardIndex = findColumnIndex(headers, ['card#', 'card', 'id', 'nr', 'card_number', 'cardnumber']);
        const urlIndex = findColumnIndex(headers, ['url', 'link', 'youtube', 'video']);
        const targetId = parseInt(id, 10);
        const lines = csvContent.slice(1);

        if (cardIndex === -1 || urlIndex === -1) return null;

        for (let row of lines) {
            if (parseInt(row[cardIndex], 10) === targetId) {
                return row[urlIndex] ? row[urlIndex].trim() : null;
            }
        }
        return null;
    }

    setupEventListeners();
    getCookies();
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
                'onStateChange': onPlayerStateChange
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
    
    const checkInterval = setInterval(() => {
        if (player && typeof player.cueVideoById === 'function') {
            clearInterval(checkInterval);
            callback();
        }
    }, 100);
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

    setCookie("appOnlyMode", enable, 30);
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

        if (autoPlayChecked) {
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

// Global sichtbare Hilfsfunktionen für Bereichs-Umschaltung
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

function toggleDisplay(id) {
    const el = document.getElementById(id);
    if (!el) {
        console.warn(`Element mit ID '${id}' konnte im DOM nicht gefunden werden.`);
        return;
    }
    const currentStyle = window.getComputedStyle(el).display;
    if (currentStyle === 'none') {
        el.style.display = 'block';
        el.style.visibility = 'visible';
        el.style.opacity = '1';
    } else {
        el.style.display = 'none';
    }
}

// Event Listeners Setup
function setupEventListeners() {
    let timerAlertMessage = null;

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
                    const alertBox = document.getElementById('alertBox');
                    if (alertBox) {
                        alertBox.innerText = appOnlyMode ? "Bitte erst 'Next' klicken!" : "Bitte erst scannen!";
                        alertBox.style.display = "block";
                        clearTimeout(timerAlertMessage);
                        timerAlertMessage = setTimeout(() => { alertBox.style.display = "none"; }, 2000);
                    }
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
            if (lastRandomRow && lastCsvHeaders) {
                const artistIdx = findColumnIndex(lastCsvHeaders, ['artist', 'interpret', 'künstler', 'performer', 'author']);
                const titleIdx = findColumnIndex(lastCsvHeaders, ['title', 'titel', 'song', 'track', 'name']);
                const yearIdx = findColumnIndex(lastCsvHeaders, ['year', 'jahr', 'release', 'date', 'erscheinungsjahr']);

                const artist = (artistIdx !== -1 && lastRandomRow[artistIdx]) ? lastRandomRow[artistIdx] : (lastRandomRow[1] || '');
                const title = (titleIdx !== -1 && lastRandomRow[titleIdx]) ? lastRandomRow[titleIdx] : (lastRandomRow[2] || '');
                const year = (yearIdx !== -1 && lastRandomRow[yearIdx]) ? lastRandomRow[yearIdx] : (lastRandomRow[6] || lastRandomRow[3] || '');

                const overlayText = document.getElementById("solveButton-overlay-text");
                const overlay = document.getElementById("solveButton-overlay");
                if (overlayText) overlayText.innerHTML = `${artist}<br>${title}<br>${year}`;
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

    // ROBUSTES MENÜ-HANDLING (Event Delegation)
    // Fängt alle Klicks im Navigationsbereich ab, unabhängig von genauer HTML-Reihenfolge
    document.addEventListener('click', function(e) {
        const target = e.target.closest('a, button, li, [id]');
        if (!target) return;

        const id = target.id || '';
        const href = target.getAttribute ? (target.getAttribute('href') || '') : '';
        const textContent = target.textContent ? target.textContent.trim().toLowerCase() : '';

        // Prüfe ob ein Menü-Element getroffen wurde
        const isHome = id === 'menu-home-button' || href === '#home' || textContent === 'home';
        const isSettings = id === 'cb_settings' || id === 'settings' || href.includes('settings') || textContent.includes('einstellung');
        const isCredits = id === 'credits' || href.includes('credits') || textContent.includes('credit');

        if (isHome || isSettings || isCredits) {
            e.preventDefault();
            e.stopPropagation();

            if (isHome) {
                hideSection('settings_div');
                hideSection('credits_div');
            } else if (isSettings) {
                hideSection('credits_div');
                toggleDisplay('settings_div');
            } else if (isCredits) {
                hideSection('settings_div');
                toggleDisplay('credits_div');
            }

            closeMenu();
            return;
        }

        // Schließen bei Klick außerhalb der Navigation
        const menuNav = document.querySelector('nav');
        const menuToggle = document.getElementById('menu-toggle');
        if (menuToggle && menuToggle.checked && menuNav && !menuNav.contains(e.target) && !e.target.matches('label[for="menu-toggle"]')) {
            closeMenu();
        }
    });

    // Song-Info & Cookie-Anzeige
    const songInfoBtn = document.getElementById('songinfo');
    if (songInfoBtn) songInfoBtn.addEventListener('click', updateSongInfo);
    
    const cookiesToggle = document.getElementById('cookies');
    if (cookiesToggle) cookiesToggle.addEventListener('click', updateCookieList);

    const appOnlyCheckbox = document.getElementById('appOnlyMode');
    if (appOnlyCheckbox) {
        appOnlyCheckbox.addEventListener('click', function() {
            enableAppOnlyMode(this.checked);
        });
    }
}

function updateSongInfo() {
    const songInfoChecked = document.getElementById('songinfo') ? document.getElementById('songinfo').checked : false;
    const display = songInfoChecked ? 'block' : 'none';
    
    const vId = document.getElementById('videoid');
    const vTitle = document.getElementById('videotitle');
    const vDur = document.getElementById('videoduration');

    if (vId) vId.style.display = display;
    if (vTitle) vTitle.style.display = display;
    if (vDur) vDur.style.display = display;
}

function updateCookieList() {
    const list = document.getElementById('cookielist');
    if (!list) return;
    const isChecked = document.getElementById('cookies') ? document.getElementById('cookies').checked : false;
    list.style.display = isChecked ? 'block' : 'none';
    if (isChecked) {
        list.innerText = document.cookie || "Keine Cookies gesetzt.";
    }
}

// CSV / Playlist Helpers
async function getRandomPlaylistSong() {
    try {
        const picker = document.getElementById("songlist-picker");
        const selectedList = picker ? picker.value : "hitster-de.csv";
        const csvContent = await getCachedCsv(`/${selectedList}`);
        const youtubeLink = lookupYoutubeLinkRandom(csvContent);
        if (youtubeLink) {
            const youtubeLinkData = parseYoutubeLink(youtubeLink);
            if (youtubeLinkData) {
                const videoIdEl = document.getElementById('video-id');
                if (videoIdEl) videoIdEl.textContent = youtubeLinkData.videoId;  
                
                if (hasConsent()) {
                    setLoadingState(true);
                    ensureYouTubeLoaded(() => {
                        player.cueVideoById(youtubeLinkData.videoId, youtubeLinkData.startTime || 0);
                    });
                } else {
                    showConsentBanner();
                }
            }
        }
    } catch (error) {
        console.error("Fehler beim Abrufen der zufälligen CSV:", error);
    }
}

function lookupYoutubeLinkRandom(csvContent) {
    if (!csvContent || csvContent.length <= 1) return null;
    const headers = csvContent[0];
    lastCsvHeaders = headers;
    const urlIndex = findColumnIndex(headers, ['url', 'link', 'youtube', 'video']);
    const lines = csvContent.slice(1);
    if (urlIndex === -1 || lines.length === 0) return null;

    const targetId = Math.floor(Math.random() * lines.length);
    lastRandomRow = lines[targetId];
    return lastRandomRow[urlIndex] ? lastRandomRow[urlIndex].trim() : null;
}

async function getCachedCsv(url) {
    if (!csvCache[url]) {
        const response = await fetch(url);
        const data = await response.text();
        csvCache[url] = parseCSV(data);
    }
    return csvCache[url];
}

function parseCSV(text) {
    const cleanText = text.replace(/^\ufeff/, '');
    return cleanText.split(/\r?\n/).filter(line => line.trim() !== '').map(line => {
        const result = [];
        let startValueIdx = 0, inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            if (line[i] === '"' && line[i-1] !== '\\') inQuotes = !inQuotes;
            else if (line[i] === ',' && !inQuotes) {
                result.push(line.substring(startValueIdx, i).trim().replace(/^"(.*)"$/, '$1'));
                startValueIdx = i + 1;
            }
        }
        result.push(line.substring(startValueIdx).trim().replace(/^"(.*)"$/, '$1'));
        return result;
    });
}

function parseYoutubeLink(url) {
    if (!url) return null;
    url = decodeURIComponent(url);
    const regex = /^https?:\/\/(www\.youtube\.com\/watch\?v=|youtu\.be\/|music\.youtube\.com\/watch\?v=)(.{11}).*/;
    const match = url.match(regex);
    if (match) {
        const queryParams = new URLSearchParams(url.split('?')[1] || '');
        const videoId = match[2];
        let startTime = parseInt(queryParams.get('start') || queryParams.get('t'), 10) || 0;
        return { videoId, startTime };
    }
    return null;
}

// Cookies Persistence
function setCookie(name, value, days) {
    document.cookie = `${name}=${value};max-age=${days * 86400};path=/`;
}

function getCookieValue(name) {
    const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
    return match ? match[2] : null;
}

function getCookies() {
    const isTrue = v => v === 'true';
    if (getCookieValue("appOnlyMode") !== null) {
        const active = isTrue(getCookieValue("appOnlyMode"));
        enableAppOnlyMode(active);
    }
}
