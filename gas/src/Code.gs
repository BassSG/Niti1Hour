/** Niti1Hour wash-dry-fold backend. No credentials belong in this source. */
var SERVICE_VERSION_ = '0.1.0';
var SHEETS_ = {
  Customers: ['customer_id','line_user_id','display_name','phone','created_at','updated_at'],
  Orders: ['order_id','customer_id','state','supply_mode','requested_washer_kg','requested_dryer_kg','washer_kg','dryer_kg','quote_version','quote_json','quote_total_baht','payment_state','created_at','updated_at','confirmed_at','ready_at','collected_at','row_version','terms_version','last_request_id'],
  OrderItems: ['item_id','order_id','quote_version','stage','machine_capacity_kg','quantity','unit_price_snapshot_baht','amount_baht'],
  Machines: ['machine_id','type','capacity_kg','display_no','active','current_order_id','updated_at'],
  Payments: ['payment_id','order_id','expected_amount_baht','reported_amount_baht','verified_amount_baht','status','slip_file_id','reported_at','verified_by','verified_at','request_id'],
  Timers: ['timer_id','order_id','machine_id','stage','started_at','due_at','reminder_claimed_at','reminder_sent_at','completed_at','revision'],
  Files: ['file_id','order_id','kind','drive_file_id','mime_type','byte_size','uploaded_at','uploader'],
  Events: ['event_id','order_id','actor_id','action','before_json','after_json','request_id','created_at'],
  Settings: ['key','value','updated_at','updated_by','description'],
  Idempotency: ['request_id','actor_id','action','result_json','created_at'],
  Migrations: ['version','checksum','applied_at','applied_by'],
};
var DEFAULTS_ = {
  washer_options: {9:{machineBaht:40,serviceTier:1},14:{machineBaht:50,serviceTier:2},18:{machineBaht:70,serviceTier:2},27:{machineBaht:100,serviceTier:3}},
  dryer_options: {14:{machineBaht:40,serviceTier:1},21:{machineBaht:60,serviceTier:2},25:{machineBaht:70,serviceTier:3}},
  service_fees: {1:30,2:40,3:50}, stage_minutes:30, cycles_per_order:1,
  tariff_version:'draft-2026-09-23-v1', pricing_status:'pending_owner_uat', timezone:'Asia/Bangkok',
  terms_version:'draft-1', terms_th:'ลูกค้าแยกผ้าสีและตรวจป้ายดูแลผ้าด้วยตนเอง; ราคาปกติไม่รวมน้ำยา; ต้องชำระก่อนเริ่มบริการ; เวลาซัก/อบเป็นค่าประมาณ; ร้านแจ้งพร้อมรับหลังพับและตรวจงานจริง',
};

function doGet(e) {
  return output_({ok:true,data:{service:'niti1hour-wash-dry-fold',version:SERVICE_VERSION_,status:'ok',configured:Boolean(config_().sheetId&&config_().sharedSecret)}});
}

function doPost(e) {
  try {
    var outer = JSON.parse(e && e.postData && e.postData.contents || '{}');
    var cfg = config_();
    if (!cfg.sharedSecret) throw apiError_('BACKEND_NOT_CONFIGURED','ยังไม่ได้ตั้งค่าการยืนยันตัวตน',503);
    var ts = Number(outer.timestamp), nonce = String(outer.nonce || ''), raw = String(outer.body || ''), signature = String(outer.signature || '');
    if (!ts || Math.abs(Date.now()-ts)>300000 || !/^[A-Za-z0-9-]{20,80}$/.test(nonce) || !raw || !signature) throw apiError_('INVALID_SIGNATURE','คำขอหมดอายุหรือไม่ถูกต้อง',401);
    var expected = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(ts+'\n'+nonce+'\n'+raw,cfg.sharedSecret)).replace(/=+$/,'');
    if (!constantTimeEqual_(expected,signature)) throw apiError_('INVALID_SIGNATURE','ลายเซ็นคำขอไม่ถูกต้อง',401);
    var cache = CacheService.getScriptCache(), nonceKey='valet_nonce_'+nonce;
    if (cache.get(nonceKey)) throw apiError_('REPLAYED_REQUEST','คำขอนี้ถูกใช้ไปแล้ว',409);
    cache.put(nonceKey,'1',300);
    var message = JSON.parse(raw), action = String(message.action || ''), actor = message.actor || null, payload = message.payload || {};
    authorize_(action,actor,cfg);
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) throw apiError_('BUSY','ระบบกำลังบันทึกรายการอื่น กรุณาลองใหม่',503);
    try {
      var result = isWrite_(action) ? idempotent_(message,actor,function(){return dispatch_(action,payload,actor,cfg,message.requestId);}) : dispatch_(action,payload,actor,cfg,message.requestId);
      return output_({ok:true,data:result});
    } finally { lock.releaseLock(); }
  } catch (err) {
    var e2 = err && err.code ? err : apiError_('INTERNAL_ERROR','ระบบขัดข้อง กรุณาลองใหม่',500);
    return output_({ok:false,error:{code:e2.code,message:e2.message,status:e2.status||400}});
  }
}

