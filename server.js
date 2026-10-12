const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let gameState = 'PLAYING';
let players = {};
let bodies = []; // 安全な配列形式で死体を管理
let meetingTimer = null;
let votes = {};

// ご提示いただいた非常招集ボタンの座標
const emergencyButton = { x: 2000, y: 1500 };

// ご提示いただいた完璧な11部屋・90度回廊マップの壁データ
const walls = [
    // 外周の壁
    { x: 200, y: 200, width: 3600, height: 30 },
    { x: 200, y: 2800, width: 3600, height: 30 },
    { x: 200, y: 200, width: 30, height: 2630 },
    { x: 3800, y: 200, width: 30, height: 2630 },

    // ===== 1. カフェテリア (1450,1150)-(2550,1850) 大部屋 =====
    { x: 1450, y: 1150, width: 500, height: 30 },
    { x: 2030, y: 1150, width: 520, height: 30 },
    { x: 1450, y: 1820, width: 350, height: 30 },
    { x: 1880, y: 1820, width: 670, height: 30 },
    { x: 1450, y: 1150, width: 30, height: 250 },
    { x: 1450, y: 1480, width: 30, height: 370 },
    { x: 2520, y: 1150, width: 30, height: 50 },
    { x: 2520, y: 1280, width: 30, height: 570 },

    // ===== 2. ストレージ (1550,2200)-(2250,2650) 中部屋 =====
    { x: 1550, y: 2200, width: 250, height: 30 },
    { x: 1880, y: 2200, width: 370, height: 30 },
    { x: 1550, y: 2620, width: 700, height: 30 },
    { x: 1550, y: 2200, width: 30, height: 80 },
    { x: 1550, y: 2360, width: 30, height: 290 },
    { x: 2220, y: 2200, width: 30, height: 80 },
    { x: 2220, y: 2360, width: 30, height: 290 },

    // ===== 3. ナビゲーション (1700,300)-(2300,700) =====
    { x: 1700, y: 300, width: 600, height: 30 },
    { x: 1700, y: 670, width: 250, height: 30 },
    { x: 2030, y: 670, width: 270, height: 30 },
    { x: 1700, y: 300, width: 30, height: 220 },
    { x: 1700, y: 600, width: 30, height: 100 },
    { x: 2270, y: 300, width: 30, height: 220 },
    { x: 2270, y: 600, width: 30, height: 100 },

    // ===== 4. メッドベイ (900,450)-(1300,900) =====
    { x: 900, y: 450, width: 400, height: 30 },
    { x: 900, y: 870, width: 400, height: 30 },
    { x: 900, y: 450, width: 30, height: 150 },
    { x: 900, y: 680, width: 30, height: 220 },
    { x: 1270, y: 450, width: 30, height: 70 },
    { x: 1270, y: 600, width: 30, height: 300 },

    // ===== 5. エンジン (300,400)-(650,900) =====
    { x: 300, y: 400, width: 350, height: 30 },
    { x: 300, y: 870, width: 220, height: 30 },
    { x: 600, y: 870, width: 50, height: 30 },
    { x: 300, y: 400, width: 30, height: 500 },
    { x: 620, y: 400, width: 30, height: 200 },
    { x: 620, y: 680, width: 30, height: 220 },

    // ===== 6. セキュリティ (400,1250)-(800,1650) =====
    { x: 400, y: 1250, width: 120, height: 30 },
    { x: 600, y: 1250, width: 200, height: 30 },
    { x: 400, y: 1620, width: 200, height: 30 },
    { x: 680, y: 1620, width: 120, height: 30 },
    { x: 400, y: 1250, width: 30, height: 400 },
    { x: 770, y: 1250, width: 30, height: 150 },
    { x: 770, y: 1480, width: 30, height: 170 },

    // ===== 7. エレクトリカル (500,2000)-(1100,2450) =====
    { x: 500, y: 2000, width: 100, height: 30 },
    { x: 680, y: 2000, width: 420, height: 30 },
    { x: 500, y: 2420, width: 600, height: 30 },
    { x: 500, y: 2000, width: 30, height: 450 },
    { x: 1070, y: 2000, width: 30, height: 280 },
    { x: 1070, y: 2360, width: 30, height: 90 },

    // ===== 8. ウェポン (2800,350)-(3450,750) =====
    { x: 2800, y: 350, width: 650, height: 30 },
    { x: 2800, y: 720, width: 540, height: 30 },
    { x: 2800, y: 350, width: 30, height: 170 },
    { x: 2800, y: 600, width: 30, height: 150 },
    { x: 3420, y: 350, width: 30, height: 400 },

    // ===== 9. コックピット (3300,1000)-(3700,1400) =====
    { x: 3300, y: 1000, width: 40, height: 30 },
    { x: 3420, y: 1000, width: 280, height: 30 },
    { x: 3300, y: 1370, width: 80, height: 30 },
    { x: 3460, y: 1370, width: 240, height: 30 },
    { x: 3300, y: 1000, width: 30, height: 200 },
    { x: 3300, y: 1280, width: 30, height: 120 },
    { x: 3670, y: 1000, width: 30, height: 400 },

    // ===== 10. リアクター (3200,1600)-(3700,1900) =====
    { x: 3200, y: 1600, width: 180, height: 30 },
    { x: 3460, y: 1600, width: 240, height: 30 },
    { x: 3200, y: 1870, width: 180, height: 30 },
    { x: 3460, y: 1870, width: 240, height: 30 },
    { x: 3200, y: 1600, width: 30, height: 300 },
    { x: 3670, y: 1600, width: 30, height: 300 },

    // ===== 11. シールド (2900,2100)-(3500,2500) =====
    { x: 2900, y: 2100, width: 480, height: 30 },
    { x: 3460, y: 2100, width: 40, height: 30 },
    { x: 2900, y: 2470, width: 600, height: 30 },
    { x: 2900, y: 2100, width: 30, height: 180 },
    { x: 2900, y: 2360, width: 30, height: 140 },
    { x: 3470, y: 2100, width: 30, height: 400 },

    // ===== 通路（平行2本壁・直角のみ）=====
    { x: 650, y: 570, width: 250, height: 30 },
    { x: 650, y: 680, width: 250, height: 30 },
    { x: 1300, y: 490, width: 400, height: 30 },
    { x: 1300, y: 600, width: 400, height: 30 },
    { x: 2300, y: 490, width: 500, height: 30 },
    { x: 2300, y: 600, width: 500, height: 30 },
    { x: 1920, y: 700, width: 30, height: 450 },
    { x: 2030, y: 700, width: 30, height: 450 },
    { x: 3310, y: 750, width: 30, height: 250 },
    { x: 3420, y: 750, width: 30, height: 250 },
    { x: 2550, y: 1170, width: 750, height: 30 },
    { x: 2550, y: 1280, width: 750, height: 30 },
    { x: 3350, y: 1400, width: 30, height: 200 },
    { x: 3460, y: 1400, width: 30, height: 200 },
    { x: 3350, y: 1900, width: 30, height: 200 },
    { x: 3460, y: 1900, width: 30, height: 200 },
    { x: 2250, y: 2250, width: 650, height: 30 },
    { x: 2250, y: 2360, width: 650, height: 30 },
    { x: 1770, y: 1850, width: 30, height: 350 },
    { x: 1880, y: 1850, width: 30, height: 350 },
    { x: 800, y: 1370, width: 650, height: 30 },
    { x: 800, y: 1480, width: 650, height: 30 },
    { x: 490, y: 900, width: 30, height: 350 },
    { x: 600, y: 900, width: 30, height: 350 },
    { x: 570, y: 1650, width: 30, height: 350 },
    { x: 680, y: 1650, width: 30, height: 350 },
    { x: 1100, y: 2250, width: 450, height: 30 },
    { x: 1100, y: 2360, width: 450, height: 30 }
];

