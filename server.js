require("dotenv").config();
const express=require("express");
const cors=require("cors");
const crypto=require("crypto");
const jwt=require("jsonwebtoken");
const bcrypt=require("bcryptjs");
const {Pool}=require("pg");
const multer=require("multer");
const axios=require("axios");

const app=express();
app.use(cors());
app.use(express.json({limit:"1mb"}));
app.use(express.urlencoded({extended:true}));
app.use("/uploads",express.static("uploads"));

const PORT=process.env.PORT||3000;
const JWT_SECRET=process.env.JWT_SECRET||"CHANGE_THIS_SECRET";
const DATABASE_URL=process.env.DATABASE_URL;
if(!DATABASE_URL) console.warn("DATABASE_URL is not set.");
const pool=new Pool({connectionString:DATABASE_URL,ssl:process.env.PGSSL==="true"?{rejectUnauthorized:false}:undefined});

const PLANS={
  monthly:{name:"মাসিক Premium",amount:999,days:30},
  quarterly:{name:"৩ মাসের Premium",amount:2499,days:90},
  yearly:{name:"বার্ষিক Premium",amount:7999,days:365}
};

function auth(req,res,next){
  const h=req.headers.authorization||"";
  const token=h.startsWith("Bearer ")?h.slice(7):null;
  if(!token) return res.status(401).json({error:"লগইন প্রয়োজন"});
  try{req.user=jwt.verify(token,JWT_SECRET);next();}catch(e){return res.status(401).json({error:"সেশন শেষ হয়েছে"});}
}
async function q(text,params=[]){return pool.query(text,params);}
async function premium(userId){
  const r=await q("select * from subscriptions where user_id=$1 and status='active' and ends_at>now() order by ends_at desc limit 1",[userId]);
  return !!r.rows[0];
}
async function init(){
  await q(`create table if not exists subscriptions(
    id uuid primary key default gen_random_uuid(), user_id uuid not null,
    plan varchar(20) not null, status varchar(20) not null default 'pending',
    provider varchar(40), provider_order_id varchar(120), amount numeric(10,2),
    currency varchar(10) default 'BDT', starts_at timestamptz, ends_at timestamptz,
    created_at timestamptz default now()
  )`);
  await q(`create table if not exists payment_orders(
    id uuid primary key default gen_random_uuid(), user_id uuid not null,
    plan varchar(20) not null, provider varchar(40) not null default 'sslcommerz',
    tran_id varchar(80) unique not null, amount numeric(10,2) not null,
    currency varchar(10) default 'BDT', status varchar(30) default 'PENDING',
    session_key varchar(100), val_id varchar(100), bank_tran_id varchar(120),
    card_type varchar(100), raw jsonb, created_at timestamptz default now(), updated_at timestamptz default now()
  )`);
  await q(`create table if not exists subscription_events(
    id uuid primary key default gen_random_uuid(), provider varchar(40) not null,
    event_id varchar(160) not null, tran_id varchar(80), payload jsonb,
    created_at timestamptz default now(), unique(provider,event_id)
  )`);
  await q(`create table if not exists users(
    id uuid primary key default gen_random_uuid(), email varchar(255) unique not null,
    password_hash text not null, created_at timestamptz default now()
  )`);
  await q(`create table if not exists profiles(
    user_id uuid primary key references users(id) on delete cascade,
    name varchar(100), age int, bio text, avatar_url text
  )`);
}
const upload=multer({dest:"uploads/"});

app.get("/api/health",(req,res)=>res.json({ok:true,version:"V10",payment:"SSLCOMMERZ mobile banking only"}));

app.post("/api/auth/register",async(req,res)=>{
  try{
    const {email,password,name,age}=req.body||{};
    if(!email||!password) return res.status(400).json({error:"ইমেইল ও পাসওয়ার্ড দিন"});
    const exists=await q("select id from users where email=$1",[email.toLowerCase()]);
    if(exists.rows[0]) return res.status(409).json({error:"এই ইমেইল আগে থেকেই আছে"});
    const hash=await bcrypt.hash(password,12);
    const u=(await q("insert into users(email,password_hash) values($1,$2) returning id,email",[email.toLowerCase(),hash])).rows[0];
    await q("insert into profiles(user_id,name,age) values($1,$2,$3)",[u.id,name||"HeartLink User",age||18]);
    const token=jwt.sign({id:u.id,email:u.email},JWT_SECRET,{expiresIn:"30d"});
    res.json({token,user:u});
  }catch(e){res.status(500).json({error:e.message});}
});
app.post("/api/auth/login",async(req,res)=>{
  try{
    const {email,password}=req.body||{};
    const r=await q("select * from users where email=$1",[String(email||"").toLowerCase()]);
    if(!r.rows[0]||!(await bcrypt.compare(password,r.rows[0].password_hash))) return res.status(401).json({error:"লগইন তথ্য সঠিক নয়"});
    const token=jwt.sign({id:r.rows[0].id,email:r.rows[0].email},JWT_SECRET,{expiresIn:"30d"});
    res.json({token,user:{id:r.rows[0].id,email:r.rows[0].email}});
  }catch(e){res.status(500).json({error:e.message});}
});
app.get("/api/me",auth,async(req,res)=>{
  const r=await q("select u.id,u.email,p.name,p.age,p.bio,p.avatar_url from users u left join profiles p on p.user_id=u.id where u.id=$1",[req.user.id]);
  res.json(r.rows[0]);
});

