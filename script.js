const CONFIG = {
    SYMBOL_HEIGHT: 60,
    REEL_LENGTH: 21,
    SPIN_SPEED: 0.25, // symbols per frame
    MAX_SLIP_FRAMES: 8, // Maximum allowed slip (frames)
    BONUS_GRAPE_PAYOUT: 24,
    BONUS_GAME_COUNTS: {
        BIG: 12, // Number of wins
        REG: 6
    }
};

const SYMBOLS = {
    BIG: { id: 0, class: 'seven', name: '7', payout: 0 },
    REG: { id: 1, class: 'bar', name: 'BAR', payout: 0 },
    BELL: { id: 2, class: 'bell', name: '🔔', payout: 12 },
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

// Roles (Sync with SYMBOLS.id for consistency where possible, negative for blanks/special)
const ROLES = {
    BLANK: -1,
    BIG: 0,
    REG: 1,
    BELL: 2,
    CHERRY: 3,
    REPLAY: 4,
    GRAPE: 5,
    BAR_RARE: 7,
    FREEZE: 99 // Special flag for premium freeze
};

// 確率テーブル化 (Weights out of 65536)
const LOTTERY_TABLE = {
    NORMAL: [
        { role: ROLES.FREEZE, weight: 64 },      // ~1/1024
        { role: ROLES.REPLAY, weight: 9298 },    // ~1/7
        { role: ROLES.GRAPE, weight: 7281 },     // ~1/9
        { role: ROLES.BELL, weight: 5461 },      // ~1/12
        { role: ROLES.CHERRY, weight: 1872 },    // ~1/35
        { role: ROLES.BAR_RARE, weight: 93 },    // ~1/700
        { role: ROLES.BIG, weight: 187 },        // ~1/350
        { role: ROLES.REG, weight: 187 }         // ~1/350
        // Remainder is BLANK (calculated dynamically)
    ],
    BONUS_ACTIVE: [
        // ボーナス成立中（内部中）の小役確率
        { role: ROLES.REPLAY, weight: 9298 },
        { role: ROLES.GRAPE, weight: 7281 },
        { role: ROLES.BELL, weight: 5461 }
        // チェリーおよびボーナス系抽選（BIG, REG, BAR_RARE）を取り除く
    ],
    BONUS_GAME: [
        // ボーナスゲーム中（ブドウ超高確率）
        { role: ROLES.GRAPE, weight: 50000 },
        { role: ROLES.REPLAY, weight: 2000 },
        { role: ROLES.CHERRY, weight: 1000 }
    ]
};

// 出目制御（スベリ）優先順位テーブル
// 各フラグに対して、どの絵柄を引き込もうとするか（スベリコマ限界まで探す絵柄）の定義
// 優先度配列順に探し、見つからなければ次点を探す。どれも見つからなければ「ハズレ出目」を狙う。
const STOP_CONTROL_TABLE = {
    [ROLES.BIG]: { targetIds: [SYMBOLS.BIG.id], maxSlip: CONFIG.MAX_SLIP_FRAMES },
    [ROLES.REG]: { targetIds: [SYMBOLS.REG.id, SYMBOLS.BIG.id], maxSlip: CONFIG.MAX_SLIP_FRAMES }, // Left, Center can use BIG as substitute for REG shape 7-7-BAR
    [ROLES.CHERRY]: { targetIds: [SYMBOLS.CHERRY.id], maxSlip: CONFIG.REEL_LENGTH }, // Reel 0 only usually searches
    [ROLES.REPLAY]: { targetIds: [SYMBOLS.REPLAY.id], maxSlip: CONFIG.REEL_LENGTH },
    [ROLES.BELL]: { targetIds: [SYMBOLS.BELL.id], maxSlip: CONFIG.REEL_LENGTH },
    [ROLES.GRAPE]: { targetIds: [SYMBOLS.GRAPE.id], maxSlip: CONFIG.REEL_LENGTH },
    [ROLES.BAR_RARE]: { targetIds: [SYMBOLS.REG.id], maxSlip: CONFIG.REEL_LENGTH } // BAR-BAR-BAR
};

// --- Web Audio API Sound System ---
class SoundFX {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.enabled = false;
        this.spinOsc = null;
        this.bgmOscs = [];
        this.bgmLoop = null;
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

    freezeWindup() {
        if (!this.enabled) return;
        const duration = 4.0;

        const subOsc = this.ctx.createOscillator();
        const subGain = this.ctx.createGain();
        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(80, this.ctx.currentTime);
        subOsc.frequency.exponentialRampToValueAtTime(10, this.ctx.currentTime + duration);

        subGain.gain.setValueAtTime(0.01, this.ctx.currentTime);
        subGain.gain.linearRampToValueAtTime(1.0, this.ctx.currentTime + 0.5);
        subGain.gain.linearRampToValueAtTime(0.8, this.ctx.currentTime + duration - 1.0);
        subGain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);

        subOsc.connect(subGain);
        subGain.connect(this.ctx.destination);

        const midOsc = this.ctx.createOscillator();
        const midGain = this.ctx.createGain();
        midOsc.type = 'triangle';
        midOsc.frequency.setValueAtTime(80, this.ctx.currentTime);
        midOsc.frequency.exponentialRampToValueAtTime(10, this.ctx.currentTime + duration);

        midGain.gain.setValueAtTime(0.01, this.ctx.currentTime);
        midGain.gain.linearRampToValueAtTime(0.5, this.ctx.currentTime + 0.5);
        midGain.gain.linearRampToValueAtTime(0.3, this.ctx.currentTime + duration - 1.0);
        midGain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);

        midOsc.connect(midGain);
        midGain.connect(this.ctx.destination);

        subOsc.start();
        midOsc.start();
        subOsc.stop(this.ctx.currentTime + duration);
        midOsc.stop(this.ctx.currentTime + duration);
    }

    startBonusBGM() {
        if (!this.enabled || this.bgmLoop) return;

        const playStep = (time, freq, vol, type = 'square') => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.index = 0; // tracking
            osc.type = type;
            osc.frequency.setValueAtTime(freq, time);
            gain.gain.setValueAtTime(vol, time);
            gain.gain.exponentialRampToValueAtTime(0.01, time + 0.15);
            osc.connect(gain);
            gain.connect(this.ctx.destination);
            osc.start(time);
            osc.stop(time + 0.2);
            return osc;
        };

        // Arpeggio sequence for more "hype"
        const sequence = [
            { f: 523.25, t: 0 }, { f: 659.25, t: 0.1 }, { f: 783.99, t: 0.2 }, { f: 1046.50, t: 0.3 },
            { f: 587.33, t: 0.4 }, { f: 739.99, t: 0.5 }, { f: 880.00, t: 0.6 }, { f: 1174.66, t: 0.7 },
            { f: 523.25, t: 0.8 }, { f: 659.25, t: 0.9 }, { f: 783.99, t: 1.0 }, { f: 1046.50, t: 1.1 },
            { f: 440.00, t: 1.2 }, { f: 493.88, t: 1.3 }, { f: 523.25, t: 1.4 }, { f: 587.33, t: 1.5 }
        ];

        let loopStartTime = this.ctx.currentTime;
        const startLoop = () => {
            sequence.forEach(note => {
                playStep(loopStartTime + note.t, note.f, 0.03, 'square');
                // Bass note
                if (note.t % 0.4 === 0) {
                    playStep(loopStartTime + note.t, note.f / 4, 0.05, 'triangle');
                }
            });
            loopStartTime += 1.6;
            this.bgmLoop = setTimeout(startLoop, 1600);
        };
        startLoop();
    }

    stopBonusBGM() {
        if (this.bgmLoop) {
            clearTimeout(this.bgmLoop);
            this.bgmLoop = null;
        }
    }
}

