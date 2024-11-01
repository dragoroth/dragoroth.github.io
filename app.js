import QrScanner from "https://unpkg.com/qr-scanner/qr-scanner.min.js";

let player; // Define player globally
let playbackTimer; // hold the timer reference
let playbackDuration = 30; // Default playback duration
let qrScanner;
let csvCache = {};


document.addEventListener('DOMContentLoaded', function () {

    let lastDecodedText = ""; // Store the last decoded text

    const video = document.getElementById('qr-video');
    const resultContainer = document.getElementById("qr-reader-results");

    qrScanner = new QrScanner(video, result => {
        console.log('decoded qr code:', result);
        if (result.data !== lastDecodedText) {
            //console.log('new qr!');
            lastDecodedText = result.data; // Update the last decoded text
            handleScannedLink(result.data);
        }
    }, { 
        highlightScanRegion: true,
        highlightCodeOutline: true,
    }
    );
    
    // Function to determine the type of link and act accordingly
    async function handleScannedLink(decodedText) {
        let youtubeURL = "";
        if (isYoutubeLink(decodedText)) {
            console.log("IsYoutubeLink");
            youtubeURL = decodedText;
        } else if (isHitsterLink(decodedText)) {
            console.log("IsHitsterLink");
            const hitsterData = parseHitsterUrl(decodedText);
            if (hitsterData) {
                console.log("Hitster data:", hitsterData.id, hitsterData.lang);
                try {
                    const csvContent = await getCachedCsv(`/hitster-${hitsterData.lang}.csv`);
                    const youtubeLink = lookupYoutubeLink(hitsterData.id, csvContent);
                    if (youtubeLink) {
                        // Handle YouTube link obtained from the CSV
                        console.log(`YouTube Link from CSV: ${youtubeLink}`);
                        youtubeURL = youtubeLink;
                        // Example: player.cueVideoById(parseYoutubeLink(youtubeLink).videoId);
                    }
                } catch (error) {
                  console.error("Failed to fetch CSV:", error);
                }
            }
            else {
                console.log("Invalid Hitster URL:", decodedText);
            }
        }

        console.log(`YouTube Video URL: ${youtubeURL}`);

        const youtubeLinkData = parseYoutubeLink(youtubeURL);
        if (youtubeLinkData) {
            qrScanner.stop(); // Stop scanning after a result is found
            document.getElementById('qr-reader').style.display = 'none'; // Hide the scanner after successful scan
            document.getElementById('cancelScanButton').style.display = 'none'; // Hide the cancel-button
            lastDecodedText = ""; // Reset the last decoded text

            document.getElementById('video-id').textContent = youtubeLinkData.videoId;  

            console.log("Queing video:", youtubeLinkData.videoId, ", Starting at ", youtubeLinkData.startTime);
            player.cueVideoById(youtubeLinkData.videoId, youtubeLinkData.startTime || 0);
        }
        
    }

    function isHitsterLink(url) {
        // Regular expression to match with or without "http://" or "https://"
        const regex = /^(?:http:\/\/|https:\/\/)?(www\.hitstergame|app\.hitsternordics)\.com\/.+/;
        console.log("test if hitster link, result: ", regex.test(url));
        return regex.test(url);
    }

    // Example implementation for isYoutubeLink
    function isYoutubeLink(url) {
        return url.startsWith("https://www.youtube.com") || url.startsWith("https://youtu.be") || url.startsWith("https://music.youtube.com/");
    }

    // Example implementation for parseHitsterUrl
    function parseHitsterUrl(url) {
        const regex = /^(?:http:\/\/|https:\/\/)?www\.hitstergame\.com\/(.+?)\/(\d+)$/;
        const match = url.match(regex);
        if (match) {
            // Hitster URL is in the format: https://www.hitstergame.com/{lang}/{id}
            // lang can be things like "en", "de", "pt", etc., but also "de/aaaa0007"
            const processedLang = match[1].replace(/\//g, "-");
            return { lang: processedLang, id: match[2] };
        }
        const regex_nordics = /^(?:http:\/\/|https:\/\/)?app.hitster(nordics).com\/resources\/songs\/(\d+)$/;
        const match_nordics = url.match(regex_nordics);
        if (match_nordics) {
            // Hitster URL can also be in the format: https://app.hitsternordics.com/resources/songs/{id}
            return { lang: match_nordics[1], id: match_nordics[2] };
        }
        return null;
    }

    // Looks up the YouTube link in the CSV content based on the ID
    function lookupYoutubeLink(id, csvContent) {
        const headers = csvContent[0]; // Get the headers from the CSV content
        const cardIndex = headers.indexOf('Card#');
        const urlIndex = headers.indexOf('URL');

        const targetId = parseInt(id, 10); // Convert the incoming ID to an integer
        const lines = csvContent.slice(1); // Exclude the first row (headers) from the lines

        if (cardIndex === -1 || urlIndex === -1) {
            throw new Error('Card# or URL column not found');
        }

        for (let row of lines) {
            const csvId = parseInt(row[cardIndex], 10);
            if (csvId === targetId) {
                return row[urlIndex].trim(); // Return the YouTube link
            }
        }
        return null; // If no matching ID is found

    }

    // Could also use external library, but for simplicity, we'll define it here
    function parseCSV(text) {
        const lines = text.split('\n');
        return lines.map(line => {
            const result = [];
            let startValueIdx = 0;
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
                if (line[i] === '"' && line[i-1] !== '\\') {
                    inQuotes = !inQuotes;
                } else if (line[i] === ',' && !inQuotes) {
                    result.push(line.substring(startValueIdx, i).trim().replace(/^"(.*)"$/, '$1'));
                    startValueIdx = i + 1;
                }
            }
            result.push(line.substring(startValueIdx).trim().replace(/^"(.*)"$/, '$1')); // Push the last value
            return result;
        });
    }

    async function getCachedCsv(url) {
        if (!csvCache[url]) { // Check if the URL is not in the cache
            console.log(`URL not cached, fetching CSV from URL: ${url}`);
            const response = await fetch(url);
            const data = await response.text();
            csvCache[url] = parseCSV(data); // Cache the parsed CSV data using the URL as a key
        }
        return csvCache[url]; // Return the cached data for the URL
    }

    function parseYoutubeLink(url) {
        // First, ensure that the URL is decoded (handles encoded URLs)
        url = decodeURIComponent(url);
    
        const regex = /^https?:\/\/(www\.youtube\.com\/watch\?v=|youtu\.be\/|music\.youtube\.com\/watch\?v=)(.{11}).*/;
        const match = url.match(regex);
        if (match) {
            const queryParams = new URLSearchParams(match[4]); // Correctly capture and parse the query string part of the URL
            const videoId = match[2];
            console.log(queryParams);
            let startTime = queryParams.get('start') || queryParams.get('t');
            const endTime = queryParams.get('end');
    
            // Normalize and parse 't' and 'start' parameters
            startTime = normalizeTimeParameter(startTime);
            const parsedEndTime = normalizeTimeParameter(endTime);
            if (startTime == null) startTime = 0;
    
            return { videoId, startTime, endTime: parsedEndTime };
        }
        return null;
    }
    
    function normalizeTimeParameter(timeValue) {
        if (!timeValue) return null; // Return null if timeValue is falsy
    
        // Handle time formats (e.g., 't=1m15s' or '75s')
        let seconds = 0;
        if (timeValue.endsWith('s')) {
            seconds = parseInt(timeValue, 10);
        } else {
            // Additional parsing can be added here for 'm', 'h' formats if needed
            seconds = parseInt(timeValue, 10);
        }
    
        return isNaN(seconds) ? null : seconds;
    }
});

