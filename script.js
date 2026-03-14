const SYMBOLS = {
    BIG: { id: 0, class: 'seven', name: '7', payout: 312 },
    REG: { id: 1, class: 'bar', name: 'BAR', payout: 104 },
    BELL: { id: 2, class: 'bell', name: '🔔', payout: 4 },
    CHERRY: { id: 3, class: 'cherry', name: '🍒', payout: 2 },
    REPLAY: { id: 4, class: 'replay', name: 'REP', payout: 0 },
    GRAPE: { id: 5, class: 'grape', name: '🍇', payout: 7 }
};

// Simplified Juggler-like reel arrays (21 symbols)
const REEL_ARRAYS = [
    // Reel 0 (Left)
    [0, 5, 2, 4, 5, 3, 2, 5, 4, 5, 0, 5, 2, 4, 5, 1, 2, 5, 4, 5, 1],
    // Reel 1 (Center)
    [5, 4, 2, 0, 5, 3, 4, 1, 5, 2, 4, 5, 0, 4, 2, 5, 1, 4, 3, 5, 2],
    // Reel 2 (Right)
    [2, 5, 4, 1, 2, 5, 0, 4, 5, 2, 3, 4, 5, 1, 2, 4, 5, 0, 4, 5, 2]
];

// Roles (Sync with SYMBOLS.id for consistency)
const ROLES = {
    BLANK: -1,
    BIG: 0,
    REG: 1,
    BELL: 2,
    CHERRY: 3,
    REPLAY: 4,
    GRAPE: 5,
    BAR_RARE: 7
};

// --- Web Audio API Sound System ---
class SoundFX {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.enabled = false;
        this.spinOsc = null;
    }

    playTone(freq, type, duration, vol = 0.1) {
        if (!this.enabled) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }

    coin() { this.playTone(1200, 'sine', 0.1, 0.2); }
    bet() { this.playTone(800, 'square', 0.1, 0.05); }
    lever() { this.playTone(300, 'triangle', 0.1, 0.2); }
    stop() { this.playTone(150, 'square', 0.05, 0.2); }
    gogo() {
        if (!this.enabled) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(50, this.ctx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.5, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.3);
    }

    startSpin() {
        if (!this.enabled) return;
        if (this.spinOsc) this.stopSpin();
        this.spinOsc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        this.spinOsc.type = 'triangle';
        this.spinOsc.frequency.setValueAtTime(80, this.ctx.currentTime);
        gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
        this.spinOsc.connect(gain);
        gain.connect(this.ctx.destination);
        this.spinOsc.start();
    }

    stopSpin() {
        if (this.spinOsc) {
            this.spinOsc.stop();
            this.spinOsc = null;
        }
    }

    payout() {
        if (!this.enabled) return;
        let time = this.ctx.currentTime;
        for (let i = 0; i < 5; i++) {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.frequency.setValueAtTime(1200 + (Math.random() * 400), time);
            gain.gain.setValueAtTime(0.1, time);
            gain.gain.exponentialRampToValueAtTime(0.01, time + 0.1);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(time);
            osc.stop(time + 0.1);
            time += 0.08;
        }
    }

    bonus() {
        if (!this.enabled) return;
        let time = this.ctx.currentTime;
        const notes = [440, 554, 659, 880];
        notes.forEach((freq, i) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(freq, time);
            gain.gain.setValueAtTime(0.1, time);
            gain.gain.exponentialRampToValueAtTime(0.01, time + 0.15);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(time);
            osc.stop(time + 0.15);
            time += 0.15;
        });
    }
}
const sfx = new SoundFX();

// Game State
let gameState = {
    yen: 10000,
    credits: 0,
    bet: 0,
    spins: 0,
    bigs: 0,
    regs: 0,
    payoutDisplay: 0, // Used to show last won amount in bet indicator

    internalBonus: null, // null: None, 1: REG, 0: BIG (Must use null because BIG is 0)
    currentRole: ROLES.BLANK, // Role selected for current spin

    spinning: [false, false, false],
    stopping: [false, false, false],
    reelPos: [0, 0, 0], // floating point offset
    reelStopPos: [-1, -1, -1], // target index stops
    active: false,

    gogoLit: false
};