// リール1個のオブジェクト
class Reel {
    constructor(index, element, array) {
        this.index = index;
        this.el = element;
        this.array = array;
        this.pos = 0; // Floating pixel pos
        this.spinning = false;
        this.stopping = false;
        this.stopIdx = -1; // Target symbol index
    }

    initDOM() {
        this.el.innerHTML = '';
        const totalVisSymbols = CONFIG.REEL_LENGTH * 2 + 5;
        for (let i = 0; i < totalVisSymbols; i++) {
            const symId = this.array[i % CONFIG.REEL_LENGTH];
            const symDef = Object.values(SYMBOLS).find(s => s.id === symId);
            const div = document.createElement('div');
            div.className = `symbol ${symDef.class}`;
            div.textContent = symDef.name;
            this.el.appendChild(div);
        }
    }

    start() {
        this.spinning = true;
        this.stopping = false;
        this.stopIdx = -1;
    }

    stopAt(index) {
        this.stopping = true;
        this.stopIdx = index;
    }

    // Returns true if fully stopped this frame, false if still moving
    update() {
        if (!this.spinning) return true;

        if (this.stopping && this.stopIdx !== -1) {
            const targetY = ((this.stopIdx - 1 + CONFIG.REEL_LENGTH) % CONFIG.REEL_LENGTH) * CONFIG.SYMBOL_HEIGHT;
            let diff = (this.pos - targetY + CONFIG.REEL_LENGTH * CONFIG.SYMBOL_HEIGHT) % (CONFIG.REEL_LENGTH * CONFIG.SYMBOL_HEIGHT);

            if (diff < CONFIG.SYMBOL_HEIGHT * CONFIG.SPIN_SPEED) {
                this.pos = targetY;
                this.spinning = false;
            } else {
                this.pos -= CONFIG.SYMBOL_HEIGHT * CONFIG.SPIN_SPEED;
            }
        } else {
            this.pos -= CONFIG.SYMBOL_HEIGHT * CONFIG.SPIN_SPEED;
        }

        if (this.pos < 0) {
            this.pos += CONFIG.REEL_LENGTH * CONFIG.SYMBOL_HEIGHT;
        }

        this.el.style.transform = `translateY(-${this.pos}px)`;
        return !this.spinning;
    }

