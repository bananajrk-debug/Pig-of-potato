const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ゲーム設定
const MAP_WIDTH = 3600;
const MAP_HEIGHT = 2600;
const PLAYER_RADIUS = 20;
const PLAYER_SPEED = 4;

let gameState = 'PLAYING'; // 'PLAYING' | 'MEETING'
let players = {};
let bodies = {};
let emergencyButton = { x: 1800, y: 1100, radius: 40, active: true };
let meetingTimer = null;
let meetingSecondsLeft = 45;

// ==========================================
// 洗練された宇宙船マップの壁データ (walls)
// ==========================================
const walls = [
    // --- 外周壁 ---
    { x: 0, y: 0, w: MAP_WIDTH, h: 40 },
    { x: 0, y: MAP_HEIGHT - 40, w: MAP_WIDTH, h: 40 },
    { x: 0, y: 0, w: 40, h: MAP_HEIGHT },
    { x: MAP_WIDTH - 40, y: 0, w: 40, h: MAP_HEIGHT },

    // 1. カフェテリア (Cafeteria) [x: 1400-2200, y: 700-1500]
    { x: 1400, y: 700, w: 320, h: 40 }, { x: 2080, y: 700, w: 320, h: 40 }, // 上壁 (ドア: 1720-2080)
    { x: 1400, y: 1500, w: 320, h: 40 }, { x: 2080, y: 1500, w: 320, h: 40 }, // 下壁
    { x: 1400, y: 700, w: 40, h: 320 }, { x: 1400, y: 1180, w: 40, h: 320 }, // 左壁 (ドア: 1020-1180)
    { x: 2360, y: 700, w: 40, h: 320 }, { x: 2360, y: 1180, w: 40, h: 320 }, // 右壁 (ドア: 1020-1180)

    // 2. ストレージ (Storage) [x: 1400-2200, y: 1900-2400]
    { x: 1400, y: 1900, w: 320, h: 40 }, { x: 2080, y: 1900, w: 320, h: 40 }, // 上壁
    { x: 1400, y: 2400, w: 800, h: 40 }, // 下壁
    { x: 1400, y: 1900, w: 40, h: 500 }, // 左壁
    { x: 2360, y: 1900, w: 40, h: 500 }, // 右壁

    // 3. アッパーエンジン (Upper Engine) [x: 600-1100, y: 300-800]
    { x: 600, y: 300, w: 500, h: 40 },
    { x: 600, y: 800, w: 500, h: 40 },
    { x: 600, y: 300, w: 40, h: 500 },
    { x: 1060, y: 300, w: 40, h: 500 },

    // 4. ロワーエンジン (Lower Engine) [x: 600-1100, y: 1700-2200]
    { x: 600, y: 1700, w: 500, h: 40 },
    { x: 600, y: 2200, w: 500, h: 40 },
    { x: 600, y: 1700, w: 40, h: 500 },
    { x: 1060, y: 1700, w: 40, h: 500 },

    // 5. メッドベイ (MedBay) [x: 600-1100, y: 1000-1500]
    { x: 600, y: 1000, w: 500, h: 40 },
    { x: 600, y: 1500, w: 500, h: 40 },
    { x: 600, y: 1000, w: 40, h: 500 },
    { x: 1060, y: 1000, w: 40, h: 500 },

    // 6. セキュリティ (Security) [x: 200-500, y: 1000-1400]
    { x: 200, y: 1000, w: 300, h: 40 },
    { x: 200, y: 1400, w: 300, h: 40 },
    { x: 200, y: 1000, w: 40, h: 400 },
    { x: 460, y: 1000, w: 40, h: 400 },

    // 7. エレクトリカル (Electrical) [x: 600-1100, y: 2350-2550]
    { x: 600, y: 2350, w: 500, h: 40 },
    { x: 600, y: 2550, w: 500, h: 40 },
    { x: 600, y: 2350, w: 40, h: 200 },
    { x: 1060, y: 2350, w: 40, h: 200 },

    // 8. ナビゲーション (Navigation) [x: 2700-3300, y: 1000-1500]
    { x: 2700, y: 1000, w: 600, h: 40 },
    { x: 2700, y: 1500, w: 600, h: 40 },
    { x: 2700, y: 1000, w: 40, h: 500 },
    { x: 3260, y: 1000, w: 40, h: 500 },

    // 9. ウェポン (Weapons) [x: 2500-3000, y: 300-800]
    { x: 2500, y: 300, w: 500, h: 40 },
    { x: 2500, y: 800, w: 500, h: 40 },
    { x: 2500, y: 300, w: 40, h: 500 },
    { x: 2960, y: 300, w: 40, h: 500 },

    // 10. コックピット (Cockpit) [x: 3100-3550, y: 300-800]
    { x: 3100, y: 300, w: 450, h: 40 },
    { x: 3100, y: 800, w: 450, h: 40 },
    { x: 3100, y: 300, w: 40, h: 500 },
    { x: 3510, y: 300, w: 40, h: 500 },

    // 11. シールド (Shields) [x: 2500-3000, y: 1800-2300]
    { x: 2500, y: 1800, w: 500, h: 40 },
    { x: 2500, y: 2300, w: 500, h: 40 },
    { x: 2500, y: 1800, w: 40, h: 500 },
    { x: 2960, y: 1800, w: 40, h: 500 },

    // --- 廊下（通路）を形成する平行壁 ---
    // カフェテリア ⇔ 上エリア (アッパーエンジン・ウェポン)
    { x: 1720, y: 400, w: 40, h: 300 },
    { x: 1840, y: 400, w: 40, h: 300 },
    { x: 1060, y: 400, w: 700, h: 40 },
    { x: 1060, y: 520, w: 700, h: 40 },
    { x: 1840, y: 400, w: 700, h: 40 },
    { x: 1840, y: 520, w: 700, h: 40 },

    // カフェテリア ⇔ 下エリア (ストレージ)
    { x: 1720, y: 1500, w: 40, h: 400 },
    { x: 1840, y: 1500, w: 40, h: 400 },

    // カフェテリア ⇔ メッドベイ・セキュリティ (左方向)
    { x: 1060, y: 1080, w: 360, h: 40 },
    { x: 1060, y: 1200, w: 360, h: 40 },
    { x: 500, y: 1080, w: 100, h: 40 },
    { x: 500, y: 1200, w: 100, h: 40 },

    // カフェテリア ⇔ ナビゲーション (右方向)
    { x: 2360, y: 1080, w: 340, h: 40 },
    { x: 2360, y: 1200, w: 340, h: 40 },

    // メッドベイ ⇔ 上下エンジン
    { x: 780, y: 800, w: 40, h: 200 },
    { x: 900, y: 800, w: 40, h: 200 },
    { x: 780, y: 1500, w: 40, h: 200 },
    { x: 900, y: 1500, w: 40, h: 200 },

    // ストレージ ⇔ シールド・エレクトリカル
    { x: 1060, y: 2420, w: 340, h: 40 },
    { x: 1060, y: 2540, w: 340, h: 40 },
    { x: 2360, y: 2000, w: 140, h: 40 },
    { x: 2360, y: 2120, w: 140, h: 40 }
];

