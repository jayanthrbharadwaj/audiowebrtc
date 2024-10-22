'use strict';

/**
 *  AudioPlayer2
 */
 
/* 
 * AudioPlayer2
 *
 * There are audio web API: 
 *   - HTMLAudioElement  (Can be associated with speaker. Chrome only)
 *   - Audio Context.    (Uses default speaker)
 * 
 * For most operation systems and browsers HTMLAudioElement is best option.
 * The exception is macOS Safari and all iOS browsers (WebKit codebase)
 * WebKit HTMLAudioElement is about unusable for our case.
 * 
 * AudioPlayer2 can be configured to use HTMLAudioElement or AudioContext API to
 * play sound.
 * Both modes used AudioContext API to generate tones and sending audio stream.
 * 
 * Igor Kolosov AudioCodes Ltd 2022
 */
class AudioPlayer2 {
    constructor() {
        this.browser = this._browser();
        this.speakerDeviceId = undefined;  // undefined - don't use setSinkId, null or string uses setSinkId()
        this.ringerDeviceId = undefined;  // additional loudspeaker to play rings
        this.useAudioElement = undefined; // true/false switch HTMLAudioElement/AudioContext API
        this.logger = console.log;
        this.sounds = {};           // Sounds
        this.sound = null;          // Current sound
        this.ringer = null;         // Ringer sound
        this.ssound = null;         // Short sound
        this.audioCtx = null;
        this.dtmfTones = {
            '1': [{ f: [697, 1209], t: 0.2 }],
            '2': [{ f: [697, 1336], t: 0.2 }],
            '3': [{ f: [697, 1477], t: 0.2 }],
            '4': [{ f: [770, 1209], t: 0.2 }],
            '5': [{ f: [770, 1336], t: 0.2 }],
            '6': [{ f: [770, 1477], t: 0.2 }],
            '7': [{ f: [852, 1209], t: 0.2 }],
            '8': [{ f: [852, 1336], t: 0.2 }],
            '9': [{ f: [852, 1477], t: 0.2 }],
            '*': [{ f: [941, 1209], t: 0.2 }],
            '0': [{ f: [941, 1336], t: 0.2 }],
            '#': [{ f: [941, 1477], t: 0.2 }],
            'A': [{ f: [697, 1633], t: 0.2 }],
            'B': [{ f: [770, 1633], t: 0.2 }],
            'C': [{ f: [852, 1633], t: 0.2 }],
            'D': [{ f: [941, 1633], t: 0.2 }]
        };
    }

    /**
     * User can select API by setting:
     * useAudioElement: true
     * useAudioElement: false
     * useAudioElement: undefined (default) - API selected according using browser:
     *   used AudioElement API, except macOS Safari and any iOS browsers.
     */
    init(options = { logger: null, audioCtx: null, useAudioElement: undefined }) {
        this.logger = options.logger ? options.logger : console.log;
        this.audioCtx = options.audioCtx ? options.audioCtx : new (window.AudioContext || window.webkitAudioContext)();
        if (options.useAudioElement === true || options.useAudioElement === false)
            this.useAudioElement = options.useAudioElement; // user can select using API.
        else // or API will be selected automatically
            this.useAudioElement = !['safari', 'safari|ios'].includes(this.browser);

        this.logger(`AudioPlayer2: init ${this.useAudioElement ? 'AudioElement' : 'AudioContext'} (${this.browser})`);
    }

    // Set earpeace device for play().  For AudioElement mode in Chrome
    setSpeakerId(deviceId) {
        this.logger(`AudioPlayer2: setSpeakerId(${deviceId})`);
        this.speakerDeviceId = (deviceId !== null) ? deviceId : '';
    }

    // Set loudspeaker device for playRing(). For AudioElement mode in Chrome
    setRingerId(deviceId) {
        this.logger(`AudioPlayer2: setRingerId(${deviceId})`);
        this.ringerDeviceId = (deviceId) ? deviceId : null;
    }