    getCenterIndex() {
        return Math.floor(this.pos / CONFIG.SYMBOL_HEIGHT) + 1;
    }

    getSymbolAt(index) {
        return this.array[(index + CONFIG.REEL_LENGTH) % CONFIG.REEL_LENGTH];
    }
}

// リール群の回転・停止制御を担うコントローラー
class ReelController {
    constructor(elements, sfx) {
        this.sfx = sfx;
        this.reels = [
            new Reel(0, elements[0], REEL_ARRAYS[0]),
            new Reel(1, elements[1], REEL_ARRAYS[1]),
            new Reel(2, elements[2], REEL_ARRAYS[2])
        ];
        this.onAllStopCallback = null;
        this.animFrameId = null;

        this.reels.forEach(r => r.initDOM());
    }

    startSpin(onStop) {
        this.onAllStopCallback = onStop;
        this.reels.forEach(r => r.start());
        this.sfx.startSpin();

        if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
        this.spinLoop();
    }

    spinLoop() {
        let allStopped = true;
        for (let r of this.reels) {
            const isStoppedThisFrame = r.update();
            if (!isStoppedThisFrame) allStopped = false;
        }

        if (!allStopped) {
            this.animFrameId = requestAnimationFrame(() => this.spinLoop());
        } else {
            this.sfx.stopSpin();
            this.animFrameId = null;
            if (this.onAllStopCallback) this.onAllStopCallback();
        }
    }

    // 出目制御ロジックの本体（テーブル＆関数の分離）
    attemptStopReel(reelIndex, controlRole, currentInternalBonus) {
        const reel = this.reels[reelIndex];
        if (!reel.spinning || reel.stopping) return false;

        this.sfx.stop();
        const centerIdx = reel.getCenterIndex();

        // 実際の制御役（成立フラグ）。
        // 小役非成立で、内部ボーナスがあればボーナス絵柄を引き込もうとする。
        let activeRole = controlRole;
        if (activeRole === ROLES.BLANK && currentInternalBonus !== null) {
            activeRole = currentInternalBonus;
        }

        const bestSlip = this.calculateSlip(reelIndex, centerIdx, activeRole);
        const targetIdx = (centerIdx - bestSlip + CONFIG.REEL_LENGTH) % CONFIG.REEL_LENGTH;

        reel.stopAt(targetIdx);
        return true;
    }

    // 第一停止できるリールを探して止める（スペースキー用）
    stopFirstAvailable(controlRole, currentInternalBonus) {
        for (let i = 0; i < 3; i++) {
            if (this.attemptStopReel(i, controlRole, currentInternalBonus)) return true;
        }
        return false;
    }

    getStopPositions() {
        return this.reels.map(r => r.stopIdx);
    }

    isSpinning(index = null) {
        if (index !== null) return this.reels[index].spinning;
        return this.reels.some(r => r.spinning);
    }

    isStopping(index) {
        return this.reels[index].stopping;
    }

