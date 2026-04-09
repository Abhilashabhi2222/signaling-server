const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

const rooms = {};

console.log('Signaling server starting...');

io.on('connection', (socket) => {
    console.log('New connection:', socket.id,
        'transport:', socket.conn.transport.name);

    socket.on('register', (data) => {
        const { uid, role, type = 'camera' } = data;
        console.log(`Register: uid=${uid} role=${role} type=${type}`);

        if (!rooms[uid]) rooms[uid] = {};
        if (!rooms[uid][type]) rooms[uid][type] = { child: null, parent: null };

        if (role === 'child') {
            rooms[uid][type].child = socket;
            socket.uid  = uid;
            socket.role = 'child';
            socket.type = type;

            const parent = rooms[uid][type].parent;
            if (parent) {
                parent.emit('child-online', { uid, type });
                socket.emit('request-stream', { type });
                console.log(`Child joined — told to stream uid=${uid} type=${type}`);
            }

        } else if (role === 'parent') {
            rooms[uid][type].parent = socket;
            socket.uid  = uid;
            socket.role = 'parent';
            socket.type = type;

            const child = rooms[uid][type].child;
            if (child) {
                child.emit('request-stream', { type });
                socket.emit('child-online', { uid, type });
                console.log(`Parent joined — child already here uid=${uid} type=${type}`);
            } else {
                socket.emit('child-offline', { uid, type });
                console.log(`Parent joined — child not here yet uid=${uid} type=${type}`);
            }
        }
    });

    socket.on('offer', (data) => {
        const { uid, type = 'camera' } = data;
        console.log(`Offer from child uid=${uid} type=${type}`);
        const parent = rooms[uid]?.[type]?.parent;
        if (parent) {
            parent.emit('offer', data);
            console.log(`Offer forwarded to parent uid=${uid} type=${type}`);
        } else {
            console.log(`No parent for offer uid=${uid} type=${type}`);
        }
    });

    socket.on('answer', (data) => {
        const { uid, type = 'camera' } = data;
        console.log(`Answer from parent uid=${uid} type=${type}`);
        const child = rooms[uid]?.[type]?.child;
        if (child) {
            child.emit('answer', data);
            console.log(`Answer forwarded to child uid=${uid} type=${type}`);
        }
    });

    socket.on('ice-candidate', (data) => {
        const { uid, type = 'camera' } = data;
        const room = rooms[uid]?.[type];
        if (!room) return;

        if (socket.role === 'child') {
            room.parent?.emit('ice-candidate', data);
            console.log(`ICE child→parent uid=${uid} type=${type}`);
        } else {
            room.child?.emit('ice-candidate', data);
            console.log(`ICE parent→child uid=${uid} type=${type}`);
        }
    });

    socket.on('disconnect', () => {
        const { uid, role, type } = socket;
        console.log(`Disconnected: uid=${uid} role=${role} type=${type}`);

        if (!uid || !type || !rooms[uid]?.[type]) return;

        if (role === 'child') {
            rooms[uid][type].child = null;
            rooms[uid][type].parent?.emit('child-offline', { uid, type });
        } else if (role === 'parent') {
            rooms[uid][type].parent = null;
            rooms[uid][type].child?.emit('stop-stream', { type });
        }

        if (!rooms[uid][type].child && !rooms[uid][type].parent) {
            delete rooms[uid][type];
            if (Object.keys(rooms[uid]).length === 0) delete rooms[uid];
        }
    });
});

app.get('/', (req, res) => {
    res.json({ status: 'running', message: 'Signaling server online' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✓ Signaling server running on port ${PORT}`);
    console.log(`✓ Visit http://localhost:${PORT}\n`);
});

const https = require('https');
const RENDER_URL = 'https://signaling-server.onrender.com';

setInterval(() => {
    https.get(RENDER_URL, (res) => {
        console.log(`Keep-alive ping: ${res.statusCode}`);
    }).on('error', (e) => {
        console.log(`Keep-alive error: ${e.message}`);
    });
}, 10 * 60 * 1000); 