import QrScanner from "https://unpkg.com/qr-scanner/qr-scanner.min.js";

let player; 
let playbackTimer; 
let playbackDuration = 30; 
let qrScanner;
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
let animId;
let phase = 0;
let isPlaying = false;

document.addEventListener('DOMContentLoaded', function () {
    let lastDecodedText = ""; 

    const video = document.getElementById('qr-video');
    canvas = document.getElementById('visualizer');
    ctx = canvas.getContext('2d');

    checkUrlParameters();
    checkConsent();

    // QR-Scanner
    qrScanner = new QrScanner(video, result => {
        if (result.data !== lastDecodedText) {
            lastDecodedText = result.data;
            handleScannedLink(result.data);
        }
    }, { 
        highlightScanRegion: true,
        highlightCodeOutline: true,
    });

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
                    console.error("Failed to fetch CSV:", error);
                }
            }
        }

        const youtubeLinkData = parseYoutubeLink(youtubeURL);
        if (youtubeLinkData) {
            qrScanner.stop(); 
            document.getElementById('qr-reader').style.display = 'none'; 
            document.getElementById('cancelScanButton').style.display = 'none'; 
            lastDecodedText = ""; 

            document.getElementById('video-id').textContent = youtubeLinkData.videoId;  
            
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

        const regexNordics = /^(?:http:\/\/|https:\/\/)?app.hitsternordics\.com\/resources\/songs\/(\d+)$/;
        const matchNordics = url.match(regexNordics);
        if (matchNordics) return { lang: matchNordics[1], id: matchNordics[2] };

        return null;
    }

    function lookupYoutubeLink(id, csvContent) {
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
    loadStoredSettings();
});

/* Consent Management (DSGVO-Konformität) */
function hasConsent() {
    return localStorage.getItem('yt_consent') === 'granted';
}

function checkConsent() {
    if (hasConsent()) {
        loadYouTubeApi();
    }
}

function showConsentBanner() {
    document.getElementById('consent-banner').style.display = 'flex';
}

function hideConsentBanner() {
    document.getElementById('consent-banner').style.display = 'none';
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
    document.getElementsByTagName('script')[0].parentNode.insertBefore(tag, document.getElementsByTagName('script')[0]);
}

function ensureYouTubeLoaded(callback) {
    if (!hasConsent()) {
        showConsentBanner();
        return;
    }
    if (!youtubeApiLoaded) {
        loadYouTubeApi();
        const checkInterval = setInterval(() => {
            if (player && typeof player.cueVideoById === 'function') {
                clearInterval(checkInterval);
                callback();
            }
        }, 100);
    } else if (player && typeof player.cueVideoById === 'function') {
        callback();
    }
}

function checkUrlParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    for (const [key, value] of urlParams.entries()) {
        if (key.toLowerCase() === 'mode' && value.toLowerCase() === 'ohyes') {
            enableAppOnlyMode(true);
            break;
        } else if (key.toUpperCase() === 'OHYES') {
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

    localStorage.setItem("appOnlyMode", enable);
}

function setLoadingState(loading) {
    const playBtn = document.getElementById('startstop-video');
    if (loading) {
        playBtn.classList.add('is-loading');
    } else {
        playBtn.classList.remove('is-loading');
    }
}

function onPlayerStateChange(event) {
    const playBtn = document.getElementById('startstop-video');
    
    if (event.data == YT.PlayerState.BUFFERING) {
        setLoadingState(true);
        if (document.getElementById('autoplay').checked && !isPlaying) {
            playVideoWithSettingsOptions();
        }
    }
    else if (event.data == YT.PlayerState.CUED) {
        setLoadingState(false);
        const videoData = player.getVideoData();
        document.getElementById('video-title').textContent = videoData.title;
        document.getElementById('video-duration').textContent = formatDuration(player.getDuration());

        if (document.getElementById('autoplay').checked) {
            playVideoWithSettingsOptions();
        }
    }
    else if (event.data == YT.PlayerState.PLAYING) {
        setLoadingState(false);
        playBtn.classList.add('is-playing');
        isPlaying = true;
        if (playStartTime === 0) playStartTime = Date.now();
        renderVisualizer();
    }
    else if (event.data == YT.PlayerState.PAUSED || event.data == YT.PlayerState.ENDED) {
        setLoadingState(false);
        playBtn.classList.remove('is-playing');
        isPlaying = false;
        clearTimeout(playbackTimer);
    }
}

function formatDuration(duration) {
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
    let videoDuration = player.getDuration();
    let startTime = player.getCurrentTime(); 
    playbackDuration = parseInt(document.getElementById('playback-duration').value, 10) || 30;
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

    if (document.getElementById('randomplayback').checked) {
        player.seekTo(startTime, true);
    }

    player.playVideo();

    const durationLimitActive = document.getElementById('playback-duration-limit').checked;
    if (durationLimitActive) {
        targetPlayDuration = endTime - startTime;
        playStartTime = Date.now();

        clearTimeout(playbackTimer);
        playbackTimer = setTimeout(() => {
            player.pauseVideo();
        }, targetPlayDuration * 1000);
    } else {
        targetPlayDuration = 0;
    }
}

// Visualizer Wave Rendering & Timer Ring
function drawGlowingSineRing({ cx, cy, baseRadius, frequency, amplitude, phaseShift, color, glowColor, glowBlur, lineWidth }) {
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
    const isTimerActive = document.getElementById('playback-duration-limit').checked;
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
    if (!isPlaying) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
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

// Event Listeners
function setupEventListeners() {
    let timerAlertMessage = null;

    document.getElementById('acceptConsent').addEventListener('click', function() {
        localStorage.setItem('yt_consent', 'granted');
        hideConsentBanner();
        loadYouTubeApi();
    });

    document.getElementById('denyConsent').addEventListener('click', function() {
        localStorage.setItem('yt_consent', 'denied');
        hideConsentBanner();
    });

    document.getElementById('revokeConsentBtn').addEventListener('click', function() {
        localStorage.removeItem('yt_consent');
        showConsentBanner();
    });

    document.getElementById('startstop-video').addEventListener('click', function() {
        if (!hasConsent()) {
            showConsentBanner();
            return;
        }

        if (!isPlaying) {
            const playerState = (player && typeof player.getPlayerState === 'function') ? player.getPlayerState() : -1;
            
            if (playerState === -1) {
                const alertBox = document.getElementById('alertBox');
                alertBox.innerText = appOnlyMode ? "Bitte erst 'Next' klicken!" : "Bitte erst scannen!";
                alertBox.style.display = "block";
                clearTimeout(timerAlertMessage);
                timerAlertMessage = setTimeout(() => { alertBox.style.display = "none"; }, 2000);
                return;
            }
            playVideoWithSettingsOptions();
        } else {
            player.pauseVideo();
        }
    });

    document.getElementById('startScanButton').addEventListener('click', function() {
        if (appOnlyMode) {
            getRandomPlaylistSong();
            return;
        }
        document.getElementById('cancelScanButton').style.display = 'block';
        document.getElementById('qr-reader').style.display = 'block'; 
        qrScanner.start().then(() => {
            qrScanner.setInversionMode('both'); 
        }).catch(err => console.error('QR Scanner failed', err));
    });

    document.getElementById('cancelScanButton').addEventListener('click', function() {
        qrScanner.stop();
        document.getElementById('qr-reader').style.display = 'none';
        document.getElementById('cancelScanButton').style.display = 'none';
    });

    document.getElementById('solveButton').addEventListener('click', function() {
        if (lastRandomRow && lastCsvHeaders) {
            const artistIdx = findColumnIndex(lastCsvHeaders, ['artist', 'interpret', 'künstler', 'performer', 'author']);
            const titleIdx = findColumnIndex(lastCsvHeaders, ['title', 'titel', 'song', 'track', 'name']);
            const yearIdx = findColumnIndex(lastCsvHeaders, ['year', 'jahr', 'release', 'date', 'erscheinungsjahr']);

            const artist = (artistIdx !== -1 && lastRandomRow[artistIdx]) ? lastRandomRow[artistIdx] : (lastRandomRow[1] || '');
            const title = (titleIdx !== -1 && lastRandomRow[titleIdx]) ? lastRandomRow[titleIdx] : (lastRandomRow[2] || '');
            const year = (yearIdx !== -1 && lastRandomRow[yearIdx]) ? lastRandomRow[yearIdx] : (lastRandomRow[6] || lastRandomRow[3] || '');

            document.getElementById("solveButton-overlay-text").innerHTML = `${artist}<br>${title}<br>${year}`;
            document.getElementById("solveButton-overlay").style.display = "block";
        }
    });

    document.getElementById('solveButton-overlay').addEventListener('click', function() {
        this.style.display = "none";
    });

    document.getElementById('cb_settings').addEventListener('click', () => toggleDisplay('settings_div'));
    document.getElementById('credits').addEventListener('click', () => toggleDisplay('credits_div'));
    document.getElementById('menu-home-button').addEventListener('click', () => {
        document.getElementById('menu-toggle').checked = false;
    });

    document.addEventListener('click', function(event) {
        const menuNav = document.querySelector('nav');
        const menuToggle = document.getElementById('menu-toggle');
        if (menuToggle.checked && !menuNav.contains(event.target)) {
            menuToggle.checked = false;
        }
    });

    document.getElementById('songinfo').addEventListener('click', updateSongInfo);
    document.getElementById('appOnlyMode').addEventListener('click', function() {
        enableAppOnlyMode(this.checked);
    });
}

function toggleDisplay(id) {
    const el = document.getElementById(id);
    el.style.display = el.style.display === 'block' ? 'none' : 'block';
}

function updateSongInfo() {
    const display = document.getElementById('songinfo').checked ? 'block' : 'none';
    document.getElementById('videoid').style.display = display;
    document.getElementById('videotitle').style.display = display;
    document.getElementById('videoduration').style.display = display;
}

// CSV/Playlist Helpers
async function getRandomPlaylistSong() {
    try {
        const selectedList = document.getElementById("songlist-picker").value;
        const csvContent = await getCachedCsv(`/${selectedList}`);
        const youtubeLink = lookupYoutubeLinkRandom(csvContent);
        if (youtubeLink) {
            const youtubeLinkData = parseYoutubeLink(youtubeLink);
            if (youtubeLinkData) {
                document.getElementById('video-id').textContent = youtubeLinkData.videoId;  
                
                ensureYouTubeLoaded(() => {
                    setLoadingState(true);
                    player.cueVideoById(youtubeLinkData.videoId, youtubeLinkData.startTime || 0);
                });
            }
        }
    } catch (error) {
        console.error("Failed to fetch CSV:", error);
    }
}

function lookupYoutubeLinkRandom(csvContent) {
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
                startValueIdx = i + 