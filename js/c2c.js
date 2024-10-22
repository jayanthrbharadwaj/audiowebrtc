'use strict';

/*
   Simple Click to Call Widget for SDK 1.19.0

   It seems that this simple version is much more convenient for understanding and customization.

   Removed features:

   - Test call 
   - Browser voice quality score
   - Server voice quality score
   - Device selection code (camera, microphone. For desktop Chrome also speaker)
   - Form that user fill before calling. The data converted to JSON and send as INVITE X-header
   - DTMF sequence sending after open call
   - DTMF keyboard
   - websocket logger
   - work without microphone.

   If you need one of removed feature please take corresponding code from complete click-to-call version.
     
   Igor Kolosov AudioCodes Ltd 2022
 */
const c2c_userAgent = 'AudioCodes Simple Click-to-Call';
const c2c_sbcDisconnectCounterMax = 5;
const c2c_sbcDisconnectDelay = 60;   // After call termination keep SBC connection the time interval (seconds)
let c2c_phone = new AudioCodesUA(); // phone API
let c2c_ac_log = console.log;       // phone logger
let c2c_hasCamera = false;
let c2c_audioPlayer = new AudioPlayer2();
let c2c_activeCall = null; // not null, if exists active call
let c2c_restoreCall = null;
let c2c_sbcDisconnectCounter = 0;
let c2c_sbcDisconnectTimer = null;
let c2c_messageId = 0;
let c2c_isWsConnected = false;  // Is websocket connected to SBC ? 
let c2c_isStartCall = false;    // start call after SBC connection.
let c2c_callButtonHandler = function () { };
let c2c_callButtonTitle = null;

// HTML element references
let c2c_widgetDiv = null;
let c2c_callButton = null; // the same button used to start call and to hangup call

// If call type is 'user_control' before call show video checkbox
let c2c_videoSpan = null;
let c2c_videoCheckbox = null;

// If call type is 'user_control' during call show camera button
let c2c_cameraButton = null;
let c2c_cameraLineSvg = null;

// Status line.
let c2c_status_line = null;

// Video element 
let c2c_remoteVideo = null;

// Set logger: console or websocket.
function c2c_init() {
    c2c_setConsoleLoggers();
    c2c_startPhone();
}

