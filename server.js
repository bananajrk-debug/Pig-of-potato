const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ゲーム設定
const MAP_WIDTH = 4000;
const MAP_HEIGHT = 3000;
const PLAYER_RADIUS = 20;
const PLAYER_SPEED = 4;

let gameState = 'PLAYING'; // 'PLAYING' | 'MEETING'
let players = {};
let bodies = [];
let emergencyButton = { x: 2000, y: 1400, radius: 40, active: true };
let meetingTimer = null;
let meetingSecondsLeft = 45;

// ==========================================
// 完璧に接続された宇宙船マップの壁データ (walls)
// ==========================================
const walls = [
    // --- 外周壁 ---
    { x: 0, y: 0, w: MAP_WIDTH, h: 40 },
    { x: 0, y: MAP_HEIGHT - 40, w: MAP_WIDTH, h: 40 },
    { x: 0, y: 0, w: 40, h: MAP_HEIGHT },
    { x: MAP_WIDTH - 40, y: 0, w: 40, h: MAP_HEIGHT },

    // --- 1. カフェテリア (Cafeteria) [中央: x:1600-2400, y:1000-1800] ---
    // 上壁 (ドア隙間: x:1950〜2050)
    { x: 1600, y: 1000, w: 350, h: 40 }, { x: 2050, y: 1000, w: 350, h: 40 },
    // 下壁 (ドア隙間: x:1950〜2050)
    { x: 1600, y: 1800, w: 350, h: 40 }, { x: 2050, y: 1800, w: 350, h: 40 },
    // 左壁 (ドア隙間: y:1350〜1450)
    { x: 1600, y: 1000, w: 40, h: 350 }, { x: 1600, y: 1450, w: 40, h: 350 },
    // 右壁 (ドア隙間: y:1350〜1450)
    { x: 2400, y: 1000, w: 40, h: 350 }, { x: 2400, y: 1450, w: 40, h: 350 },

    // --- 2. ストレージ (Storage) [下部中央: x:1600-2400, y:2200-2800] ---
    // 上壁 (カフェテリアからの通路接続: x:1950〜2050)
    { x: 1600, y: 2200, w: 350, h: 40 }, { x: 2050, y: 2200, w: 350, h: 40 },
    // 下壁
    { x: 1600, y: 2800, w: 800, h: 40 },
    // 左壁 (エレクトリカルへの通路接続: y:2450〜2550)
    { x: 1600, y: 2200, w: 40, h: 250 }, { x: 1600, y: 2550, w: 40, h: 250 },
    // 右壁 (シールドへの通路接続: y:2450〜2550)
    { x: 2400, y: 2200, w: 40, h: 250 }, { x: 2400, y: 2550, w: 40, h: 250 },

    // --- 3. アッパーエンジン (Upper Engine) [左上: x:600-1200, y:400-950] ---
    { x: 600, y: 400, w: 600, h: 40 },
    // 下壁 (メッドベイへの縦通路接続: x:850〜950)
    { x: 600, y: 950, w: 250, h: 40 }, { x: 950, y: 950, w: 250, h: 40 },
    { x: 600, y: 400, w: 40, h: 550 },
    // 右壁 (ウェポンへの横通路接続: y:625〜725)
    { x: 1200, y: 400, w: 40, h: 225 }, { x: 1200, y: 725, w: 40, h: 225 },

    // --- 4. ロワーエンジン (Lower Engine) [左下: x:600-1200, y:2050-2600] ---
    // 上壁 (メッドベイからの縦通路接続: x:850〜950)
    { x: 600, y: 2050, w: 250, h: 40 }, { x: 950, y: 2050, w: 250, h: 40 },
    { x: 600, y: 2600, w: 600, h: 40 },
    { x: 600, y: 2050, w: 40, h: 550 },
    // 右壁 (エレクトリカルへの通路接続: y:2250〜2350)
    { x: 1200, y: 2050, w: 40, h: 200 }, { x: 1200, y: 2350, w: 40, h: 250 },

    // --- 5. メッドベイ (MedBay) [左中央: x:600-1200, y:1200-1800] ---
    // 上壁 (アッパーエンジンへの接続)
    { x: 600, y: 1200, w: 250, h: 40 }, { x: 950, y: 1200, w: 250, h: 40 },
    // 下壁 (ロワーエンジンへの接続)
    { x: 600, y: 1800, w: 250, h: 40 }, { x: 950, y: 1800, w: 250, h: 40 },
    // 左壁 (セキュリティへの通路接続: y:1450〜1550)
    { x: 600, y: 1200, w: 40, h: 250 }, { x: 600, y: 1550, w: 40, h: 250 },
    // 右壁 (カフェテリアへの横通路接続: y:1350〜1450)
    { x: 1200, y: 1200, w: 40, h: 150 }, { x: 1200, y: 1450, w: 40, h: 350 },

    // --- 6. セキュリティ (Security) [左端中央: x:200-520, y:1250-1750] ---
    { x: 200, y: 1250, w: 320, h: 40 },
    { x: 200, y: 1750, w: 320, h: 40 },
    { x: 200, y: 1250, w: 40, h: 500 },
    // 右壁 (メッドベイへの接続: y:1450〜1550)
    { x: 520, y: 1250, w: 40, h: 200 }, { x: 520, y: 1550, w: 40, h: 200 },

    // --- 7. エレクトリカル (Electrical) [左最下: x:600-1200, y:2750-2960] ---
    // 上壁 (ロワーエンジンからの接続: x:850〜950)
    { x: 600, y: 2750, w: 250, h: 40 }, { x: 950, y: 2750, w: 250, h: 40 },
    { x: 600, y: 2960, w: 600, h: 40 },
    { x: 600, y: 2750, w: 40, h: 210 },
    // 右壁 (ストレージへの接続: y:2820〜2920)
    { x: 1200, y: 2750, w: 40, h: 70 }, { x: 1200, y: 2920, w: 40, h: 40 },

    // --- 8. ナビゲーション (Navigation) [右端中央: x:3050-3750, y:1200-1800] ---
    { x: 3050, y: 1200, w: 700, h: 40 },
    { x: 3050, y: 1800, w: 700, h: 40 },
    // 左壁 (カフェテリアへの横廊下接続: y:1350〜1450)
    { x: 3050, y: 1200, w: 40, h: 150 }, { x: 3050, y: 1450, w: 40, h: 350 },
    { x: 3750, y: 1200, w: 40, h: 600 },

    // --- 9. ウェポン (Weapons) [右上: x:2800-3400, y:400-950] ---
    { x: 2800, y: 400, w: 600, h: 40 },
    { x: 2800, y: 950, w: 600, h: 40 },
    { x: 2800, y: 400, w: 40, h: 550 },
    // 右壁 (コックピットへの通路接続: y:625〜725)
    { x: 3400, y: 400, w: 40, h: 225 }, { x: 3400, y: 725, w: 40, h: 225 },

    // --- 10. コックピット (Cockpit) [最右上: x:3550-3950, y:400-900] ---
    { x: 3550, y: 400, w: 400, h: 40 },
    { x: 3550, y: 900, w: 400, h: 40 },
    // 左壁 (ウェポンからの接続: y:625〜725)
    { x: 3550, y: 400, w: 40, h: 225 }, { x: 3550, y: 725, w: 40, h: 225 },
    { x: 3950, y: 400, w: 40, h: 500 },

    // --- 11. シールド (Shields) [右下: x:2800-3400, y:2100-2650] ---
    // 上壁 (ストレージからの接続: x:3050〜3150)
    { x: 2800, y: 2100, w: 250, h: 40 }, { x: 3150, y: 2100, w: 250, h: 40 },
    { x: 2800, y: 2650, w: 600, h: 40 },
    { x: 2800, y: 2100, w: 40, h: 550 },
    { x: 3400, y: 2100, w: 40, h: 550 },

    // ==========================================
    // 廊下を形作る平行ガイド壁（幅100pxの通路）
    // ==========================================
    // カフェテリア ⇔ 上エリア（アッパーエンジン・ウェポン方面）
    { x: 1950, y: 650, w: 40, h: 350 },
    { x: 2050, y: 650, w: 40, h: 350 },
    { x: 1240, y: 650, w: 1560, h: 40 }, // 横の連結廊下上壁
    { x: 1240, y: 750, w: 1560, h: 40 }, // 横の連結廊下下壁

    // カフェテリア ⇔ 下エリア（ストレージ方面）
    { x: 1950, y: 1800, w: 40, h: 400 },
    { x: 2050, y: 1800, w: 40, h: 400 },

    // カフェテリア ⇔ メッドベイ・セキュリティ
    { x: 1200, y: 1350, w: 400, h: 40 },
    { x: 1200, y: 1450, w: 400, h: 40 },

    // カフェテリア ⇔ ナビゲーション
    { x: 2400, y: 1350, w: 650, h: 40 },
    { x: 2400, y: 1450, w: 650, h: 40 },

    // メッドベイ ⇔ 上下エンジン
    { x: 850, y: 950, w: 40, h: 250 },
    { x: 950, y: 950, w: 40, h: 250 },
    { x: 850, y: 1800, w: 40, h: 250 },
    { x: 950, y: 1800, w: 40, h: 250 },

    // ストレージ ⇔ シールド
    { x: 2400, y: 2450, w: 400, h: 40 },
    { x: 2400, y: 2550, w: 400, h: 40 },

    // ストレージ ⇔ エレクトリカル・ロワーエンジン
    { x: 1200, y: 2450, w: 400, h: 40 },
    { x: 1200, y: 2550, w: 400, h: 40 }
];