const SYMBOL_HEIGHT = 60;
const REEL_LENGTH = 21;
const SPIN_SPEED = 0.25; // symbols per frame (slowed down)
const MAX_SLIP = 8; // Maximum allowed slip (frames) - increased from 4 for easier play

// DOM Elements
const els = {
    yen: document.getElementById('yen-count'),
    credits: document.getElementById('credit-count'),
    creditsDisplay: document.getElementById('credit-count-display'),
    big: document.getElementById('big-count'),
    reg: document.getElementById('reg-count'),
    games: document.getElementById('games-count'),
    betInd: document.getElementById('bet-indicator'),
    msg: document.getElementById('message-area'),
    gogo: document.getElementById('gogo-lamp'),

    btnDispense: document.getElementById('dispense-btn'),
    btnExchange: document.getElementById('exchange-btn'),
    btnSoundToggle: document.getElementById('sound-toggle-btn'),
    btnDebugToggle: document.getElementById('debug-toggle-btn'),
    btnBet: document.getElementById('max-bet-btn'),
    btnSpin: document.getElementById('spin-btn'),
    debugPanel: document.getElementById('debug-panel'),
    debugFlag: document.getElementById('debug-flag'),
    debugGogo: document.getElementById('debug-gogo'),
    btnStops: [
        document.getElementById('stop-0'),
        document.getElementById('stop-1'),
        document.getElementById('stop-2')
    ],

    reels: [
        document.getElementById('reel-0'),
        document.getElementById('reel-1'),
        document.getElementById('reel-2')
    ]
};

// Keyboard bindings (Shift: Bet, Ctrl: Spin, Space: Stop nearest spinning)
document.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') {
        els.btnBet.click();
    } else if (e.key === 'Control') {
        els.btnSpin.click();
    } else if (e.key === ' ') {
        // Space bar stops the first spinning reel
        for (let i = 0; i < 3; i++) {
            if (gameState.spinning[i] && !gameState.stopping[i]) {
                stopReel(i);
                break;
            }
        }
        e.preventDefault(); // Prevent page scroll
    }
});

els.btnSoundToggle.addEventListener('click', () => {
    sfx.enabled = !sfx.enabled;
    if (sfx.enabled) {
        sfx.ctx.resume(); // Required by browsers to unlock AudioContext
        els.btnSoundToggle.innerText = "サウンド: ON";
        els.btnSoundToggle.style.background = "#225522";
        sfx.coin();
    } else {
        els.btnSoundToggle.innerText = "サウンド: OFF";
        els.btnSoundToggle.style.background = "#552222";
        sfx.stopSpin();
    }
});

els.btnDebugToggle.addEventListener('click', () => {
    const isHidden = els.debugPanel.style.display === 'none';
    if (isHidden) {
        els.debugPanel.style.display = 'block';
        els.btnDebugToggle.innerText = "開発者モード: ON";
        els.btnDebugToggle.style.background = "#222255";
    } else {
        els.debugPanel.style.display = 'none';
        els.btnDebugToggle.innerText = "開発者モード: OFF";
        els.btnDebugToggle.style.background = "#444";
    }
});

function updateDebug() {
    const sym = Object.values(SYMBOLS).find(s => s.id === gameState.currentRole);
    const flagNames = { 7: "BAR揃い", [-1]: "BLANK" };
    els.debugFlag.innerText = sym ? sym.name : (flagNames[gameState.currentRole] || "BLANK");
    els.debugGogo.innerText = (gameState.internalBonus !== null) ? "ON" : "OFF";
}

// Initialization
function initReels() {
    for (let r = 0; r < 3; r++) {
        els.reels[r].innerHTML = '';
        // Create 2 sets of symbols + 3 extra for smooth scrolling visual (wrapping)
        const totalVisSymbols = REEL_LENGTH * 2 + 5;
        for (let i = 0; i < totalVisSymbols; i++) {
            const symId = REEL_ARRAYS[r][i % REEL_LENGTH];
            const symDef = Object.values(SYMBOLS).find(s => s.id === symId);
            const div = document.createElement('div');
            div.className = `symbol ${symDef.class}`;
            div.textContent = symDef.name;
            els.reels[r].appendChild(div);
        }
    }
    updateUI();
}