// This function creates an <iframe> (and YouTube player) after the API code downloads.
function onYouTubeIframeAPIReady() {
    player = new YT.Player('player', {
        height: '0',
        width: '0',
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
}
window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;

// Load the YouTube IFrame API script
const tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
const firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

// The API will call this function when the video player is ready.
function onPlayerReady(event) {
    // Cue a video using the videoId from the QR code (example videoId used here)
    // player.cueVideoById('dQw4w9WgXcQ');
}

// Display video information when it's cued
function onPlayerStateChange(event) {
    console.log('playerStateChange to ', event.data, YT.PlayerState);
    if (event.data == YT.PlayerState.CUED) {
        document.getElementById('startstop-video').style.background = "green";
        // Display title and duration
        var videoData = player.getVideoData();
        document.getElementById('video-title').textContent = videoData.title;
        var duration = player.getDuration();
        document.getElementById('video-duration').textContent = formatDuration(duration);
        // Check for Autoplay
        if (document.getElementById('autoplay').checked == true) {
            //document.getElementById('startstop-video').innerHTML = "Stop";
            playVideoWithSettingsOptions();
            /*if (document.getElementById('randomplayback').checked == true) {
                playVideoAtRandomStartTime();
            }
            else {
            player.playVideo();
            }*/
        }
    }
    else if (event.data == YT.PlayerState.PLAYING) {
        document.getElementById('startstop-video').style.background = "red";
        document.getElementById('startstop-video').innerHTML = "Stop";
    }
    else if (event.data == YT.PlayerState.PAUSED | event.data == YT.PlayerState.ENDED) {
        document.getElementById('startstop-video').style.background = "green";
        var pulsingCircles = document.getElementsByClassName('outer-circle');
        for(var i = 0; i < pulsingCircles.length; i++){
            pulsingCircles[i].style.visibility = "hidden";
        }
        timePassed = playbackDuration - 1;
    }
    else if (event.data == YT.PlayerState.BUFFERING) {
        document.getElementById('startstop-video').style.background = "orange";
        document.getElementById('startstop-video').innerHTML = "Loading";
    }
}

// Helper function to format duration from seconds to a more readable format
function formatDuration(duration) {
    var minutes = Math.floor(duration / 60);
    var seconds = duration % 60;
    return minutes + ":" + (seconds < 10 ? '0' : '') + seconds;
}

// Add event listeners to Play and Stop buttons
let timerAlertMessage = null;
document.getElementById('startstop-video').addEventListener('click', function() {
    if (this.innerHTML == "Play") {
        if (this.style.background != "green")
        {
            document.getElementById('alertBox').innerText = "Bitte erst scannen!";
            document.getElementById('alertBox').style.display = "block";
            /*var progressbar = document.getElementById('alertHideProgressbar');
            var progressbarinner = document.getElementById('inner');
            progressbarinner.style.animationDuration = '2s';
            if (typeof(callback) === 'function') {
                progressbarinner.addEventListener('animationend', callback);
            }
            progressbarinner.style.animationPlayState = 'running';*/
            clearInterval(timerAlertMessage);
            timerAlertMessage = setTimeout(() => {
                document.getElementById('alertBox').style.display = "none";
            }, 2000); // hide after ms
            return;
        }
        this.innerHTML = "Stop";
        playVideoWithSettingsOptions();
        /*if (document.getElementById('randomplayback').checked == true) {
            
        }
        else {
            player.playVideo();
        }*/
    }
    else {
        this.innerHTML = "Play";
        player.pauseVideo();
        var pulsingCircles = document.getElementsByClassName('outer-circle');
        for(var i = 0; i < pulsingCircles.length; i++){
            pulsingCircles[i].style.visibility = "hidden";
        }
        timePassed = playbackDuration - 1;
    }
});

document.getElementById('menu-home-button').addEventListener('click', function() {
    document.getElementById('menu-toggle').checked = false;
});

//Timer ring
const FULL_DASH_ARRAY = 283;
let timePassed = 0;
let timeLeft = 30;
let timerInterval = null;

function onTimesUp() {
    clearInterval(timerInterval);
    timePassed = 0;
}
  
function startTimer() {
    timerInterval = setInterval(() => {
      timePassed = timePassed += 1;
      timeLeft = playbackDuration - timePassed;
      if (timeLeft < 0) timeLeft = 0;
      setCircleDasharray();
  
      if (timeLeft <= 0) {
        onTimesUp();
      }
    }, 1000);
}
function setCircleDasharray() {
    const circleDasharray = `${(
      calculateTimeFraction() * FULL_DASH_ARRAY
    ).toFixed(0)} 283`;
    document
      .getElementById("base-timer-path-remaining")
      .setAttribute("stroke-dasharray", circleDasharray);
}

function calculateTimeFraction() {
    const rawTimeFraction = timeLeft / playbackDuration;
    return rawTimeFraction - (1 / playbackDuration) * (1 - rawTimeFraction);
  }
  

async function playVideoWithSettingsOptions() {
    const minStartPercentage = 0.10;
    const maxEndPercentage = 0.90;
    let videoDuration = player.getDuration()
    let startTime = player.getCurrentTime(); // If the video is already cued to a specific start time
    playbackDuration = parseInt(document.getElementById('playback-duration').value, 10) || 30;
    let endTime = startTime + playbackDuration;

    // Adjust start and end time based on video duration
    const minStartTime = Math.max(startTime, videoDuration * minStartPercentage);
    const maxEndTime = videoDuration * maxEndPercentage;

    // Ensure the video ends by 90% of its total duration
    if (endTime > maxEndTime) {
        endTime = maxEndTime;
        startTime = Math.max(minStartTime, endTime - playbackDuration);
    }

    // If custom start time is 0 or very close to the beginning, pick a random start time within the range
    if (startTime <= minStartTime) {
        const range = maxEndTime - minStartTime - playbackDuration;
        const randomOffset = Math.random() * range;
        startTime = minStartTime + randomOffset;
        endTime = startTime + playbackDuration;
    }

    // Cue video at calculated start time and play
    if (document.getElementById('randomplayback').checked == true) {
        console.log("play random", startTime, endTime)
        player.seekTo(startTime, true);
    }

    player.playVideo();
    
    //document.getElementById('menu-home-button').innerHTML = "waitingForLoad";
    await waitForVideoLoaded();
    //document.getElementById('menu-home-button').innerHTML = "loadingDone";

    var pulsingCircles = document.getElementsByClassName('outer-circle');
    for(var i = 0; i < pulsingCircles.length; i++){
        pulsingCircles[i].style.visibility = "visible";
    }

    if (document.getElementById('playback-duration-limit').checked == true) {
        clearTimeout(playbackTimer); // Clear any existing timer
        clearInterval(timerInterval);
        timePassed = 0;
        startTimer();
        // Schedule video stop after the specified duration
        playbackTimer = setTimeout(() => {
            player.pauseVideo();
            document.getElementById('startstop-video').innerHTML = "Play";
            for(var i = 0; i < pulsingCircles.length; i++){
                pulsingCircles[i].style.visibility = "hidden";
            }
        }, (endTime - startTime) * 1000); // Convert to milliseconds
    }
}

function waitForVideoLoaded() {
    return new Promise(resolve => {
      var start_time = Date.now();
      function checkFlag() {
        if (document.getElementById('startstop-video').style.background == "red") {
          console.log('VideoLoaded');
          resolve();
        } else if (Date.now() > start_time + 5000) {
          console.log('VideoLoadNotFinishedAfterTimeout');
          resolve();
        } else {
          window.setTimeout(checkFlag, 1000); 
        }
      }
      checkFlag();
    });
  }

// Assuming you have an element with the ID 'qr-reader' for the QR scanner
document.getElementById('qr-reader').style.display = 'none'; // Initially hide the QR Scanner

document.getElementById('startScanButton').addEventListener('click', function() {
    if (appOnlyMode)
    {
        getRandomPlaylistSong();
        return;
    }
    document.getElementById('cancelScanButton').style.display = 'block';
    document.getElementById('qr-reader').style.display = 'block'; // Show the scanner
    qrScanner.start().catch(err => {
        console.error('Unable to start QR Scanner', err);
        qrResult.textContent = "QR Scanner failed to start.";
    });

    qrScanner.start().then(() => {
        qrScanner.setInversionMode('both'); // we want to scan also for Hitster QR codes which use inverted colors
    });
});

async function getRandomPlaylistSong() {
    let youtubeURL = "";
    try
    {
        var selectedList = document.getElementById("songlist-picker").value;
        const csvContent = await getCachedCsvRandom(`/${selectedList}`);
        const youtubeLink = lookupYoutubeLinkRandom(csvContent);
        if (youtubeLink) {
            // Handle YouTube link obtained from the CSV
            console.log(`YouTube Link from CSV: ${youtubeLink}`);
            youtubeURL = youtubeLink;
            // Example: player.cueVideoById(parseYoutubeLink(youtubeLink).videoId);
        }
    } catch (error) {
        console.error("Failed to fetch CSV:", error);
    }

    console.log(`YouTube Video URL: ${youtubeURL}`);

    const youtubeLinkData = parseYoutubeLink(youtubeURL);
    if (youtubeLinkData) {
        //qrScanner.stop(); // Stop scanning after a result is found
        //document.getElementById('qr-reader').style.display = 'none'; // Hide the scanner after successful scan
        //document.getElementById('cancelScanButton').style.display = 'none'; // Hide the cancel-button
        //lastDecodedText = ""; // Reset the last decoded text

        document.getElementById('video-id').textContent = youtubeLinkData.videoId;  

        console.log("Queing video:", youtubeLinkData.videoId, ", Starting at ", youtubeLinkData.startTime);
        player.cueVideoById(youtubeLinkData.videoId, youtubeLinkData.startTime || 0);
    }
}

async function getCachedCsvRandom(url) {
    if (!csvCache[url]) { // Check if the URL is not in the cache
        console.log(`URL not cached, fetching CSV from URL: ${url}`);
        const response = await fetch(url);
        const data = await response.text();
        csvCache[url] = parseCSVRandom(data); // Cache the parsed CSV data using the URL as a key
    }
    return csvCache[url]; // Return the cached data for the URL
}

function parseCSVRandom(text) {
    const lines = text.split('\n');
    return lines.map(line => {
        const result = [];
        let startValueIdx = 0;
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            if (line[i] === '"' && line[i-1] !== '\\') {
                inQuotes = !inQuotes;
            } else if (line[i] === ',' && !inQuotes) {
                result.push(line.substring(startValueIdx, i).trim().replace(/^"(.*)"$/, '$1'));
                startValueIdx = i + 1;
            }
        }
        result.push(line.substring(startValueIdx).trim().replace(/^"(.*)"$/, '$1')); // Push the last value
        return result;
    });
}

function lookupYoutubeLinkRandom(csvContent) {
    const headers = csvContent[0]; // Get the headers from the CSV content
    const cardIndex = headers.indexOf('Card#');
    const urlIndex = headers.indexOf('URL');

    const lines = csvContent.slice(1); // Exclude the first row (headers) from the lines
    const targetId = getRandomInt(lines.length - 1); // Convert the incoming ID to an integer

    if (cardIndex === -1 || urlIndex === -1) {
        throw new Error('Card# or URL column not found');
    }
    let row = lines[targetId];
    lastRandomRow = row;
    //console.log(`Row= ${row}`);
    let rowURL = row[urlIndex].trim();
    //console.log(`RowURL= ${rowURL}`);
    //let row = lines[targetId][urlIndex].strip();
    return rowURL;
    for (let row of lines) {
        const csvId = parseInt(row[cardIndex], 10);
        if (csvId === targetId) {
            return row[urlIndex].trim(); // Return the YouTube link
        }
    }
    return null; // If no matching ID is found
}

function parseYoutubeLink(url) {
    // First, ensure that the URL is decoded (handles encoded URLs)
    url = decodeURIComponent(url);

    const regex = /^https?:\/\/(www\.youtube\.com\/watch\?v=|youtu\.be\/|music\.youtube\.com\/watch\?v=)(.{11}).*/;
    const match = url.match(regex);
    if (match) {
        const queryParams = new URLSearchParams(match[4]); // Correctly capture and parse the query string part of the URL
        const videoId = match[2];
        console.log(queryParams);
        let startTime = queryParams.get('start') || queryParams.get('t');
        const endTime = queryParams.get('end');

        // Normalize and parse 't' and 'start' parameters
        startTime = normalizeTimeParameter(startTime);
        const parsedEndTime = normalizeTimeParameter(endTime);
        if (startTime == null) startTime = 0;

        return { videoId, startTime, endTime: parsedEndTime };
    }
    else console.log(`No match: ${url}`)
    return null;
}

function normalizeTimeParameter(timeValue) {
    if (!timeValue) return null; // Return null if timeValue is falsy

    // Handle time formats (e.g., 't=1m15s' or '75s')
    let seconds = 0;
    if (timeValue.endsWith('s')) {
        seconds = parseInt(timeValue, 10);
    } else {
        // Additional parsing can be added here for 'm', 'h' formats if needed
        seconds = parseInt(timeValue, 10);
    }

    return isNaN(seconds) ? null : seconds;
}

function getRandomInt(max) {
    return Math.floor(Math.random() * max);
}

document.getElementById('solveButton').addEventListener('click', function() {
    //Card#,Artist,Title,URL,Hashed Info,Youtube-Title,Year
    if (lastRandomRow != null)
    {
        document.getElementById("solveButton-overlay-text").innerHTML = lastRandomRow[1] + "<br>" + lastRandomRow[2] + "<br>" + lastRandomRow[6];
        //document.getElementById("solveButton-overlay-songname").innerHTML = lastRandomRow[2];
        //document.getElementById("solveButton-overlay-songyear").innerHTML = lastRandomRow[6];
        document.getElementById("solveButton-overlay").style.display = "block";
    }
});

document.getElementById('solveButton-overlay').addEventListener('click', function() {
    document.getElementById("solveButton-overlay").style.display = "none";
});

document.getElementById('songinfo').addEventListener('click', function() {
    updateSongInfo();
});

function updateSongInfo()
{
    var cb = document.getElementById('songinfo');
    var videoid = document.getElementById('videoid');
    var videotitle = document.getElementById('videotitle');
    var videoduration = document.getElementById('videoduration');
    if(cb.checked == true){
        videoid.style.display = 'block';
        videotitle.style.display = 'block';
        videoduration.style.display = 'block';
    } else {
        videoid.style.display = 'none';
        videotitle.style.display = 'none';
        videoduration.style.display = 'none';
    }
}

document.getElementById('cancelScanButton').addEventListener('click', function() {
    qrScanner.stop(); // Stop scanning after a result is found
    document.getElementById('qr-reader').style.display = 'none'; // Hide the scanner after successful scan
    document.getElementById('cancelScanButton').style.display = 'none'; // Hide the cancel-button
});

let settingsvisible = false;
document.getElementById('cb_settings').addEventListener('click', function() {
    var cb = document.getElementById('cb_settings');
    if (settingsvisible == false) {
        document.getElementById('settings_div').style.display = 'block';
        settingsvisible = true;
    }
    else {
        document.getElementById('settings_div').style.display = 'none';
        settingsvisible = false;
    }
});

let creditsvisible = false;
document.getElementById('credits').addEventListener('click', function() {
    if (creditsvisible == false)
    {
        document.getElementById('credits_div').style.display = 'block';
        creditsvisible = true;
    }
    else
    {
        document.getElementById('credits_div').style.display = 'none';
        creditsvisible = false;
    }
});

let appOnlyMode = false;
let lastRandomRow = null;
document.getElementById('appOnlyMode').addEventListener('click', function() {
    document.cookie = "appOnlyMode=" + this.checked + ";max-age=2592000"; //30 Tage
    appOnlyMode = this.checked;
    listCookies();
    if (appOnlyMode)
    {
        document.getElementById("startScanButton").innerHTML = "Next";
        document.getElementById("solveButton").style.display = 'block';
    }
    else 
    {
        document.getElementById("startScanButton").innerHTML = "Scan";
        document.getElementById("solveButton").style.display = 'none';
    }
});

document.getElementById('randomplayback').addEventListener('click', function() {
    document.cookie = "RandomPlaybackChecked=" + this.checked + ";max-age=2592000"; //30 Tage
    listCookies();
});

document.getElementById('playback-duration-limit').addEventListener('click', function() {
    document.cookie = "PlaybackTimeLimitChecked=" + this.checked + ";max-age=2592000"; //30 Tage
    listCookies();
});

document.getElementById('playback-duration').addEventListener('change', function() {
    document.cookie = "PlaybackTimeLimitValue=" + this.value + ";max-age=2592000"; //30 Tage
    listCookies();
});

document.getElementById('autoplay').addEventListener('click', function() {
    document.cookie = "autoplayChecked=" + this.checked + ";max-age=2592000"; //30 Tage
    listCookies();
});

document.getElementById('cookies').addEventListener('click', function() {
    var cb = document.getElementById('cookies');
    if (cb.checked == true) {
        document.getElementById('cookielist').style.display = 'block';
    }
    else {
        document.getElementById('cookielist').style.display = 'none';
    }
});

function listCookies() {
    var result = document.cookie;
    document.getElementById("cookielist").innerHTML=result;
}

function getCookieValue(name) {
    const regex = new RegExp(`(^| )${name}=([^;]+)`);
    const match = document.cookie.match(regex);
    if (match) {
        return match[2];
    }
}

function getSonglists() {
    var selectList = document.getElementById("songlist-picker");
    const directoryPath = 'tmp/playlists';
    fs.readdir(directoryPath, (err, files) => {
        if (err) {
            return res.status(500).send('Unable to scan directory');
        }
        const csvFiles = files.filter(file => file.endsWith('.csv'));
        result = json(csvFiles);
        result.forEach(file => {
            const option = document.createElement('option');
            option.value = file;
            option.textContent = file;
            selectList.appendChild(option);
        });
    });
}

function getCookies() {
    var isTrueSet;
    if (getCookieValue("RandomPlaybackChecked") != "") {
        isTrueSet = (getCookieValue("RandomPlaybackChecked") === 'true');
        document.getElementById('randomplayback').checked = isTrueSet;
    }
    if (getCookieValue("autoplayChecked") != "") {
        isTrueSet = (getCookieValue("autoplayChecked") === 'true');
        document.getElementById('autoplay').checked = isTrueSet;  
    }
    if (getCookieValue("PlaybackTimeLimitChecked") != "") {
        isTrueSet = (getCookieValue("PlaybackTimeLimitChecked") === 'true');
        document.getElementById('playback-duration-limit').checked = isTrueSet;  
    }
    if (getCookieValue("PlaybackTimeLimitValue") != "") {
        var timeLimitValue = parseInt(getCookieValue("PlaybackTimeLimitValue"));
        if (isNaN(timeLimitValue) | timeLimitValue < 10)
        {
            console.log("set timeLimitValue to 10");
            timeLimitValue = 10;
        }
        document.getElementById('playback-duration').value = timeLimitValue;  
    }
    if (getCookieValue("appOnlyMode") != "") {
        isTrueSet = (getCookieValue("appOnlyMode") === 'true');
        document.getElementById('appOnlyMode').checked = isTrueSet;
        if (isTrueSet)
        {
            appOnlyMode = true;
            document.getElementById("startScanButton").innerHTML = "Next";
            document.getElementById("solveButton").style.display = 'block';
        }
        else
        {
            document.getElementById("solveButton").style.display = 'none';
        }
    }
    
    listCookies();

    var sPageURL = window.location.search.substring(1);
    var sURLVariables = sPageURL.split('&');
    for (var i = 0; i < sURLVariables.length; i++) 
    {
        console.log("Parameter: ", sURLVariables[i]);
        var sParameterName = sURLVariables[i].split('=');
        if (sParameterName[0] == "mode" && sParameterName[1] == "OHYES") 
        {
            console.log("OHYESMODE!");
            var elem = document.createElement("img");
            elem.setAttribute("src", "8.png");
            elem.setAttribute("height", "100");
            elem.setAttribute("width", "100");
            document.getElementById('icon').innerText = "";
            document.getElementById('icon').appendChild(elem);
            document.getElementById('widmung').innerHTML =
              "Für Steffi & Marcel ❤<br><br>Alles Gute zur Hochzeit wünschen:<br>Carolin & Dennis<br>Celine & Ralf<br>Tokens by Hoof<br><br></br>";
        }
    }
}

window.addEventListener("DOMContentLoaded", getCookies());