function setupSchema() {
  var cfg=config_(); if(!cfg.sheetId) throw new Error('Missing Script Property VALET_SHEET_ID');
  var ss=SpreadsheetApp.openById(cfg.sheetId);
  Object.keys(SHEETS_).forEach(function(name){
    var sh=ss.getSheetByName(name);
    if(!sh) sh=ss.insertSheet(name);
    var headers=SHEETS_[name], existing=sh.getRange(1,1,1,headers.length).getDisplayValues()[0];
    var nonempty=existing.some(function(v){return String(v).trim()!=='';});
    if(nonempty && JSON.stringify(existing)!==JSON.stringify(headers)) throw new Error('Schema header mismatch: '+name);
    if(!nonempty) sh.getRange(1,1,1,headers.length).setValues([headers]);
    sh.setFrozenRows(1); sh.getRange(1,1,1,headers.length).setFontWeight('bold').setBackground('#a74429').setFontColor('#ffffff');
  });
  ss.setSpreadsheetTimeZone('Asia/Bangkok');
  seedSettings_(ss);
  var migrations=ss.getSheetByName('Migrations');
  if(migrations.getLastRow()<2) migrations.appendRow([1,'schema-v1-2026-09-23',now_(),'system']);
  return {ok:true,tabs:Object.keys(SHEETS_),timezone:ss.getSpreadsheetTimeZone(),version:1};
}

function dispatch_(action,payload,actor,cfg,requestId) {
  if(action==='catalog') return catalog_();
  if(action==='customer.createOrder') return createOrder_(payload,actor,requestId);
  if(action==='customer.listOrders') return customerOrders_(actor);
  if(action==='customer.uploadSlip') return uploadSlip_(payload,actor,cfg,requestId);
  if(action==='customer.reportPayment') return reportPayment_(payload,actor,requestId);
  if(action==='customer.acceptSupplyQuote') return acceptSupplyQuote_(payload,actor,requestId,true);
  if(action==='customer.declineSupplyQuote') return acceptSupplyQuote_(payload,actor,requestId,false);
  if(action==='admin.queue') return adminQueue_();
  if(action==='admin.get-slip') return getSlip_(payload);
  if(action==='admin.dropoff') return setDropoff_(payload,actor,requestId);
  if(action==='admin.quote') return setQuote_(payload,actor,requestId);
  if(action==='admin.verify-payment') return verifyPayment_(payload,actor,requestId);
  if(action==='admin.start-wash') return startMachine_(payload,actor,requestId,'wash');
  if(action==='admin.complete-wash') return completeMachine_(payload,actor,requestId,'wash');
  if(action==='admin.start-dry') return startMachine_(payload,actor,requestId,'dry');
  if(action==='admin.complete-dry') return completeMachine_(payload,actor,requestId,'dry');
  if(action==='admin.ready') return markReady_(payload,actor,requestId);
  if(action==='admin.notify-ready') return reserveReadyNotice_(payload,actor,requestId);
  if(action==='admin.record-ready-notification') return recordReadyNotice_(payload,actor,requestId);
  if(action==='admin.collect') return collect_(payload,actor,requestId);
  if(action==='system.dueTimers'||action==='admin.dueTimers') return dueTimers_();
  if(action==='system.claimDueTimer') return claimDueTimer_(payload,requestId);
  if(action==='system.completeTimerReminder') return completeTimerReminder_(payload,requestId);
  throw apiError_('UNKNOWN_ACTION','ไม่พบคำสั่งนี้',404);
}