function updateUI() {
    els.yen.innerText = gameState.yen.toLocaleString();
    els.credits.innerText = gameState.credits;
    if (els.creditsDisplay) els.creditsDisplay.innerText = gameState.credits;
    els.big.innerText = gameState.bigs;
    els.reg.innerText = gameState.regs;
    els.games.innerText = gameState.spins;
    // Show payout only if it exists, otherwise remain dark/empty
    els.betInd.innerText = gameState.payoutDisplay > 0 ? gameState.payoutDisplay : "";

    if (gameState.gogoLit) els.gogo.classList.add('on');
    else els.gogo.classList.remove('on');

    updateDebug();
}

function msg(text) {
    els.msg.innerText = text;
}

// Economy Actions
els.btnDispense.addEventListener('click', () => {
    if (gameState.yen >= 1000) {
        gameState.yen -= 1000;
        gameState.credits += 46;
        sfx.coin();
        updateUI();
        msg("1000円分（46枚）クレジットを借りました。");
    } else {
        msg("所持金が足りません。");
    }
});

els.btnExchange.addEventListener('click', () => {
    if (gameState.credits >= 52) {
        const bundles = Math.floor(gameState.credits / 52);
        const exchangedCredits = bundles * 52;
        const yenGain = bundles * 1000;

        gameState.credits -= exchangedCredits;
        gameState.yen += yenGain;
        sfx.coin();
        updateUI();
        msg(`${exchangedCredits}クレジットを${yenGain}円に交換しました。`);
    } else {
        msg("交換にはクレジットが最低52枚必要です。");
    }
});

// Game Actions
els.btnBet.addEventListener('click', () => {
    if (gameState.active || gameState.spinning.some(s => s)) return;
    if (gameState.bet >= 3) {
        msg("既に3枚掛けされています。");
        return;
    }

    if (gameState.credits >= 3) {
        gameState.bet = 3;
        gameState.credits -= 3;
        sfx.bet();
        gameState.payoutDisplay = 0; // Reset payout display when new bet is placed
        updateUI();
    } else {
        msg("クレジットが足りません。貸出ボタンを押してください。");
    }
});

els.btnSpin.addEventListener('click', () => {
    if (gameState.active || gameState.bet < 3) return;
    startSpin();
});

function startSpin() {
    gameState.active = true;
    gameState.spins++;
    gameState.payoutDisplay = 0; // Reset payout display at start of spin
    sfx.lever();
    setTimeout(() => sfx.startSpin(), 100);

    // Lottery
    // Lottery
    lottery();

    // Turn on GOGO Lamp if bonus triggers this spin (pre-notification)
    // Or if BAR_RARE was selected (BAR_RARE itself is a lottery within lottery)
    if ((gameState.internalBonus !== null) && !gameState.gogoLit) {
        // 25% chance of pre-notification for Juggler style, but only if NOT BAR_RARE
        if (gameState.currentRole !== ROLES.BAR_RARE && Math.random() < 0.25) {
            gameState.gogoLit = true;
            sfx.gogo();
        }
    }

    updateUI();
    msg("回転中... ストップボタンを押してね。(キー: SPACE)");

    for (let i = 0; i < 3; i++) {
        gameState.spinning[i] = true;
        gameState.stopping[i] = false;
        gameState.reelStopPos[i] = -1;
        els.btnStops[i].classList.add('active');
    }

    requestAnimationFrame(spinLoop);
}

// Pre-define probabilities
function lottery() {
    const rnd = Math.random() * 65536;
    let role = ROLES.BLANK;

    if (rnd < 8978) role = ROLES.REPLAY; // ~1/7.3
    else if (rnd < 19200) role = ROLES.BELL; // ~1/6.4
    else if (rnd < 29000) role = ROLES.GRAPE; // ~1/6.5
    else if (rnd < 30300) role = ROLES.CHERRY; // ~1/50
    else if (rnd < 30364) {
        role = ROLES.BAR_RARE;
    }
    else {
        if (gameState.internalBonus === null) {
            if (rnd < 30637) role = ROLES.BIG; // ~1/240
            else if (rnd < 30829) role = ROLES.REG; // ~1/340
        }
    }

    if (role === ROLES.BIG || role === ROLES.REG || role === ROLES.BAR_RARE) {
        if (gameState.internalBonus === null) {
            if (role === ROLES.BAR_RARE) {
                gameState.internalBonus = Math.random() < 0.6 ? ROLES.BIG : ROLES.REG;
            } else {
                gameState.internalBonus = role;
            }
        }
    }

    // If internal bonus is active, and no other role hit (role is still BLANK)
    // We MUST set currentRole to internalBonus so that the slippage logic (stopReel)
    // actually tries to pull the bonus symbols in.
    if (gameState.internalBonus !== null && role === ROLES.BLANK) {
        role = gameState.internalBonus;
    }

    gameState.currentRole = role;
    updateDebug();
}