// タスク定義
const tasksData = [
    { id: 't1', x: 800, y: 650, name: '配線修理 (アッパーエンジン)', type: 'WIRING' },
    { id: 't2', x: 800, y: 2300, name: 'データダウンロード (ロワーエンジン)', type: 'DOWNLOAD' },
    { id: 't3', x: 800, y: 1500, name: 'エンジン点検 (メッドベイ)', type: 'ENGINE' },
    { id: 't4', x: 350, y: 1500, name: '配線修理 (セキュリティ)', type: 'WIRING' },
    { id: 't5', x: 900, y: 2850, name: 'データダウンロード (エレクトリカル)', type: 'DOWNLOAD' },
    { id: 't6', x: 2000, y: 2500, name: 'エンジン点検 (ストレージ)', type: 'ENGINE' },
    { id: 't7', x: 3100, y: 650, name: '配線修理 (ウェポン)', type: 'WIRING' },
    { id: 't8', x: 3400, y: 1500, name: 'データダウンロード (ナビゲーション)', type: 'DOWNLOAD' },
    { id: 't9', x: 3100, y: 2350, name: 'エンジン点検 (シールド)', type: 'ENGINE' }
];

// 当たり判定チェック
function checkCollision(x, y, r) {
    if (x - r < 0 || x + r > MAP_WIDTH || y - r < 0 || y + r > MAP_HEIGHT) return true;
    for (let wall of walls) {
        if (
            x + r > wall.x &&
            x - r < wall.x + wall.w &&
            y + r > wall.y &&
            y - r < wall.y + wall.h
        ) {
            return true;
        }
    }
    return false;
}

