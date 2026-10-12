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
const emergencyButton = { x: 1800, y: 1200 };

// 綺麗につながった「部屋（島）」と「廊下（通路）」の壁データ
// マップサイズ: 3600 x 2600
const walls = [
    // --- 【外周の壁】 ---
    { x: 200, y: 200, width: 3200, height: 30 }, // 上
    { x: 200, y: 2400, width: 3200, height: 30 }, // 下
    { x: 200, y: 200, width: 30, height: 2230 }, // 左
    { x: 3400, y: 200, width: 30, height: 2230 }, // 右

    // ==========================================
    // 1. 【中央：カフェテリア】 (x: 1500〜2100, y: 900〜1500)
    // ==========================================
    // 上壁（左右に通路用の隙間をあける）
    { x: 1500, y: 900, width: 220, height: 25 },
    { x: 1880, y: 900, width: 220, height: 25 },
    // 下壁
    { x: 1500, y: 1500, width: 220, height: 25 },
    { x: 1880, y: 1500, width: 220, height: 25 },
    // 左壁（上下に通路用の隙間）
    { x: 1500, y: 900, width: 25, height: 180 },
    { x: 1500, y: 1280, width: 25, height: 220 },
    // 右壁
    { x: 2075, y: 900, width: 25, height: 180 },
    { x: 2075, y: 1280, width: 25, height: 220 },


    // ==========================================
    // 2. 【左上：コックピット】 (x: 600〜1000, y: 400〜800)
    // ==========================================
    { x: 600, y: 400, width: 400, height: 25 },
    { x: 600, y: 800, width: 400, height: 25 },
    { x: 600, y: 400, width: 25, height: 160 },
    { x: 600, y: 640, width: 25, height: 160 }, // 左下に出入り口
    { x: 975, y: 400, width: 25, height: 400 },


    // ==========================================
    // 3. 【左下：エンジンルーム】 (x: 600〜1000, y: 1600〜2000)
    // ==========================================
    { x: 600, y: 1600, width: 400, height: 25 },
    { x: 600, y: 2000, width: 400, height: 25 },
    { x: 600, y: 1600, width: 25, height: 160 },
    { x: 600, y: 1840, width: 25, height: 160 }, // 左上に出入り口
    { x: 975, y: 1600, width: 25, height: 400 },


    // ==========================================
    // 4. 【右上：ウェポンルーム】 (x: 2600〜3000, y: 400〜800)
    // ==========================================
    { x: 2600, y: 400, width: 400, height: 25 },
    { x: 2600, y: 800, width: 400, height: 25 },
    { x: 2600, y: 400, width: 25, height: 400 },
    { x: 2975, y: 400, width: 25, height: 160 },
    { x: 2975, y: 640, width: 25, height: 160 }, // 右下に出入り口


    // ==========================================
    // 5. 【右下：ナビゲーション】 (x: 2600〜3000, y: 1600〜2000)
    // ==========================================
    { x: 2600, y: 1600, width: 400, height: 25 },
    { x: 2600, y: 2000, width: 400, height: 25 },
    { x: 2600, y: 1600, width: 25, height: 400 },
    { x: 2975, y: 1600, width: 25, height: 160 },
    { x: 2975, y: 1840, width: 25, height: 160 }, // 右上に出入り口


    // ==========================================
    // 6. 【部屋をつなぐ「廊下（通路）」の壁】
    // ==========================================
    // カフェテリア左側から伸びる水平の廊下（上下の壁で挟む。幅は y: 900 〜 y: 1000 の約100px）
    { x: 1000, y: 900, width: 500, height: 25 },  // 廊上の上壁
    { x: 1000, y: 1025, width: 500, height: 25 }, // 廊下の下壁

    // カフェテリア右側から伸びる水平の廊下
    { x: 2100, y: 900, width: 500, height: 25 },  // 廊上の上壁
    { x: 2100, y: 1025, width: 500, height: 25 }, // 廊下の下壁

    // コックピット（上）へ縦に伸びる廊下（左右の壁で挟む）
    { x: 975, y: 780, width: 25, height: 145 },   // 廊下の左壁
    { x: 1100, y: 780, width: 25, height: 145 },  // 廊下の右壁

    // エンジンルーム（下）へ縦に伸びる廊下
    { x: 975, y: 1475, width: 25, height: 145 },  // 廊下の左壁
    { x: 1100, y: 1475, width: 25, height: 145 }, // 廊下の右壁

    // ウェポン（右上）へ縦に伸びる廊下
    { x: 2500, y: 780, width: 25, height: 145 },  // 廊下の左壁
    { x: 2625, y: 780, width: 25, height: 145 },  // 廊下の右壁

    // ナビゲーション（右下）へ縦に伸びる廊下
    { x: 2500, y: 1475, width: 25, height: 145 }, // 廊下の左壁
    { x: 2625, y: 1475, width: 25, height: 145 }, // 廊下の右壁
];

// 各部屋や廊下に配置されたタスク
let tasks = [
    { id: 1, x: 800, y: 600, name: 'コックピット機器調整', completed: false },
    { id: 2, x: 800, y: 1800, name: 'エンジン燃料給油', completed: false },
    { id: 3, x: 1800, y: 1050, name: 'カフェテリア配線', completed: false },
    { id: 4, x: 1800, y: 1350, name: 'ゴミ処理', completed: false },
    { id: 5, x: 2800, y: 600, name: 'ウェポン照準合わせ', completed: false },
    { id: 6, x: 2800, y: 1800, name: 'ナビゲーション設定', completed: false }
];

io.on('connection', (socket) => {
    console.log(`プレイヤー接続: ${socket.id}`);

    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#ff6b81'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    
    players[socket.id] = {
        id: socket.id,
        x: 1800 + Math.random() * 30,
        y: 1200 + Math.random() * 30,
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
