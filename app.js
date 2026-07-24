import QrScanner from "https://unpkg.com/qr-scanner/qr-scanner.min.js";

let player; 
let playbackTimer; 
let playbackDuration = 30; 
let qrScanner;
let csvCache = {};
let lastRandomRow = null;
let appOnlyMode = false;

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
            player.cueVideoById(youtubeLinkData.videoId, youtubeLinkData.startTime || 0);
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
        const cardIndex = headers.indexOf('Card#');
        const urlIndex = headers.indexOf('URL');
        const targetId = parseInt(id, 10);
        const lines = csvContent.slice(1);

        if (cardIndex === -1 || urlIndex === -1) return null;

        for (let row of lines) {
            if (parseInt(row[cardIndex], 10) === targetId) {
                return row[urlIndex].trim();
            }
        }
        return null;
    }

    setupEventListeners();
    getCookies();
});

// YouTube API
function onYouTubeIframeAPIReady() {
    player = new YT.Player('player', {
        height: '0',
        width: '0',
        events: {
            'onReady': () => {},
            'onStateChange': onPlayerStateChange
        }
    });
}
window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;

const tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
document.getElementsByTagName('script')[0].parentNode.insertBefore(tag, document.getElementsByTagName('script')[0]);

function onPlayerStateChange(event) {
    const playBtn = document.getElementById('startstop-video');
    
    if (event.data == YT.PlayerState.CUED) {
        const videoData = player.getVideoData();
        document.getElementById('video-title').textContent = videoData.title;
        document.getElementById('video-duration').textContent = formatDuration(player.getDuration());

        if (document.getElementById('autoplay').checked) {
            playVideoWithSettingsOptions();
        }
    }
    else if (event.data == YT.PlayerState.PLAYING) {
        playBtn.classList.add('is-playing');
        isPlaying = true;
        renderVisualizer();
    }
    else if (event.data == YT.PlayerState.PAUSED || event.data == YT.PlayerState.ENDED) {
        playBtn.classList.remove('is-playing');
        isPlaying = false;
    }
}

function formatDuration(duration) {
    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

async function playVideoWithSettingsOptions() {
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

    if (document.getElementById('playback-duration-limit').checked) {
        clearTimeout(playbackTimer);
        playbackTimer = setTimeout(() => {
            player.pauseVideo();
        }, (endTime - startTime) * 1000);
    }
}

// Visualizer Wave Rendering
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

    drawGlowingSineRing({ cx, cy, baseRadius: 55, frequency: 8, amplitude: 4, phaseShift: phase, color: 'rgba(0, 150, 220, 0.7)', glowColor: glowCyan, glowBlur: 15, lineWidth: 3 });
    drawGlowingSineRing({ cx, cy, baseRadius: 75, frequency: 12, amplitude: 5, phaseShift: -phase * 1.1, color: 'rgba(0, 200, 255, 0.6)', glowColor: glowCyan, glowBlur: 12, lineWidth: 2.5 });
    drawGlowingSineRing({ cx, cy, baseRadius: 95, frequency: 16, amplitude: 6, phaseShift: phase * 1.4, color: 'rgba(100, 230, 255, 0.5)', glowColor: glowIce, glowBlur: 10, lineWidth: 2 });

    ctx.globalCompositeOperation = 'source-over';
}

// Helper & Events Setup
function setupEventListeners() {
    let timerAlertMessage = null;

    document.getElementById('startstop-video').addEventListener('click', function() {
        if (!isPlaying) {
            if (!player || typeof player.getPlayerState !== 'function' || player.getPlayerState() === -1) {
                const alertBox = document.getElementById('alertBox');
                alertBox.innerText = "Bitte erst scannen!";
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
        if (lastRandomRow) {
            document.getElementById("solveButton-overlay-text").innerHTML = `${lastRandomRow[1]}<br>${lastRandomRow[2]}<br>${lastRandomRow[6]}`;
            document.getElementById("solveButton-overlay").style.display = "block";
        }
    });

    document.getElementById('solveButton-overlay').addEventListener('click', function() {
        this.style.display = "none";
    });

    // Menü-Toggles
    document.getElementById('cb_settings').addEventListener('click', () => toggleDisplay('settings_div'));
    document.getElementById('credits').addEventListener('click', () => toggleDisplay('credits_div'));
    document.getElementById('menu-home-button').addEventListener('click', () => {
        document.getElementById('menu-toggle').checked = false;
    });

    // Einstellungen Persistence
    document.getElementById('songinfo').addEventListener('click', updateSongInfo);
    document.getElementById('appOnlyMode').addEventListener('click', function() {
        setCookie("appOnlyMode", this.checked, 30);
        appOnlyMode = this.checked;
        document.getElementById("startScanButton").innerHTML = appOnlyMode ? "Next" : "Scan";
        document.getElementById("solveButton").style.display = appOnlyMode ? 'block' : 'none';
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
                player.cueVideoById(youtubeLinkData.videoId, youtubeLinkData.startTime || 0);
            }
        }
    } catch (error) {
        console.error("Failed to fetch CSV:", error);
    }
}

function lookupYoutubeLinkRandom(csvContent) {
    const headers = csvContent[0];
    const urlIndex = headers.indexOf('URL');
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
    return text.split('\n').map(line => {
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

// Cookies
function setCookie(name, value, days) {
    document.cookie = `${name}=${value};max-age=${days * 86400}`;
}

function getCookieValue(name) {
    const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
    return match ? match[2] : null;
}

function getCookies() {
    const isTrue = v => v === 'true';
    if (getCookieValue("appOnlyMode") !== null) {
        appOnlyMode = isTrue(getCookieValue("appOnlyMode"));
        document.getElementById('appOnlyMode').checked = appOnlyMode;
        document.getElementById("startScanButton").innerHTML = appOnlyMode ? "Next" : "Scan";
        document.getElementById("solveButton").style.display = appOnlyMode ? 'block' : 'none';
    }
}
