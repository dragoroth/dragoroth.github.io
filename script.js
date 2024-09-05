// script.js
document.addEventListener('DOMContentLoaded', function() {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const audio = new Audio('path_to_your_audio_file.mp3');
    const source = audioContext.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(audioContext.destination);

    const pulsatingCircles = document.querySelectorAll('.outer-circle');
    let pulsationActive = false;
    let animationFrameId;

    function animatePulsation() {
        if (!pulsationActive) return;
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);
        const bass = dataArray.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
        const scale = 1 + bass / 256;
        pulsatingCircles.forEach(circle => {
            circle.style.transform = `scale(${scale})`;
        });
        animationFrameId = requestAnimationFrame(animatePulsation);
    }

    document.getElementById('toggle-pulsation').addEventListener('click', function() {
        pulsationActive = !pulsationActive;
        if (pulsationActive) {
            animatePulsation();
        } else {
            cancelAnimationFrame(animationFrameId);
            pulsatingCircles.forEach(circle => {
                circle.style.transform = 'scale(1)';
            });
        }
    });

    audio.play();
});