// Start cick to call phone.
async function c2c_startPhone() {
    c2c_ac_log(`------ Date: ${new Date().toDateString()} -------`);
    c2c_ac_log(c2c_userAgent);
    c2c_ac_log(`SDK: ${c2c_phone.version()}`);
    c2c_ac_log(`SIP: ${JsSIP.C.USER_AGENT}`);
    c2c_ac_log(`Browser: ${c2c_phone.getBrowserName()}  Internal name: ${c2c_phone.getBrowser()}|${c2c_phone.getOS()}`);

    c2c_phone.setUserAgent(`${c2c_userAgent} ${c2c_phone.version()} ${c2c_phone.getBrowserName()}`);

    // Optional url parameters: 'call', 'server', 'domain', E.g. ?call=user1&server=sbc.audiocodes.com&domain=audiocodes.com
    let call = c2c_getStrUrlParameter('call');
    if (call) {
        if (c2c_config.call === '_take_value_from_url_') {
            c2c_config.call = c2c_stringDropCharacters(call, ' -');
        } else {
            c2c_ac_log(`Error: URL parameter "call" is ignored. To enable set configuration "call: '_take_value_from_url_'"`);
        }
    }

    let domain = c2c_getStrUrlParameter('domain');
    if (domain) {
        if (c2c_serverConfig.domain === '_take_value_from_url_') {
            c2c_serverConfig.domain = domain;
        } else {
            c2c_ac_log(`Error: URL parameter "domain" is ignored. To enable set configuration "domain: '_take_value_from_url_'"`);
        }
    }

    let server = c2c_getStrUrlParameter('server');
    if (server) {
        if (c2c_serverConfig.addresses === '_take_value_from_url_') {
            c2c_serverConfig.addresses = [`wss://${server}`];
        } else {
            c2c_ac_log(`Error: URL parameter "server" is ignored. To enable set configuration "addresses: '_take_value_from_url_'"`);
        }
    }

    // Get HTML element references.
    if (!c2c_getHTMLPageReferences()) {
        return; // Missed mandatory HTML element, please fix used HTML.
    }

    // Set buttons handlers
    c2c_callButton.onclick = function () { c2c_buttonHandler('call button', c2c_callButtonHandler); }
    if (c2c_cameraButton) c2c_cameraButton.onclick = function () { c2c_buttonHandler('webcam on/off button', c2c_cameraToggle); }

    // Check WebRTC support. If loaded from unsecure context (HTTP site) the WebRTC API is hidden. 
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        c2c_info('No WebRTC');
        c2c_gui_phoneDisabled('WebRTC API is not supported in this browser !');
        return; 
    }

    // Check presence of microphone, speaker, web camera.
    try {
        c2c_hasCamera = await c2c_phone.checkAvailableDevices();
        c2c_ac_log(`Camera is ${c2c_hasCamera ? 'present' : 'missing'}`);
    } catch (e) {
        c2c_info('No microphone or speaker !'); // Please connect headset and reload page.
        c2c_gui_phoneDisabled('No microphone or speaker !');
        return;
    }

    // Prepare restore call data c2c_restoreCall
    let data = sessionStorage.getItem('c2c_restoreCall');
    if (data !== null) {
        sessionStorage.removeItem('c2c_restoreCall');
        c2c_restoreCall = JSON.parse(data);
        let delay = Math.ceil(Math.abs(c2c_restoreCall.time - new Date().getTime()) / 1000);
        if (delay > c2c_config.c2c_restoreCallMaxDelay) {
            c2c_ac_log('No restore call, delay is too long (' + delay + ' seconds)');
            c2c_restoreCall = null;
        }
    }

    window.addEventListener('beforeunload', c2c_onBeforeUnload);

    // Prepare audio player
    c2c_audioPlayer.init({ logger: c2c_ac_log });

    // mp3 sounds are not used in this example
    // await c2c_audioPlayer.downloadSounds('../sounds/', c2c_soundConfig.downloadSounds)

    await c2c_audioPlayer.generateTonesSuite(c2c_soundConfig.generateTones);

    c2c_ac_log('audioPlayer2: sounds are ready');

    c2c_gui_phoneBeforeCall();

    if (c2c_restoreCall === null) {
        // Call auto start after HTML page load
        let callAutoStart = !!c2c_config.callAutoStart ? c2c_config.callAutoStart.toLowerCase() : 'no';
        if ((callAutoStart === 'yes force') || (callAutoStart === 'yes' && !c2c_audioPlayer.isDisabled())) {
            if (c2c_audioPlayer.isDisabled()) {
                c2c_ac_log('Start call automatically. Warning: audio player is disabled. So you cannot hear beeps!');
            } else {
                c2c_ac_log('Start call automatically');
            }
            c2c_call();
        }
    } else {
        // Restore call after HTML page reload
        c2c_ac_log('Trying to restore call', c2c_restoreCall);
        c2c_call();
    }
}

