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

// 非常招集ボタン（中央カフェテリア）
const emergencyButton = { x: 1200, y: 900 };

// 【コンパクトかつ通路が広いAmong Us風マップ】 (マップサイズ: 2400 x 1800)
const walls = [
    // --- 外周の壁 ---
    { x: 100, y: 100, width: 2200, height: 25 },
    { x: 100, y: 1675, width: 2200, height: 25 },
    { x: 100, y: 100, width: 25, height: 1600 },
    { x: 2275, y: 100, width: 25, height: 1600 },

    // ==========================================
    // 1. カフェテリア (中央: 1000,750 〜 1400,1050) 大部屋
    // ==========================================
    { x: 1000, y: 750, width: 140, height: 25 },
    { x: 1260, y: 750, width: 140, height: 25 }, // 上ドア (1140-1260)
    { x: 1000, y: 1025, width: 140, height: 25 },
    { x: 1260, y: 1025, width: 140, height: 25 }, // 下ドア (1140-1260)
    { x: 1000, y: 750, width: 25, height: 100 },
    { x: 1000, y: 890, width: 25, height: 135 },  // 左ドア (850-890)
    { x: 1375, y: 750, width: 25, height: 100 },
    { x: 1375, y: 890, width: 25, height: 135 },  // 右ドア (850-890)

    // ==========================================
    // 2. ストレージ (下部中央: 1050,1300 〜 1350,1550) 中部屋
    // ==========================================
    { x: 1050, y: 1300, width: 100, height: 25 },
    { x: 1250, y: 1300, width: 100, height: 25 }, // 上ドア (1150-1250)
    { x: 1050, y: 1525, width: 300, height: 25 },
    { x: 1050, y: 1300, width: 25, height: 100 },
    { x: 1050, y: 1440, width: 25, height: 85 },  // 左ドア (1400-1440)
    { x: 1325, y: 1300, width: 25, height: 100 },
    { x: 1325, y: 1440, width: 25, height: 85 },  // 右ドア (1400-1440)

    // ==========================================
    // 3. ナビゲーション (上部中央: 1050,250 〜 1350,500)
    // ==========================================
    { x: 1050, y: 250, width: 300, height: 25 },
    { x: 1050, y: 475, width: 100, height: 25 },
    { x: 1250, y: 475, width: 100, height: 25 }, // 下ドア (1150-1250)
    { x: 1050, y: 250, width: 25, height: 100 },
    { x: 1050, y: 390, width: 25, height: 85 },  // 左ドア (350-390)
    { x: 1325, y: 250, width: 25, height: 100 },
    { x: 1325, y: 390, width: 25, height: 85 },  // 右ドア (350-390)

    // ==========================================
    // 4. メッドベイ (中左上: 650,350 〜 900,600)
    // ==========================================
    { x: 650, y: 350, width: 250, height: 25 },
    { x: 650, y: 575, width: 250, height: 25 },
    { x: 650, y: 350, width: 25, height: 100 },
    { x: 650, y: 490, width: 25, height: 85 },  // 左ドア (450-490)
    { x: 875, y: 350, width: 25, height: 95 },
    { x: 875, y: 480, width: 25, height: 95 },  // 右ドア (440-480)

    // ==========================================
    // 5. エンジン (左上: 250,300 〜 500,600)
    // ==========================================
    { x: 250, y: 300, width: 250, height: 25 },
    { x: 250, y: 575, width: 100, height: 25 },
    { x: 400, y: 575, width: 100, height: 25 }, // 下ドア (350-400)
    { x: 250, y: 300, width: 25, height: 275 },
    { x: 475, y: 300, width: 25, height: 95 },
    { x: 475, y: 430, width: 25, height: 145 }, // 右ドア (390-430)

    // ==========================================
    // 6. セキュリティ (左中: 300,800 〜 550,1100)
    // ==========================================
    { x: 300, y: 800, width: 250, height: 25 },
    { x: 300, y: 1075, width: 250, height: 25 },
    { x: 300, y: 800, width: 25, height: 100 },
    { x: 300, y: 940, width: 25, height: 135 },  // 左ドア (900-940)
    { x: 525, y: 800, width: 25, height: 95 },
    { x: 525, y: 935, width: 25, height: 140 },  // 右ドア (895-935)

    // ==========================================
    // 7. エレクトリカル (左下: 350,1300 〜 600,1550)
    // ==========================================
    { x: 350, y: 1300, width: 250, height: 25 },
    { x: 350, y: 1525, width: 250, height: 25 },
    { x: 350, y: 1300, width: 25, height: 90 },
    { x: 350, y: 1430, width: 25, height: 95 },  // 左ドア (1390-1430)
    { x: 575, y: 1300, width: 25, height: 95 },
    { x: 575, y: 1435, width: 25, height: 90 },  // Right door

    // ==========================================
    // 8. ウェポン (右上: 1500,350 〜 1750,600)
    // ==========================================
    { x: 1500, y: 350, width: 250, height: 25 },
    { x: 1500, y: 575, width: 250, height: 25 },
    { x: 1500, y: 350, width: 25, height: 95 },
    { x: 1500, y: 485, width: 25, height: 90 },  // Left door
    { x: 1725, y: 350, width: 25, height: 100 },
    { x: 1725, y: 490, width: 25, height: 85 },  // Right door

    // ==========================================
    // 9. アドミン (中右: 1550,800 〜 1850,1100)
    // ==========================================
    { x: 1550, y: 800, width: 300, height: 25 },
    { x: 1550, y: 1075, width: 300, height: 25 },
    { x: 1550, y: 800, width: 25, height: 100 },
    { x: 1550, y: 940, width: 25, height: 135 },  // Left door
    { x: 1825, y: 800, width: 25, height: 100 },
    { x: 1825, y: 940, width: 25, height: 135 },  // Right door

    // ==========================================
    // 10. シールド (右下: 1600,1300 〜 1850,1550)
    // ==========================================
    { x: 1600, y: 1300, width: 250, height: 25 },
    { x: 1600, y: 1525, width: 250, height: 25 },
    { x: 1600, y: 1300, width: 25, height: 90 },
    { x: 1600, y: 1430, width: 25, height: 95 },  // Left door
    { x: 1825, y: 1300, width: 25, height: 95 },
    { x: 1825, y: 1435, width: 25, height: 90 },  // Right door

    // ==========================================
    // 11. 広めの接続通路（幅を約80ピクセルに拡張）
    // ==========================================
    // カフェテリア ⇔ ナビゲーション
    { x: 1140, y: 500, width: 25, height: 250 },
    { x: 1220, y: 500, width: 25, height: 250 },
    // カフェテリア ⇔ ストレージ
    { x: 1140, y: 1025, width: 25, height: 275 },
    { x: 1220, y: 1025, width: 25, height: 275 },
    // カフェテリア ⇔ セキュリティ
    { x: 525, y: 850, width: 475, height: 25 },
    { x: 525, y: 930, width: 475, height: 25 },
    // カフェテリア ⇔ アドミン
    { x: 1400, y: 850, width: 150, height: 25 },
    { x: 1400, y: 930, width: 150, height: 25 },
    // エンジン ⇔ メッドベイ
    { x: 500, y: 440, width: 150, height: 25 },
    { x: 500, y: 520, width: 150, height: 25 },
    // メッドベイ ⇔ ウェポン
    { x: 900, y: 440, width: 600, height: 25 },
    { x: 900, y: 520, width: 600, height: 25 },
    // アドミン ⇔ シールド
    { x: 1350, y: 1400, width: 250, height: 25 },
    { x: 1350, y: 1480, width: 250, height: 25 },
    // ストレージ ⇔ エレクトリカル
    { x: 600, y: 1400, width: 450, height: 25 },
    { x: 600, y: 1480, width: 450, height: 25 },
];

