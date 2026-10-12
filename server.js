const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let gameState = 'PLAYING';
let players = {};
let bodies = [];
let meetingTimer = null;
let votes = {};

// 非常招集ボタン（カフェテリア中央）
const emergencyButton = { x: 2050, y: 1530 };

// ご提示いただいた完璧な11部屋・広め通路のマップデータ
const walls = [
    // 外周の壁
    { x: 200, y: 200, width: 3600, height: 30 },
    { x: 200, y: 2800, width: 3600, height: 30 },
    { x: 200, y: 200, width: 30, height: 2630 },
    { x: 3800, y: 200, width: 30, height: 2630 },

    // ===== 1. カフェテリア (1650,1250)-(2450,1810) 大部屋 800x560 =====
    { x: 1650, y: 1250, width: 50, height: 30 },
    { x: 1790, y: 1250, width: 510, height: 30 },
    { x: 2390, y: 1250, width: 60, height: 30 },
    { x: 1650, y: 1780, width: 450, height: 30 },
    { x: 2190, y: 1780, width: 260, height: 30 },
    { x: 1650, y: 1250, width: 30, height: 170 },
    { x: 1650, y: 1510, width: 30, height: 300 },
    { x: 2420, y: 1250, width: 30, height: 100 },
    { x: 2420, y: 1440, width: 30, height: 370 },

    // ===== 2. ストレージ (1900,2250)-(2500,2650) 中部屋 600x400 =====
    { x: 1900, y: 2250, width: 200, height: 30 },
    { x: 2190, y: 2250, width: 310, height: 30 },
    { x: 1900, y: 2620, width: 600, height: 30 },
    { x: 1900, y: 2250, width: 30, height: 150 },
    { x: 1900, y: 2490, width: 30, height: 160 },
    { x: 2470, y: 2250, width: 30, height: 80 },
    { x: 2470, y: 2420, width: 30, height: 230 },

    // ===== 3. アッパーエンジン (500,450)-(900,820) 400x370 =====
    { x: 500, y: 450, width: 400, height: 30 },
    { x: 500, y: 790, width: 250, height: 30 },
    { x: 840, y: 790, width: 60, height: 30 },
    { x: 500, y: 450, width: 30, height: 370 },
    { x: 870, y: 450, width: 30, height: 130 },
    { x: 870, y: 670, width: 30, height: 150 },

    // ===== 4. メッドベイ (1450,500)-(1850,870) 400x370 =====
    { x: 1450, y: 500, width: 400, height: 30 },
    { x: 1450, y: 840, width: 250, height: 30 },
    { x: 1790, y: 840, width: 60, height: 30 },
    { x: 1450, y: 500, width: 30, height: 80 },
    { x: 1450, y: 670, width: 30, height: 200 },
    { x: 1820, y: 500, width: 30, height: 370 },

    // ===== 5. ナビゲーション (2250,500)-(2650,880) 400x380 =====
    { x: 2250, y: 500, width: 400, height: 30 },
    { x: 2250, y: 850, width: 50, height: 30 },
    { x: 2390, y: 850, width: 260, height: 30 },
    { x: 2250, y: 500, width: 30, height: 380 },
    { x: 2620, y: 500, width: 30, height: 60 },
    { x: 2620, y: 650, width: 30, height: 230 },

    // ===== 6. ウェポン (3050,450)-(3500,820) 450x370 =====
    { x: 3050, y: 450, width: 450, height: 30 },
    { x: 3050, y: 790, width: 310, height: 30 },
    { x: 3450, y: 790, width: 50, height: 30 },
    { x: 3050, y: 450, width: 30, height: 110 },
    { x: 3050, y: 650, width: 30, height: 170 },
    { x: 3470, y: 450, width: 30, height: 370 },

    // ===== 7. コックピット (3300,1250)-(3750,1620) 450x370 =====
    { x: 3300, y: 1250, width: 60, height: 30 },
    { x: 3450, y: 1250, width: 300, height: 30 },
    { x: 3300, y: 1590, width: 100, height: 30 },
    { x: 3490, y: 1590, width: 260, height: 30 },
    { x: 3300, y: 1250, width: 30, height: 100 },
    { x: 3300, y: 1440, width: 30, height: 180 },
    { x: 3720, y: 1250, width: 30, height: 370 },

    // ===== 8. シールド (3150,2150)-(3600,2530) 450x380 =====
    { x: 3150, y: 2150, width: 250, height: 30 },
    { x: 3490, y: 2150, width: 110, height: 30 },
    { x: 3150, y: 2500, width: 450, height: 30 },
    { x: 3150, y: 2150, width: 30, height: 180 },
    { x: 3150, y: 2420, width: 30, height: 110 },
    { x: 3570, y: 2150, width: 30, height: 380 },

    // ===== 9. セキュリティ (700,1300)-(1100,1660) 400x360 =====
    { x: 700, y: 1300, width: 50, height: 30 },
    { x: 840, y: 1300, width: 260, height: 30 },
    { x: 700, y: 1630, width: 60, height: 30 },
    { x: 850, y: 1630, width: 250, height: 30 },
    { x: 700, y: 1300, width: 30, height: 360 },
    { x: 1070, y: 1300, width: 30, height: 120 },
    { x: 1070, y: 1510, width: 30, height: 150 },

    // ===== 10. ロワーエンジン (500,2250)-(900,2620) 400x370 =====
    { x: 500, y: 2250, width: 260, height: 30 },
    { x: 850, y: 2250, width: 50, height: 30 },
    { x: 500, y: 2590, width: 400, height: 30 },
    { x: 500, y: 2250, width: 30, height: 370 },
    { x: 870, y: 2250, width: 30, height: 150 },
    { x: 870, y: 2490, width: 30, height: 130 },

    // ===== 11. エレクトリカル (1150,2300)-(1550,2680) 400x380 =====
    { x: 1150, y: 2300, width: 400, height: 30 },
    { x: 1150, y: 2650, width: 400, height: 30 },
    { x: 1150, y: 2300, width: 30, height: 100 },
    { x: 1150, y: 2490, width: 30, height: 190 },
    { x: 1520, y: 2300, width: 30, height: 100 },
    { x: 1520, y: 2490, width: 30, height: 190 },

    // ===== 通路（幅90・平行2本壁・直角のみ）=====
    { x: 900, y: 550, width: 550, height: 30 },
    { x: 900, y: 670, width: 550, height: 30 },
    { x: 1670, y: 870, width: 30, height: 380 },
    { x: 1790, y: 870, width: 30, height: 380 },
    { x: 2270, y: 880, width: 30, height: 370 },
    { x: 2390, y: 880, width: 30, height: 370 },
    { x: 2650, y: 530, width: 400, height: 30 },
    { x: 2650, y: 650, width: 400, height: 30 },
    { x: 3330, y: 820, width: 30, height: 430 },
    { x: 3450, y: 820, width: 30, height: 430 },
    { x: 2450, y: 1320, width: 850, height: 30 },
    { x: 2450, y: 1440, width: 850, height: 30 },
    { x: 3370, y: 1620, width: 30, height: 530 },
    { x: 3490, y: 1620, width: 30, height: 530 },
    { x: 2500, y: 2300, width: 650, height: 30 },
    { x: 2500, y: 2420, width: 650, height: 30 },
    { x: 2070, y: 1810, width: 30, height: 440 },
    { x: 2190, y: 1810, width: 30, height: 440 },
    { x: 1550, y: 2370, width: 350, height: 30 },
    { x: 1550, y: 2490, width: 350, height: 30 },
    { x: 900, y: 2370, width: 250, height: 30 },
    { x: 900, y: 2490, width: 250, height: 30 },
    { x: 730, y: 1660, width: 30, height: 590 },
    { x: 850, y: 1660, width: 30, height: 590 },
    { x: 720, y: 820, width: 30, height: 480 },
    { x: 840, y: 820, width: 30, height: 480 },
    { x: 1100, y: 1390, width: 550, height: 30 },
    { x: 1100, y: 1510, width: 550, height: 30 }
];