    // スベリコマ数計算（出目制御テーブルベース）
    calculateSlip(r, centerIdx, activeRole) {
        // 特別扱い: BAR_RAREは強制ハズレではないが、Unlimited SlipでREG(BAR)を探す
        const controlDef = STOP_CONTROL_TABLE[activeRole];

        if (controlDef) {
            // Priority: center -> top -> bottom
            const positions = [0, -1, 1];

            // 例外: REG時の特殊処理（左中は7も可、右はBARのみ）
            let targetIds = controlDef.targetIds;
            if (activeRole === ROLES.REG && r === 2) {
                targetIds = [SYMBOLS.REG.id]; // 右リールはBARのみ探す
            }

            for (let pos of positions) {
                for (let slip = 0; slip <= controlDef.maxSlip; slip++) {
                    const targetCenter = (centerIdx - slip + CONFIG.REEL_LENGTH) % CONFIG.REEL_LENGTH;
                    const visualSymId = this.reels[r].getSymbolAt(targetCenter + pos);

                    // チェリーは第一停止優先、かつ左リールのみ有効
                    if (activeRole === ROLES.CHERRY && r !== 0) continue;

                    if (targetIds.includes(visualSymId)) {
                        // 但し、揃ってはいけない役（制御で蹴るべき役）が揃わないか「ハズレ（安全）確認」も必要。
                        // ここは簡略化のため、指定絵柄が見つかれば許可（実機では「蹴り」が最優先）
                        return slip;
                    }
                }
            }
        }

        // 見つからない、あるいはBLANKの場合は「どの入賞ラインにも役（小役・ボーナス）が成立しない」スベリを探す（蹴り制御）
        return this.findSafeSlip(r, centerIdx);
    }

    findSafeSlip(r, centerIdx) {
        for (let slip = 0; slip <= CONFIG.MAX_SLIP_FRAMES; slip++) {
            const targetCenter = (centerIdx - slip + CONFIG.REEL_LENGTH) % CONFIG.REEL_LENGTH;
            const stops = [
                r === 0 ? targetCenter : this.reels[0].stopIdx,
                r === 1 ? targetCenter : this.reels[1].stopIdx,
                r === 2 ? targetCenter : this.reels[2].stopIdx
            ];

            if (!this.checkFormsAnyWin(stops)) {
                return slip;
            }
        }
        return 0; // fallback
    }

    checkFormsAnyWin(stops) {
        // [s0, s1, s2]
        if (stops[0] !== -1) {
            let leftTop = this.reels[0].getSymbolAt(stops[0] - 1);
            let leftCenter = this.reels[0].getSymbolAt(stops[0]);
            let leftBottom = this.reels[0].getSymbolAt(stops[0] + 1);
            if (leftTop === SYMBOLS.CHERRY.id || leftCenter === SYMBOLS.CHERRY.id || leftBottom === SYMBOLS.CHERRY.id) return true;
        }

        if (stops[0] !== -1 && stops[1] !== -1 && stops[2] !== -1) {
            const matrix = this.getMatrix(stops);
            const lines = this.getPaylines(matrix);
            for (let line of lines) {
                if (line[0] === line[1] && line[1] === line[2] && line[0] !== SYMBOLS.CHERRY.id) return true;
                if (line[0] === SYMBOLS.BIG.id && line[1] === SYMBOLS.BIG.id && line[2] === SYMBOLS.REG.id) return true;
            }
        }
        return false;
    }

    getMatrix(stops) {
        return [
            [this.reels[0].getSymbolAt(stops[0] - 1), this.reels[1].getSymbolAt(stops[1] - 1), this.reels[2].getSymbolAt(stops[2] - 1)],
            [this.reels[0].getSymbolAt(stops[0]), this.reels[1].getSymbolAt(stops[1]), this.reels[2].getSymbolAt(stops[2])],
            [this.reels[0].getSymbolAt(stops[0] + 1), this.reels[1].getSymbolAt(stops[1] + 1), this.reels[2].getSymbolAt(stops[2] + 1)]
        ];
    }

    getPaylines(matrix) {
        return [
            [matrix[1][0], matrix[1][1], matrix[1][2]], // Center
            [matrix[0][0], matrix[0][1], matrix[0][2]], // Top
            [matrix[2][0], matrix[2][1], matrix[2][2]], // Bottom
            [matrix[0][0], matrix[1][1], matrix[2][2]], // Cross down
            [matrix[2][0], matrix[1][1], matrix[0][2]]  // Cross up
        ];
    }
}

