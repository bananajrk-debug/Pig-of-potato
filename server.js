const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const WORLD_WIDTH = 4000;
const WORLD_HEIGHT = 4000;

const rooms = {};

const baseIslands = [
    { id: 'port_potato', name: '🥔 ポテト港町', x: 2000, y: 2000, radius: 250, type: 'port' },
    { id: 'island_1', name: 'バナナ島', x: 1000, y: 1000, radius: 150, type: 'resource' },
    { id: 'island_2', name: 'ソルト島', x: 3000, y: 1000, radius: 150, type: 'resource' },
    { id: 'island_3', name: 'フライ島', x: 1000, y: 3000, radius: 150, type: 'resource' },
    { id: 'island_4', name: 'マッシュ島', x: 3000, y: 3000, radius: 150, type: 'resource' }
];

const baseResources = [
    { id: 'res_1', x: 1000, y: 800, type: 'wood', amount: 5, active: true },
    { id: 'res_2', x: 800, y: 1000, type: 'wood', amount: 5, active: true },
    { id: 'res_3', x: 3000, y: 800, type: 'wood', amount: 5, active: true },
    { id: 'res_4', x: 3200, y: 1000, type: 'wood', amount: 5, active: true },
    { id: 'res_5', x: 1000, y: 3200, type: 'wood', amount: 5, active: true },
    { id: 'res_6', x: 800, y: 3000, type: 'wood', amount: 5, active: true },
    { id: 'res_7', x: 3000, y: 3200, type: 'wood', amount: 5, active: true },
    { id: 'res_8', x: 3200, y: 3000, type: 'wood', amount: 5, active: true },
];

