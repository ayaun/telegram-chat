const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, { 
    maxHttpBufferSize: 1e8, // 100MB 限制
    cors: { origin: "*" } 
});
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'db.json');
let db = { users: {}, groups: {}, allMsgs: [] };

// 加载数据库
if (fs.existsSync(DB_FILE)) {
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        if (data) db = JSON.parse(data);
    } catch (e) { console.log("初始化数据库"); }
}

function saveDB() { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

io.on('connection', (socket) => {
    // --- 认证系统 ---
    socket.on('register', (data) => {
        if (!data.user || db.users[data.user]) return socket.emit('sys-msg', '用户名已占用');
        db.users[data.user] = { pass: data.pass, avatar: null, bio: '新用户', friends: [], requests: [], groups: [] };
        saveDB(); 
        socket.emit('auth-result', { success: true, isReg: true });
    });

    socket.on('login', (data) => {
        const u = db.users[data.user];
        if (u && u.pass === data.pass) {
            socket.username = data.user; u.socketId = socket.id;
            u.groups = u.groups || []; u.friends = u.friends || []; u.requests = u.requests || [];
            u.groups.forEach(gid => socket.join(gid));
            const groupList = u.groups.filter(gid => db.groups[gid]).map(gid => ({ id: gid, name: db.groups[gid].name }));
            socket.emit('auth-result', { success: true, user: data.user, userData: u, allGroups: groupList });
            socket.emit('load-history', db.allMsgs.filter(m => m.from === data.user || m.to === data.user || (m.isGroup && u.groups.includes(m.to))));
        } else {
            socket.emit('auth-result', { success: false, msg: u ? '密码错误' : '用户不存在，请先注册' });
        }
    });

    // --- 消息系统 ---
    socket.on('send-msg', (data) => {
        if(!socket.username) return;
        const msg = { 
            id: Date.now() + Math.random(),
            from: socket.username, to: data.to, text: data.text || "",
            avatar: db.users[socket.username].avatar,
            image: data.image || null, video: data.video || null,
            isGroup: data.isGroup,
            time: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) 
        };
        db.allMsgs.push(msg); 
        if (db.allMsgs.length > 500) db.allMsgs.shift();
        saveDB();
        if (data.isGroup) io.to(data.to).emit('msg', msg);
        else {
            if (db.users[data.to] && db.users[data.to].socketId) io.to(db.users[data.to].socketId).emit('msg', msg);
            socket.emit('msg', msg);
        }
    });

    // --- 资料与社交 ---
    socket.on('get-user-info', n => {
        const u = db.users;
        if(u) socket.emit('user-info-card', { user: n, avatar: u.avatar, bio: u.bio });
    });

    socket.on('update-profile', d => {
        if(db.users[socket.username]) {
            Object.assign(db.users[socket.username], d);
            saveDB();
            socket.emit('update-data', { userData: db.users[socket.username] });
        }
    });

    socket.on('find-user', n => {
        const u = db.users;
        if(u) socket.emit('search-result', {user: n, avatar: u.avatar, bio: u.bio});
        else socket.emit('sys-msg', '未找到用户');
    });

    socket.on('add-request', t => {
        if (db.users[t] && t !== socket.username) {
            if(!db.users[t].requests.includes(socket.username)) db.users[t].requests.push(socket.username);
            saveDB();
            if(db.users[t].socketId) io.to(db.users[t].socketId).emit('update-data', {userData: db.users[t]});
            socket.emit('sys-msg', '申请已发送');
        }
    });

    socket.on('accept-friend', n => {
        const me = db.users[socket.username], f = db.users;
        if (me && f) {
            if(!me.friends.includes(n)) me.friends.push(n);
            if(!f.friends.includes(socket.username)) f.friends.push(socket.username);
            me.requests = me.requests.filter(r => r !== n);
            saveDB();
            socket.emit('update-data', { userData: me });
            if (f.socketId) io.to(f.socketId).emit('update-data', { userData: f });
        }
    });

    // --- 群组 ---
    socket.on('create-group', (name) => {
        const gid = 'G' + Date.now();
        db.groups[gid] = { name: name, members: [socket.username] };
        db.users[socket.username].groups.push(gid);
        saveDB(); socket.join(gid);
        const gList = db.users[socket.username].groups.map(id => ({ id: id, name: db.groups[id].name }));
        socket.emit('update-data', { userData: db.users[socket.username], allGroups: gList });
    });

    socket.on('invite-friend', ({ groupId, friendName }) => {
        const f = db.users[friendName], g = db.groups[groupId];
        if (f && g && !g.members.includes(friendName)) {
            g.members.push(friendName); f.groups.push(groupId);
            saveDB();
            if (f.socketId) {
                const s = io.sockets.sockets.get(f.socketId); if(s) s.join(groupId);
                const gList = f.groups.map(id => ({ id: id, name: db.groups[id].name }));
                io.to(f.socketId).emit('update-data', { userData: f, allGroups: gList });
            }
            socket.emit('sys-msg', '已邀请');
        }
    });

    socket.on('disconnect', () => { if(socket.username) db.users[socket.username].socketId = null; });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`🚀 服务启动在端口 ${PORT}`));