function c2c_getHTMLPageReferences() {
    c2c_widgetDiv = document.getElementById('c2c_widget_div');
    if (!c2c_widgetDiv) {
        c2c_ac_log('Fatal error: HTML missed div id="c2c_widget"');
        return false;
    }

    c2c_callButton = document.getElementById('c2c_call_btn');
    if (!c2c_callButton) {
        c2c_ac_log('Fatal error: HTML missed button id="c2c_call_btn"');
        return false;
    }
    c2c_callButtonTitle = c2c_callButton.title; // original call button title.

    c2c_remoteVideo = document.getElementById('c2c_remote_video');
    if (!c2c_remoteVideo) {
        c2c_ac_log('Fatal error: HTML missed video element id="c2c_remote_video"');
        return false;
    }
    c2c_status_line = document.getElementById('c2c_status_line');
    if (!c2c_status_line) {
        c2c_ac_log('Fatal error: HTML missed div id="c2c_status_line"');
        return false;
    }

    // Get HTML elements for call type 'user_control'
    c2c_videoSpan = document.getElementById('c2c_video_chk_span');
    c2c_videoCheckbox = document.getElementById('c2c_video_chk');
    c2c_cameraButton = document.getElementById('c2c_camera_btn');
    c2c_cameraLineSvg = document.getElementById('c2c_camera_line_svg');

    if (c2c_config.type === 'user_control') {
        if (!c2c_videoSpan) {
            c2c_ac_log('Fatal error: Call type is "user_control" and HTML missed span id="c2c_video_chk_span"');
            return false;
        }
        if (!c2c_videoCheckbox) {
            c2c_ac_log('Fatal error: Call type is "user_control" and HTML missed checkbox id="c2c_video_chk"');
            return false;
        }

        if (!c2c_cameraButton) {
            c2c_ac_log('Fatal error: Call type is "user_control" and HTML missed button id="c2c_camera_btn"');
            return false;
        }
        if (!c2c_cameraLineSvg) {
            c2c_ac_log('Fatal error: Call type is "user_control" and HTML missed svg id="c2c_camera_line_svg"');
            return false;
        }
    }

    return true;
}

// Use button interaction to enable sound
function c2c_buttonHandler(name, handler) {
    c2c_ac_log(`phone>> "${name}" onclick event`);
    if (!c2c_audioPlayer.isDisabled()) {
        handler();
        return;
    }
    c2c_ac_log('Let enable sound...');
    c2c_audioPlayer.enable()
        .then(() => {
            c2c_ac_log('Sound is enabled')
        })
        .catch((e) => {
            c2c_ac_log('Cannot enable sound', e);
        })
        .finally(() => {
            handler();
        });
}

// Get URL parameters
function c2c_getStrUrlParameter(name, defValue = null) {
    let s = window.location.search.split('&' + name + '=')[1];
    if (!s) s = window.location.search.split('?' + name + '=')[1];
    return s !== undefined ? decodeURIComponent(s.split('&')[0]) : defValue;
}

function c2c_getIntUrlParameter(name, defValue = null) {
    let s = window.location.search.split('&' + name + '=')[1];
    if (!s) s = window.location.search.split('?' + name + '=')[1];
    return s !== undefined ? parseInt(decodeURIComponent(s.split('&')[0])) : defValue;
}

// Filter for URL parameters values (e.g. to remove '-' characters)
function c2c_stringDropCharacters(text, removeChars) {
    let result = '';
    for (let c of text) {
        if (!removeChars.includes(c))
            result += c;
    }
    return result;
}

function c2c_timestamp() {
    let date = new Date();
    let h = date.getHours();
    let m = date.getMinutes();
    let s = date.getSeconds();
    let ms = date.getMilliseconds();
    return ((h < 10) ? '0' + h : h) + ':' + ((m < 10) ? '0' + m : m) + ':' + ((s < 10) ? '0' + s : s) + '.' + ('00' + ms).slice(-3) + ' ';
}

// Search server address in array of addresses
function c2c_searchServerAddress(addresses, searchAddress) {
    searchAddress = searchAddress.toLowerCase();
    for (let ix = 0; ix < addresses.length; ix++) {
        let data = addresses[ix]; // can be address or [address, priority]
        let address = data instanceof Array ? data[0] : data;
        if (address.toLowerCase() === searchAddress)
            return ix;
    }
    return -1;
}

