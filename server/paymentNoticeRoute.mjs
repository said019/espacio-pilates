import {consultarAviso} from './paymentNoticeClient.mjs';
export function registerPaymentNoticeRoute(app,{authMiddleware,pool,token=process.env.WALLET_CLUB_NOTICE_TOKEN,consultar=consultarAviso}){
 app.get('/api/admin/platform-payment-notice',authMiddleware,async(req,res)=>{
  res.set('Cache-Control','private, no-store');
  try{
   const result=await pool.query('SELECT role FROM users WHERE id = $1',[req.userId]);
   if(!['admin','super_admin'].includes(result.rows[0]?.role))return res.status(403).json({message:'Acceso restringido'});
   res.json({aviso:await consultar({baseUrl:'https://walletclub.com.mx',token})});
  }catch{res.json({aviso:null});}
 });
}