function config_() {
  var p=PropertiesService.getScriptProperties();
  return {sheetId:p.getProperty('VALET_SHEET_ID')||'',driveRootId:p.getProperty('VALET_DRIVE_ROOT_ID')||'',slipsFolderId:p.getProperty('VALET_SLIPS_FOLDER_ID')||'',photosFolderId:p.getProperty('VALET_PHOTOS_FOLDER_ID')||'',sharedSecret:p.getProperty('VALET_SHARED_SECRET')||'',adminLineIds:(p.getProperty('VALET_ADMIN_LINE_IDS')||'').split(',').map(function(x){return x.trim();}).filter(Boolean)};
}
function authorize_(action,actor,cfg) {
  if(action==='catalog') return;
  if(!actor) throw apiError_('AUTH_REQUIRED','กรุณายืนยันตัวตนก่อน',401);
  if(action.indexOf('system.')===0 && actor.role==='system') return;
  if(action.indexOf('admin.')===0 && (actor.role==='admin' && actor.lineUserId && cfg.adminLineIds.indexOf(actor.lineUserId)>=0)) return;
  if(action.indexOf('customer.')===0 && actor.role==='customer' && actor.lineUserId) return;
  throw apiError_('FORBIDDEN','ไม่มีสิทธิ์ทำรายการนี้',403);
}
function isWrite_(action) { return action!=='catalog'&&action!=='customer.listOrders'&&action!=='admin.queue'&&action!=='admin.get-slip'&&action!=='admin.dueTimers'&&action!=='system.dueTimers'; }
function idempotent_(message,actor,work) {
  var id=String(message.requestId||''); if(!id) throw apiError_('REQUEST_ID_REQUIRED','ไม่พบรหัสคำขอ',400);
  var rows=table_('Idempotency');
  var prior=rows.find(function(r){return r.request_id===id;});
  if(prior) { if(prior.actor_id!==(actor&&actor.lineUserId||actor&&actor.role||'') || prior.action!==message.action) throw apiError_('IDEMPOTENCY_CONFLICT','รหัสคำขอนี้ใช้กับรายการอื่นแล้ว',409); return JSON.parse(prior.result_json); }
  var result=work(); append_('Idempotency',{request_id:id,actor_id:actor&&actor.lineUserId||actor&&actor.role||'',action:message.action,result_json:JSON.stringify(result),created_at:now_()}); return result;
}
function catalog_() {
  var settings=settings_();
  return {washerOptions:jsonSetting_(settings,'washer_options',DEFAULTS_.washer_options),dryerOptions:jsonSetting_(settings,'dryer_options',DEFAULTS_.dryer_options),serviceFees:jsonSetting_(settings,'service_fees',DEFAULTS_.service_fees),stageMinutes:Number(settings.stage_minutes||DEFAULTS_.stage_minutes),cyclesPerOrder:Number(settings.cycles_per_order||1),tariffVersion:settings.tariff_version||DEFAULTS_.tariff_version,pricingStatus:settings.pricing_status||'pending_owner_uat',termsVersion:settings.terms_version||DEFAULTS_.terms_version,termsTh:settings.terms_th||DEFAULTS_.terms_th};
}
function createOrder_(p,actor,requestId) {
  if(p.acceptedTerms!==true) throw apiError_('TERMS_REQUIRED','กรุณายืนยันเงื่อนไขก่อนส่งคำขอ',400);
  var cat=catalog_(), w=Number(p.washerKg), d=Number(p.dryerKg), mode=String(p.supplyMode||'customer_own');
  if(!cat.washerOptions[w]||!cat.dryerOptions[d]||['customer_own','shop_purchase_requested'].indexOf(mode)<0) throw apiError_('INVALID_ORDER','ข้อมูลเครื่องหรือรูปแบบน้ำยาไม่ถูกต้อง',400);
  var customer=table_('Customers').find(function(c){return c.line_user_id===actor.lineUserId;});
  var customerId=customer?customer.customer_id:uuid_();
  var verifiedName=String(actor.displayName||'ลูกค้า LINE').slice(0,80);
  if(!customer) append_('Customers',{customer_id:customerId,line_user_id:actor.lineUserId,display_name:verifiedName,phone:String(p.phone||'').slice(0,30),created_at:now_(),updated_at:now_()});
  else { customerId=customer.customer_id; update_('Customers',customer._row,{display_name:verifiedName,updated_at:now_()}); }
  var id='WD-'+Utilities.formatDate(new Date(), 'Asia/Bangkok','yyMMdd')+'-'+uuid_().slice(0,8).toUpperCase();
  var rec={order_id:id,customer_id:customerId,state:'awaiting_dropoff',supply_mode:mode,requested_washer_kg:w,requested_dryer_kg:d,washer_kg:'',dryer_kg:'',quote_version:0,quote_json:'',quote_total_baht:'',payment_state:'unpaid',created_at:now_(),updated_at:now_(),confirmed_at:'',ready_at:'',collected_at:'',row_version:1,terms_version:cat.termsVersion,last_request_id:requestId};
  append_('Orders',rec); event_(id,actor.lineUserId,'customer.createOrder',null,publicOrder_(rec),requestId);
  return {orderId:id,state:rec.state,rowVersion:1,message:'รับคำขอแล้ว รอร้านตรวจผ้าและยืนยันยอด'};
}
function customerOrders_(actor) {
  var customer=table_('Customers').find(function(c){return c.line_user_id===actor.lineUserId;}); if(!customer)return {orders:[]};
  var orders=table_('Orders').filter(function(o){return o.customer_id===customer.customer_id;}).sort(function(a,b){return String(b.created_at).localeCompare(String(a.created_at));});
  return {orders:orders.map(function(o){var q=o.quote_json?JSON.parse(o.quote_json):null;return {orderId:o.order_id,state:o.state,washerKg:Number(o.washer_kg||o.requested_washer_kg),dryerKg:Number(o.dryer_kg||o.requested_dryer_kg),quoteTotalBaht:o.quote_total_baht===''?null:Number(o.quote_total_baht),supplyBaht:q&&q.supplyBaht!==null?Number(q.supplyBaht):null,paymentState:o.payment_state,supplyMode:o.supply_mode,createdAt:o.created_at,rowVersion:Number(o.row_version)};})};
}
function setDropoff_(p,actor,requestId) {
  var o=order_(p.orderId); if(o.state!=='awaiting_dropoff') throw apiError_('INVALID_STATE','รายการนี้ไม่ได้อยู่ในขั้นรอรับผ้า',409);
  var before=publicOrder_(o); update_('Orders',o._row,{state:'awaiting_quote',updated_at:now_(),row_version:Number(o.row_version)+1,last_request_id:requestId});event_(o.order_id,actor.lineUserId,'admin.dropoff',before,{state:'awaiting_quote'},requestId);
  return {orderId:o.order_id,state:'awaiting_quote',message:'บันทึกรับผ้าแล้ว กรุณาตรวจปริมาณและยืนยันเครื่อง/ยอด'};
}
function quoteCalc_(w,d,mode,supplyBaht,supplyAccepted,machineConfirmed) {
  var cat=catalog_(), wo=cat.washerOptions[w], dr=cat.dryerOptions[d];if(!wo||!dr)throw apiError_('INVALID_MACHINE','ไม่พบขนาดเครื่องนี้',400);
  var tier=Math.max(Number(wo.serviceTier),Number(dr.serviceTier)),fee=Number(cat.serviceFees[tier]);
  var base=Number(wo.machineBaht)+Number(dr.machineBaht)+fee,manual=mode==='shop_purchase_requested';
  var blockers=[];if(!machineConfirmed)blockers.push('admin_machine_confirmation');if(manual&&supplyBaht===null)blockers.push('manual_supply_quote');if(manual&&supplyBaht!==null&&!supplyAccepted)blockers.push('customer_supply_quote_acceptance');
  return {washerKg:w,dryerKg:d,cycles:1,washerBaht:Number(wo.machineBaht),dryerBaht:Number(dr.machineBaht),shopServiceBaht:fee,serviceTier:tier,supplyMode:mode,supplyBaht:manual?supplyBaht:0,baseTotalBaht:base,totalBaht:manual&&(supplyBaht===null||!supplyAccepted)?null:base+(manual?Number(supplyBaht):0),readyForPayment:blockers.length===0,paymentBlockers:blockers,tariffVersion:cat.tariffVersion};
}
function setQuote_(p,actor,requestId) {
  var o=order_(p.orderId);if(o.state!=='awaiting_quote')throw apiError_('INVALID_STATE','รายการนี้ยังไม่พร้อมเสนอราคา',409);
  var w=Number(p.washerKg||o.requested_washer_kg),d=Number(p.dryerKg||o.requested_dryer_kg),manual=o.supply_mode==='shop_purchase_requested';
  var extra=manual?(p.supplyBaht===undefined||p.supplyBaht===null?null:Number(p.supplyBaht)):0;
  if(manual&&extra!==null&&(!isFinite(extra)||extra<0))throw apiError_('INVALID_SUPPLY_PRICE','ค่าผลิตภัณฑ์ไม่ถูกต้อง',400);
  var quote=quoteCalc_(w,d,o.supply_mode,extra,false,true),state=manual?'awaiting_customer_quote_acceptance':'awaiting_payment';
  var before=publicOrder_(o),version=Number(o.quote_version)+1;
  update_('Orders',o._row,{state:state,washer_kg:w,dryer_kg:d,quote_version:version,quote_json:JSON.stringify(quote),quote_total_baht:quote.totalBaht===null?'':quote.totalBaht,confirmed_at:manual?'':now_(),updated_at:now_(),row_version:Number(o.row_version)+1,last_request_id:requestId});
  append_('OrderItems',{item_id:uuid_(),order_id:o.order_id,quote_version:version,stage:'wash',machine_capacity_kg:w,quantity:1,unit_price_snapshot_baht:quote.washerBaht,amount_baht:quote.washerBaht});
  append_('OrderItems',{item_id:uuid_(),order_id:o.order_id,quote_version:version,stage:'dry',machine_capacity_kg:d,quantity:1,unit_price_snapshot_baht:quote.dryerBaht,amount_baht:quote.dryerBaht});
  append_('OrderItems',{item_id:uuid_(),order_id:o.order_id,quote_version:version,stage:'service',machine_capacity_kg:'',quantity:1,unit_price_snapshot_baht:quote.shopServiceBaht,amount_baht:quote.shopServiceBaht});
  if(manual&&extra!==null)append_('OrderItems',{item_id:uuid_(),order_id:o.order_id,quote_version:version,stage:'supply',machine_capacity_kg:'',quantity:1,unit_price_snapshot_baht:extra,amount_baht:extra});
  event_(o.order_id,actor.lineUserId,'admin.quote',before,{state:state,quote:quote},requestId);
  return {orderId:o.order_id,state:state,quote:quote,message:manual?'เสนอค่าผลิตภัณฑ์แล้ว รอลูกค้ายืนยันก่อนจ่าย':'ยืนยันยอดแล้ว รอลูกค้าชำระ'};
}
function acceptSupplyQuote_(p,actor,requestId,accept) {
  var o=order_(p.orderId),c=table_('Customers').find(function(x){return x.customer_id===o.customer_id;});
  if(!c||c.line_user_id!==actor.lineUserId)throw apiError_('NOT_FOUND','ไม่พบรายการนี้',404);
  if(o.state!=='awaiting_customer_quote_acceptance')throw apiError_('INVALID_STATE','ไม่มีข้อเสนอที่รอยืนยัน',409);
  var q=JSON.parse(o.quote_json);if(!accept){update_('Orders',o._row,{state:'awaiting_quote',quote_json:'',quote_total_baht:'',updated_at:now_(),row_version:Number(o.row_version)+1,last_request_id:requestId});event_(o.order_id,actor.lineUserId,'customer.declineSupplyQuote',publicOrder_(o),{state:'awaiting_quote'},requestId);return {state:'awaiting_quote',message:'ปฏิเสธข้อเสนอแล้ว กรุณาติดต่อร้านเพื่อปรับรายการ'};}
  q=quoteCalc_(Number(q.washerKg),Number(q.dryerKg),o.supply_mode,Number(q.supplyBaht),true,true);
  update_('Orders',o._row,{state:'awaiting_payment',quote_json:JSON.stringify(q),quote_total_baht:q.totalBaht,confirmed_at:now_(),updated_at:now_(),row_version:Number(o.row_version)+1,last_request_id:requestId});event_(o.order_id,actor.lineUserId,'customer.acceptSupplyQuote',publicOrder_(o),{state:'awaiting_payment',quote:q},requestId);return {state:'awaiting_payment',quote:q,message:'ยืนยันยอดแล้ว กรุณาชำระก่อนร้านเริ่มงาน'};
}
function reportPayment_(p,actor,requestId) {
  var o=order_(p.orderId),c=table_('Customers').find(function(x){return x.customer_id===o.customer_id;});if(!c||c.line_user_id!==actor.lineUserId)throw apiError_('NOT_FOUND','ไม่พบรายการนี้',404);
  if(o.state!=='awaiting_payment')throw apiError_('INVALID_STATE','รายการนี้ยังไม่อยู่ในขั้นแจ้งชำระ',409);
  var amount=Number(p.reportedAmount),expected=Number(o.quote_total_baht);if(!isFinite(amount)||amount<=0)throw apiError_('INVALID_AMOUNT','ยอดที่แจ้งไม่ถูกต้อง',400);
  var slip=table_('Files').find(function(f){return f.file_id===String(p.slipFileId)&&f.order_id===o.order_id&&f.kind==='payment_slip';});if(!slip)throw apiError_('SLIP_REQUIRED','กรุณาแนบสลิปก่อนแจ้งโอน',400);
  var paymentId=uuid_();append_('Payments',{payment_id:paymentId,order_id:o.order_id,expected_amount_baht:expected,reported_amount_baht:amount,verified_amount_baht:'',status:'review',slip_file_id:slip.file_id,reported_at:now_(),verified_by:'',verified_at:'',request_id:requestId});
  update_('Orders',o._row,{state:'payment_review',payment_state:'review',updated_at:now_(),row_version:Number(o.row_version)+1,last_request_id:requestId});event_(o.order_id,actor.lineUserId,'customer.reportPayment',publicOrder_(o),{paymentId:paymentId,state:'payment_review'},requestId);return {paymentId:paymentId,state:'payment_review',message:'ส่งหลักฐานแล้ว รอร้านตรวจยอดเงินจริง'};
}
function verifyPayment_(p,actor,requestId) {
  var o=order_(p.orderId);if(o.state!=='payment_review')throw apiError_('INVALID_STATE','รายการนี้ไม่มีรายการรอตรวจเงิน',409);
  var pay=table_('Payments').filter(function(x){return x.order_id===o.order_id&&x.status==='review';}).pop();if(!pay)throw apiError_('PAYMENT_NOT_FOUND','ไม่พบรายการชำระที่รอตรวจ',404);
  var real=Number(p.verifiedAmount);if(!isFinite(real)||real!==Number(pay.expected_amount_baht)||real!==Number(pay.reported_amount_baht))throw apiError_('AMOUNT_MISMATCH','ยอดเงินจริง/ยอดแจ้ง/ยอดบิลไม่ตรงกัน ให้ตรวจสอบก่อนยืนยัน',409);
  update_('Payments',pay._row,{verified_amount_baht:real,status:'verified',verified_by:actor.lineUserId,verified_at:now_()});update_('Orders',o._row,{state:'paid',payment_state:'verified',updated_at:now_(),row_version:Number(o.row_version)+1,last_request_id:requestId});event_(o.order_id,actor.lineUserId,'admin.verify-payment',publicOrder_(o),{state:'paid',verifiedAmount:real},requestId);return {state:'paid',message:'ยืนยันรับเงินแล้ว'};
}
function startMachine_(p,actor,requestId,stage) {
  var o=order_(p.orderId),expectedState=stage==='wash'?'paid':'drying_pending';if(o.state!==expectedState)throw apiError_('INVALID_STATE','งานยังไม่อยู่ในขั้นเริ่มเครื่อง',409);
  var machine=table_('Machines').find(function(m){return (m.machine_id===String(p.machineId)||String(m.display_no)===String(p.machineNo))&&String(m.type)===stage&&Number(m.capacity_kg)===Number(stage==='wash'?o.washer_kg:o.dryer_kg)&&String(m.active).toUpperCase()==='TRUE';});
  if(!machine)throw apiError_('MACHINE_NOT_FOUND','ไม่พบเครื่องที่เปิดใช้งานและตรงกับขนาดงาน กรุณาตั้งเลขเครื่องก่อน',409);
  if(machine.current_order_id&&machine.current_order_id!==o.order_id)throw apiError_('MACHINE_BUSY','เครื่องนี้กำลังใช้งานกับงานอื่น',409);
  var started=new Date(),minutes=Number(settings_().stage_minutes||30),due=new Date(started.getTime()+minutes*60000),timerId=uuid_(),next=stage==='wash'?'washing':'drying';
  update_('Machines',machine._row,{current_order_id:o.order_id,updated_at:now_()});append_('Timers',{timer_id:timerId,order_id:o.order_id,machine_id:machine.machine_id,stage:stage,started_at:started.toISOString(),due_at:due.toISOString(),reminder_claimed_at:'',reminder_sent_at:'',completed_at:'',revision:1});
  update_('Orders',o._row,{state:next,updated_at:now_(),row_version:Number(o.row_version)+1,last_request_id:requestId});event_(o.order_id,actor.lineUserId,'admin.start-'+stage,publicOrder_(o),{state:next,machineId:machine.machine_id,dueAt:due.toISOString()},requestId);return {state:next,dueAt:due.toISOString(),message:'เริ่มจับเวลา '+minutes+' นาทีแล้ว · เตือนแอดมินเท่านั้น'};
}
function completeMachine_(p,actor,requestId,stage) {
  var o=order_(p.orderId),state=stage==='wash'?'washing':'drying';if(o.state!==state)throw apiError_('INVALID_STATE','รายการนี้ไม่ได้อยู่ในขั้นเครื่องที่เลือก',409);
  var timers=table_('Timers').filter(function(t){return t.order_id===o.order_id&&t.stage===stage&&!t.completed_at;});var timer=timers[timers.length-1];if(!timer)throw apiError_('TIMER_NOT_FOUND','ไม่พบตัวจับเวลาของเครื่องนี้',409);
  var machine=table_('Machines').find(function(m){return m.machine_id===timer.machine_id;});if(machine)update_('Machines',machine._row,{current_order_id:'',updated_at:now_()});update_('Timers',timer._row,{completed_at:now_(),revision:Number(timer.revision||0)+1});
  var next=stage==='wash'?'drying_pending':'folding';update_('Orders',o._row,{state:next,updated_at:now_(),row_version:Number(o.row_version)+1,last_request_id:requestId});event_(o.order_id,actor.lineUserId,'admin.complete-'+stage,publicOrder_(o),{state:next},requestId);return {state:next,message:stage==='wash'?'ซักเสร็จแล้ว · เลือกเครื่องอบและกดเริ่มอบเมื่อเริ่มจริง':'อบเสร็จแล้ว · งานเข้าคิวรอพับ'};
}
function markReady_(p,actor,requestId) {
  var o=order_(p.orderId);if(o.state!=='folding')throw apiError_('INVALID_STATE','งานยังไม่อยู่ในคิวรอพับ',409);update_('Orders',o._row,{state:'ready',ready_at:now_(),updated_at:now_(),row_version:Number(o.row_version)+1,last_request_id:requestId});event_(o.order_id,actor.lineUserId,'admin.ready',publicOrder_(o),{state:'ready'},requestId);return {state:'ready',message:'บันทึกว่าพับและตรวจเสร็จแล้ว · ยังไม่ได้ส่งข้อความให้ลูกค้า'};
}
function reserveReadyNotice_(p,actor,requestId) {
  var o=order_(p.orderId);if(o.state!=='ready')throw apiError_('INVALID_STATE','ต้องทำผ้าเสร็จและพร้อมรับก่อน',409);
  var prior=table_('Events').find(function(e){return e.order_id===o.order_id&&e.action==='admin.notify-ready.sent';});if(prior)return {alreadySent:true,message:'รายการนี้ส่งแจ้งพร้อมรับแล้ว'};
  var inFlight=table_('Events').find(function(e){return e.order_id===o.order_id&&e.action==='admin.notify-ready.requested'&&Date.now()-Date.parse(e.created_at)<120000;});if(inFlight)throw apiError_('NOTICE_IN_PROGRESS','กำลังส่งหรือกำลังตรวจผลการส่งอยู่ กรุณารอสักครู่ก่อน',409);
  var c=table_('Customers').find(function(x){return x.customer_id===o.customer_id;});if(!c)throw apiError_('CUSTOMER_NOT_FOUND','ไม่พบข้อมูลผู้รับ');
  event_(o.order_id,actor.lineUserId,'admin.notify-ready.requested',null,{requestId:requestId},requestId);return {alreadySent:false,to:c.line_user_id,orderId:o.order_id,expectedAmount:Number(o.quote_total_baht||0),message:'ผ้าของคุณพร้อมรับแล้ว กรุณาแสดงเลขงาน '+o.order_id+' ที่ร้าน'};
}
function recordReadyNotice_(p,actor,requestId){var o=order_(p.orderId);if(o.state!=='ready')throw apiError_('INVALID_STATE','งานไม่ได้อยู่ในขั้นพร้อมรับ',409);var prior=table_('Events').find(function(e){return e.order_id===o.order_id&&e.action==='admin.notify-ready.sent';});if(!prior)event_(o.order_id,actor.lineUserId,'admin.notify-ready.sent',null,{sent:true},requestId);return {sent:true};}
function collect_(p,actor,requestId) {
  var o=order_(p.orderId);if(o.state!=='ready')throw apiError_('INVALID_STATE','งานยังไม่อยู่ในขั้นพร้อมรับ',409);update_('Orders',o._row,{state:'collected',collected_at:now_(),updated_at:now_(),row_version:Number(o.row_version)+1,last_request_id:requestId});event_(o.order_id,actor.lineUserId,'admin.collect',publicOrder_(o),{state:'collected'},requestId);return {state:'collected',message:'บันทึกรับผ้าแล้ว'};
}
function uploadSlip_(p,actor,cfg,requestId) {
  var o=order_(p.orderId),c=table_('Customers').find(function(x){return x.customer_id===o.customer_id;});if(!c||c.line_user_id!==actor.lineUserId)throw apiError_('NOT_FOUND','ไม่พบรายการนี้',404);if(o.state!=='awaiting_payment')throw apiError_('INVALID_STATE','ยังไม่สามารถแนบสลิปในสถานะนี้',409);
  var folderId=cfg.slipsFolderId;if(!folderId)throw apiError_('DRIVE_NOT_CONFIGURED','ยังไม่ได้ตั้งค่าโฟลเดอร์สลิป',503);var mime=String(p.mimeType||''),data=String(p.base64||'');if(['image/jpeg','image/png','image/webp'].indexOf(mime)<0)throw apiError_('INVALID_FILE_TYPE','รองรับเฉพาะรูป JPG, PNG หรือ WebP',400);if(!data||data.length>7*1024*1024)throw apiError_('INVALID_FILE_SIZE','ไฟล์ว่างหรือใหญ่เกิน 5 MB',413);
  var bytes=Utilities.base64Decode(data);if(bytes.length>5*1024*1024)throw apiError_('INVALID_FILE_SIZE','รูปต้องมีขนาดไม่เกิน 5 MB',413);
  var ext=mime==='image/jpeg'?'jpg':mime==='image/png'?'png':'webp',blob=Utilities.newBlob(bytes,mime,'slip-'+o.order_id+'-'+uuid_().slice(0,8)+'.'+ext),file=DriveApp.getFolderById(folderId).createFile(blob);
  var fileId=uuid_();append_('Files',{file_id:fileId,order_id:o.order_id,kind:'payment_slip',drive_file_id:file.getId(),mime_type:mime,byte_size:bytes.length,uploaded_at:now_(),uploader:actor.lineUserId});event_(o.order_id,actor.lineUserId,'customer.uploadSlip',{fileId:fileId},{fileId:fileId},requestId);return {slipFileId:fileId,message:'อัปโหลดสลิปแล้ว กรุณากดแจ้งโอนเพื่อให้ร้านตรวจ'};
}
function getSlip_(p) {
  var o=order_(p.orderId),slip=table_('Files').filter(function(f){return f.order_id===o.order_id&&f.kind==='payment_slip';}).pop();
  if(!slip) throw apiError_('SLIP_NOT_FOUND','ยังไม่มีสลิปแนบในรายการนี้',404);
  var blob=DriveApp.getFileById(slip.drive_file_id).getBlob();
  return {orderId:o.order_id,mimeType:blob.getContentType(),base64:Utilities.base64Encode(blob.getBytes()),fileId:slip.file_id};
}
function adminQueue_() {
  var orders=table_('Orders').filter(function(o){return ['collected','cancelled'].indexOf(o.state)<0;}).sort(function(a,b){return String(a.created_at).localeCompare(String(b.created_at));});
  var customers=table_('Customers'),timers=table_('Timers'),machines=table_('Machines'),payments=table_('Payments'),files=table_('Files');
  return {orders:orders.map(function(o){var c=customers.find(function(x){return x.customer_id===o.customer_id;}),q=o.quote_json?JSON.parse(o.quote_json):null,activeTimers=timers.filter(function(t){return t.order_id===o.order_id&&!t.completed_at;}),t=activeTimers[activeTimers.length-1],m=t&&machines.find(function(x){return x.machine_id===t.machine_id;}),reviews=payments.filter(function(x){return x.order_id===o.order_id&&x.status==='review';}),pay=reviews[reviews.length-1];return {orderId:o.order_id,displayName:c&&c.display_name||'ลูกค้า LINE',state:o.state,washerKg:Number(o.washer_kg||o.requested_washer_kg),dryerKg:Number(o.dryer_kg||o.requested_dryer_kg),estimateBaht:q&&q.totalBaht!==null?q.totalBaht:null,supplyBaht:q&&q.supplyBaht!==null?Number(q.supplyBaht):null,supplyMode:o.supply_mode,paymentState:o.payment_state,expectedAmountBaht:pay?Number(pay.expected_amount_baht):null,reportedAmountBaht:pay?Number(pay.reported_amount_baht):null,hasSlip:files.some(function(f){return f.order_id===o.order_id&&f.kind==='payment_slip';}),machineNo:m&&m.display_no||'',dueAt:t&&t.due_at||'',rowVersion:Number(o.row_version)};})};
}
function dueTimers_() {var now=Date.now();return {timers:table_('Timers').filter(function(t){return !t.completed_at&&!t.reminder_sent_at&&Date.parse(t.due_at)<=now;}).map(function(t){var m=table_('Machines').find(function(x){return x.machine_id===t.machine_id;});return {timerId:t.timer_id,orderId:t.order_id,stage:t.stage,machineId:t.machine_id,machineDisplayNo:m&&m.display_no||'ไม่ระบุ',dueAt:t.due_at};})};}
function claimDueTimer_(p,requestId) {
  var t=table_('Timers').find(function(x){return x.timer_id===String(p.timerId);});if(!t||t.completed_at||t.reminder_sent_at||Date.parse(t.due_at)>Date.now())return {claimed:false};if(t.reminder_claimed_at&&Date.now()-Date.parse(t.reminder_claimed_at)<120000)return {claimed:false};update_('Timers',t._row,{reminder_claimed_at:now_(),revision:Number(t.revision||0)+1});return {claimed:true,timerId:t.timer_id,orderId:t.order_id,stage:t.stage,machineId:t.machine_id};
}
function completeTimerReminder_(p,requestId) {var t=table_('Timers').find(function(x){return x.timer_id===String(p.timerId);});if(!t||t.reminder_sent_at)return {sent:false};update_('Timers',t._row,{reminder_sent_at:now_(),revision:Number(t.revision||0)+1});event_(t.order_id,'system','system.timerDueReminder',null,{timerId:t.timer_id},requestId);return {sent:true};}

