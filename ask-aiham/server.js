import express from 'express';
import Database from 'better-sqlite3';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 32) throw new Error('Set SESSION_SECRET (32+ chars)');
const dbPath = process.env.DB_PATH || './data/ask-aiham.sqlite';
fs.mkdirSync(path.dirname(dbPath), {recursive:true});
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, admin INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS questions (id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, name TEXT NOT NULL, visibility TEXT NOT NULL CHECK(visibility IN ('public','private')), status TEXT NOT NULL DEFAULT 'pending', user_id INTEGER REFERENCES users(id), guest_hash TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS replies (id INTEGER PRIMARY KEY, question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE, body TEXT NOT NULL, author TEXT NOT NULL, author_id INTEGER REFERENCES users(id), approved INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_questions_status ON questions(status,created_at);
CREATE INDEX IF NOT EXISTS idx_replies_question ON replies(question_id);
`);
const hashPassword = (p) => { const salt=crypto.randomBytes(16).toString('hex');return `${salt}:${crypto.scryptSync(p,salt,64).toString('hex')}`; };
const checkPassword = (p,stored) => {try {const [salt,h]=stored.split(':');return crypto.timingSafeEqual(crypto.scryptSync(p,salt,64),Buffer.from(h,'hex'));}catch{return false;}};
const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
if (adminEmail && process.env.ADMIN_PASSWORD) {
 const existing=db.prepare('SELECT id FROM users WHERE email=?').get(adminEmail);
 if (!existing) db.prepare('INSERT INTO users(name,email,password,admin) VALUES(?,?,?,1)').run('Aiham',adminEmail,hashPassword(process.env.ADMIN_PASSWORD));
 else db.prepare('UPDATE users SET admin=1 WHERE id=?').run(existing.id);
}
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","https://fonts.googleapis.com"],fontSrc:["'self'","https://fonts.gstatic.com"],imgSrc:["'self'","data:"],connectSrc:["'self'"]}}}));
app.use(express.json({limit:'40kb'}));app.use(cookieParser());app.use(express.static('public'));
const sign=(s)=>crypto.createHmac('sha256',secret).update(s).digest('base64url');
const makeSession=(id)=>{const payload=`${id}.${Date.now()+1000*60*60*24*14}`;return `${payload}.${sign(payload)}`;};
function userFrom(req){const t=req.cookies.session;if(!t)return null;const parts=t.split('.');if(parts.length!==3)return null;const payload=parts.slice(0,2).join('.');if(!crypto.timingSafeEqual(Buffer.from(sign(payload)),Buffer.from(parts[2])))return null;if(Number(parts[1])<Date.now())return null;return db.prepare('SELECT id,name,email,admin FROM users WHERE id=?').get(Number(parts[0]))||null;}
function safeUser(req,res,next){try{req.user=userFrom(req);}catch{req.user=null;}next();}
app.use(safeUser);
const limit=new Map();
function rate(req,res,next){const ip=req.ip||'unknown';const now=Date.now();const item=limit.get(ip)||{n:0,until:now+60000};if(now>item.until){item.n=0;item.until=now+60000;}item.n++;limit.set(ip,item);if(item.n>35)return res.status(429).json({error:'Too many requests. Try again shortly.'});next();}
app.use('/api',rate);
const clean=(s,max)=>typeof s==='string'?s.trim().slice(0,max):'';
const err=(res,status,message)=>res.status(status).json({error:message});
const tokenHash=t=>crypto.createHash('sha256').update(t).digest('hex');
const canView=(q,req,token)=>!!(req.user?.admin || (q.user_id && req.user?.id===q.user_id) || (q.guest_hash && token && tokenHash(token)===q.guest_hash) || (q.visibility==='public'&&q.status==='published'));
const canReply=(q,req,token)=>!!(req.user?.admin || (q.user_id && req.user?.id===q.user_id) || (q.guest_hash && token && tokenHash(token)===q.guest_hash));
function viewQuestion(q,req){return {...q,guest_hash:undefined,user_id:undefined,replies:db.prepare('SELECT id,body,author,created_at,approved FROM replies WHERE question_id=? ORDER BY id').all(q.id).filter(r=>req.user?.admin || q.visibility==='private' || r.approved).map(({approved,...r})=>r)};}
app.get('/api/me',(req,res)=>res.json({user:req.user||null}));
app.post('/api/register',(req,res)=>{const name=clean(req.body.name,60),email=clean(req.body.email,160).toLowerCase(),pass=req.body.password;if(name.length<2||!email.includes('@')||typeof pass!=='string'||pass.length<10)return err(res,400,'Enter a name, valid email, and password (10+ characters).');try{const x=db.prepare('INSERT INTO users(name,email,password) VALUES(?,?,?)').run(name,email,hashPassword(pass));res.cookie('session',makeSession(x.lastInsertRowid),{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:14*86400000});res.json({ok:true});}catch{return err(res,409,'Email already registered.');}});
app.post('/api/login',(req,res)=>{const u=db.prepare('SELECT * FROM users WHERE email=?').get(clean(req.body.email,160).toLowerCase());if(!u||!checkPassword(req.body.password||'',u.password))return err(res,401,'Invalid credentials.');res.cookie('session',makeSession(u.id),{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:14*86400000});res.json({ok:true});});
app.post('/api/logout',(req,res)=>{res.clearCookie('session');res.json({ok:true});});
app.post('/api/questions',(req,res)=>{if(req.body.website)return res.json({ok:true});const title=clean(req.body.title,130),body=clean(req.body.body,4000),visibility=req.body.visibility==='private'?'private':'public',name=req.user?.name||clean(req.body.name,60);if(title.length<4||body.length<8||name.length<2)return err(res,400,'Name, title, and question are required.');const token=req.user?null:crypto.randomBytes(32).toString('base64url');const result=db.prepare('INSERT INTO questions(title,body,name,visibility,user_id,guest_hash) VALUES(?,?,?,?,?,?)').run(title,body,name,visibility,req.user?.id||null,token?tokenHash(token):null);res.json({id:result.lastInsertRowid,token,visibility});});
app.get('/api/questions',(req,res)=>{const rows=db.prepare("SELECT id,title,body,name,visibility,status,created_at FROM questions WHERE visibility='public' AND status='published' ORDER BY id DESC LIMIT 100").all();res.json({questions:rows});});
app.get('/api/mine',(req,res)=>{if(!req.user)return err(res,401,'Log in first.');res.json({questions:db.prepare('SELECT id,title,visibility,status,created_at FROM questions WHERE user_id=? ORDER BY id DESC').all(req.user.id)});});
app.get('/api/questions/:id',(req,res)=>{const q=db.prepare('SELECT * FROM questions WHERE id=?').get(req.params.id);if(!q||!canView(q,req,clean(req.query.token,200)))return err(res,404,'Question not found or access denied.');res.json({question:viewQuestion(q,req),canReply:canReply(q,req,clean(req.query.token,200))});});
app.post('/api/questions/:id/replies',(req,res)=>{const q=db.prepare('SELECT * FROM questions WHERE id=?').get(req.params.id),token=clean(req.body.token,200);if(!q||!canReply(q,req,token))return err(res,403,'Not authorized to reply.');const body=clean(req.body.body,4000);if(body.length<2)return err(res,400,'Reply is too short.');const author=req.user?.admin?'Aiham':q.name;db.prepare('INSERT INTO replies(question_id,body,author,author_id,approved) VALUES(?,?,?,?,?)').run(q.id,body,author,req.user?.id||null,req.user?.admin?1:0);res.json({ok:true});});
function admin(req,res,next){if(!req.user?.admin)return err(res,403,'Admin only.');next();}
app.get('/api/admin/questions',admin,(req,res)=>{res.json({questions:db.prepare('SELECT id,title,body,name,visibility,status,created_at FROM questions ORDER BY id DESC LIMIT 300').all(),pendingReplies:db.prepare('SELECT replies.id,replies.question_id,replies.body,replies.author FROM replies JOIN questions ON questions.id=replies.question_id WHERE replies.approved=0 AND questions.visibility="public" ORDER BY replies.id DESC').all()});});
app.patch('/api/admin/questions/:id',admin,(req,res)=>{const status=req.body.status;if(!['pending','published','hidden'].includes(status))return err(res,400,'Invalid status.');db.prepare('UPDATE questions SET status=? WHERE id=?').run(status,req.params.id);res.json({ok:true});});
app.patch('/api/admin/replies/:id',admin,(req,res)=>{db.prepare('UPDATE replies SET approved=? WHERE id=?').run(req.body.approved?1:0,req.params.id);res.json({ok:true});});
app.delete('/api/admin/questions/:id',admin,(req,res)=>{db.prepare('DELETE FROM questions WHERE id=?').run(req.params.id);res.json({ok:true});});
app.delete('/api/admin/replies/:id',admin,(req,res)=>{db.prepare('DELETE FROM replies WHERE id=?').run(req.params.id);res.json({ok:true});});
app.get('*',(req,res)=>res.sendFile(path.resolve('public/index.html')));
app.listen(PORT,()=>console.log(`Ask Aiham listening on ${PORT}`));