io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    socket.on('join-game', (playerName) => {
        const isFirst = Object.keys(players).length === 0;
        players[socket.id] = {
            id: socket.id,
            name: playerName || `Player_${socket.id.substr(0,4)}`,
            x: 2000 + (Math.random() * 100 - 50),
            y: 1400 + (Math.random() * 100 - 50),
            role: isFirst ? 'wolf' : 'crew',
            isAlive: true,
            color: isFirst ? '#ff4444' : '#4488ff',
            tasks: tasksData.map(t => ({ ...t, completed: false })),
            vote: null
        };

        socket.emit('init', { id: socket.id, players, bodies, emergencyButton, tasks: tasksData, walls });
    });

    socket.on('player-move', (data) => {
        if (gameState !== 'PLAYING') return;
        let p = players[socket.id];
        if (!p || !p.isAlive) return;

        let newX = p.x + data.vx * PLAYER_SPEED;
        let newY = p.y + data.vy * PLAYER_SPEED;

        if (!checkCollision(newX, p.y, PLAYER_RADIUS)) p.x = newX;
        if (!checkCollision(p.x, newY, PLAYER_RADIUS)) p.y = newY;
    });

    socket.on('player-kill', (targetId) => {
        let killer = players[socket.id];
        let target = players[targetId];
        if (killer && killer.role === 'wolf' && killer.isAlive && target && target.isAlive) {
            let dist = Math.hypot(killer.x - target.x, killer.y - target.y);
            if (dist < 100) {
                target.isAlive = false;
                bodies.push({ id: target.id, name: target.name, x: target.x, y: target.y, color: target.color });
                io.emit('notification', `${target.name} が殺害されました！`);
            }
        }
    });

    socket.on('report-body', (bodyId) => {
        if (gameState !== 'PLAYING') return;
        startMeeting('死体が発見されました！');
    });

    socket.on('emergency-meeting', () => {
        if (gameState !== 'PLAYING') return;
        let p = players[socket.id];
        if (!p || !p.isAlive) return;
        let dist = Math.hypot(p.x - emergencyButton.x, p.y - emergencyButton.y);
        if (dist < emergencyButton.radius + PLAYER_RADIUS) {
            startMeeting('緊急会議が招集されました！');
        }
    });

    socket.on('cast-vote', (targetId) => {
        if (gameState !== 'MEETING') return;
        let p = players[socket.id];
        if (!p || !p.isAlive) return;
        p.vote = targetId;
        
        let alivePlayers = Object.values(players).filter(pl => pl.isAlive);
        if (alivePlayers.every(pl => pl.vote !== undefined)) {
            resolveMeeting();
        }
    });

    socket.on('complete-task', (taskId) => {
        let p = players[socket.id];
        if (!p || !p.isAlive) return;
        let task = p.tasks.find(t => t.id === taskId);
        if (task && !task.completed) {
            let dist = Math.hypot(p.x - task.x, p.y - task.y);
            if (dist < 80) {
                task.completed = true;
                let allCompleted = Object.values(players)
                    .filter(pl => pl.role === 'crew')
                    .every(pl => pl.tasks.every(t => t.completed));
                if (allCompleted) {
                    io.emit('game-over', '市民のタスク勝利！');
                    gameState = 'GAMEOVER';
                }
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        if (players[socket.id]) {
            delete players[socket.id];
        }
        if (Object.keys(players).length === 0) {
            gameState = 'PLAYING';
            bodies = [];
        }
    });
});