let tasks = [
    { id: 1,  x: 1200, y: 900,  name: 'カフェテリア：配線修理', completed: false },
    { id: 2,  x: 1200, y: 1420, name: 'ストレージ：ゴミ捨て',     completed: false },
    { id: 3,  x: 1200, y: 370,  name: 'ナビゲーション：操縦',   completed: false },
    { id: 4,  x: 775,  y: 475,  name: 'メッドベイ：スキャン',   completed: false },
    { id: 5,  x: 375,  y: 440,  name: 'エンジン：燃料補給',     completed: false },
    { id: 6,  x: 410,  y: 940,  name: 'セキュリティ：カメラ',   completed: false },
    { id: 7,  x: 460,  y: 1410, name: 'エレクトリカル：配電盤', completed: false },
    { id: 8,  x: 1610, y: 460,  name: 'ウェポン：砲台調整',     completed: false },
    { id: 9,  x: 1690, y: 940,  name: 'アドミン：カードキー',   completed: false },
    { id: 10, x: 1715, y: 1415, name: 'シールド：バリア起動',   completed: false },
    { id: 11, x: 1200, y: 1200, name: '廊下：緊急点検',         completed: false }
];

io.on('connection', (socket) => {
    console.log(`プレイヤー接続: ${socket.id}`);

    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#ff6b81'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    
    players[socket.id] = {
        id: socket.id,
        x: emergencyButton.x + (Math.random() * 20 - 10),
        y: emergencyButton.y + (Math.random() * 20 - 10),
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