    _browser() {
        if (/iPad|iPhone|iPod/.test(navigator.userAgent))
            return 'safari|ios'; // all iOS browsers (includes Safari, Chrome or Firefox)
        if (navigator.mozGetUserMedia)
            return 'firefox';
        if (navigator.webkitGetUserMedia)
            return 'chrome';
        if (window.safari)
            return 'safari';
        return 'other';
    }

    // To support auto-play policy.
    isDisabled() {
        if (this.audioCtx.state === 'interrupted')
            this.logger('AudioPlayer2: isDisabled() state = interrupted ! Hello from iOS');

        if (['chrome', 'safari', 'safari|ios'].includes(this.browser)) {
            return this.audioCtx.state === 'suspended';
        } else {
            return false;
        }
    }

    enable() {
        if (['chrome', 'safari', 'safari|ios'].includes(this.browser)) {
            return this.audioCtx.resume();
        } else {
            return Promise.resolve();
        }
    }

    /* 
     * Download MP3 sounds. Resolved when all sounds are loaded
     */
    downloadSounds(path, soundList) {
        this.logger(`AudioPlayer2: downloadSounds ${path} ${JSON.stringify(soundList)}`);
        if (!this.useAudioElement && ['safari', 'safari|ios'].includes(this.browser)) {
            this._setDecodeAudioDataShim(this.audioCtx);
        }
        let readyList = [];
        for (let sound of soundList) {
            let name, sname;
            if (typeof sound === 'string') {
                name = sname = sound;
            } else {
                name = Object.keys(sound)[0];
                sname = sound[name];
            }
            let file = path + sname + '.mp3';
            readyList.push(this.useAudioElement ? this._downloadSound1(name, file) : this._downloadSound2(name, file));
        }
        return Promise.allSettled(readyList);
    }

    generateTonesSuite(suite) {
        this.logger('AudioPlayer2: generateTonesSuite');
        let readyList = [];
        for (let toneName of Object.keys(suite)) {
            let toneDefinition = suite[toneName];
            readyList.push(this.useAudioElement ? this._generateTone1(toneName, toneDefinition) : this._generateTone2(toneName, toneDefinition));
        }
        return Promise.allSettled(readyList);
    }

    /**
     * Play sound in speaker
     * 
     * @param options
     *   name  sound clip name (must be set)
     *
     *   volume = 0 .. 1.0  Default 1.0   (for iOS HTMLAudioElement always 1.0)
     *   loop = true/false Endless loop
     *   repeat = number  Repeat <number> times
     *
     *   streamDestination (undefined by default), value mediaStreamDestination.
     *   Assign output to audio stream instead of speaker.
     *   
     * @returns Promise to check when playing is finished.
     */
    play(options, streamDestination = undefined) {
        if (this.isDisabled()) {
            this.logger(`AudioPlayer2: play: ${JSON.stringify(options)} [Sound is disabled]`);
            return Promise.resolve();
        }
        if (this.useAudioElement) {
            return streamDestination ? this._playStream1(options, streamDestination) : this._play1(options);
        } else {
            return this._play2(options, streamDestination);
        }
    }

    /**
     * Play ringing additionaly in loudspeaker (if configured)
     *
     * Note: the same sound name cannot be used in play() and playRing() -
     * because for each sound name created own HTMLAudioElement associated with
     * speaker.
     * So if for play() and playRing() used the same MP3 sound file,
     * use it with different sound names. (e.g. 'ring' and 'r_ring' in our examples)
     */
    playRing(options) {
        if (this.isDisabled()) {
            this.logger(`AudioPlayer2: playRing: ${JSON.stringify(options)} [Sound is disabled]`);
            return Promise.resolve();
        }
        return this.useAudioElement ? this._playRing1(options) : Promise.resolve();
    }