function c2c_setConsoleLoggers() {
    let useColor = ['chrome', 'firefox', 'safari'].includes(c2c_phone.getBrowser());
    const log1 = function () {
        let args = [].slice.call(arguments);
        let firstArg = [c2c_timestamp() + '' + (useColor ? '%c' : '') + args[0]];
        if (useColor) firstArg = firstArg.concat(['color: BlueViolet;']);
        console.log.apply(console, firstArg.concat(args.slice(1)));
    };
    let log2 = function () {
        let args = [].slice.call(arguments);
        let firstArg = [c2c_timestamp() + args[0]];
        console.log.apply(console, firstArg.concat(args.slice(1)));
    };
    c2c_ac_log = log1;              // phone log
    c2c_phone.setAcLogger(log1);    // api log
    c2c_phone.setJsSipLogger(log2); // jssip log
}


// Connect to SBC server, don't send REGISTER
function c2c_initStack(account) {
    // restore previosly connected SBC after page reloading.
    if (c2c_restoreCall !== null) {
        let ix = c2c_searchServerAddress(c2c_serverConfig.addresses, c2c_restoreCall.address);
        if (ix !== -1) {
            c2c_ac_log('Page reloading, raise priority of previously connected server: "' + c2c_restoreCall.address + '"');
            c2c_serverConfig.addresses[ix] = [c2c_restoreCall.address, 1000];
        } else {
            c2c_ac_log('Cannot find previously connected server: ' + c2c_restoreCall.address + ' in configuration');
        }
    }
    c2c_phone.setServerConfig(c2c_serverConfig.addresses, c2c_serverConfig.domain, c2c_serverConfig.iceServers);
    c2c_phone.setAccount(account.user, account.displayName, account.password);
    c2c_phone.setWebSocketKeepAlive(c2c_config.pingInterval, c2c_config.pongTimeout, c2c_config.timerThrottlingBestEffort, c2c_config.pongReport, c2c_config.pongDist);

    // Set c2c_phone API listeners
    c2c_phone.setListeners({
        loginStateChanged: function (isLogin, cause) {
            switch (cause) {
                case 'connected':
                    c2c_ac_log('phone>>> loginStateChanged: connected');
                    c2c_isWsConnected = true;
                    if (c2c_activeCall !== null) {
                        c2c_ac_log('phone: active call exists (SBC might have switched over to secondary)');
                        break;
                    }
                    if (c2c_restoreCall !== null) {
                        c2c_ac_log('send INVITE with Replaces to restore call');
                        c2c_makeCall(c2c_restoreCall.callTo,
                            c2c_restoreCall.video === 'sendrecv' || c2c_restoreCall.video === 'sendonly' ? c2c_phone.VIDEO : c2c_phone.AUDIO
                            , ['Replaces: ' + c2c_restoreCall.replaces]);
                    } else if (c2c_isStartCall) {
                        c2c_startCall();
                    }
                    break;

                case 'disconnected':
                    c2c_ac_log('phone>>> loginStateChanged: disconnected');
                    c2c_isWsConnected = false;
                    if (c2c_phone.isInitialized()) {
                        if (c2c_sbcDisconnectCounter++ >= c2c_sbcDisconnectCounterMax && c2c_activeCall === null) {
                            c2c_ac_log('phone: too many disconnections.');
                            c2c_phone.deinit();
                            c2c_info('Cannot connect to SBC server');
                            c2c_gui_phoneBeforeCall();
                        }
                    }
                    break;

                default:
                    // other values are not used in click-to-call.
                    c2c_ac_log(`phone>>> loginStateChanged: ${cause}`);
                    break;
            }
        },

        outgoingCallProgress: function (call, response) {
            c2c_ac_log('phone>>> outgoing call progress');
            c2c_info('Ringing', true);
            c2c_audioPlayer.play(c2c_soundConfig.play.outgoingCallProgress);
        },

        callTerminated: function (call, message, cause, redirectTo) {
            c2c_ac_log(`phone>>> call terminated callback, cause=${cause}`);
            c2c_activeCall = null;
            if (cause === 'Redirected') {
                c2c_ac_log(`Redirect call to ${redirectTo}`);
                c2c_makeCall(redirectTo, c2c_videoOption());
                return;
            }

            c2c_audioPlayer.stop();
            let terminatedInfo = cause;  // '<span style="font-weight:bold">' + c2c_config.call + '</span> ' + cause;
            c2c_info(terminatedInfo, true);
            if (call.isOutgoing() && !call.wasAccepted()) {
                // Busy tone.
                c2c_audioPlayer.play(c2c_soundConfig.play.busy);
            } else {
                // Disconnect tone.
                c2c_audioPlayer.play(c2c_soundConfig.play.disconnect);
            }

            if (c2c_sbcDisconnectDelay === 0) {
                c2c_phone.deinit();
            } else {
                c2c_sbcDisconnectTimer = setTimeout(() => {
                    c2c_ac_log('The time interval between the end of the call and SBC disconnection is over');
                    c2c_phone.deinit();
                }, c2c_sbcDisconnectDelay * 1000);
            }

            c2c_gui_phoneBeforeCall();
            // Hide black rectangle after video call
            c2c_setRemoteVideoVisibility(false);
            c2c_restoreCall = null;
        },

        callConfirmed: async function (call, message, cause) {
            c2c_ac_log('phone>>> callConfirmed');
            c2c_audioPlayer.stop();

            // Display or hide remote video element
            c2c_setRemoteVideoVisibility(c2c_activeCall.hasReceiveVideo());

            c2c_gui_phoneDuringCall();

            c2c_info('Call is established', true);

            if (c2c_restoreCall !== null && c2c_restoreCall.hold.includes('remote')) {
                c2c_ac_log('Restore remote hold');
                c2c_info('Hold');
                c2c_activeCall.setRemoteHoldState();
            }
        },

        callShowStreams: function (call, localStream, remoteStream) {
            c2c_ac_log('phone>>> callShowStreams');
            c2c_audioPlayer.stop();
            c2c_remoteVideo.srcObject = remoteStream;
        },

        incomingCall: function (call, invite) {
            c2c_ac_log('phone>>> incomingCall');
            call.reject();
        },

        callHoldStateChanged: function (call, isHold, isRemote) {
            c2c_ac_log('phone>>> callHoldStateChanged');
            if (call.isRemoteHold()) {
                c2c_gui_phoneOnRemoteHold()
            } else {
                c2c_gui_phoneDuringCall();
            }
        },

        callIncomingReinvite: function (call, start, request) {
            if (start)
                return;
            // Display or hide remote video element
            c2c_setRemoteVideoVisibility(call.hasReceiveVideo());

            if (call.hasReceiveVideo() && !call.hasSendVideo() && c2c_hasCamera) {
                if (!call.hasEnabledSendVideo()) {
                    // Other side add video
                    c2c_info('You are invited to turn on your camera', true);
                } else {
                    c2c_ac_log('Other side disable receive video for video call');
                }
            }
        },

        incomingNotify: function (call, eventName, from, contentType, body, request) {
            c2c_ac_log(`phone>>> incoming NOTIFY "${eventName}"`, call, from, contentType, body);
        }
    });

    c2c_sbcDisconnectCounter = 0;

    // Other side allowed to add video for call type: 'video' or 'user_control'
    // call type 'audio' is limited to audio only.
    c2c_phone.setEnableAddVideo(c2c_config.type !== 'audio');
    c2c_phone.setNetworkPriority(c2c_config.networkPriority);
    c2c_phone.setModes(c2c_config.modes);
    c2c_phone.init(false);
}

