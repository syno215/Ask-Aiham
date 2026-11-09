import {createClient} from '@supabase/supabase-js';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
const url=process.env.SUPABASE_URL, pub=process.env.SUPABASE_PUBLISHABLE_KEY, secret=process.env.SUPABASE_SECRET_KEY;
const admin=()=>createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const publicClient=()=>createClient(url,pub,{auth:{persistSession:false,autoRefreshToken:false}});
const hash=s=>createHash('sha256').update(s).digest('hex');
const clean=(s,n)=>typeof s==='string'?s.trim().slice(0,n):'';
const fail=(res,status,error)=>res.status(status).json({error});
const unwrap=(result)=>{if(result.error)throw result.error;return result.data;};
function matchToken(token,stored){if(!token||!stored)return false;const a=Buffer.from(hash(token),'hex'),b=Buffer.from(stored,'hex');return a.length===b.length&&timingSafeEqual(a,b);}
export default async function handler(req,res){
 if(!url||!pub||!secret)return fail(res,503,'Server not configured.');
 res.setHeader('Cache-Control','no-store');
 const path=req.url.split('?')[0].replace(/^\/api/,'').replace(/\/$/,'')||'/';
 const method=req.method;const body=req.body||{};const token=(req.headers.authorization||'').replace(/^Bearer /i,'');
 const sb=admin();let user=null,isAdmin=false,profile=null;
 try{
  if(token){const {data,error}=await publicClient().auth.getUser(token);if(!error&&data.user){user=data.user;profile=unwrap(await sb.from('profiles').select('display_name').eq('id',user.id).maybeSingle());isAdmin=!!unwrap(await sb.from('admins').select('user_id').eq('user_id',user.id).maybeSingle());}}
  const me=user?{id:user.id,name:profile?.display_name||user.user_metadata?.display_name||user.email,email:user.email,admin:isAdmin}:null;
  if(path==='/me'&&method==='GET')return res.json({user:me});
  if(path==='/register'&&method==='POST'){
   const name=clean(body.name,60),email=clean(body.email,160).toLowerCase(),password=body.password;
   if(name.length<2||!email.includes('@')||typeof password!=='string'||password.length<10)return fail(res,400,'Enter name, email and password (10+ characters).');
   const {data,error}=await publicClient().auth.signUp({email,password,options:{data:{display_name:name}}});
   if(error)return fail(res,400,error.message);
   if(data.user)unwrap(await sb.from('profiles').upsert({id:data.user.id,display_name:name}));
   return res.json({ok:true,needsConfirmation:!data.session,session:data.session?{access_token:data.session.access_token,refresh_token:data.session.refresh_token}:null});
  }
  if(path==='/login'&&method==='POST'){
   const {data,error}=await publicClient().auth.signInWithPassword({email:clean(body.email,160),password:body.password||''});
   if(error)return fail(res,401,error.message);
   return res.json({ok:true,session:{access_token:data.session.access_token,refresh_token:data.session.refresh_token}});
  }
  if(path==='/refresh'&&method==='POST'){
   const {data,error}=await publicClient().auth.refreshSession({refresh_token:body.refresh_token});
   if(error)return fail(res,401,error.message);
   return res.json({session:{access_token:data.session.access_token,refresh_token:data.session.refresh_token}});
  }
  if(path==='/logout'&&method==='POST')return res.json({ok:true});
  if(path==='/questions'&&method==='POST'){
   if(body.website)return res.json({ok:true});
   const title=clean(body.title,130),content=clean(body.body,4000),visibility=body.visibility==='private'?'private':'public',name=me?.name||clean(body.name,60);
   if(title.length<4||content.length<8||name.length<2)return fail(res,400,'Name, title, and question are required.');
   const guestToken=user?null:randomBytes(32).toString('base64url');
   const q=unwrap(await sb.from('questions').insert({user_id:user?.id||null,guest_token_hash:guestToken?hash(guestToken):null,name,title,body:content,visibility,status:'pending'}).select('id').single());
   return res.json({id:q.id,token:guestToken,visibility});
  }
  if(path==='/questions'&&method==='GET'){
   const questions=unwrap(await sb.from('questions').select('id,title,body,name,visibility,status,created_at').eq('visibility','public').eq('status','published').order('id',{ascending:false}).limit(100));
   return res.json({questions});
  }
  if(path==='/mine'&&method==='GET'){
   if(!user)return fail(res,401,'Log in first.');
   return res.json({questions:unwrap(await sb.from('questions').select('id,title,visibility,status,created_at').eq('user_id',user.id).order('id',{ascending:false}))});
  }
  if(path==='/admin/questions'&&method==='GET'){
   if(!isAdmin)return fail(res,403,'Admin only.');
   const questions=unwrap(await sb.from('questions').select('id,title,body,name,visibility,status,created_at').order('id',{ascending:false}).limit(300));
   const pendingReplies=unwrap(await sb.from('replies').select('id,question_id,body,author:author_name,questions!inner(visibility)').eq('approved',false).eq('questions.visibility','public').order('id',{ascending:false}));
   return res.json({questions,pendingReplies});
  }
  const qmatch=path.match(/^\/questions\/(\d+)$/);
  if(qmatch&&method==='GET'){
   const q=unwrap(await sb.from('questions').select('*').eq('id',qmatch[1]).maybeSingle());
   if(!q)return fail(res,404,'Question not found.');
   const guestToken=clean(new URL(req.url,'https://example.invalid').searchParams.get('token'),200);
   const owner=!!(isAdmin||(user&&q.user_id===user.id)||matchToken(guestToken,q.guest_token_hash));
   const publicVisible=q.visibility==='public'&&q.status==='published';
   if(!owner&&!publicVisible)return fail(res,404,'Question not found or access denied.');
   let replies=unwrap(await sb.from('replies').select('id,body,author:author_name,created_at,approved').eq('question_id',q.id).order('id'));
   if(!owner||q.visibility==='public'&&!isAdmin)replies=replies.filter(r=>r.approved);
   const {guest_token_hash,user_id,...safe}=q;
   return res.json({question:{...safe,replies:replies.map(({approved,...r})=>r)},canReply:owner});
  }
  const reply=path.match(/^\/questions\/(\d+)\/replies$/);
  if(reply&&method==='POST'){
   const q=unwrap(await sb.from('questions').select('*').eq('id',reply[1]).maybeSingle());
   if(!q||!(isAdmin||(user&&q.user_id===user.id)||matchToken(clean(body.token,200),q.guest_token_hash)))return fail(res,403,'Not authorized to reply.');
   const content=clean(body.body,4000);if(content.length<2)return fail(res,400,'Reply is too short.');
   unwrap(await sb.from('replies').insert({question_id:q.id,body:content,author_id:user?.id||null,author_name:isAdmin?'Aiham':q.name,approved:isAdmin}));
   return res.json({ok:true});
  }
  const status=path.match(/^\/admin\/questions\/(\d+)$/);
  if(status&&method==='PATCH'){
   if(!isAdmin)return fail(res,403,'Admin only.');
   const q=unwrap(await sb.from('questions').select('visibility').eq('id',status[1]).maybeSingle());
   if(!q)return fail(res,404,'Question not found.');
   if(!['pending','published','hidden'].includes(body.status)||q.visibility==='private'&&body.status==='published')return fail(res,400,'Invalid status for question.');
   unwrap(await sb.from('questions').update({status:body.status}).eq('id',status[1]));return res.json({ok:true});
  }
  if(status&&method==='DELETE'){
   if(!isAdmin)return fail(res,403,'Admin only.');
   unwrap(await sb.from('questions').delete().eq('id',status[1]));return res.json({ok:true});
  }
  const moderate=path.match(/^\/admin\/replies\/(\d+)$/);
  if(moderate&&method==='PATCH'){
   if(!isAdmin)return fail(res,403,'Admin only.');
   const r=unwrap(await sb.from('replies').select('question_id').eq('id',moderate[1]).maybeSingle());
   if(!r)return fail(res,404,'Reply not found.');
   const q=unwrap(await sb.from('questions').select('visibility').eq('id',r.question_id).single());
   if(q.visibility!=='public')return fail(res,400,'Only public replies can be moderated.');
   unwrap(await sb.from('replies').update({approved:body.approved===true}).eq('id',moderate[1]));return res.json({ok:true});
  }
  if(moderate&&method==='DELETE'){
   if(!isAdmin)return fail(res,403,'Admin only.');
   unwrap(await sb.from('replies').delete().eq('id',moderate[1]));return res.json({ok:true});
  }
  return fail(res,404,'Not found.');
 }catch(e){console.error('API error:',e?.message);return fail(res,500,'Server error.');}
}