    /**
     * Stops playing. (if played)
     * Stops play() and playRing(), does not stop playShortSound()
     */
    stop() {
        this.useAudioElement ? this._stop1() : this._stop2();
    }

    /*
     * For independent of play(), playRing() and stop() usage.
     * Cannot be stopped.
     */
    playShortSound(options) {
        if (!this.audioCtx)
            return Promise.reject('No audio context');
        return this.useAudioElement ? this._playShortSound1(options) : this._playShortSound2(options);
    }

    /*
      HTMLAudioElement implementation
     */
    _downloadSound1(name, file) {
        let audioElem = new Audio(file);
        this.sounds[name] = {
            audioElem: audioElem,
            deviceId: '',            // associated device id
            source: null,            // linked MediaElementSource 
            streamDestination: null  // linked StreamDestination 
        };
        return new Promise((resolved, rejected) => {
            audioElem.oncanplaythrough = resolved;
            if (['safari', 'safari|ios'].includes(this.browser)) {
                audioElem.oncanplay = resolved;
                audioElem.onloadedmetadata = resolved;
            }
            audioElem.onerror = rejected;
        });
    }

    _generateTone1(toneName, toneDefinition) {
        return this._generateTone(toneDefinition)
            .then(data => {
                let audioElem = new Audio();
                let blob = this._createBlob1(data);
                audioElem.src = URL.createObjectURL(blob);
                this.sounds[toneName] = {
                    audioElem: audioElem,
                    deviceId: '',            // associated device id
                    source: null,
                    streamDestination: null
                };
            });
    }