// Prepare restore call after page reload.
function c2c_onBeforeUnload() {
    c2c_ac_log('phone>>> beforeunload event');
    if (c2c_phone === null || !c2c_phone.isInitialized())
        return;
    if (c2c_activeCall !== null) {
        if (c2c_activeCall.isEstablished()) {
            let data = {
                callTo: c2c_activeCall.data['_user'],
                video: c2c_activeCall.getVideoState(), // sendrecv, sendonly, recvonly, inactive
                replaces: c2c_activeCall.getReplacesHeader(),
                time: new Date().getTime(),
                hold: `${c2c_activeCall.isLocalHold() ? 'local' : ''}${c2c_activeCall.isRemoteHold() ? 'remote' : ''}`,
                address: c2c_phone.getServerAddress()
            }
            sessionStorage.setItem('c2c_restoreCall', JSON.stringify(data));
        } else {
            c2c_activeCall.terminate(); // send BYE or CANCEL
        }
    }
}

function c2c_videoOption() {
    if (!c2c_hasCamera)
        return c2c_phone.AUDIO;
    switch (c2c_config.type) {
        case 'audio':
            return c2c_phone.AUDIO;
        case 'video':
            return c2c_phone.VIDEO;
        case 'user_control':
            return c2c_videoCheckbox.checked ? c2c_phone.VIDEO : c2c_phone.AUDIO;
        default:
            c2c_ac_log(`Warning: c2c_videoOption(): Illegal value of c2c_config.type Used: 'audio'`);
            return c2c_phone.AUDIO;
    }
}