// Stopping logic
els.btnStops.forEach((btn, r) => {
    btn.addEventListener('click', () => {
        if (gameState.spinning[r] && !gameState.stopping[r]) {
            stopReel(r);
        }
    });
});

function formsAnyWin(stop0, stop1, stop2) {
    if (stop0 !== -1) {
        let leftTop = getSymbol(0, stop0 - 1);
        let leftCenter = getSymbol(0, stop0);
        let leftBottom = getSymbol(0, stop0 + 1);
        if (leftTop === SYMBOLS.CHERRY.id || leftCenter === SYMBOLS.CHERRY.id || leftBottom === SYMBOLS.CHERRY.id) {
            return true;
        }
    }

    if (stop0 !== -1 && stop1 !== -1 && stop2 !== -1) {
        const matrix = [
            [getSymbol(0, stop0 - 1), getSymbol(1, stop1 - 1), getSymbol(2, stop2 - 1)],
            [getSymbol(0, stop0), getSymbol(1, stop1), getSymbol(2, stop2)],
            [getSymbol(0, stop0 + 1), getSymbol(1, stop1 + 1), getSymbol(2, stop2 + 1)]
        ];
        const lines = [
            [matrix[1][0], matrix[1][1], matrix[1][2]],
            [matrix[0][0], matrix[0][1], matrix[0][2]],
            [matrix[2][0], matrix[2][1], matrix[2][2]],
            [matrix[0][0], matrix[1][1], matrix[2][2]],
            [matrix[2][0], matrix[1][1], matrix[0][2]]
        ];
        for (let line of lines) {
            if (line[0] === line[1] && line[1] === line[2]) {
                if (line[0] !== SYMBOLS.CHERRY.id) return true;
            }
            // Check REG (7-7-BAR)
            if (line[0] === SYMBOLS.BIG.id && line[1] === SYMBOLS.BIG.id && line[2] === SYMBOLS.REG.id) return true;
        }
    }
    return false;
}

function findSafeSlip(r, centerIdx) {
    for (let slip = 0; slip <= MAX_SLIP; slip++) {
        const targetCenter = (centerIdx - slip + REEL_LENGTH) % REEL_LENGTH;
        let s0 = r === 0 ? targetCenter : gameState.reelStopPos[0];
        let s1 = r === 1 ? targetCenter : gameState.reelStopPos[1];
        let s2 = r === 2 ? targetCenter : gameState.reelStopPos[2];

        if (!formsAnyWin(s0, s1, s2)) {
            return slip;
        }
    }
    return 0; // fallback
}

function stopReel(r) {
    gameState.stopping[r] = true;
    els.btnStops[r].classList.remove('active');
    sfx.stop();

    const currentIdxFloat = (gameState.reelPos[r] / SYMBOL_HEIGHT);
    const centerIdx = Math.floor(currentIdxFloat) + 1; // current center-ish

    let bestSlip = 0;

    // If role is CHERRY, priority to align cherry on Reel 0
    if (gameState.currentRole === ROLES.CHERRY && r === 0) {
        bestSlip = findSlipToSymbol(r, centerIdx, SYMBOLS.CHERRY.id, REEL_LENGTH);
    }
    else if (gameState.currentRole === ROLES.BIG) {
        bestSlip = findSlipToSymbol(r, centerIdx, SYMBOLS.BIG.id, MAX_SLIP);
    }
    else if (gameState.currentRole === ROLES.REG) {
        // REG: 7-7-BAR (4 frame slip limit)
        if (r === 0 || r === 1) bestSlip = findSlipToSymbol(r, centerIdx, SYMBOLS.BIG.id, MAX_SLIP);
        else bestSlip = findSlipToSymbol(r, centerIdx, SYMBOLS.REG.id, MAX_SLIP);
    }
    else if (gameState.currentRole === ROLES.BAR_RARE) {
        // BAR_RARE: BAR-BAR-BAR (Unlimited slip)
        bestSlip = findSlipToSymbol(r, centerIdx, SYMBOLS.REG.id, REEL_LENGTH);
    }
    else if (gameState.currentRole === ROLES.REPLAY) {
        bestSlip = findSlipToSymbol(r, centerIdx, SYMBOLS.REPLAY.id, REEL_LENGTH);
    }
    else if (gameState.currentRole === ROLES.BELL) {
        bestSlip = findSlipToSymbol(r, centerIdx, SYMBOLS.BELL.id, REEL_LENGTH);
    }
    else if (gameState.currentRole === ROLES.GRAPE) {
        bestSlip = findSlipToSymbol(r, centerIdx, SYMBOLS.GRAPE.id, REEL_LENGTH);
    }
    else {
        bestSlip = findSafeSlip(r, centerIdx);
    }

    const targetIdx = (centerIdx - bestSlip + REEL_LENGTH) % REEL_LENGTH;
    gameState.reelStopPos[r] = targetIdx;
}