io.on('connection', (socket) => {
    let currentRoom = null;
    let playerId = socket.id;

    socket.on('join_room', (data) => {
        const { roomCode, name, color, mode } = data;
        currentRoom = roomCode;

        if (!rooms[roomCode]) {
            rooms[roomCode] = {
                code: roomCode,
                mode: mode || 'multi',
                started: true, // すぐにゲーム開始状態にする
                players: {},
                ships: {},
                projectiles: [],
                enemies: [],
                islands: JSON.parse(JSON.stringify(baseIslands)),
                resources: JSON.parse(JSON.stringify(baseResources))
            };

            if (mode === 'cpu') {
                rooms[roomCode].enemies.push({
                    id: 'cpu_1',
                    x: 1800,
                    y: 1800,
                    angle: 0,
                    speed: 1.5,
                    hp: 100,
                    maxHp: 100,
                    radius: 40
                });
            }
        }

        const room = rooms[roomCode];
        socket.join(roomCode);

        room.players[playerId] = {
            id: playerId,
            name: name || '名無しの豚',
            color: color || '#ff99bb',
            x: 2000,
            y: 2150,
            angle: 0,
            isSteering: false,
            shipId: 'ship_' + playerId,
            wood: 0,
            coins: 100,
            ammoType: 1,
            ready: true
        };

        const shipId = 'ship_' + playerId;
        room.ships[shipId] = {
            id: shipId,
            ownerId: playerId,
            x: 2000,
            y: 2200,
            angle: 0,
            speed: 0,
            maxSpeed: 4,
            hp: 100,
            maxHp: 100,
            speedLevel: 1,
            radius: 45,
            leftCooldown: 0,
            rightCooldown: 0
        };

        updateRoomState(roomCode);
    });

    socket.on('player_input', (input) => {
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];
        const player = room.players[playerId];
        if (!player) return;

        const ship = room.ships[player.shipId];

        if (player.isSteering && ship) {
            if (input.w) ship.speed = Math.min(ship.speed + 0.1, ship.maxSpeed);
            if (input.s) ship.speed = Math.max(ship.speed - 0.1, -ship.maxSpeed / 2);
            if (!input.w && !input.s) ship.speed *= 0.95;

            if (input.a) ship.angle -= 0.03;
            if (input.d) ship.angle += 0.03;

            ship.x += Math.cos(ship.angle) * ship.speed;
            ship.y += Math.sin(ship.angle) * ship.speed;

            player.x = ship.x;
            player.y = ship.y;
            player.angle = ship.angle;
        } else {
            const moveSpeed = 3.5;
            let dx = 0, dy = 0;
            if (input.w) dy -= moveSpeed;
            if (input.s) dy += moveSpeed;
            if (input.a) dx -= moveSpeed;
            if (input.d) dx += moveSpeed;

            if (dx !== 0 || dy !== 0) {
                player.x += dx;
                player.y += dy;
                player.angle = Math.atan2(dy, dx);
            }
            if (ship && !player.isSteering) {
                // 船の近くにいる場合の位置連動などは自由移動を優先
            }
        }

        player.x = Math.max(50, Math.min(WORLD_WIDTH - 50, player.x));
        player.y = Math.max(50, Math.min(WORLD_HEIGHT - 50, player.y));
    });

    socket.on('toggle_steer', () => {
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];
        const player = room.players[playerId];
        const ship = room.ships[player.shipId];
        if (!player || !ship) return;

        if (player.isSteering) {
            player.isSteering = false;
            player.x = ship.x + 40;
            player.y = ship.y;
        } else {
            const dist = Math.hypot(player.x - ship.x, player.y - ship.y);
            if (dist < 100) {
                player.isSteering = true;
            }
        }
    });

    socket.on('fire_cannons', (side) => {
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];
        const player = room.players[playerId];
        const ship = room.ships[player.shipId];
        if (!player || !ship || !player.isSteering) return;

        const now = Date.now();
        if (side === 'left' && ship.leftCooldown <= now) {
            ship.leftCooldown = now + 1000;
            fireCannonBall(room, ship, -Math.PI / 2, player.ammoType, playerId);
        } else if (side === 'right' && ship.rightCooldown <= now) {
            ship.rightCooldown = now + 1000;
            fireCannonBall(room, ship, Math.PI / 2, player.ammoType, playerId);
        }
    });

    socket.on('repair_ship', () => {
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];
        const player = room.players[playerId];
        const ship = room.ships[player.shipId];
        if (!player || !ship) return;

        if (player.wood >= 2 && ship.hp < ship.maxHp) {
            player.wood -= 2;
            ship.hp = Math.min(ship.maxHp, ship.hp + 30);
        }
    });

    socket.on('gather_resource', () => {
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];
        const player = room.players[playerId];
        if (!player) return;

        room.resources.forEach(res => {
            if (res.active && Math.hypot(player.x - res.x, player.y - res.y) < 80) {
                res.active = false;
                player.wood += res.amount;
                setTimeout(() => {
                    if (rooms[currentRoom]) {
                        const targetRes = rooms[currentRoom].resources.find(r => r.id === res.id);
                        if (targetRes) targetRes.active = true;
                    }
                }, 30000);
            }
        });
    });

    socket.on('port_action', (action) => {
        if (!currentRoom || !rooms[currentRoom]) return;
        const room = rooms[currentRoom];
        const player = room.players[playerId];
        const ship = room.ships[player.shipId];
        if (!player || !ship) return;

        const port = room.islands.find(i => i.type === 'port');
        if (Math.hypot(player.x - port.x, player.y - port.y) < port.radius + 50) {
            if (action === 'sell_wood' && player.wood > 0) {
                player.coins += player.wood * 15;
                player.wood = 0;
            } else if (action === 'upgrade_speed' && player.coins >= 50 * ship.speedLevel) {
                player.coins -= 50 * ship.speedLevel;
                ship.speedLevel++;
                ship.maxSpeed += 1;
            } else if (action === 'upgrade_hp' && player.coins >= 100) {
                player.coins -= 100;
                ship.maxHp += 50;
                ship.hp = ship.maxHp;
            }
        }
    });

    socket.on('change_ammo', (type) => {
        if (!currentRoom || !rooms[currentRoom]) return;
        const player = rooms[currentRoom].players[playerId];
        if (player) player.ammoType = type;
    });

    socket.on('disconnect', () => {
        if (currentRoom && rooms[currentRoom]) {
            const room = rooms[currentRoom];
            delete room.players[playerId];
            if (room.ships['ship_' + playerId]) {
                delete room.ships['ship_' + playerId];
            }
            if (Object.keys(room.players).length === 0) {
                delete rooms[currentRoom];
            } else {
                updateRoomState(currentRoom);
            }
        }
    });
});