function c2c_cameraToggle() {
    c2c_ac_log('c2c_cameraToggle()');
    c2c_info('');
    if (!c2c_activeCall.hasEnabledSendVideo()) {
        if (c2c_cameraButton) c2c_cameraButton.disabled = true;
        c2c_activeCall.startSendingVideo()
            .then(() => {
                c2c_gui_phoneDuringCall();
                c2c_setRemoteVideoVisibility(c2c_activeCall.hasReceiveVideo());
            })
            .catch((e) => {
                c2c_ac_log('c2c error during start video', e);
            })
            .finally(() => {
                if (c2c_cameraButton)
                    c2c_cameraButton.disabled = false;
            });
    } else {
        c2c_activeCall.stopSendingVideo()
            .then(() => {
                c2c_gui_phoneDuringCall();
                c2c_setRemoteVideoVisibility(c2c_activeCall.hasReceiveVideo());
            })
            .catch((e) => {
                c2c_ac_log('stop sending video failure', e);
            })
            .finally(() => {
                if (c2c_cameraButton)
                    c2c_cameraButton.disabled = false;
            });
    }
}

async function c2c_call() {
    if (c2c_sbcDisconnectTimer !== null) {
        clearTimeout(c2c_sbcDisconnectTimer);
        c2c_sbcDisconnectTimer = null;
    }

    c2c_isStartCall = true;
    c2c_audioPlayer.stop();

    c2c_gui_phoneCalling();

    if (!c2c_phone.isInitialized()) {
        try {
            // the call will start when the sbc is connected
            await c2c_sbc_connect_sequence();
        } catch (e) {
            c2c_ac_log('phone initialization or SBC connecting error:', e);
            c2c_info(e);
            c2c_gui_phoneBeforeCall();
        }
    } else if (c2c_isWsConnected) {
        c2c_startCall();
    } else {
        c2c_ac_log('SIP is already initialized. websocket is disconnected. Wait connection...');
    }
}

async function c2c_sbc_connect_sequence() {
    c2c_info('Connecting');
    c2c_initStack({ user: c2c_config.caller, displayName: c2c_config.callerDN, password: '' });
}

function c2c_startCall() {
    c2c_isStartCall = false;
    c2c_makeCall(c2c_config.call, c2c_videoOption());
}

function c2c_makeCall(callTo, videoMode, extraHeaders = []) {
    let extraOptions = {};
    if (c2c_activeCall !== null)
        throw 'Already exists active call';
    c2c_info('Calling', true);
    c2c_activeCall = c2c_phone.call(videoMode, callTo, extraHeaders, extraOptions);
}

function c2c_hangupCall() {
    if (c2c_activeCall !== null) {
        c2c_activeCall.terminate();
        c2c_activeCall = null;
    }
}

