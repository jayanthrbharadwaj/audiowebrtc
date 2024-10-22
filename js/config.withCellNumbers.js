let c2c_serverConfig = {
     domain: "ngseltdiemtw.sip1-region2.audiocodes.io",
    //domain: 'audiocodes.com',              // SBC domain name, used to build SIP headers From/To
    //domain: '_take_value_from_url_',          // Get it from URL 'domain' parameter.

    addresses: ["wss://ngseltdiemtw.sip1-region2.audiocodes.io"],
    //addresses: ['wss://example.sbc.com'],  // AudioCodes SBC secure web socket URL (can be multiple)
    //addresses: '_take_value_from_url_',       // Get it from URL 'server' parameter.

    iceServers: [],                           // Optional STUN or TURN servers.
};

let c2c_config = {
    // Call
    call: '+789', // +789 will call UNFCU Hotline. Call to this user name (or phone number). Special value: '_take_value_from_url_' to set the value from URL 'call' parameter
    caller: 'Anonymous', // Caller user name (One word according SIP RFC 3261). 
    callerDN: 'Anonymous', // Caller display name (words sequence).
    type: 'user_control',   // Call type: 'audio', 'video' or 'user_control'
    videoCheckboxDefault: false, // For 'user_control' call, default value of video checkbox.
    //videoSize: { width: '400px', height: '300px' }, // video size (a little smaller)
    videoSize: { width: '480px', height: '360px' }, // video size (a little bigger)
    callAutoStart: 'no',  // Start call automatically after page loading. Values: 'yes' (start if autoplay policy enabled) 'yes force' (start always), 'no' (don't start call automatically)                                      
    messageDisplayTime: 5, // A message will be displayed during this time (seconds).
    restoreCallMaxDelay: 20, // After page reloading, call can be restored within the time interval (seconds).
    networkPriority: undefined, // Sending RTP DSCP network priority: undefined (don't change) or 'high', 'medium', 'low', 'very-low'. Supported only in Chrome.
    
    // Websocket keep alive.
    pingInterval: 10,          // Keep alive ping interval,  0 value means don't send pings. (seconds)
    pongTimeout: true,         // Close and reopen websocket when pong timeout detected
    timerThrottlingBestEffort: true, // Action if timer throttling detected (for Chrome increase ping interval)
    pongReport: 60,       // if 0 not print, otherwise each N pongs print min and max pong delay 
    pongDist: false,      // Print to console log also pong delay distribution.    

    // SDK modes. 
    modes: {
        ice_timeout_fix: 2000,             // ICE gathering timeout (milliseconds)
        chrome_rtp_timeout_fix: 13,        // Workaround of https://bugs.chromium.org/p/chromium/issues/detail?id=982793
    }
};

let c2c_soundConfig = {
    generateTones: {
        ringingTone: [{ f: 400, t: 1.5 }, { t: 3.5 }],
        busyTone: [{ f: 400, t: 0.5 }, { t: 0.5 }],
        disconnectTone: [{ f: 400, t: 0.5 }, { t: 0.5 }],
    },

    play: {
        outgoingCallProgress: { name: 'ringingTone', loop: true, volume: 0.2 },
        busy: { name: 'busyTone', volume: 0.2, repeat: 4 },
        disconnect: { name: 'disconnectTone', volume: 0.2, repeat: 3 },
    },
};