    // Convert AudioBuffer to WAV Blob. 
    // Thanks to https://github.com/mattdiamond/Recorderjs  MIT lisence
    _createBlob1(audioBuffer) {
        function writeString(view, offset, string) {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i))
            }
        }
        function floatTo16BitPCM(output, offset, input, k) {
            for (let i = 0; i < input.length; i++, offset += 2) {
                let v = input[i] / k;
                let s = Math.max(-1, Math.min(1, v))
                output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
            }
        }
        function normalize(input) {
            let max = 0, min = 0;
            for (let i = 0; i < input.length; i++) {
                let v = input[i];
                max = Math.max(max, v)
                min = Math.min(min, v)
            }
            return (max - min) / 2;
        }
        let samples = audioBuffer.getChannelData(0);
        let sampleRate = audioBuffer.sampleRate;
        let format = 1;
        let bitDepth = 16;
        let bytesPerSample = bitDepth / 8;
        let numChannels = 1;
        let blockAlign = numChannels * bytesPerSample;

        let buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
        let view = new DataView(buffer);

        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + samples.length * bytesPerSample, true);
        writeString(view, 8, 'WAVE');
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, format, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitDepth, true);
        writeString(view, 36, 'data');
        view.setUint32(40, samples.length * bytesPerSample, true);
        let k = normalize(samples);
        floatTo16BitPCM(view, 44, samples, k);
        return new Blob([buffer], { type: "audio/wav" });
    }

    _play1(options) {
        this.logger(`AudioPlayer2 [AudioElement]: play: ${JSON.stringify(options)}`);
        return this._play1_impl(options, 'sound', this.speakerDeviceId);
    }

    _playRing1(options) {
        if (!this.ringerDeviceId)
            return Promise.resolve();
        this.logger(`AudioPlayer2 [AudioElement]: playRing: ${JSON.stringify(options)}`);
        return this._play1_impl(options, 'ringer', this.ringerDeviceId);
    }

    _playShortSound1(options) {
        return this._play1_impl(options, 'ssound', this.speakerDeviceId);
    }

    _play1_impl(options, sname, deviceId) {
        this._silentStop1(this[sname]);

        let sound = this[sname] = this.sounds[options.name];
        if (!sound) {
            this.logger(`AudioPlayer2 [AudioElement]: missed sound: "${options.name}"`);
            return Promise.reject();
        }
        if (sound.source) {
            this.logger(`AudioPlayer2 [AudioElement]: sound "${options.name}" was used for streaming`);
            return Promise.reject();
        }

        return Promise.resolve()
            .then(() => {
                if (deviceId !== undefined && sound.audioElem.setSinkId !== undefined) {
                    if (sound.deviceId === deviceId) {
                        return Promise.resolve();
                    } else {
                        this.logger(`AudioPlayer2 [AudioElement]: "${options.name}": setSinkId deviceId="${deviceId}"`);
                        return sound.audioElem.setSinkId(deviceId);
                    }
                } else {
                    return Promise.resolve();
                }
            })
            .then(() => {
                sound.deviceId = deviceId;
            })
            .catch((e) => {
                // Sometimes there is Chrome error: 'The operation could not be performed and was aborted'
                this.logger(`AudioPlayer2 [AudioElement]: HTMLAudioElement.setSinkId error "${e.message}" [used default speaker]`);
            })
            .then(() => {
                sound.audioElem.volume = options.volume !== undefined ? options.volume : 1.0;
                sound.audioElem.loop = !!options.loop && options.repeat === undefined;
                let repeat = options.repeat !== undefined ? options.repeat : 1;

                return new Promise((resolve) => {
                    sound.audioElem.onended = () => {
                        if (--repeat > 0 && this[sname]) {
                            sound.audioElem.currentTime = 0;
                            sound.audioElem.play()
                                .catch((e) => {
                                    this.logger('AudioPlayer2 [AudioElement]: play error', e);
                                });
                        } else {
                            resolve();
                        }
                    }
                    sound.audioElem.currentTime = 0;
                    sound.audioElem.play()
                        .catch((e) => {
                            this.logger('AudioPlayer2 [AudioElement]: play error', e);
                        });
                });
            });
    }

    _playStream1(options, streamDestination) {
        this.logger(`AudioPlayer2 [AudioElement]: play stream: ${JSON.stringify(options)}`);
        this._silentStop1(this.sound);
        this.sound = this.sounds[options.name];
        if (!this.sound) {
            this.logger(`AudioPlayer2 [AudioElement]: missed media file: "${options.name}"`);
            return Promise.reject();
        }

        return new Promise((resolve) => {
            this.sound.audioElem.volume = options.volume !== undefined ? options.volume : 1.0;
            this.sound.audioElem.loop = !!options.loop && options.repeat === undefined;
            let repeat = options.repeat !== undefined ? options.repeat : 1;

            this.sound.audioElem.onended = () => {
                if (--repeat > 0 && this.sound) {
                    this.sound.audioElem.currentTime = 0;
                    this.sound.audioElem.play()
                        .catch((e) => {
                            this.logger('AudioPlayer2 [AudioElement]: streaming error', e);
                        });
                } else {
                    this.logger('AudioPlayer2 [AudioElement]: stopped');
                    resolve();
                }
            }
            this.sound.audioElem.currentTime = 0;
            // It's workaround of the issue: https://bugs.chromium.org/p/chromium/issues/detail?id=429204
            // (The Audio cannot be used in createMediaElementSource again)
            if (!this.sound.source) {
                this.sound.source = this.audioCtx.createMediaElementSource(this.sound.audioElem);
            }
            this.sound.streamDestination = streamDestination;
            this.sound.source.connect(this.sound.streamDestination);
            this.sound.audioElem.play()
                .catch((e) => {
                    this.logger('AudioPlayer2 [AudioElement]: streaming error', e);
                });
        });
    }

    _stop1() {
        this.logger('AudioPlayer2 [AudioElement]: stop');
        this._silentStop1(this.sound);
        this.sound = null;
        this._silentStop1(this.ringer);
        this.ringer = null;
    }

    _silentStop1(sound) {
        if (!sound)
            return;

        sound.audioElem.pause();

        if (sound.source) {
            try {
                sound.source && sound.source.disconnect();
                sound.streamDestination && sound.streamDestination.disconnect();
                sound.streamDestination = null;
            } catch (e) {
                this.logger('AudioPlayer2 [AudioElement]: disconnect AudioContext error', e);
            }
        }
    }

    /* 
      AudioContext implementation
    */
    _downloadSound2(name, file) {
        return fetch(file, { credentials: 'same-origin' })
            .then(response => {
                if (response.status >= 200 && response.status <= 299)
                    return response.arrayBuffer()
                        .catch(() => {
                            throw 'download body error';
                        });
                throw response.status === 404 ? 'file not found' : 'download error';
            })
            .then(data => {
                return this.audioCtx.decodeAudioData(data)
                    .catch(() => {
                        throw 'decoding error';
                    });
            })
            .then(decodedData => {
                this.sounds[name] = {
                    data: decodedData,
                    source: null,
                    gain: null,
                    streamDestination: null
                };
            })
            .catch(e => {
                this.logger('AudioPlayer2 [AudioContext]: ' + e + ': ' + file);
            });
    }

    _generateTone2(toneName, toneDefinition) {
        return this._generateTone(toneDefinition)
            .then(data => {
                if (data) {
                    this.sounds[toneName] = {
                        data: data,
                        source: null,
                        gain: null,
                        streamDestination: null,
                    };
                }
            })
    }

    _play2(options, streamDestination = null) {
        this.logger(`AudioPlayer2 [AudioContext]: ${streamDestination ? 'playStream' : 'play'}: ${JSON.stringify(options)}`);
        this._silentStop2(this.sound);
        let sound = this.sounds[options.name];
        if (!sound) {
            this.logger(`AudioPlayer2 [AudioContext]: missed media: "${options.name}"`);
            return Promise.reject();
        }
        this.sound = sound = Object.assign({}, sound);

        return new Promise((resolve, reject) => {
            try {
                sound.source = this.audioCtx.createBufferSource();
                sound.source.buffer = sound.data;

                sound.source.onended = () => {
                    this.logger(`AudioPlayer2 [AudioContext]:  onended ${options.name}`);
                    this._silentStop2(sound);
                    resolve(true);
                }
                sound.source.onerror = () => {
                    this.logger(`AudioPlayer2 [AudioContext]:  onerror ${options.name}`);
                    this._silentStop2(sound);
                    reject(new Error('onerror callback'));
                }

                sound.gain = this.audioCtx.createGain();
                let volume = options.volume ? options.volume : 1.0;
                sound.gain.gain.setValueAtTime(volume, this.audioCtx.currentTime);
                sound.source.connect(sound.gain);
                if (streamDestination) {
                    sound.streamDestination = streamDestination;
                    sound.gain.connect(sound.streamDestination);
                } else {
                    sound.streamDestination = null;
                    sound.gain.connect(this.audioCtx.destination);
                }

                if (options.loop === true || options.repeat) {
                    sound.source.loop = true;
                    sound.source.loopStart = 0;
                }

                let duration = null;
                if (options.repeat) {
                    duration = this.sound.source.buffer.duration * options.repeat;
                }

                sound.source.start(0, 0);
                if (duration)
                    sound.source.stop(this.audioCtx.currentTime + duration);
            } catch (e) {
                this.logger('AudioPlayer2 [AudioContext]: play error', e);
                this._silentStop2(sound);
                reject(e);
            }
        });
    }

    _playShortSound2(options) {
        let source;
        let gain;
        function release() {
            try {
                source && source.stop();
                gain && gain.disconnect();
                source && source.disconnect();
            } catch (e) {
                this.logger('AudioPlayer [AudioContext]: playShortSound: release error', e);
            }
        }
        return new Promise((resolve, reject) => {
            try {
                let sound = this.sounds[options.name];
                if (!sound) {
                    `AudioPlayer2 [AudioContext]: playShortSound: no sound: "${options.name}"`
                    reject('No sound');
                    return;
                }
                source = this.audioCtx.createBufferSource();
                source.buffer = sound.data;
                source.onended = () => {
                    release();
                    resolve();
                }
                source.onerror = (e) => {
                    release();
                    reject(e);
                }
                gain = this.audioCtx.createGain();
                let volume = options.volume ? options.volume : 1.0;
                gain.gain.setValueAtTime(volume, this.audioCtx.currentTime);
                source.connect(gain);
                gain.connect(this.audioCtx.destination);
                source.start();
            } catch (e) {
                this.logger('AudioPlayer [AudioContext]: playShortSound error', e);
                reject(e);
            }
        });
    }

    _stop2() {
        this.logger('AudioPlayer2 [AudioContext]: stop');
        this._silentStop2(this.sound);
        this.sound = null;
    }

    _silentStop2(sound) {
        if (!sound || !sound.source) {
            return;
        }
        try {
            sound.source && sound.source.stop();
        } catch (e) {
        }

        try {
            sound.gain && sound.gain.disconnect();
            sound.source && sound.source.disconnect();
            sound.streamDestination && sound.streamDestination.disconnect();
            sound.gain = null;
            sound.source = null;
            sound.streamDestination = null;
        } catch (e) {
            this.logger('AudioPlayer2 [AudioContext]: release resources error', e);
        }
    }

    /*
      Used in both implementations
    */
    // for Safari
    _setDecodeAudioDataShim(audioCtx) {
        let origDecodeAudioData = audioCtx.decodeAudioData;
        audioCtx.decodeAudioData = (data) => new Promise((resolve, reject) => {
            origDecodeAudioData.call(audioCtx, data, (d) => resolve(d), (e) => reject(e))
        });
    }

    // for Safari
    _setStartRenderingShim(offlineCtx) {
        let origStartRendering = offlineCtx.startRendering;
        offlineCtx.startRendering = () => new Promise((resolve) => {
            offlineCtx.oncomplete = (e) => { resolve(e.renderedBuffer); }
            origStartRendering.call(offlineCtx);
        });
    }

    _generateTone(toneDefinition) {
        function getArray(e) {
            if (e === undefined) return [];
            if (Array.isArray(e)) return e;
            return [e];
        }
        try {
            let duration = 0;
            let oscillatorNumber = 0;
            for (let step of toneDefinition) {
                duration += step.t;
                oscillatorNumber = Math.max(oscillatorNumber, getArray(step.f).length);
            }
            let channels = 1;
            let sampleRate = this.audioCtx.sampleRate;
            let frameCount = sampleRate * duration;
            let offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(channels, frameCount, sampleRate);
            if (this.browser === 'safari' || this.browser === 'safari|ios')
                this._setStartRenderingShim(offlineCtx);

            let oscillators = new Array(oscillatorNumber);
            for (let i = 0; i < oscillators.length; i++) {
                oscillators[i] = offlineCtx.createOscillator();
                oscillators[i].connect(offlineCtx.destination);
            }

            let time = 0;
            for (let i = 0, num = toneDefinition.length; i < num; i++) {
                let step = toneDefinition[i];
                let frequencies = getArray(step.f);
                for (let j = 0; j < oscillators.length; j++) {
                    let f = (j < frequencies.length) ? frequencies[j] : 0;
                    oscillators[j].frequency.setValueAtTime(f, offlineCtx.currentTime + time);
                }
                time += step.t;
            }

            for (let o of oscillators) {
                o.start(0);
                o.stop(offlineCtx.currentTime + duration);
            }

            return offlineCtx.startRendering()
                .then(renderedBuffer => {
                    for (let o of oscillators)
                        o.disconnect();
                    return renderedBuffer;
                });
        } catch (e) {
            this.logger('AudioPlayer2: cannot generate tone', e);
            return Promise.reject(e);
        }
    }
}