function c2c_setRemoteVideoVisibility(isVisible) {
    let vs = c2c_remoteVideo.style;
    vs.display = 'block';
    if (isVisible) {
        vs.width = c2c_config.videoSize.width;
        vs.height = c2c_config.videoSize.height;
    } else {
        vs.width = vs.height = 0;
    }
}

// Display message, and optionally clean it after delay.
function c2c_info(text, clear = false) {
    c2c_status_line.innerHTML = text;
    c2c_status_line.dataset.id = ++c2c_messageId;
    if (clear) {
        (function (id) {
            setTimeout(() => {
                if (c2c_status_line.dataset.id === id) {
                    c2c_status_line.innerHTML = '';
                }
            }, c2c_config.messageDisplayTime * 1000);
        })(c2c_status_line.dataset.id);
    }
}

/*
   Web Designer should customize the code to define HTML elements representation:
    1. phone disabled
    2. before call
    3. when calling
    4. during call   
    5. call on remote hold    
 */
function c2c_gui_phoneDisabled(msg) {
    c2c_ac_log(msg);
    c2c_callButton.disabled = true;
    document.querySelector('#c2c_call_btn svg').setAttribute('class', 'c2c_call_svg_disabled')
    c2c_widgetDiv.className = 'c2c_widget_disabled';
}

function c2c_gui_phoneBeforeCall() {
    // Show call button
    c2c_callButton.style.display = 'inline-block';
    c2c_callButton.disabled = false;
    c2c_callButton.className = 'c2c_call_btn_ready';
    c2c_callButton.querySelector('span').innerText = 'Call';
    c2c_callButton.querySelector('svg').setAttribute('class', 'c2c_call_svg_ready');
    c2c_callButton.title = c2c_callButtonTitle;
    // Call button handler
    c2c_callButtonHandler = function () { c2c_call(); }

    // Show audio/video checkbox
    if (c2c_videoSpan) {
        let showVideoCheckbox = c2c_config.type === 'user_control' && c2c_hasCamera;
        c2c_videoSpan.style.display = showVideoCheckbox ? 'inline-block' : 'none';

        if (c2c_videoCheckbox) {
            c2c_videoCheckbox.checked = c2c_config.videoCheckboxDefault;
        }
    }

    // Hide camera button
    if (c2c_cameraButton) {
        c2c_cameraButton.style.display = 'none';
        if (c2c_cameraLineSvg) {
            c2c_cameraButton.style.display = 'none';
        }
    }
}

function c2c_gui_phoneCalling() {
    // Modify call button look (to hangup)
    c2c_callButton.className = 'c2c_call_btn_hangup';
    c2c_callButton.querySelector('span').innerText = 'Hangup';
    c2c_callButton.title = 'Hang up';
    c2c_callButton.querySelector('svg').setAttribute('class', 'c2c_call_svg_calling');
    c2c_callButton.querySelector('svg').setAttribute('class', 'c2c_call_svg_calling');
    // Set the button handler to hangup.
    c2c_callButtonHandler = c2c_hangupCall;

    if (c2c_videoSpan) {
        c2c_videoSpan.style.display = 'none';
    }
}

function c2c_gui_phoneOnRemoteHold() {
    c2c_ac_log('phone on remote hold');
}

function c2c_gui_phoneDuringCall() {
    if (c2c_videoSpan) {
        c2c_videoSpan.style.display = 'none';
    }
    c2c_callButton.querySelector('svg').setAttribute('class', 'c2c_call_svg_hangup');

    if (c2c_config.type === 'user_control' && c2c_hasCamera) {
        if (c2c_cameraButton && c2c_cameraLineSvg) {
            c2c_cameraButton.style.display = 'inline-block';
            c2c_cameraButton.title = c2c_activeCall.hasEnabledSendVideo() ? 'turn camera off' : 'turn camera on';
            c2c_cameraLineSvg.setAttribute('class', c2c_activeCall.hasEnabledSendVideo() ? 'c2c_camera_on' : 'c2c_camera_off');
        }
    }
}

// Start phone
c2c_init();