function seedSettings_(ss) {
  var sh=ss.getSheetByName('Settings'),last=sh.getLastRow();if(last>1)return;
  var rows=Object.keys(DEFAULTS_).map(function(k){return [k,JSON.stringify(DEFAULTS_[k]),now_(),'system','ค่าเริ่มต้นสำหรับระบบซัก–อบ–พับ; ตรวจทานก่อนเปิดจริง'];});
  if(rows.length)sh.getRange(2,1,rows.length,5).setValues(rows);
}
function settings_(){var out={};table_('Settings').forEach(function(r){out[r.key]=r.value;});return out;}
function jsonSetting_(settings,key,fallback){try{return settings[key]?JSON.parse(settings[key]):fallback;}catch(_){return fallback;}}
function order_(id){var o=table_('Orders').find(function(x){return x.order_id===String(id);});if(!o)throw apiError_('ORDER_NOT_FOUND','ไม่พบเลขงานนี้',404);return o;}
function publicOrder_(o){return {orderId:o.order_id,state:o.state,supplyMode:o.supply_mode,washerKg:Number(o.washer_kg||o.requested_washer_kg),dryerKg:Number(o.dryer_kg||o.requested_dryer_kg),quoteTotalBaht:o.quote_total_baht===''?null:Number(o.quote_total_baht),paymentState:o.payment_state,rowVersion:Number(o.row_version)};}
function table_(name){var ss=SpreadsheetApp.openById(config_().sheetId),sh=ss.getSheetByName(name);if(!sh)throw apiError_('SCHEMA_NOT_READY','ยังไม่ได้ตั้งค่าโครงสร้างข้อมูล กรุณาให้ผู้ดูแลรัน setupSchema',503);var v=sh.getDataRange().getValues();if(v.length<2)return [];var headers=v[0].map(String);return v.slice(1).map(function(row,i){var o={_row:i+2};headers.forEach(function(k,j){o[k]=row[j]===null?'':row[j];});return o;}).filter(function(o){return Object.keys(o).some(function(k){return k!=='_row'&&o[k]!=='';});});}
function append_(name,record){var ss=SpreadsheetApp.openById(config_().sheetId),sh=ss.getSheetByName(name);if(!sh)throw apiError_('SCHEMA_NOT_READY','ไม่พบแท็บ '+name,503);var headers=SHEETS_[name];sh.appendRow(headers.map(function(k){return record[k]===undefined?'':record[k];}));}
function update_(name,row,patch){var ss=SpreadsheetApp.openById(config_().sheetId),sh=ss.getSheetByName(name),headers=SHEETS_[name];Object.keys(patch).forEach(function(k){var col=headers.indexOf(k);if(col>=0)sh.getRange(row,col+1).setValue(patch[k]);});}
function event_(orderId,actor,action,before,after,requestId){append_('Events',{event_id:uuid_(),order_id:orderId,actor_id:actor||'system',action:action,before_json:before?JSON.stringify(before):'',after_json:after?JSON.stringify(after):'',request_id:requestId||'',created_at:now_()});}
function now_(){return new Date().toISOString();}
function uuid_(){return Utilities.getUuid();}
function constantTimeEqual_(a,b){if(a.length!==b.length)return false;var diff=0;for(var i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
function output_(v){return ContentService.createTextOutput(JSON.stringify(v)).setMimeType(ContentService.MimeType.JSON);}
function apiError_(code,message,status){var e=new Error(message);e.code=code;e.status=status||400;return e;}
