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
let emergencyButton = { x: 2000, y: 1200, radius: 40, active: true };
let meetingTimer = null;
let meetingSecondsLeft = 45;

// マップ定義：11個の部屋と外周壁・廊下の壁構造
const walls = [
    // 外周壁
    { x: 0, y: 0, w: MAP_WIDTH, h: 40 },
    { x: 0, y: MAP_HEIGHT - 40, w: MAP_WIDTH, h: 40 },
    { x: 0, y: 0, w: 40, h: MAP_HEIGHT },
    { x: MAP_WIDTH - 40, y: 0, w: 40, h: MAP_HEIGHT },

    // 1. カフェテリア (Cafeteria) [中央: x:1600-2400, y:800-1600]
    { x: 1600, y: 800, w: 320, h: 40 }, { x: 2080, y: 800, w: 320, h: 40 }, // 上壁（ドア隙間あり）
    { x: 1600, y: 1600, w: 320, h: 40 }, { x: 2080, y: 1600, w: 320, h: 40 }, // 下壁
    { x: 1600, y: 800, w: 40, h: 320 }, { x: 1600, y: 1280, w: 40, h: 320 }, // 左壁
    { x: 2360, y: 800, w: 40, h: 320 }, { x: 2360, y: 1280, w: 40, h: 320 }, // 右壁

    // 2. ストレージ (Storage) [下部: x:1600-2400, y:2000-2600]
    { x: 1600, y: 2000, w: 320, h: 40 }, { x: 2080, y: 2000, w: 320, h: 40 },
    { x: 1600, y: 2600, w: 800, h: 40 },
    { x: 1600, y: 2000, w: 40, h: 600 },
    { x: 2360, y: 2000, w: 40, h: 600 },

    // 3. アッパーエンジン (Upper Engine) [左上: x:600-1200, y:400-1000]
    { x: 600, y: 400, w: 600, h: 40 },
    { x: 600, y: 1000, w: 600, h: 40 },
    { x: 600, y: 400, w: 40, h: 600 },
    { x: 1160, y: 400, w: 40, h: 600 },

    // 4. ロワーエンジン (Lower Engine) [左下: x:600-1200, y:1800-2400]
    { x: 600, y: 1800, w: 600, h: 40 },
    { x: 600, y: 2400, w: 600, h: 40 },
    { x: 600, y: 1800, w: 40, h: 600 },
    { x: 1160, y: 1800, w: 40, h: 600 },

    // 5. メッドベイ (MedBay) [左中央: x:600-1200, y:1200-1600]
    { x: 600, y: 1200, w: 600, h: 40 },
    { x: 600, y: 1600, w: 600, h: 40 },
    { x: 600, y: 1200, w: 40, h: 400 },
    { x: 1160, y: 1200, w: 40, h: 400 },

    // 6. セキュリティ (Security) [最左: x:200-500, y:1200-1500]
    { x: 200, y: 1200, w: 300, h: 40 },
    { x: 200, y: 1500, w: 300, h: 40 },
    { x: 200, y: 1200, w: 40, h: 300 },
    { x: 460, y: 1200, w: 40, h: 300 },

    // 7. エレクトリカル (Electrical) [左最下: x:600-1200, y:2600-2900]
    { x: 600, y: 2600, w: 600, h: 40 },
    { x: 600, y: 2900, w: 600, h: 40 },
    { x: 600, y: 2600, w: 40, h: 300 },
    { x: 1160, y: 2600, w: 40, h: 300 },

    // 8. ナビゲーション (Navigation) [右端: x:3200-3800, y:1200-1600]
    { x: 3200, y: 1200, w: 600, h: 40 },
    { x: 3200, y: 1600, w: 600, h: 40 },
    { x: 3200, y: 1200, w: 40, h: 400 },
    { x: 3760, y: 1200, w: 40, h: 400 },

    // 9. ウェポン (Weapons) [右上: x:2800-3400, y:400-900]
    { x: 2800, y: 400, w: 600, h: 40 },
    { x: 2800, y: 900, w: 600, h: 40 },
    { x: 2800, y: 400, w: 40, h: 500 },
    { x: 3360, y: 400, w: 40, h: 500 },

    // 10. コックピット (Cockpit) [最右上: x:3500-3900, y:400-800]
    { x: 3500, y: 400, w: 400, h: 40 },
    { x: 3500, y: 800, w: 400, h: 40 },
    { x: 3500, y: 400, w: 40, h: 400 },
    { x: 3860, y: 400, w: 40, h: 400 },

    // 11. シールド (Shields) [右下: x:2800-3400, y:2000-2500]
    { x: 2800, y: 2000, w: 600, h: 40 },
    { x: 2800, y: 2500, w: 600, h: 40 },
    { x: 2800, y: 2000, w: 40, h: 500 },
    { x: 3360, y: 2000, w: 40, h: 500 },
];

// 3種類のタスク定義（各部屋に配置）
const tasksData = [
    { id: 't1', x: 900, y: 700, name: '配線修理 (アッパーエンジン)', type: 'WIRING' },
    { id: 't2', x: 900, y: 2100, name: 'データダウンロード (ロワーエンジン)', type: 'DOWNLOAD' },
    { id: 't3', x: 900, y: 1400, name: 'エンジン点検 (メッドベイ)', type: 'ENGINE' },
    { id: 't4', x: 350, y: 1350, name: '配線修理 (セキュリティ)', type: 'WIRING' },
    { id: 't5', x: 900, y: 2750, name: 'データダウンロード (エレクトリカル)', type: 'DOWNLOAD' },
    { id: 't6', x: 2000, y: 2300, name: 'エンジン点検 (ストレージ)', type: 'ENGINE' },
    { id: 't7', x: 3100, y: 650, name: '配線修理 (ウェポン)', type: 'WIRING' },
    { id: 't8', x: 3500, y: 1400, name: 'データダウンロード (ナビゲーション)', type: 'DOWNLOAD' },
    { id: 't9', x: 3100, y: 2250, name: 'エンジン点検 (シールド)', type: 'ENGINE' }
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

    const isFirst = Object.keys(players).length === 0;
    players[socket.id] = {
        id: socket.id,
        x: 2000 + (Math.random() * 100 - 50),
        y: 1200 + (Math.random() * 100 - 50),
        role: isFirst ? 'wolf' : 'crew',
        isAlive: true,
        color: isFirst ? '#ff4444' : '#4488ff',
        tasks: tasksData.map(t => ({ ...t, completed: false })),
        vote: null
    };

    socket.emit('init', { id: socket.id, players, bodies, emergencyButton, tasks: tasksData, walls });

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
                bodies.push({ id: target.id, x: target.x, y: target.y, color: target.color });
                io.emit('notification', `${target.id.substr(4,4)} が殺害されました！`);
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
        delete players[socket.id];
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
        io.emit('notification', `${exiledId.substr(4,4)} は投票により追放されました。`);
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