function findSlipToSymbol(r, centerIdx, symbolId, limit) {
    // Priority: center line, then any line, then any visible (fallback)
    const positions = [0, -1, 1]; // center, top, bottom
    for (let pos of positions) {
        for (let slip = 0; slip <= limit; slip++) {
            const targetCenter = (centerIdx - slip + REEL_LENGTH) % REEL_LENGTH;
            if (getSymbol(r, targetCenter + pos) === symbolId) {
                return slip;
            }
        }
    }
    return findSafeSlip(r, centerIdx);
}

function getSymbol(r, index) {
    return REEL_ARRAYS[r][(index + REEL_LENGTH) % REEL_LENGTH];
}

function spinLoop() {
    let allStopped = true;
    for (let r = 0; r < 3; r++) {
        if (gameState.spinning[r]) {
            allStopped = false;

            if (gameState.stopping[r] && gameState.reelStopPos[r] !== -1) {
                // Determine target pixel pos
                const targetY = ((gameState.reelStopPos[r] - 1 + REEL_LENGTH) % REEL_LENGTH) * SYMBOL_HEIGHT;

                // Jump to target visually if close
                let diff = (gameState.reelPos[r] - targetY + REEL_LENGTH * SYMBOL_HEIGHT) % (REEL_LENGTH * SYMBOL_HEIGHT);

                if (diff < SYMBOL_HEIGHT * SPIN_SPEED) {
                    gameState.reelPos[r] = targetY;
                    gameState.spinning[r] = false;
                } else {
                    gameState.reelPos[r] -= SYMBOL_HEIGHT * SPIN_SPEED;
                }
            } else {
                gameState.reelPos[r] -= SYMBOL_HEIGHT * SPIN_SPEED;
            }

            if (gameState.reelPos[r] < 0) {
                gameState.reelPos[r] += REEL_LENGTH * SYMBOL_HEIGHT;
            }

            // Render
            const drawPos = gameState.reelPos[r];
            els.reels[r].style.transform = `translateY(-${drawPos}px)`;
        }
    }

    if (!allStopped) {
        requestAnimationFrame(spinLoop);
    } else {
        sfx.stopSpin();
        checkWin();
    }
}

