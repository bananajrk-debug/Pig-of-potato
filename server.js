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
let emergencyButton = { x: 2000, y: 1500, radius: 40, active: true };
let meetingTimer = null;
let meetingSecondsLeft = 45;

// マップ定義（walls, tasks）
const walls = [
    // 外周壁
    { x: 0, y: 0, w: MAP_WIDTH, h: 40 },
    { x: 0, y: MAP_HEIGHT - 40, w: MAP_WIDTH, h: 40 },
    { x: 0, y: 0, w: 40, h: MAP_HEIGHT },
    { x: MAP_WIDTH - 40, y: 0, w: 40, h: MAP_HEIGHT },
    // 内部の部屋や壁の簡易サンプル（カフェテリア周辺など）
    { x: 1600, y: 1100, w: 800, h: 40 },
    { x: 1600, y: 1860, w: 800, h: 40 },
    { x: 1600, y: 1100, w: 40, h: 380 },
    { x: 2360, y: 1100, w: 40, h: 380 },
    { x: 1600, y: 1520, w: 40, h: 380 },
    { x: 2360, y: 1520, w: 40, h: 380 },
];

const tasksData = [
    { id: 't1', x: 1700, y: 1200, name: 'カフェテリア端末' },
    { id: 't2', x: 2200, y: 1200, name: '配線修理' },
    { id: 't3', x: 1700, y: 1800, name: 'データ分析' },
    { id: 't4', x: 2300, y: 1800, name: 'エンジン点検' },
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
        y: 1600 + (Math.random() * 100 - 50),
        role: isFirst ? 'wolf' : 'crew',
        isAlive: true,
        color: isFirst ? '#ff4444' : '#4488ff',
        tasks: tasksData.map(t => ({ ...t, completed: false })),
        vote: null
    };

    socket.emit('init', { id: socket.id, players, bodies, emergencyButton, tasks: tasksData });

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
        p.vote = targetId; // targetId can be null (skip)
        
        // 全員投票したかチェック
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
                // 全タスク完了チェック
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

    bodies = []; // 会議終了時に死体クリア
    gameState = 'PLAYING';

    // 勝敗チェック
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

// ゲームループ（定期的な位置・状態の同期）
setInterval(() => {
    if (gameState === 'PLAYING') {
        io.emit('game-state', { players, bodies });
    }
}, 1000 / 30);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