// 出目判定用純粋関数
function evaluateWin(matrix) {
    const lines = [
        [matrix[1][0], matrix[1][1], matrix[1][2]],
        [matrix[0][0], matrix[0][1], matrix[0][2]],
        [matrix[2][0], matrix[2][1], matrix[2][2]],
        [matrix[0][0], matrix[1][1], matrix[2][2]],
        [matrix[2][0], matrix[1][1], matrix[0][2]]
    ];

    // Priority 1: Bonuses (BIG/REG)
    for (let line of lines) {
        if (line[0] === SYMBOLS.BIG.id && line[1] === SYMBOLS.BIG.id && line[2] === SYMBOLS.BIG.id) {
            return { type: 'BONUS', id: ROLES.BIG, payout: SYMBOLS.BIG.payout, name: "777" };
        }
        if (line[0] === SYMBOLS.BIG.id && line[1] === SYMBOLS.BIG.id && line[2] === SYMBOLS.REG.id) {
            return { type: 'BONUS', id: ROLES.REG, payout: SYMBOLS.REG.payout, name: "77BAR" };
        }
    }

    // Priority 2: Rare BAR
    for (let line of lines) {
        if (line[0] === SYMBOLS.REG.id && line[1] === SYMBOLS.REG.id && line[2] === SYMBOLS.REG.id) {
            return { type: 'RARE', id: ROLES.BAR_RARE, payout: 12, name: "BAR揃い" };
        }
    }

    // Priority 3: Normal Small Roles (exclude Cherry/Bonus)
    for (let line of lines) {
        if (line[0] === line[1] && line[1] === line[2]) {
            const sym = Object.values(SYMBOLS).find(s => s.id === line[0]);
            if (sym && sym.id !== SYMBOLS.CHERRY.id && sym.id !== SYMBOLS.BIG.id && sym.id !== SYMBOLS.REG.id) {
                return { type: 'SMALL', id: sym.id, payout: sym.payout, name: sym.name };
            }
        }
    }

    // Priority 4: Cherry
    if (matrix[0][0] === SYMBOLS.CHERRY.id || matrix[1][0] === SYMBOLS.CHERRY.id || matrix[2][0] === SYMBOLS.CHERRY.id) {
        return { type: 'SMALL', id: SYMBOLS.CHERRY.id, payout: SYMBOLS.CHERRY.payout, name: SYMBOLS.CHERRY.name };
    }

    return { type: 'NONE', id: ROLES.BLANK, payout: 0, name: "" };
}


// メインゲームクラス
class SlotGame {
    constructor() {
        this.sfx = new SoundFX();

        // State Encapsulation
        this.state = {
            yen: 10000,
            credits: 0,
            bet: 0,
            spins: 0,
            bigs: 0,
            regs: 0,
            payoutDisplay: 0,
            isFreezing: false,

            // GOGOランプ・ボーナス状態を一元管理
            internalBonus: null, // null, ROLES.BIG, ROLES.REG
            gogoState: 'OFF',    // 'OFF', 'ON', 'BLINK'
            isPremiumBonus: false, // フリーズ経由の特別ボーナスフラグ

            currentRole: ROLES.BLANK, // 毎ゲームの成立フラグ
            forcedFlag: null,         // 開発者モード用：強制フラグ (null または ROLESの値)
            active: false,

            // ボーナスゲーム管理
            isBonusGame: false,
            bonusGamesRemaining: 0,
            activeBonusType: null // 'BIG' | 'REG'
        };

        // DOM Encapsulation
        this.els = {
            freezeOverlay: document.getElementById('freeze-overlay'),
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
            reelElements: [
                document.getElementById('reel-0'),
                document.getElementById('reel-1'),
                document.getElementById('reel-2')
            ],
            debugNextFlag: document.getElementById('debug-next-flag')
        };

        this.reelCtrl = new ReelController(this.els.reelElements, this.sfx);
        this.loadState();
        this.bindEvents();
        this.updateUI();
    }

