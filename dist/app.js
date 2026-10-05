const icons={wave:'<path d="M3 7c3-4 5 4 9 0s6 4 9 0M3 12c3-4 5 4 9 0s6 4 9 0M3 17c3-4 5 4 9 0s6 4 9 0"/>',shield:'<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z"/><path d="m8 12 3 3 5-6"/>',home:'<path d="m3 10 9-7 9 7v10H3zM9 20v-8h6v8"/>',bell:'<path d="M6 9a6 6 0 0 1 12 0v7l2 2H4l2-2zM9 21h6"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',settings:'<path d="m10 3 4 0 1 3 3 1 3 3v4l-3 3-3 1-1 3h-4l-1-3-3-1-3-3v-4l3-3 3-1z"/><circle cx="12" cy="12" r="3"/>',wifi:'<path d="M3 8a15 15 0 0 1 18 0M6 12a10 10 0 0 1 12 0M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="20" r=".5"/>',phone:'<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 18h4"/>',device:'<rect x="6" y="3" width="12" height="18" rx="4"/><path d="M9 8h6M9 11h6"/><circle cx="12" cy="17" r="1"/>',arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',check:'<path d="m5 12 5 5L20 6"/>',alert:'<path d="m12 3 10 18H2zM12 9v5M12 17v1"/>',power:'<path d="M12 2v10M7 5a9 9 0 1 0 10 0"/>',plus:'<path d="M12 4v16M4 12h16"/>',users:'<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5"/>',lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4"/>',sound:'<path d="m3 9 4 0 5-5v16l-5-5H3zM16 8a6 6 0 0 1 0 8M19 4a11 11 0 0 1 0 16"/>'};
const icon=(name,cls='')=>`<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.shield}</svg>`;
const escapeHTML=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initial={paired:false,pool:'المسبح الرئيسي',enabled:true,events:[],contacts:[],settings:{phone:true,sound:true,escalate:true}};
let legacy;try{legacy=JSON.parse(localStorage.getItem('smart-monitor-v1'));}catch{}
let state={...initial},page='welcome',step=0,filter='all',pairTimer,busy=false,ready=false,importDismissed=false;
const app=document.querySelector('#app'),modal=document.querySelector('#modal');
async function api(path,method='GET',body){
  const response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(90000),headers:method==='GET'?{}:{'Content-Type':'application/json','X-Smart-Monitor':'1','If-Match':String(state.revision)},body:method==='GET'?undefined:JSON.stringify(body||{})});
  let data;try{data=await response.json();}catch{throw new Error('الخادم لا يدعم قاعدة البيانات. شغّل الموقع باستخدام npm start.');}
  if(response.status===401&&path!=='/api/login'){ready=false;modal.close();showLogin();}
  if(!response.ok){const error=new Error(data.error||'تعذر تنفيذ الطلب');error.status=response.status;throw error;}
  return data;
}
function setBusy(value){busy=value;document.querySelectorAll('button').forEach(b=>b.disabled=value);app.setAttribute('aria-busy',String(value));}
function showSaveError(message){
  if(modal.open){
    let error=modal.querySelector('[role="alert"]');
    if(!error){error=document.createElement('p');error.className='form-error';error.setAttribute('role','alert');modal.append(error);}
    error.textContent=message;
  }else toast(message);
}
async function change(path,method,body,message,after){
  if(busy)return false;setBusy(true);
  try{state=await api(path,method,body);if(after)after();render();if(message)toast(message);return true;}
  catch(error){if(error.status===409){try{state=await api('/api/state');render();}catch{}}showSaveError(error.status?error.message:'تعذر الاتصال بالخادم. لم يتم تأكيد الحفظ؛ أعد المحاولة.');return false;}
  finally{setBusy(false);}
}
async function load(){
  app.innerHTML='<main class="connection-page"><h1>المراقب الذكي</h1><p role="status">جارٍ تحميل بيانات المسبح…</p></main>';
  try{state=await api('/api/state');ready=true;page=state.paired?'home':'welcome';render();}
  catch(error){if(error.status===401){showLogin();return;}ready=false;app.innerHTML=`<main class="connection-page"><h1>تعذر الاتصال بالخادم</h1><p>${escapeHTML(error.message)}</p><p>قد يحتاج الخادم المجاني إلى دقيقة للاستيقاظ. تحقق من اتصال الإنترنت ثم أعد المحاولة.</p><button class="primary" data-action="retry">إعادة المحاولة</button></main>`;}
}
function toast(message){const t=document.querySelector('#toast');t.textContent=message;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),3500);}
const button=(text,action,cls='primary',glyph='arrow')=>`<button class="${cls}" data-action="${action}">${text}${icon(glyph)}</button>`;
const brand=()=>`<div class="brand"><span class="brand-icon">${icon('wave')}</span><div><strong>المراقب الذكي</strong><small>طمأنينة، في كل لحظة</small></div></div>`;
const disclaimer=()=>`<div class="notice">${icon('shield')}<span>طبقة حماية إضافية، لا تغني عن الإشراف المباشر على المسبح.</span></div>`;
function intro(){const content=[`<span class="eyebrow">أمان ذكي. خصوصية كاملة.</span><h1>حماية مسبحك<br><span>بدون كاميرا</span></h1><p class="lead">تابع حالة مسبحك، واستقبل التنبيهات، وابقَ قريبًا ممن تحب.</p><div class="water-art"><div class="orbit one"></div><div class="orbit two"></div><div class="hero-shield">${icon('shield')}</div><div class="waves"></div><span class="art-label">حساسات ذكية · بدون مراقبة بصرية</span></div>${button('ابدأ الآن','intro-next')}${button('استكشف كيف يعمل','how','secondary','shield')}`,`<span class="eyebrow">كيف يعمل المراقب الذكي؟</span><h1>أمان ذكي،<br><span>بلا مراقبة بصرية</span></h1><p class="lead">خطوات بسيطة لتكون أقرب إلى سلامة مسبحك.</p><div class="feature-list">${[['wave','رصد دخول الجسم للماء','حساس يراقب الاضطراب على سطح المسبح.'],['phone','تنبيه فوري للجوال','لتعرف بوجود تنبيه وتتحقق من المسبح مباشرة.'],['shield','خصوصية كاملة دون كاميرا','يعتمد على الحساسات ويحافظ على خصوصية العائلة.']].map(x=>`<div class="feature"><span class="tile">${icon(x[0])}</span><div><h3>${x[1]}</h3><p>${x[2]}</p></div></div>`).join('')}</div>${disclaimer()}${button('التالي','intro-next')}`,`<span class="eyebrow">إضافة جهاز جديد</span><h1>مسبحك،<br><span>أقرب إليك</span></h1><p class="lead">جهّز المستشعر في 3 خطوات، ثم أضفه إلى لوحة المتابعة.</p><div class="device-art">${icon('device')}<div class="water-lines"></div><span>مراقب المسبح</span></div><div class="steps">${['ثبّت الجهاز فوق سطح ماء المسبح','شغّل الجهاز من مفتاح التشغيل','ابدأ الربط لإضافة الجهاز إلى اللوحة'].map((s,i)=>`<div><b>${i+1}</b>${s}</div>`).join('')}</div>${disclaimer()}${button('ابدأ الربط التجريبي','pair','primary','wifi')}`];return `<div class="intro-layout"><aside class="intro-aside">${brand()}<div class="aside-content"><span class="eyebrow">المراقب الذكي</span><h2>راحة بالك تبدأ<br>من هنا.</h2><p>حل يعتمد على الحساسات وإنترنت الأشياء<br>لمتابعة المسبح الخاص.</p><div class="aside-rings">${icon('shield')}</div></div><small>خصوصية العائلة أولًا. بدون كاميرات.</small></aside><main class="intro-main"><div class="intro-top">${brand()}<span class="demo-tag">نسخة تجريبية</span></div><div class="intro-content">${step?`<button class="back" data-action="intro-back">${icon('arrow')} رجوع</button>`:''}<div class="progress">${[0,1,2].map(i=>`<span class="${i===step?'active':''}"></span>`).join('')}</div>${content[step]}</div><footer>بيانات تجريبية للعرض · لا يوجد جهاز متصل فعليًا</footer></main></div>`;}
function pair(){return `<main class="pair-page">${brand()}<span class="demo-tag">ربط تجريبي</span><div class="pair-content"><div class="pair-orbit">${icon('wifi')}</div><h1>جارٍ تجهيز لوحة المسبح</h1><p>نحاكي خطوات الاتصال لتجربة الموقع.<br>لا يتم البحث عن أجهزة حقيقية.</p><div class="pair-steps"><span>١. الجهاز</span><span>٢. الاتصال</span><span>٣. جاهز</span></div>${button('إلغاء','cancel-pair','secondary','arrow')}</div>${disclaimer()}</main>`;}
const currentAlert=()=>state.events.find(e=>!e.acknowledged);
const navItems=[['home','home','الرئيسية'],['alerts','bell','التنبيهات'],['history','clock','السجل'],['settings','settings','الإعدادات']];
function shell(content,title,sub){const alert=currentAlert();return `<div class="app-layout"><aside class="sidebar">${brand()}<nav aria-label="التنقل الرئيسي">${navItems.map(([key,glyph,label])=>`<button data-page="${key}" class="nav-item ${page===key?'active':''}" ${page===key?'aria-current="page"':''}>${icon(glyph)}<span>${label}</span>${key==='alerts'&&alert?'<b class="badge">1</b>':''}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="privacy">${icon('shield')}<strong>خصوصيتك محفوظة</strong><p>مراقبة بالحساسات<br>بدون كاميرات</p></div><span class="demo-tag">${sourceLabel(state.device.mode)}</span></div></aside><div class="main-shell"><header class="topbar"><div class="mobile-brand">${brand()}</div><div class="topbar-desktop"><span class="live-dot"></span> ${state.enabled?'المراقبة نشطة':'المراقبة متوقفة'}</div><div class="topbar-end"><span class="demo-tag">${deviceConnection()}</span><button class="icon-button" data-page="alerts" aria-label="عرض التنبيهات">${icon('bell')}${alert?'<i></i>':''}</button><button class="text-button" data-action="enable-sound" aria-label="تفعيل الصوت على هذا الجهاز">${icon("sound")}</button>${state.authRequired?'<button class="text-button" data-action="logout">خروج</button>':""}</div></header><main class="main-content"><div class="page-heading"><div><span class="eyebrow">سلامة مسبحك</span><h1>${title}</h1><p>${sub}</p></div>${page==='home'?button('إدارة الجهاز','device','secondary','settings'):''}</div>${content}<div class="bottom-notice">${disclaimer()}</div></main><nav class="mobile-nav" aria-label="التنقل للجوال">${navItems.map(([key,glyph,label])=>`<button class="${page===key?'active':''}" data-page="${key}" ${page===key?'aria-current="page"':''}>${icon(glyph)}<span>${label}</span></button>`).join('')}</nav></div></div>`;}
function poolVisual(alert){return `<div class="pool-scene ${alert?'danger':''}"><div class="pool-ripple r1"></div><div class="pool-ripple r2"></div><div class="pool-ripple r3"></div><span class="sensor">${icon('device')}<i></i></span><span class="pool-caption">${icon('wave')} ${escapeHTML(state.pool)}</span><span class="pool-tag">${alert?'تنبيه نشط':state.enabled?'متابعة المسبح':'المراقبة متوقفة'}</span></div>`;}
function home(){const alert=currentAlert();return shell(`<div class="dashboard-grid"><section class="card pool-card"><div class="section-head"><h2>نظرة على المسبح</h2><span class="muted">بدون كاميرا</span></div>${poolVisual(alert)}<div class="metrics"><div>${icon('wave')}<small>حالة المسبح</small><strong class="${alert?'red':'teal'}">${alert?'دخول جسم':state.enabled?(state.device.online?(state.device.waterDetected?'اضطراب الماء':'لا اضطراب مرصود'):'لا توجد قراءة حديثة'):'غير مراقب'}</strong></div><div>${icon('wifi')}<small>اتصال الجهاز</small><strong>${deviceConnection()}</strong></div><div>${icon('device')}<small>البطارية</small><strong dir="ltr">${state.device.batteryPercent===null?"—":Math.round(state.device.batteryPercent)+"%"}</strong></div></div></section><section class="card status-card ${alert?'alert-status':''}"><div class="section-head"><h2>حالة المراقبة</h2><span class="status-pill ${alert?'danger':''}">${alert?'يتطلب التحقق':state.enabled?'نشطة':'متوقفة'}</span></div><div class="status-symbol">${icon(alert?'alert':'shield')}</div><h2>${alert?'تم اكتشاف دخول جسم إلى الماء':state.enabled?(state.device.online?'متابعة قراءات الجهاز':'بانتظار قراءات الجهاز'):'المراقبة متوقفة'}</h2><p>${alert?sourceLabel(alert.source):'تعرض اللوحة آخر قراءة مستلمة؛ تحقق من اتصال الجهاز.'}</p>${alert?button('عرض تفاصيل التنبيه','detail','danger-button','arrow'):button(state.enabled?'إيقاف المراقبة':'تشغيل المراقبة','toggle','secondary','power')}<div class="status-foot">${icon('lock')} حساسات فقط، بدون كاميرات</div></section><section class="card device-card"><div class="section-head"><h2>مستشعر المسبح الرئيسي</h2><span class="status-pill">${deviceConnection()}</span></div><div class="device-row"><span class="tile">${icon('device')}</span><div><strong>المراقب الذكي</strong><p>${sourceLabel(state.device.mode)} · ${escapeHTML(state.device.serial)}</p></div><button class="text-button" data-action="device">إدارة ${icon('arrow')}</button></div><div class="device-summary"><span>${icon('check')} ${sourceLabel(state.device.mode)}</span><span>${icon('wifi')} ${deviceConnection()}</span></div></section><section class="card activity-card"><div class="section-head"><h2>آخر الأحداث</h2><button class="text-button" data-page="history">عرض الكل</button></div>${state.events.length?eventRow(state.events[0]):`<div class="empty-small">${icon('clock')}<div><strong>لا توجد تنبيهات حتى الآن</strong><p>تظهر الأحداث هنا عند تجربة محاكاة التنبيه.</p></div></div>`}</section><section class="demo-panel"><span class="tile">${icon('alert')}</span><div><h3>جرّب سيناريو التنبيه</h3><p>حاكِ دخول جسم للماء لاستكشاف تفاصيل التنبيه والاستجابة.</p></div>${button('محاكاة تنبيه','simulate','secondary','plus')}</section></div>`,'أهلًا بك في المراقب الذكي','كل ما تحتاجه لمتابعة مسبحك، في مكان واحد.');}
function eventRow(e){return `<button class="event-row" data-event="${e.id}"><span class="tile ${e.acknowledged?'':'red-tile'}">${icon(e.acknowledged?'check':'alert')}</span><div><strong>دخول جسم إلى الماء</strong><p>${escapeHTML(e.pool)} · ${new Date(e.time).toLocaleString('ar-SA',{dateStyle:'short',timeStyle:'short'})}</p></div><span class="status-pill ${e.acknowledged?'':'danger'}">${e.acknowledged?'تم التحقق':'يتطلب التحقق'}</span>${icon('arrow')}</button>`;}
function eventsPage(){const list=state.events.filter(e=>filter==='all'||(filter==='pending'?!e.acknowledged:e.acknowledged));return shell(`<section class="card events-card"><div class="section-head"><h2>${page==='history'?'سجل الأحداث':'تنبيهات المسبح'}</h2><span class="muted">${state.events.length} حدث</span></div><div class="filters">${[['all','الكل'],['pending','بانتظار التحقق'],['done','تم التحقق']].map(([k,v])=>`<button class="${filter===k?'active':''}" data-filter="${k}">${v}</button>`).join('')}</div>${list.length?list.map(eventRow).join(''):`<div class="empty-state">${icon('bell')}<h2>لا توجد ${filter==='all'?'تنبيهات':'أحداث مطابقة'}</h2><p>ستظهر التنبيهات التجريبية هنا عند محاكاة حدث.</p>${button('محاكاة تنبيه','simulate','secondary','plus')}</div>`}</section>`,page==='history'?'سجل المسبح':'التنبيهات',page==='history'?'راجع الأحداث السابقة وحالة التحقق منها.':'تابع التنبيهات واتخذ الإجراء المناسب.');}
function settings(){return shell(`<div class="settings-grid"><section class="card"><div class="section-head"><h2>إعدادات التنبيهات</h2>${icon('bell')}</div>${[['phone','phone','إشعارات الجوال','تنبيه ظاهر في الموقع أثناء فتحه على الجوال.'],['sound','sound','التنبيه الصوتي','صوت داخل الصفحة المفتوحة بعد تفعيله على هذا الجهاز.'],['escalate','users','تنبيه جهات الاتصال','حفظ التفضيل؛ لا يتم إرسال رسائل في وضع العرض.']].map(([key,glyph,title,desc])=>`<div class="setting-row"><span class="tile">${icon(glyph)}</span><div><strong>${title}</strong><p>${desc}</p></div><button class="switch" role="switch" aria-label="${title}" aria-checked="${state.settings[key]}" data-setting="${key}"><span></span></button></div>`).join('')}<div class="info-note">التنبيهات الحية تعمل أثناء فتح الصفحة واتصالها بالإنترنت. فعّل الصوت من الشريط العلوي. لا توجد رسائل SMS أو إشعارات عند إغلاق الموقع؛ جهات الاتصال محفوظة فقط.</div></section><section class="card"><div class="section-head"><h2>جهات الاتصال</h2><button class="text-button" data-action="add-contact">${icon('plus')} إضافة</button></div>${state.contacts.length?state.contacts.map((c,i)=>`<div class="contact-row"><span class="avatar">${escapeHTML(c.name.slice(0,1))}</span><div><strong>${escapeHTML(c.name)}</strong><p dir="ltr">${escapeHTML(c.phone)}</p></div><button class="text-button" data-remove="${c.id}" aria-label="حذف ${escapeHTML(c.name)}">حذف</button></div>`).join(''):`<div class="empty-small">${icon('users')}<div><strong>أضف جهة اتصال</strong><p>احفظ جهات التواصل في قاعدة البيانات.</p></div></div>`}</section><section class="card"><div class="section-head"><h2>الجهاز والمسبح</h2>${icon('device')}</div><form id="pool-form"><label for="pool-name">اسم المسبح</label><input id="pool-name" name="pool" value="${escapeHTML(state.pool)}" required maxlength="50"><button class="primary" type="submit">حفظ التغييرات ${icon('check')}</button></form></section><section class="card privacy-card">${icon('shield')}<h2>أمان ذكي يحفظ الخصوصية</h2><p>الفكرة تعتمد على حساسات ترصد اضطراب الماء وتؤكد دخول جسم للمسبح، بدون تصوير أو كاميرات.</p><span class="demo-tag">البيانات محفوظة في قاعدة البيانات</span></section></div>`,'الإعدادات','اضبط تفضيلات المراقبة وجهات التواصل.');}
function render(){
  const canImport=legacy&&typeof legacy==='object'&&!importDismissed&&state.revision===0&&!state.legacyImported;
  app.innerHTML=(canImport?`<aside class="migration-banner"><span>لديك بيانات من النسخة السابقة في هذا المتصفح.</span><button class="text-button" data-action="import">نقلها إلى قاعدة البيانات</button><button class="text-button" data-action="dismiss-import">لاحقًا</button></aside>`:'')+(page==='welcome'?intro():page==='pair'?pair():page==='home'?home():page==='settings'?settings():eventsPage());
  setBusy(busy);updateLiveBanner();
}
function showModal(body){modal.innerHTML=`<button class="modal-close icon-button" data-action="close-modal" aria-label="إغلاق">×</button>${body}`;modal.querySelector('h2')?.setAttribute('id','dialog-title');modal.setAttribute('aria-labelledby','dialog-title');modal.showModal();}
function detail(id){const e=state.events.find(x=>x.id===id)||currentAlert();if(!e)return;showModal(`<span class="detail-icon">${icon('alert')}</span><span class="eyebrow">${sourceLabel(e.source)}</span><h2>دخول جسم إلى الماء</h2><p>تحقق من المسبح مباشرة عند تلقي تنبيه حقيقي.</p><dl><div><dt>المسبح</dt><dd>${escapeHTML(e.pool)}</dd></div><div><dt>الوقت</dt><dd>${new Date(e.time).toLocaleString('ar-SA')}</dd></div><div><dt>حالة التنبيه</dt><dd>${e.acknowledged?'تم التحقق':'بانتظار التحقق'}</dd></div><div><dt>مصدر البيانات</dt><dd>${sourceLabel(e.source)}</dd></div></dl><div class="action-guide"><h3>الإجراء الموصى به</h3><ol><li>توجّه إلى المسبح فورًا.</li><li>تحقق من سلامة الموجودين.</li><li>عند وجود حالة طارئة، اطلب المساعدة.</li></ol></div>${!e.acknowledged?`<button class="danger-button" data-ack="${e.id}">تم التحقق من المسبح ${icon('check')}</button>`:button('إغلاق','close-modal','secondary','check')}`);}
function sound(){try{audioContext ||= new (window.AudioContext||window.webkitAudioContext)();audioContext.resume();const osc=audioContext.createOscillator(),gain=audioContext.createGain();osc.connect(gain);gain.connect(audioContext.destination);osc.frequency.value=740;gain.gain.value=.07;osc.start();gain.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+.5);osc.stop(audioContext.currentTime+.5);}catch{}}
async function simulate(){
  if(!state.enabled){toast('شغّل المراقبة أولًا');return;}
  if(currentAlert()){detail();return;}
  await change('/api/events/simulate','POST',{},'تم حفظ تنبيه تجريبي في قاعدة البيانات',()=>{page='home';if(state.settings.sound)sound();});
}
async function toggle(){
  if(state.enabled&&currentAlert()){toast('تحقق من التنبيه النشط قبل إيقاف المراقبة');return;}
  const enabled=!state.enabled;
  await change('/api/monitoring','PATCH',{enabled},enabled?'تم تشغيل المراقبة':'تم إيقاف المراقبة',()=>modal.close());
}
function showDevice(){showModal(`<span class="tile">${icon('device')}</span><h2>إدارة الجهاز</h2><p>${sourceLabel(state.device.mode)}</p><dl><div><dt>اسم المسبح</dt><dd>${escapeHTML(state.pool)}</dd></div><div><dt>الجهاز</dt><dd>${escapeHTML(state.device.serial)}</dd></div><div><dt>الاتصال</dt><dd>${deviceConnection()}</dd></div><div><dt>آخر قراءة</dt><dd>${state.device.lastSeen?new Date(state.device.lastSeen).toLocaleString("ar-SA"):"لم تصل قراءات"}</dd></div><div><dt>إشارة Wi-Fi</dt><dd>${state.device.rssi??"—"} dBm</dd></div><div><dt>المراقبة</dt><dd>${state.enabled?'نشطة':'متوقفة'}</dd></div></dl>${button(state.enabled?'إيقاف المراقبة':'تشغيل المراقبة','device-toggle','secondary','power')}${button('إعادة تجربة الربط','repair','secondary','wifi')}`);}
function addContact(){showModal(`<span class="tile">${icon('users')}</span><h2>إضافة جهة اتصال</h2><p>تُحفظ في قاعدة البيانات، دون إرسال رسائل في وضع العرض.</p><form id="contact-form"><label for="contact-name">الاسم</label><input id="contact-name" name="name" required maxlength="60" autocomplete="name"><label for="contact-phone">رقم الجوال</label><input id="contact-phone" name="phone" type="tel" dir="ltr" placeholder="05xxxxxxxx" required maxlength="30" autocomplete="tel"><p id="form-error" class="form-error" role="alert"></p><button type="submit" class="primary">حفظ جهة الاتصال ${icon('check')}</button></form>`);}
function normalizeContactPhone(value){
  const ascii=value.replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776));
  if(!/^[+\d\s()-]+$/.test(ascii))return null;
  const digits=ascii.replace(/[\s()-]/g,'');
  return /^\+?[0-9]{8,15}$/.test(digits)?digits:null;
}
async function handleClick(event){
  const el=event.target.closest('button');if(!el||busy)return;
  if(el.dataset.page){page=el.dataset.page;filter='all';render();window.scrollTo(0,0);return;}
  if(el.dataset.event){detail(el.dataset.event);return;}
  if(el.dataset.filter){filter=el.dataset.filter;render();return;}
  if(el.dataset.setting){const key=el.dataset.setting;await change('/api/settings','PATCH',{[key]:!state.settings[key]},'تم حفظ الإعداد');return;}
  if(el.dataset.remove){await change('/api/contacts/'+encodeURIComponent(el.dataset.remove),'DELETE',{},'تم حذف جهة الاتصال');return;}
  if(el.dataset.ack){await change('/api/events/'+encodeURIComponent(el.dataset.ack)+'/ack','POST',{},'تم حفظ التحقق من التنبيه',()=>modal.close());return;}
  switch(el.dataset.action){
    case'enable-sound':soundEnabled=true;sound();toast('تم تفعيل الصوت لهذه الصفحة');break;
    case'logout':await api('/api/logout','POST',{});ready=false;showLogin();break;
    case'retry':await load();break;
    case'import':await change('/api/import','POST',legacy,'تم نقل بياناتك السابقة؛ بقيت النسخة الأصلية في المتصفح',()=>{page=state.paired?'home':'welcome';});break;
    case'dismiss-import':importDismissed=true;render();break;
    case'intro-next':step=Math.min(2,step+1);render();window.scrollTo(0,0);break;
    case'how':step=1;render();window.scrollTo(0,0);break;
    case'intro-back':step=Math.max(0,step-1);render();window.scrollTo(0,0);break;
    case'pair':
      page='pair';render();window.scrollTo(0,0);
      pairTimer=setTimeout(async()=>{const success=await change('/api/pair','POST',{},'تم حفظ ربط الجهاز التجريبي',()=>{page='home';});if(!success){page='welcome';step=2;render();}},1200);break;
    case'cancel-pair':clearTimeout(pairTimer);page='welcome';step=2;render();break;
    case'simulate':await simulate();break;
    case'detail':detail();break;
    case'toggle':case'device-toggle':await toggle();break;
    case'device':showDevice();break;
    case'repair':modal.close();page='welcome';step=2;render();window.scrollTo(0,0);break;
    case'add-contact':addContact();break;
    case'close-modal':modal.close();break;
  }
}
async function handleSubmit(event){
  event.preventDefault();if(busy)return;
  const data=new FormData(event.target);
  if(event.target.id==='login-form'){setBusy(true);try{await api('/api/login','POST',{password:data.get('password')});await load();}catch(error){document.querySelector('#login-error').textContent=error.message;}finally{setBusy(false);}return;}
  if(event.target.id==='pool-form'){
    const name=data.get('pool').trim();if(!name){toast('أدخل اسم المسبح');return;}
    await change('/api/pool','PATCH',{name},'تم حفظ اسم المسبح');
  }
  if(event.target.id==='contact-form'){
    const name=data.get('name').trim(),phone=normalizeContactPhone(data.get('phone').trim());
    if(!name||!phone){document.querySelector('#form-error').textContent='أدخل اسمًا ورقم جوال يحتوي على 8 إلى 15 رقمًا.';return;}
    document.querySelector('#form-error').textContent='';
    await change('/api/contacts','POST',{name,phone},'تم حفظ جهة الاتصال في قاعدة البيانات',()=>modal.close());
  }
}
function reportUnexpected(error){console.error(error);toast('تعذر إكمال العملية. أعد المحاولة.');}
document.addEventListener('click',event=>{handleClick(event).catch(reportUnexpected);});
document.addEventListener('submit',event=>{handleSubmit(event).catch(reportUnexpected);});
modal.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
modal.addEventListener('click',e=>{if(!busy&&e.target===modal){const r=modal.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)modal.close();}});
let polling=false,soundEnabled=false,audioContext,lastAnnounced='',connectionLost=false;
function sourceLabel(source){return source==='wokwi'?'محاكاة ESP32 عبر Wokwi':source==='esp32'?'جهاز ESP32':source==='legacy_import'?'بيانات مستوردة':'محاكاة الواجهة';}
function deviceConnection(){return state.device.mode==='simulation'?'محاكاة الواجهة':state.device.online?'متصل':'لا توجد قراءة حديثة';}
function showLogin(){
  document.querySelector('#live-banner')?.remove();
  app.innerHTML=`<main class="connection-page login-page">${brand()}<h1>متابعة المسبح</h1><p>أدخل كلمة مرور لوحة المراقبة.</p><form id="login-form"><label for="password">كلمة المرور</label><input id="password" name="password" type="password" autocomplete="current-password" required><p id="login-error" role="alert"></p><button class="primary" type="submit">دخول</button></form></main>`;
}
function updateLiveBanner(){
  let banner=document.querySelector('#live-banner');
  if(!banner){banner=document.createElement('aside');banner.id='live-banner';banner.setAttribute('role','alert');document.body.append(banner);}
  const alert=currentAlert();
  banner.hidden=!alert&&!connectionLost;
  banner.className=alert?'live-alert':'connection-alert';
  banner.innerHTML=alert?`<strong>تنبيه: دخول جسم إلى الماء</strong> <span>${sourceLabel(alert.source)}</span> <button data-event="${escapeHTML(alert.id)}">عرض التنبيه</button>`:connectionLost?'انقطع الاتصال بالخادم؛ القراءات المعروضة قديمة. جارٍ إعادة المحاولة…':'';
  if(alert&&lastAnnounced!==alert.id){lastAnnounced=alert.id;if(soundEnabled&&state.settings.sound)sound();}
}
async function poll(){
  if(!ready||busy||polling||document.hidden)return;
  polling=true;const revision=state.revision;
  try{
    const latest=await api('/api/state');
    if(!ready||busy||state.revision!==revision)return;
    connectionLost=false;const changed=latest.revision!==state.revision||latest.device.online!==state.device.online;
    state=latest;
    if(page==='welcome'&&state.paired)page='home';
    if(changed&&!modal.open&&page!=='settings'&&page!=='pair')render();
    updateLiveBanner();
  }catch(error){if(error.status!==401){connectionLost=true;updateLiveBanner();}}
  finally{polling=false;}
}
window.addEventListener('focus',poll);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});
setInterval(poll,5000);
load();