function fireCannonBall(room, ship, angleOffset, ammoType, shooterId) {
    const fireAngle = ship.angle + angleOffset;
    const spawnX = ship.x + Math.cos(fireAngle) * 30;
    const spawnY = ship.y + Math.sin(fireAngle) * 30;

    room.projectiles.push({
        id: Math.random().toString(36).substr(2, 9),
        x: spawnX,
        y: spawnY,
        vx: Math.cos(fireAngle) * 8,
        vy: Math.sin(fireAngle) * 8,
        ammoType: ammoType,
        shooterId: shooterId,
        range: 0
    });
}

setInterval(() => {
    for (const code in rooms) {
        const room = rooms[code];

        for (let i = room.projectiles.length - 1; i >= 0; i--) {
            const p = room.projectiles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.range += 8;

            let hit = false;
            for (const shipId in room.ships) {
                const ship = room.ships[shipId];
                if (ship.ownerId === p.shooterId) continue;
                if (Math.hypot(p.x - ship.x, p.y - ship.y) < ship.radius) {
                    let dmg = p.ammoType === 2 ? 35 : (p.ammoType === 3 ? 50 : 20);
                    ship.hp -= dmg;
                    hit = true;
                    break;
                }
            }

            for (let e = room.enemies.length - 1; e >= 0; e--) {
                const enemy = room.enemies[e];
                if (Math.hypot(p.x - enemy.x, p.y - enemy.y) < enemy.radius) {
                    enemy.hp -= 25;
                    hit = true;
                    if (enemy.hp <= 0) {
                        room.enemies.splice(e, 1);
                        const shooterPlayer = room.players[p.shooterId];
                        if (shooterPlayer) shooterPlayer.coins += 200;
                    }
                    break;
                }
            }

            if (hit || p.range > 600 || p.x < 0 || p.x > WORLD_WIDTH || p.y < 0 || p.y > WORLD_HEIGHT) {
                room.projectiles.splice(i, 1);
            }
        }

        room.enemies.forEach(enemy => {
            let closestShip = null;
            let minDist = Infinity;
            for (const shipId in room.ships) {
                const s = room.ships[shipId];
                const dist = Math.hypot(s.x - enemy.x, s.y - enemy.y);
                if (dist < minDist) {
                    minDist = dist;
                    closestShip = s;
                }
            }

            if (closestShip) {
                const targetAngle = Math.atan2(closestShip.y - enemy.y, closestShip.x - enemy.x);
                enemy.angle = targetAngle;
                if (minDist > 200) {
                    enemy.x += Math.cos(enemy.angle) * enemy.speed;
                    enemy.y += Math.sin(enemy.angle) * enemy.speed;
                }
            }
        });

        for (const shipId in room.ships) {
            const ship = room.ships[shipId];
            room.islands.forEach(island => {
                const dist = Math.hypot(ship.x - island.x, ship.y - island.y);
                if (dist < island.radius + ship.radius) {
                    const pushAngle = Math.atan2(ship.y - island.y, ship.x - island.x);
                    ship.x = island.x + Math.cos(pushAngle) * (island.radius + ship.radius);
                    ship.y = island.y + Math.sin(pushAngle) * (island.radius + ship.radius);
                    ship.speed = 0;
                }
            });
        }

        io.to(code).emit('game_update', {
            players: room.players,
            ships: room.ships,
            projectiles: room.projectiles,
            enemies: room.enemies,
            resources: room.resources,
            islands: room.islands
        });
    }
}, 1000 / 60);

function updateRoomState(roomCode) {
    const room = rooms[roomCode];
    if (room) {
        io.to(roomCode).emit('room_state', {
            code: room.code,
            mode: room.mode,
            started: room.started,
            players: room.players
        });
    }
}

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Pig of Potato server running on port ${PORT}`);
});