app.get("/api/premium/plans",(req,res)=>res.json(Object.entries(PLANS).map(([id,p])=>({id,...p,currency:"BDT"}))));
app.get("/api/subscription",auth,async(req,res)=>{
  const r=await q("select * from subscriptions where user_id=$1 order by created_at desc limit 1",[req.user.id]);
  res.json(r.rows[0]||{status:"none"});
});

function baseUrl(){
  return String(process.env.PUBLIC_BASE_URL||"").replace(/\/$/,"");
}
function sslBase(){
  return String(process.env.SSLCOMMERZ_SANDBOX||"true").toLowerCase()==="true"
    ? "https://sandbox-gw.sslcommerz.com"
    : "https://securepay.sslcommerz.com";
}
function paymentFields(plan,tranId){
  const p=PLANS[plan];
  return {
    store_id:process.env.SSLCOMMERZ_STORE_ID,
    store_passwd:process.env.SSLCOMMERZ_STORE_PASSWORD,
    total_amount:p.amount.toFixed(2),
    currency:"BDT",
    tran_id:tranId,
    success_url:`${baseUrl()}/api/payment/sslcommerz/success`,
    fail_url:`${baseUrl()}/api/payment/sslcommerz/fail`,
    cancel_url:`${baseUrl()}/api/payment/sslcommerz/cancel`,
    ipn_url:`${baseUrl()}/api/payment/sslcommerz/ipn`,
    product_name:p.name,
    product_category:"subscription",
    cus_name:"HeartLink User",
    cus_email:"customer@heartlink.app",
    cus_add1:"Bangladesh",
    cus_city:"Bangladesh",
    cus_country:"Bangladesh",
    shipping_method:"NO",
    product_profile:"non-physical-goods",
    value_a:plan,
    value_b:tranId
  };
}
async function validateWithSSL(valId){
  const url=`${sslBase()}/validator/api/validationserverAPI.php`;
  const r=await axios.get(url,{params:{
    val_id:valId,store_id:process.env.SSLCOMMERZ_STORE_ID,
    store_passwd:process.env.SSLCOMMERZ_STORE_PASSWORD,v:1,format:"json"
  },timeout:15000});
  return r.data;
}
async function activateFromValidation(data){
  if(!data||!["VALID","VALIDATED"].includes(String(data.status||"").toUpperCase())) return {ok:false,reason:"provider status not valid"};
  const tranId=String(data.tran_id||"");
  const amount=Number(data.amount||0);
  const currency=String(data.currency||data.currency_type||"").toUpperCase();
  const po=(await q("select * from payment_orders where tran_id=$1 for update",[tranId])).rows[0];
  if(!po) return {ok:false,reason:"unknown transaction"};
  if(Math.abs(amount-Number(po.amount))>0.01 || currency!=="BDT") return {ok:false,reason:"amount/currency mismatch"};
  if(po.status==="PAID") return {ok:true,already:true};
  await q("update payment_orders set status='PAID',val_id=$1,bank_tran_id=$2,card_type=$3,raw=$4,updated_at=now() where id=$5",
    [data.val_id||null,data.bank_tran_id||null,data.card_type||null,data,po.id]);
  const now=new Date();
  const end=new Date(now.getTime()+PLANS[po.plan].days*86400000);
  await q("update subscriptions set status='expired' where user_id=$1 and status='active'",[po.user_id]);
  await q(`insert into subscriptions(user_id,plan,status,provider,provider_order_id,amount,currency,starts_at,ends_at)
           values($1,$2,'active','sslcommerz',$3,$4,'BDT',$5,$6)`,
    [po.user_id,po.plan,tranId,po.amount,now,end]);
  return {ok:true};
}