// ご提示いただいた11個のタスクデータ
let tasks = [
    { id: 1,  x: 2250, y: 1650, name: 'カフェテリア：ゴミ捨て',           completed: false },
    { id: 2,  x: 1900, y: 2500, name: 'ストレージ：燃料補給',             completed: false },
    { id: 3,  x: 2000, y: 450,  name: 'ナビゲーション：航路入力',         completed: false },
    { id: 4,  x: 1100, y: 700,  name: 'メッドベイ：スキャン',             completed: false },
    { id: 5,  x: 475,  y: 650,  name: 'エンジン：出力調整',               completed: false },
    { id: 6,  x: 600,  y: 1450, name: 'セキュリティ：カメラ確認',         completed: false },
    { id: 7,  x: 800,  y: 2250, name: 'エレクトリカル：配線修理',         completed: false },
    { id: 8,  x: 3100, y: 550,  name: 'ウェポン：砲台キャリブレーション', completed: false },
    { id: 9,  x: 3500, y: 1200, name: 'コックピット：操縦ログ提出',       completed: false },
    { id: 10, x: 3560, y: 1750, name: 'リアクター：炉心冷却',             completed: false },
    { id: 11, x: 3200, y: 2300, name: 'シールド：バリア起動',             completed: false }
];

io.on('connection', (socket) => {
    console.log(`プレイヤー接続: ${socket.id}`);

    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#ff6b81'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    
    // カフェテリア内（非常招集ボタン周辺）に安全にスポーン
    players[socket.id] = {
        id: socket.id,
        x: emergencyButton.x + (Math.random() * 40 - 20),
        y: emergencyButton.y + (Math.random() * 40 - 20),
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
        console.log(`プレイヤー切断: ${socket.id}`);
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