function checkWin() {
    gameState.active = false;

    // GOGO lamp notification logic (move to top for consistent state)
    if (gameState.internalBonus !== null && !gameState.gogoLit) {
        gameState.gogoLit = true;
        sfx.gogo();
    }

    // Prepare matrix and lines
    const matrix = [
        [getSymbol(0, gameState.reelStopPos[0] - 1), getSymbol(1, gameState.reelStopPos[1] - 1), getSymbol(2, gameState.reelStopPos[2] - 1)], // top
        [getSymbol(0, gameState.reelStopPos[0]), getSymbol(1, gameState.reelStopPos[1]), getSymbol(2, gameState.reelStopPos[2])],       // center
        [getSymbol(0, gameState.reelStopPos[0] + 1), getSymbol(1, gameState.reelStopPos[1] + 1), getSymbol(2, gameState.reelStopPos[2] + 1)]  // bottom
    ];

    const lines = [
        [matrix[1][0], matrix[1][1], matrix[1][2]], // Center
        [matrix[0][0], matrix[0][1], matrix[0][2]], // Top
        [matrix[2][0], matrix[2][1], matrix[2][2]], // Bottom
        [matrix[0][0], matrix[1][1], matrix[2][2]], // Cross down
        [matrix[2][0], matrix[1][1], matrix[0][2]]  // Cross up
    ];

    let payout = 0;
    let wonRole = null;
    let bonusHit = false;

    // 1. Check for Bonus (BIG/REG) - HIGHEST PRIORITY
    for (let line of lines) {
        // BIG (7-7-7)
        if (line[0] === SYMBOLS.BIG.id && line[1] === SYMBOLS.BIG.id && line[2] === SYMBOLS.BIG.id) {
            payout = SYMBOLS.BIG.payout;
            wonRole = "777";
            gameState.internalBonus = null;
            gameState.bigs++;
            gameState.gogoLit = false;
            gameState.spins = 0;
            msg("BIG BONUS!!");
            sfx.bonus();
            bonusHit = true;
            break;
        }
        // REG (7-7-BAR)
        if (line[0] === SYMBOLS.BIG.id && line[1] === SYMBOLS.BIG.id && line[2] === SYMBOLS.REG.id) {
            payout = SYMBOLS.REG.payout;
            wonRole = "77BAR";
            gameState.internalBonus = null;
            gameState.regs++;
            gameState.gogoLit = false;
            gameState.spins = 0;
            msg("REGULAR BONUS!");
            sfx.bonus();
            bonusHit = true;
            break;
        }
    }

    // 2. If no Bonus, check for Rare BAR
    if (!bonusHit) {
        for (let line of lines) {
            if (line[0] === SYMBOLS.REG.id && line[1] === SYMBOLS.REG.id && line[2] === SYMBOLS.REG.id) {
                payout = 12;
                wonRole = "BAR揃い";
                msg("レア役 BAR揃い！");
                sfx.payout();

                // BAR揃い is guaranteed GOGO (internalBonus is already set in lottery, but we'll light it up here)
                setTimeout(() => {
                    if (!gameState.gogoLit) {
                        gameState.gogoLit = true;
                        sfx.gogo();
                        updateUI();
                    }
                }, 500);
                bonusHit = true;
                break;
            }
        }
    }

    // 3. If no Bonus/Rare, check for Small Roles
    if (!bonusHit) {
        for (let line of lines) {
            if (line[0] === line[1] && line[1] === line[2]) {
                const sym = Object.values(SYMBOLS).find(s => s.id === line[0]);
                if (sym && sym.id !== SYMBOLS.CHERRY.id && sym.id !== SYMBOLS.BIG.id && sym.id !== SYMBOLS.REG.id) {
                    payout = sym.payout;
                    wonRole = sym.name;
                    if (sym.id === SYMBOLS.REPLAY.id) {
                        wonRole = "REPLAY";
                        gameState.bet = 3;
                        msg("REPLAY");
                    } else {
                        msg(`当り！ ${wonRole} / ${payout}枚払い出し`);
                    }
                    sfx.payout();
                    bonusHit = true;
                    break;
                }
            }
        }
    }

    // 4. If nothing else, check for Cherry on Left
    if (!bonusHit) {
        if (matrix[0][0] === SYMBOLS.CHERRY.id || matrix[1][0] === SYMBOLS.CHERRY.id || matrix[2][0] === SYMBOLS.CHERRY.id) {
            payout = SYMBOLS.CHERRY.payout;
            wonRole = "CHERRY";
            msg(`当り！ ${wonRole} / ${payout}枚払い出し`);
            sfx.payout();
            bonusHit = true;

            // 1/10 Chance for GOGO on next game (setting internalBonus now)
            if (gameState.internalBonus === null && Math.random() < 0.1) {
                gameState.internalBonus = Math.random() < 0.6 ? ROLES.BIG : ROLES.REG;
                setTimeout(() => {
                    if (!gameState.gogoLit) {
                        gameState.gogoLit = true;
                        sfx.gogo();
                        updateUI();
                    }
                }, 500);
            }
        }
    }

    gameState.payoutDisplay = payout;

    if (payout > 0) {
        if (wonRole !== "REPLAY") {
            gameState.credits += payout;
        }
    } else if (wonRole !== "REPLAY") {
        gameState.bet = 0;
    }

    updateUI();
}

initReels();