app.post("/api/payment/sslcommerz/session",auth,async(req,res)=>{
  try{
    const {plan}=req.body||{};
    if(!PLANS[plan]) return res.status(400).json({error:"অবৈধ Premium plan"});
    if(!process.env.SSLCOMMERZ_STORE_ID||!process.env.SSLCOMMERZ_STORE_PASSWORD||!baseUrl())
      return res.status(503).json({error:"Payment gateway এখনো configure করা হয়নি। .env-এ credentials ও PUBLIC_BASE_URL দিন।"});
    const tranId=`HL10_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const p=PLANS[plan];
    await q("insert into payment_orders(user_id,plan,tran_id,amount,currency,status) values($1,$2,$3,$4,'BDT','PENDING')",
      [req.user.id,plan,tranId,p.amount]);
    const body=new URLSearchParams(paymentFields(plan,tranId));
    const r=await axios.post(`${sslBase()}/gwprocess/v4/api.php`,body.toString(),{
      headers:{"Content-Type":"application/x-www-form-urlencoded"},timeout:15000
    });
    if(r.data.status!=="SUCCESS"){
      await q("update payment_orders set status='INIT_FAILED',raw=$1,updated_at=now() where tran_id=$2",[r.data,tranId]);
      return res.status(502).json({error:r.data.failedreason||"Gateway session তৈরি হয়নি"});
    }
    await q("update payment_orders set session_key=$1,raw=$2,updated_at=now() where tran_id=$3",
      [r.data.sessionkey||null,r.data,tranId]);
    res.json({ok:true,tran_id:tranId,sessionkey:r.data.sessionkey,redirect_url:r.data.GatewayPageURL});
  }catch(e){res.status(500).json({error:e.response?.data||e.message});}
});

async function callback(req,res,type){
  try{
    const data={...(req.body||{}),...(req.query||{})};
    const tranId=String(data.tran_id||"");
    if(type==="success" && data.val_id){
      const valid=await validateWithSSL(data.val_id);
      const result=await activateFromValidation(valid);
      if(result.ok) return res.redirect(`${process.env.FRONTEND_URL||"/"}?payment=success&tran_id=${encodeURIComponent(tranId)}`);
    }
    if(type==="ipn" && data.val_id){
      const valid=await validateWithSSL(data.val_id);
      await activateFromValidation(valid);
      return res.json({received:true});
    }
    if(type==="fail") await q("update payment_orders set status='FAILED',raw=$1,updated_at=now() where tran_id=$2",[data,tranId]);
    if(type==="cancel") await q("update payment_orders set status='CANCELLED',raw=$1,updated_at=now() where tran_id=$2",[data,tranId]);
    if(type==="success") await q("update payment_orders set status='PENDING',raw=$1,updated_at=now() where tran_id=$2",[data,tranId]);
    if(type==="ipn") return res.json({received:true});
    return res.redirect(`${process.env.FRONTEND_URL||"/"}?payment=${type}${tranId?`&tran_id=${encodeURIComponent(tranId)}`:""}`);
  }catch(e){
    console.error("payment callback",e.message);
    if(type==="ipn") return res.status(500).json({error:"IPN processing failed"});
    return res.redirect(`${process.env.FRONTEND_URL||"/"}?payment=error`);
  }
}
app.post("/api/payment/sslcommerz/success",(req,res)=>callback(req,res,"success"));
app.post("/api/payment/sslcommerz/fail",(req,res)=>callback(req,res,"fail"));
app.post("/api/payment/sslcommerz/cancel",(req,res)=>callback(req,res,"cancel"));
app.post("/api/payment/sslcommerz/ipn",(req,res)=>callback(req,res,"ipn"));

app.get("/api/payment/orders",auth,async(req,res)=>{
  const r=await q("select tran_id,plan,amount,currency,status,bank_tran_id,created_at,updated_at from payment_orders where user_id=$1 order by created_at desc limit 30",[req.user.id]);
  res.json(r.rows);
});

app.post("/api/me/photo",auth,upload.single("photo"),async(req,res)=>{
  if(!req.file) return res.status(400).json({error:"ছবি দিন"});
  const ext=(req.file.originalname.split(".").pop()||"jpg").toLowerCase();
  const safe=`${req.file.filename}.${ext}`;
  const old=req.file.path;
  const final=old+"."+ext;
  require("fs").renameSync(old,final);
  const url=`/uploads/${safe}`;
  await q("insert into profiles(user_id) values($1) on conflict(user_id) do nothing",[req.user.id]);
  await q("update profiles set avatar_url=$1 where user_id=$2",[url,req.user.id]);
  res.json({ok:true,avatar_url:url});
});

app.listen(PORT,async()=>{try{await init();console.log(`HeartLink V10 running on ${PORT}`)}catch(e){console.error(e)}});