// タスクデータ (11個)
let tasks = [
    { id: 1,  x: 1800, y: 1620, name: 'カフェテリア：ゴミ捨て',           completed: false },
    { id: 2,  x: 2200, y: 2450, name: 'ストレージ：燃料補給',              completed: false },
    { id: 3,  x: 700,  y: 620,  name: 'アッパーエンジン：出力調整',        completed: false },
    { id: 4,  x: 1650, y: 700,  name: 'メッドベイ：スキャン',              completed: false },
    { id: 5,  x: 2450, y: 700,  name: 'ナビゲーション：航路入力',          completed: false },
    { id: 6,  x: 3250, y: 620,  name: 'ウェポン：砲台キャリブレーション', completed: false },
    { id: 7,  x: 3550, y: 1450, name: 'コックピット：操縦ログ提出',        completed: false },
    { id: 8,  x: 3400, y: 2350, name: 'シールド：バリア起動',              completed: false },
    { id: 9,  x: 900,  y: 1480, name: 'セキュリティ：カメラ確認',          completed: false },
    { id: 10, x: 700,  y: 2450, name: 'ロワーエンジン：燃料注入',          completed: false },
    { id: 11, x: 1350, y: 2560, name: 'エレクトリカル：配線修理',          completed: false }
];

io.on('connection', (socket) => {
    console.log(`プレイヤー接続: ${socket.id}`);

    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#ff6b81'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    
    players[socket.id] = {
        id: socket.id,
        x: emergencyButton.x + (Math.random() * 30 - 15),
        y: emergencyButton.y + (Math.random() * 30 - 15),
        role: Object.keys(players).length === 1 ? 'wolf' : 'crew',
        isDead: false,
        color: randomColor,
        name: 'クルー_' + socket.id.substr(0, 3),
        taskProgress: 0
    };

    socket.emit('init', { id: socket.id, players, walls, emergencyButton, tasks });

    socket.on('playerMove', (data) => {
        if (gameState !== 'PLAYING') return;
        const player = players[socket.id];
        if (!player || player.isDead) return;
        player.x = data.x;
        player.y = data.y;
    });

    socket.on('completeTask', (taskId) => {
        if (gameState !== 'PLAYING') return;
        const player = players[socket.id];
        if (!player || player.isDead || player.role === 'wolf') return;

        const task = tasks.find(t => t.id === taskId);
        if (task && !task.completed) {
            if (Math.hypot(player.x - task.x, player.y - task.y) < 80) {
                task.completed = true;
                player.taskProgress += 1;
                io.emit('updateTasks', tasks);
                checkCrewWinCondition();
            }
        }
    });

    socket.on('killPlayer', (targetId) => {
        if (gameState !== 'PLAYING') return;
        const killer = players[socket.id];
        const target = players[targetId];

        if (!killer || killer.role !== 'wolf' || killer.isDead) return;
        if (!target || target.isDead) return;

        if (Math.hypot(killer.x - target.x, killer.y - target.y) < 80) {
            target.isDead = true;
            bodies.push({ x: target.x, y: target.y, name: target.name, color: target.color });
            io.emit('updateGameState', { players, bodies });
            checkWinCondition();
        }
    });

    socket.on('reportBody', () => {
        if (gameState !== 'PLAYING') return;
        const player = players[socket.id];
        if (!player || player.isDead) return;
        if (bodies.length > 0) startMeeting('body', player.name);
    });

    socket.on('emergencyMeeting', () => {
        if (gameState !== 'PLAYING') return;
        const player = players[socket.id];
        if (!player || player.isDead) return;
        if (Math.hypot(emergencyButton.x - player.x, emergencyButton.y - player.y) < 80) {
            startMeeting('emergency', player.name);
        }
    });

    socket.on('chatMessage', (msg) => {
        if (gameState !== 'MEETING') return;
        const player = players[socket.id];
        if (!player) return;
        io.emit('chatMessage', { name: player.name, text: msg, isDead: player.isDead });
    });

    socket.on('vote', (targetId) => {
        if (gameState !== 'MEETING') return;
        const player = players[socket.id];
        if (!player || player.isDead) return;
        votes[socket.id] = targetId;

        const activePlayers = Object.values(players).filter(p => !p.isDead);
        if (Object.keys(votes).length >= activePlayers.length) {
            clearTimeout(meetingTimer);
            endMeeting();
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        delete votes[socket.id];
        io.emit('updateGameState', { players, bodies });
        checkWinCondition();
    });
});

function startMeeting(reason, reporterName) {
    gameState = 'MEETING';
    votes = {};
    io.emit('startMeeting', { reason, reporterName });
    meetingTimer = setTimeout(() => { endMeeting(); }, 45000);
}

function endMeeting() {
    if (gameState !== 'MEETING') return;
    const tally = {};
    Object.values(votes).forEach(targetId => {
        if (targetId && targetId !== 'skip') tally[targetId] = (tally[targetId] || 0) + 1;
    });

    let exiledId = null, maxVotes = 0, isTie = false;
    for (const [id, count] of Object.entries(tally)) {
        if (count > maxVotes) { maxVotes = count; exiledId = id; isTie = false; }
        else if (count === maxVotes) { isTie = true; }
    }

    let exiledName = null;
    if (exiledId && !isTie && players[exiledId]) {
        players[exiledId].isDead = true;
        exiledName = players[exiledId].name;
    }

    gameState = 'PLAYING';
    votes = {};
    bodies = [];
    io.emit('endMeeting', { exiledName, players });
    checkWinCondition();
}

function checkCrewWinCondition() {
    const allCompleted = tasks.every(t => t.completed);
    if (allCompleted) {
        io.emit('gameOver', { winner: 'crew', message: '市民の勝利！すべてのタスクが完了しました！' });
    }
}

function checkWinCondition() {
    const activePlayers = Object.values(players).filter(p => !p.isDead);
    const activeWolves = activePlayers.filter(p => p.role === 'wolf');
    const activeCrew = activePlayers.filter(p => p.role === 'crew');

    if (activeWolves.length === 0) {
        io.emit('gameOver', { winner: 'crew', message: '市民の勝利！人狼が全員追放されました！' });
    } else if (activeWolves.length >= activeCrew.length) {
        io.emit('gameOver', { winner: 'wolf', message: '人狼の勝利！市民の数が人狼と同数以下になりました！' });
    }
}

setInterval(() => {
    if (gameState === 'PLAYING') io.emit('gameStateUpdate', { players, bodies });
}, 33);

server.listen(3000, () => {
    console.log('サーバー起動: http://localhost:3000');
});
