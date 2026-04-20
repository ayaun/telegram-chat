const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, { 
    maxHttpBufferSize: 1e8, 
    cors: { origin: "*" } 
});
const fs = require('fs');
const path = require('path');

// Vercel 环境下 db.json 可能无法持久保存，但在单次部署运行中是可以读写的
const DB_FILE = '/tmp/db.json'; 
let db = { users: {}, groups: {}, allMsgs: [] };

// 尝试从临时目录或本地加载
if (fs.existsSync(DB_FILE)) {
    try {
        db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) { console.log("初始化数据库"); }
}

function saveDB() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    } catch (e) { console.error("保存失败"); }
}

app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

io.on('connection', (socket) => {
    console.log('新用户连接');

    socket.on('register', (data) => {
        const u = data.user ? data.user.trim() : "";
        if (!u) return socket.emit('sys-msg', '用户名不能为空');
        if (db.users[u]) return socket.emit('sys-msg', '用户名已占用');
        
        db.users[u] = { pass: data.pass, avatar: null, bio: 'Hello!', friends: [], requests: [], groups: [] };
        saveDB();
        socket.emit('auth-result', { success: true, isReg: true, msg: '注册成功！现在请点击登录' });
    });

    socket.on('login', (data) => {
        const u = data.user ? data.user.trim() : "";
        const userObj = db.users[u];
        if (userObj && userObj.pass === data.pass) {
            socket.username = u;
            userObj.socketId = socket.id;
            socket.emit('auth-result', { success: true, user: u, userData: userObj });
            socket.emit('load-history', db.allMsgs.filter(m => m.from === u || m.to === u));
        } else {
            socket.emit('auth-result', { success: false, msg: userObj ? '密码错误' : '用户不存在，请先注册' });
        }
    });

    socket.on('send-msg', (data) => {
        if(!socket.username) return;
        const msg = { 
            from: socket.username, to: data.to, text: data.text || "",
            image: data.image || null, video: data.video || null,
            time: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) 
        };
        db.allMsgs.push(msg);
        if (db.allMsgs.length > 200) db.allMsgs.shift();
        saveDB();
        io.emit('msg', msg); // 为了测试方便，暂时让所有人都能收到
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log('服务已启动'));