// タスク定義
const tasksData = [
    { id: 't1', x: 850, y: 550, name: '配線修理 (アッパーエンジン)', type: 'WIRING' },
    { id: 't2', x: 850, y: 1950, name: 'データダウンロード (ロワーエンジン)', type: 'DOWNLOAD' },
    { id: 't3', x: 850, y: 1250, name: 'エンジン点検 (メッドベイ)', type: 'ENGINE' },
    { id: 't4', x: 350, y: 1200, name: '配線修理 (セキュリティ)', type: 'WIRING' },
    { id: 't5', x: 850, y: 2450, name: 'データダウンロード (エレクトリカル)', type: 'DOWNLOAD' },
    { id: 't6', x: 1800, y: 2150, name: 'エンジン点検 (ストレージ)', type: 'ENGINE' },
    { id: 't7', x: 2750, y: 550, name: '配線修理 (ウェポン)', type: 'WIRING' },
    { id: 't8', x: 2950, y: 1250, name: 'データダウンロード (ナビゲーション)', type: 'DOWNLOAD' },
    { id: 't9', x: 2750, y: 2050, name: 'エンジン点検 (シールド)', type: 'ENGINE' }
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
            x: 1800 + (Math.random() * 100 - 50),
            y: 1100 + (Math.random() * 100 - 50),
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
                bodies[target.id] = { id: target.id, name: target.name, x: target.x, y: target.y, color: target.color };
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
            bodies = {};
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

    bodies = {};
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