    bindEvents() {
        // Keyboard bindings
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Shift') {
                this.els.btnBet.click();
            } else if (e.key === 'Control') {
                this.els.btnSpin.click();
            } else if (e.key === ' ') {
                if (this.reelCtrl.stopFirstAvailable(this.state.currentRole, this.state.internalBonus)) {
                    this.updateUIButtons();
                }
                e.preventDefault();
            }
        });

        // Toggle Buttons
        this.els.btnSoundToggle.addEventListener('click', () => {
            this.sfx.enabled = !this.sfx.enabled;
            if (this.sfx.enabled) {
                this.sfx.ctx.resume();
                this.els.btnSoundToggle.innerText = "サウンド: ON";
                this.els.btnSoundToggle.style.background = "#225522";
                this.sfx.coin();
                if (this.state.isBonusGame) this.sfx.startBonusBGM();
            } else {
                this.els.btnSoundToggle.innerText = "サウンド: OFF";
                this.els.btnSoundToggle.style.background = "#552222";
                this.sfx.stopSpin();
            }
        });

        this.els.btnDebugToggle.addEventListener('click', () => {
            const isHidden = this.els.debugPanel.style.display === 'none';
            if (isHidden) {
                this.els.debugPanel.style.display = 'block';
                this.els.btnDebugToggle.innerText = "開発者モード: ON";
                this.els.btnDebugToggle.style.background = "#222255";
            } else {
                this.els.debugPanel.style.display = 'none';
                this.els.btnDebugToggle.innerText = "開発者モード: OFF";
                this.els.btnDebugToggle.style.background = "#444";
            }
        });

        this.els.debugNextFlag.addEventListener('change', (e) => {
            const val = e.target.value;
            this.state.forcedFlag = (val === "AUTO") ? null : parseInt(val);
        });

        // Economy Actions
        this.els.btnDispense.addEventListener('click', () => this.borrowCredits());
        this.els.btnExchange.addEventListener('click', () => this.exchangeCredits());

        // Game Actions
        this.els.btnBet.addEventListener('click', () => this.betMax());
        this.els.btnSpin.addEventListener('click', () => this.startSpin());

        // Stop Buttons
        this.els.btnStops.forEach((btn, r) => {
            btn.addEventListener('click', () => {
                if (this.reelCtrl.attemptStopReel(r, this.state.currentRole, this.state.internalBonus)) {
                    this.updateUIButtons();
                }
            });
        });
    }

    // --- State Methods ---

    setGogoState(state) {
        this.state.gogoState = state;
        if (state === 'ON' || state === 'BLINK') {
            this.els.gogo.classList.add('on');
            if (state === 'BLINK') this.els.gogo.classList.add('blink');
            else this.els.gogo.classList.remove('blink');
        } else {
            this.els.gogo.classList.remove('on');
            this.els.gogo.classList.remove('blink');
        }
    }

    triggerGogo(isBlink = false) {
        if (this.state.gogoState === 'OFF') {
            this.setGogoState(isBlink ? 'BLINK' : 'ON');
            this.sfx.gogo();
        }
    }

    msg(text) {
        this.els.msg.innerText = text;
    }

    updateUI() {
        this.els.yen.innerText = this.state.yen.toLocaleString();
        this.els.credits.innerText = this.state.credits;
        if (this.els.creditsDisplay) this.els.creditsDisplay.innerText = this.state.credits;
        this.els.big.innerText = this.state.bigs;
        this.els.reg.innerText = this.state.regs;
        this.els.games.innerText = this.state.spins;
        this.els.betInd.innerText = this.state.payoutDisplay > 0 ? this.state.payoutDisplay : "";

        // Debug info
        const sym = Object.values(SYMBOLS).find(s => s.id === this.state.currentRole);
        const flagNames = { 7: "BAR揃い", [-1]: "BLANK", 99: "PGG(フリーズ)" };
        this.els.debugFlag.innerText = sym ? sym.name : (flagNames[this.state.currentRole] || "BLANK");
        this.els.debugGogo.innerText = (this.state.internalBonus !== null) ? "ON" : "OFF";

        // Bonus Game UI
        if (this.state.isBonusGame) {
            this.els.msg.innerText = `BONUS中！ 残り入賞回数: ${this.state.bonusGamesRemaining}`;
        }
    }

    // --- Persistence Methods ---

    saveState() {
        const data = {
            yen: this.state.yen,
            credits: this.state.credits,
            spins: this.state.spins,
            bigs: this.state.bigs,
            regs: this.state.regs,
            internalBonus: this.state.internalBonus,
            gogoState: this.state.gogoState,
            isBonusGame: this.state.isBonusGame,
            bonusGamesRemaining: this.state.bonusGamesRemaining,
            activeBonusType: this.state.activeBonusType,
            isPremiumBonus: this.state.isPremiumBonus
        };
        localStorage.setItem('slot_game_state', JSON.stringify(data));
    }

    loadState() {
        const saved = localStorage.getItem('slot_game_state');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                this.state.yen = data.yen ?? 10000;
                this.state.credits = data.credits ?? 0;
                this.state.spins = data.spins ?? 0;
                this.state.bigs = data.bigs ?? 0;
                this.state.regs = data.regs ?? 0;
                this.state.internalBonus = data.internalBonus ?? null;

                if (data.gogoState) {
                    this.setGogoState(data.gogoState);
                }
                this.state.isBonusGame = data.isBonusGame ?? false;
                this.state.bonusGamesRemaining = data.bonusGamesRemaining ?? 0;
                this.state.activeBonusType = data.activeBonusType ?? null;
                this.state.isPremiumBonus = data.isPremiumBonus ?? false;

                if (this.state.isBonusGame) {
                    setTimeout(() => this.sfx.startBonusBGM(), 100);
                }
            } catch (e) {
                console.error("Failed to load state", e);
            }
        }
    }

    updateUIButtons() {
        this.els.btnStops.forEach((btn, i) => {
            if (this.reelCtrl.isSpinning(i) && !this.reelCtrl.isStopping(i)) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    // --- Economy ---

    borrowCredits() {
        if (this.state.yen >= 1000) {
            this.state.yen -= 1000;
            this.state.credits += 46;
            this.sfx.coin();
            this.updateUI();
            this.msg("1000円分（46枚）クレジットを借りました。");
        } else {
            this.msg("所持金が足りません。");
        }
    }

    exchangeCredits() {
        if (this.state.credits >= 52) {
            const bundles = Math.floor(this.state.credits / 52);
            const exchangedCredits = bundles * 52;
            const yenGain = bundles * 1000;

            this.state.credits -= exchangedCredits;
            this.state.yen += yenGain;
            this.sfx.coin();
            this.updateUI();
            this.msg(`${exchangedCredits}クレジットを${yenGain}円に交換しました。`);
        } else {
            this.msg("交換にはクレジットが最低52枚必要です。");
        }
    }

    // --- Game Logic ---

    betMax() {
        if (this.state.active || this.reelCtrl.isSpinning()) return;
        if (this.state.bet >= 3) {
            this.msg("既に3枚掛けされています。");
            return;
        }

        if (this.state.credits >= 3 || (this.state.isBonusGame && this.state.credits >= 1)) {
            const betAmount = this.state.isBonusGame ? 1 : 3;
            this.state.bet = betAmount;
            this.state.credits -= betAmount;
            this.sfx.bet();
            this.state.payoutDisplay = 0;
            this.updateUI();
        } else {
            this.msg("クレジットが足りません。貸出ボタンを押してください。");
        }
    }

    startSpin() {
        const requiredBet = this.state.isBonusGame ? 1 : 3;
        if (this.state.active || this.state.bet < requiredBet) return;
        if (this.state.isFreezing) return;

        this.state.active = true;
        this.state.spins++;
        this.state.payoutDisplay = 0;
        this.sfx.lever();

        this.executeLottery();

        if (this.state.isFreezing) {
            this.playFreezeSequence();
            return;
        }

        this.executeSpinAction();
    }

    executeSpinAction() {
        // Pre-notification of GOGO (25% chance if internal bonus hit normally)
        if (this.state.internalBonus !== null && this.state.gogoState === 'OFF') {
            if (this.state.currentRole !== ROLES.BAR_RARE && Math.random() < 0.25) {
                this.triggerGogo(false);
            }
        }

        this.updateUI();
        this.msg("回転中... ストップボタンを押してね。(キー: SPACE)");

        // Spin via Controller
        this.reelCtrl.startSpin(() => this.onReelsStopped());
        this.updateUIButtons();
    }

    // テーブルベースの確率抽選
    executeLottery() {
        let role = ROLES.BLANK;

        // --- 1. フラグ決定フェーズ ---
        if (this.state.forcedFlag !== null) {
            // 開発者モード強制フラグ
            role = this.state.forcedFlag;
            this.state.forcedFlag = null; // 1回切り
            this.els.debugNextFlag.value = "AUTO";
        } else {
            // 通常のテーブル抽選
            let table = LOTTERY_TABLE.NORMAL;
            if (this.state.isBonusGame) {
                table = LOTTERY_TABLE.BONUS_GAME;
            } else if (this.state.internalBonus !== null) {
                table = LOTTERY_TABLE.BONUS_ACTIVE;
            }

            const rnd = Math.random() * 65536;
            let currentWeight = 0;

            for (let item of table) {
                currentWeight += item.weight;
                if (rnd < currentWeight) {
                    role = item.role;
                    break;
                }
            }
        }

        // --- 2. 決定したフラグに基づく状態更新フェーズ ---
        this.state.currentRole = role;

        if (role === ROLES.FREEZE) {
            // フリーズフラグ成立 (通常抽選または強制時)
            if (this.state.internalBonus === null) {
                this.state.isFreezing = true;
                this.state.isPremiumBonus = true; // プレミアムフラグ
                this.state.currentRole = ROLES.BIG; // 内部フラグはBIGとして扱う
                this.state.internalBonus = ROLES.BIG;
            }
        } else if (role === ROLES.BAR_RARE) {
            // レアBAR成立
            if (this.state.internalBonus === null) {
                this.state.internalBonus = Math.random() < 0.5 ? ROLES.BIG : ROLES.REG;
            }
        } else if (role === ROLES.BIG || role === ROLES.REG) {
            // ボーナス生フラグ成立
            if (this.state.internalBonus === null) {
                this.state.internalBonus = role;
            }
        }

        this.updateUI(); // デバッグ表示などを即時更新
    }

    playFreezeSequence() {
        this.els.freezeOverlay.classList.add('active');
        this.sfx.freezeWindup();

        setTimeout(() => {
            this.triggerGogo(true); // Blinking 
            this.updateUI();
            this.els.freezeOverlay.classList.remove('active');
            this.state.isFreezing = false;
            this.executeSpinAction();
        }, 4000);
    }

    onReelsStopped() {
        this.updateUIButtons();

        // 判定フェーズ
        const positions = this.reelCtrl.getStopPositions();
        const matrix = this.reelCtrl.getMatrix(positions);
        const winResult = evaluateWin(matrix);

        this.processWin(winResult);
    }

    processWin(winResult) {
        this.state.active = false;
        let payout = winResult.payout;

        // Ensure GOGO is visibly lit if internalBonus exists (Post-notification)
        // 入賞時は switch 内で OFF にするため、入賞（BONUS）以外の場合のみ実行
        if (winResult.type !== 'BONUS' && this.state.internalBonus !== null && this.state.gogoState === 'OFF') {
            this.triggerGogo(false);
        }

        switch (winResult.type) {
            case 'BONUS':
                this.state.internalBonus = null;
                this.setGogoState('OFF');
                this.state.spins = 0;

                this.state.isBonusGame = true;
                if (winResult.id === ROLES.BIG) {
                    this.state.bigs++;
                    this.state.activeBonusType = 'BIG';
                    this.state.bonusGamesRemaining = CONFIG.BONUS_GAME_COUNTS.BIG;
                    if (this.state.isPremiumBonus) {
                        this.triggerGogo(true); // 点滅維持
                        this.msg("PREMIUM BIG BONUS開始!!");
                    } else {
                        this.msg("BIG BONUS開始!!");
                    }
                } else {
                    this.state.regs++;
                    this.state.activeBonusType = 'REG';
                    this.state.bonusGamesRemaining = CONFIG.BONUS_GAME_COUNTS.REG;
                    this.msg("REGULAR BONUS開始!");
                }
                this.state.bet = 3; // Treat as replay
                this.sfx.bonus();
                this.sfx.startBonusBGM();
                break;

            case 'RARE':
                this.msg("レア役 BAR揃い！");
                this.sfx.payout();
                // BAR揃いはそのプレイ内に抽選済みなので、ここでPost-notify確定として点灯
                setTimeout(() => this.triggerGogo(), 500);
                break;

            case 'SMALL':
                if (winResult.id === SYMBOLS.REPLAY.id) {
                    this.state.bet = requiredBet;
                    this.msg("REPLAY");
                } else {
                    if (this.state.isBonusGame && winResult.id === SYMBOLS.GRAPE.id) {
                        payout = this.state.isPremiumBonus ? 72 : CONFIG.BONUS_GRAPE_PAYOUT;
                        this.state.bonusGamesRemaining--;
                        if (this.state.bonusGamesRemaining <= 0) {
                            this.state.isBonusGame = false;
                            this.state.isPremiumBonus = false; // プレミアム終了
                            this.state.activeBonusType = null;
                            this.sfx.stopBonusBGM();
                            this.setGogoState('OFF');
                            this.msg("BONUS終了");
                        }
                    }
                    this.msg(`当り！ ${winResult.name} / ${payout}枚払い出し`);
                    this.sfx.payout();
                }

                if (winResult.id === SYMBOLS.CHERRY.id && this.state.internalBonus === null) {
                    // Cherry 10% bonus chance
                    if (Math.random() < 0.1) {
                        this.state.internalBonus = Math.random() < 0.5 ? ROLES.BIG : ROLES.REG;
                        setTimeout(() => this.triggerGogo(), 500);
                    }
                }
                break;

            case 'NONE':
            default:
                // ハズレ
                break;
        }

        this.state.payoutDisplay = payout;

        // Reset Bet if not replay or bonus entry
        const isReplayType = winResult.id === SYMBOLS.REPLAY.id || winResult.type === 'BONUS';
        if (!isReplayType) {
            this.state.bet = 0;
            if (payout > 0) {
                this.state.credits += payout;
            }
        }

        this.updateUI();
        this.saveState();
    }
}

// Entry Point
document.addEventListener('DOMContentLoaded', () => {
    window.game = new SlotGame();
});