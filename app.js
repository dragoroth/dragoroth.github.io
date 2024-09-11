body {
    margin: 0;
    font-family: Arial, sans-serif;
    background: linear-gradient(to right, #add8e6, #87ceeb);
}

header {
    background: linear-gradient(to right, #add8e6, #87ceeb);
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 20px;
}

.icon {
    font-size: 2rem;
}

nav {
    position: relative;
}

.menu-icon {
    font-size: 2rem;
    cursor: pointer;
    display: none;
    z-index: 2;
}

#menu-toggle {
    display: none;
    z-index: 2;
}

.menu {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    background: #add8e6;
    position: fixed;
    top: 0;
    right: 0px;
    width: 300px;
    height: 100%;
    transition: right 0.3s ease;
    z-index: 1;
}

.menu li {
    margin: 0px 0;
    color: rgb(41, 41, 41);
    padding:5px 0px;
}

.menu li a {
    text-decoration: none;
    display: flex;
    align-items: center;
    padding: 10px 20px;
    color: rgb(41, 41, 41);
}

.menu li:hover {
    background-color: #87ceeb;
}

.menu li a span {
    margin-right: 10px;
}

.settings_div {
    margin-left: 30px;
    display: none;
    /*background: #eb87da;*/
}

.credits_div {
    display: none;
}

#menu-toggle:checked + .menu-icon + .menu {
    right: 0;
}

#menu-toggle:checked + .menu-icon {
    position: relative;
}

@media (max-width: 768px) {
    .menu-icon {
        display: block;
    }
    .menu {
        right: -300px;
    }
}

.cancelScanButton {
    z-index: 20;
}

.qr-reader,
.video-player {
    background: linear-gradient(to right, #add8e6, #87ceeb);
    /*background: #ffffff;*/
    margin: 20px 0;
    padding: 20px;
    border-radius: 8px;
    box-shadow: 0 2px 5px rgba(0,0,0,0.1);
}

.audiogram {
    height: 300px;
    display: flex;
    justify-content: center;
    align-items: center;
    margin: 20px;
}

.pulsating-circle {
    position: relative;
    width: 150px;
    height: 150px;
    border-radius: 50%;
    display: flex;
    justify-content: center;
    align-items: center;
}

.inner-circle {
    width: 100px;
    height: 100px;
    border-radius: 50%;
    background: #add8e6;
    display: flex;
    justify-content: center;
    align-items: center;
    font-size: 2rem;
}

.timer-circle {
    width: 100px;
    height: 100px;
    border-radius: 50%;
    border: 10px solid #277594;
    position: absolute;
    font-size: 2rem;
    visibility: hidden;
}

/* Sets the containers height and width */
.base-timer {
    position: absolute;
    height: 100px;
    width: 100px;
  }
  
  /* Removes SVG styling that would hide the time label */
  .base-timer__circle {
    fill: none;
    stroke: none;
  }
  
  /* The SVG path that displays the timer's progress */
  .base-timer__path-elapsed {
    stroke-width: 7px;
    stroke: #277594;
  }

  .base-timer__path-remaining {
    stroke-width: 7px;
    stroke-linecap: round;
    /*transform: rotate(90deg);
    transform-origin: center;
    transition: 1s linear all;*/
    fill-rule: nonzero;
    stroke: #70afc4;
  }

.outer-circle {
    position: absolute;
    border-radius: 50%;
    border: 2px solid #87ceeb;
    animation: pulsate 3s infinite;
    animation-timing-function: linear;
}

.outer-circle:nth-child(2) {
    width: 100px;
    height: 100px;
    animation-delay: 0s;
    opacity: 0;
}

.outer-circle:nth-child(3) {
    width: 130px;
    height: 130px;
    animation-delay: 0.3s;
    opacity: 0;
}

.outer-circle:nth-child(4) {
    width: 160px;
    height: 160px;
    animation-delay: 0.6s;
    opacity: 0;
}

.outer-circle:nth-child(5) {
    width: 190px;
    height: 190px;
    animation-delay: 0.9s;
    opacity: 0;
}

.outer-circle:nth-child(6) {
    width: 220px;
    height: 220px;
    animation-delay: 1.2s;
    opacity: 0;
    visibility: hidden;
}

@keyframes pulsate {
    0% {
        transform: scale(1);
        opacity: 0;
        border-color: #87ceeb;
    }
    25% {
        transform: scale(1.15);
        opacity:1;
        border-color:#1abce4;
    }
    50% {
        transform: scale(1.30);
        opacity:1;
        border-color:#2477e4;
    }
    75% {
        transform: scale(1.45);
        opacity:1;
        border-color:#1abce4;
    }
    100% {
        transform: scale(1.65);
        border-color: #87ceeb;
        opacity: 0;
    }
}

footer {
    display: flex;
    justify-content: center;
    padding: 20px;
}

.mainButtons {
    display: flex;
    justify-content: center;
    align-items: center;
    flex-direction: column;
    gap: 20px;
    margin: auto;
    margin-bottom: 40px;
    width: 50%;
}

.scan-button {
    background:#74a7b8;
    border: none;
    padding: 15px 35px;
    border-radius: 25px;
    color: white;
    font-size: 1rem;
    cursor: pointer;
    transition: background 0.3s, transform 0.3s;

}

.scan-button:hover {
    background: #29677c;
}

.scan-button:active {
    transform: scale(0.95);
}

.videoInfo {
    display: flex;
    flex-direction: column;
    align-items: center;
    /*border: 1px solid #000;*/
    padding: 20px;
    width: 300px;
    margin: auto;
}

.alert {
    padding: 20px;
    background-color: #f44336; /* Red */
    color: white;
    margin-bottom: 15px;
    text-align: center;
}

#qr-reader {
    position: absolute; /* or absolute */
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 2; /* Ensure it's above other content */
    /*background-color: #f4f4f4;*/
    background-color: linear-gradient(to right, #add8e6, #87ceeb);
}

#qr-video {
    display: inline-block;
    position: absolute;
    width: 100%;
    height: 100%;
    top: 0;
    left: 0;
}

#videotitle {
    display:  none;
    text-align: left;
    width: 100%;
    margin-bottom: 10px;
}

#videoduration {
    display:  none;
    text-align: left;
    width: 100%;
}

#videoid {
    display: none ;
    text-align: left;
    width: 100%;
    margin-bottom: 10px;
}

#cancelScanButton {
    position: absolute;
    display:none;
    background-color: #e95d5d;
    color: black;
    z-index: 4;
}

#cookielist {
    display: none;
}

#playback-duration {
    width: 50px;
}