function startMeeting(reason) {
    gameState = 'MEETING';
    meetingSecondsLeft = 45;
    Object.values(players).forEach(p => p.vote = undefined);
    io.emit('start-meeting', { reason, players });

    if (meetingTimer) clearInterval(meetingTimer);
    meetingTimer = setInterval(() => {
        meetingSecondsLeft--;
        io.emit('meeting-timer', meetingSecondsLeft);
        if (meetingSecondsLeft <= 0) {
            clearInterval(meetingTimer);
            resolveMeeting();
        }
    }, 1000);
}

function resolveMeeting() {
    if (gameState !== 'MEETING') return;
    if (meetingTimer) clearInterval(meetingTimer);

    let voteCounts = {};
    Object.values(players).forEach(p => {
        if (p.vote) {
            voteCounts[p.vote] = (voteCounts[p.vote] || 0) + 1;
        }
    });

    let exiledId = null;
    let maxVotes = 0;
    for (let id in voteCounts) {
        if (voteCounts[id] > maxVotes) {
            maxVotes = voteCounts[id];
            exiledId = id;
        }
    }

    if (exiledId && players[exiledId]) {
        players[exiledId].isAlive = false;
        io.emit('notification', `${players[exiledId].name} は投票により追放されました。`);
    } else {
        io.emit('notification', '誰も追放されませんでした。');
    }

    bodies = [];
    gameState = 'PLAYING';

    let wolvesAlive = Object.values(players).filter(p => p.role === 'wolf' && p.isAlive).length;
    let crewsAlive = Object.values(players).filter(p => p.role === 'crew' && p.isAlive).length;
    if (wolvesAlive === 0) {
        io.emit('game-over', '市民の勝利（人狼全滅）！');
        gameState = 'GAMEOVER';
    } else if (wolvesAlive >= crewsAlive) {
        io.emit('game-over', '人狼の勝利！');
        gameState = 'GAMEOVER';
    }

    io.emit('end-meeting', players);
}

setInterval(() => {
    if (gameState === 'PLAYING') {
        io.emit('game-state', { players, bodies });
    }
}, 1000 / 30);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
