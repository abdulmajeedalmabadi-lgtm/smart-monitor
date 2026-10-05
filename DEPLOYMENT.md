# نشر المراقب الذكي على الإنترنت

الحالة: المشروع مجهز للنشر، لكنه **لم يُنشر على حساب Render/Turso ولم يُختبر على رابط عام بعد**. نفّذ الخطوات أدناه ثم اختبارات القبول. لا تحتاج إبقاء جهاز Windows يعمل بعد النشر.

## 1. الاختيار وقاعدة البيانات

استخدم **Render Free Web Service** لتشغيل Node.js والواجهة معًا، و**Turso Cloud Free (محرك libSQL)** لقاعدة البيانات. نفس نطاق HTTPS يخدم الموقع وواجهات API؛ المتصفح يستخدم مسارات `/api/...` النسبية.

تحققنا من توثيق الاستضافة في 5 أكتوبر 2026: نظام ملفات Render المجاني مؤقت، ويُفقد SQLite المحلي عند إعادة التشغيل/النشر، ولا تتوفر أقراص دائمة للخدمة المجانية. لذلك التطبيق يرفض التشغيل في الإنتاج إذا لم تضبط Turso؛ لا توجد عودة صامتة إلى ملف SQLite. قد تنام خدمة Render بعد 15 دقيقة دون طلبات، وتحتاج نحو دقيقة للاستيقاظ. [توثيق Render المجاني](https://render.com/docs/free).

**التطوير المحلي يبقى SQLite. الإنتاج ينتقل إلى قاعدة libSQL متوافقة مع SQLite ومستضافة في Turso**، بنفس الجداول والميزات. بيانات Turso مستقلة عن قرص Render وعن جهازك؛ إعادة نشر التطبيق لا تعيد إنشاء البيانات ولا تمسحها. اختر المنطقة الأقرب إلى منطقة Render لتقليل زمن الطلبات. الخطة المجانية لها حدود تخزين وطلبات؛ راقب الاستخدام في الحساب. [Turso Cloud](https://docs.turso.tech/introduction)، [الأسعار](https://turso.tech/pricing).

هذا مسار MVP لمسبح واحد وجهاز واحد وحساب لوحة مشترك. التنبيه يصل إلى الصفحة المفتوحة خلال دورة تحديث تقارب 5 ثوانٍ بعد وصول العينة للخادم. الصوت يحتاج ضغطة تفعيل في كل جلسة. **لا يوجد Web Push عند إغلاق الصفحة أو قفل الهاتف، ولا SMS أو اتصال بجهات الطوارئ**. خطة مجانية ذات تشغيل متقطع ليست نظام إنقاذ مضمونًا.

## 2. التحضير والملفات التي ترفعها

**GitHub مطلوب في هذا الدليل** لربط Render بالمصدر. ليس مطلوبًا لتشغيل Node.js نفسه. أنشئ مستودعًا خاصًا جديدًا باسم `smart-monitor`.

ارفع **محتويات مجلد `smart-monitor` مباشرة في جذر المستودع**، بحيث يظهر `package.json` في أول مستوى:

```text
dist/       server/       db/       scripts/       tests/       wokwi/
package.json              package-lock.json        render.yaml
.gitignore                .env.example             start.cmd
README.md                 DEPLOYMENT.md            DATABASE.md
TEST-REPORT.md
```

لا ترفع `node_modules/` أو `data/` أو `backups/` أو `.git/` أو `.openai/` أو `.env` أو `wokwi/config.h`. ملف ZIP المرفق يستثنيها. لا ترفع ملف ZIP نفسه إلى GitHub؛ فك ضغطه وارفع محتوياته. من GitHub: **New repository → Private → Create repository → uploading an existing file → Commit changes**. تأكد من وجود `.gitignore` و`.env.example`، وأظهر الملفات المخفية إن لزم.

ثبّت Node.js 24.19 أو إصدار 24 أحدث يدعم `node:sqlite`. افتح PowerShell داخل مجلد المشروع:

```powershell
npm ci
npm run build
npm test
npm run secrets
```

احفظ القيم الثلاث التي يولدها الأمر الأخير بشكل خاص: `APP_PASSWORD` و`SESSION_SECRET` و`IOT_API_KEY`. كل واحدة مختلفة. هذه ليست مفاتيح Turso.

## 3. إنشاء قاعدة Turso

1. افتح [Turso](https://turso.tech/) وسجّل حسابًا، ثم افتح لوحة Turso Cloud واختر الخطة المجانية.
2. أنشئ قاعدة باسم `smart-monitor`، واختر **libSQL** إذا عرضت اللوحة اختيار المحرك. الكود يستخدم `@libsql/client`، وليس SDK محرك Turso الجديد.
3. افتح القاعدة، وانسخ **Database URL** الذي يبدأ بـ `libsql://`.
4. أنشئ **Database auth token** بصلاحية القراءة والكتابة لهذه القاعدة. احفظه في `TURSO_AUTH_TOKEN`، ولا تضعه في Wokwi أو الواجهة. انتبه لتاريخ انتهاء الرمز وجدده في Render قبل انتهائه.
5. اترك القاعدة فارغة. التطبيق ينشئ الجداول والترحيلات ويسجل الجهاز `SM-001` عند أول تشغيل. لا تنشئ جداول يدويًا.

إذا لم تجد خيار libSQL في اللوحة، المسار الرسمي البديل عبر Turso CLI في **WSL على Windows**:

```bash
curl -sSfL https://get.tur.so/install.sh | bash
```

أغلق نافذة WSL وافتحها، ثم:

```bash
turso auth login
turso db create smart-monitor
turso db show smart-monitor --url
turso db tokens create smart-monitor
```

لا تضف `--tursodb`؛ نريد محرك libSQL. [دليل Turso الرسمي](https://docs.turso.tech/quickstart)، [رموز قواعد البيانات](https://docs.turso.tech/cli/db/tokens/create).

### نقل بيانات SQLite الموجودة — اختياري، قبل تشغيل Render

إذا تريد الاحتفاظ بجهات الاتصال والإعدادات والأحداث الموجودة محليًا:

1. أوقف الخادم المحلي حتى لا تتغير البيانات أثناء النقل.
2. داخل **المجلد الأصلي الذي يحتوي `data/monitor.sqlite`** انسخ `.env.example` إلى `.env`.
3. اترك `NODE_ENV=development` واضبط `TURSO_DATABASE_URL` و`TURSO_AUTH_TOKEN` للقاعدة الجديدة الفارغة. اضبط `SMART_MONITOR_DB` على مسار الملف الأصلي عند الحاجة.
4. شغّل `npm run db:upload` مرة واحدة. ينشئ نسخة احتياطية في `backups/`، ويطبق الترحيلات على النسخة فقط، وينقل الجداول في معاملة واحدة. لا يعدّل ملفك الأصلي. يرفض استبدال قاعدة سحابية مستخدمة.
5. بعد النجاح تابع نشر Render. لا تنقل ملف SQLite إلى قرص Render.

البرنامج اختُبر على محول libSQL محليًا؛ نقل حساب Turso الحقيقي يتطلب بيانات اعتمادك ولم ينفذ ضمن هذا التسليم. لا تحذف الأصل قبل اختبار البيانات على الموقع المنشور. إذا لا تحتاج البيانات القديمة، تجاوز هذا القسم.

## 4. إنشاء خدمة Render

1. افتح [Render Dashboard](https://dashboard.render.com/) وسجّل الدخول.
2. اختر **New + → Web Service**، واربط مستودع GitHub `smart-monitor`.
3. اختر الفرع الذي رفعت عليه الملفات، عادة `main`.
4. Name: اسم فريد مثل `smart-monitor-yourname`.
5. Region: الأقرب إلى قاعدة Turso. Runtime/Language: **Node**.
6. Root Directory: **فارغ** إذا `package.json` في جذر المستودع. إذا رفعت المجلد داخل مجلد آخر، أدخل مساره النسبي الصحيح.
7. Build Command: **`npm ci && npm run build`**.
8. Start Command: **`npm start`**.
9. Instance Type: **Free**. لا تختَر Static Site؛ نحتاج عملية Node.js.
10. Health Check Path: **`/api/health`**.
11. أدخل متغيرات البيئة التالية ثم اختر **Deploy Web Service**.

| المتغير | القيمة في Render |
|---|---|
| `NODE_VERSION` | `24.19.0` |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` — عنوان استماع داخل الخادم، ليس URL للمتصفح |
| `PORT` | `10000` |
| `TURSO_DATABASE_URL` | رابط `libsql://...` الذي نسخته |
| `TURSO_AUTH_TOKEN` | رمز قاعدة البيانات للقراءة والكتابة |
| `APP_PASSWORD` | كلمة مرور اللوحة المولدة، 20 حرفًا على الأقل |
| `SESSION_SECRET` | سر توقيع الجلسات المولد، 32 حرفًا على الأقل |
| `IOT_API_KEY` | مفتاح الجهاز المولد، 32 حرفًا على الأقل، مختلف عن كلمة المرور |
| `IOT_DEVICE_ID` | `SM-001`، لا تغيّره في هذا الإصدار |
| `PUBLIC_ORIGIN` | اتركه **غير مضاف** عند استعمال نطاق Render الافتراضي |
| `RENDER_EXTERNAL_URL` | يضيفه Render تلقائيًا؛ لا تنشئه يدويًا |
| `SMART_MONITOR_DB` | لا تضفه في الإنتاج؛ يستخدم محليًا فقط |

إذا استخدمت نطاقًا مخصصًا لاحقًا: أضفه في Render وأكمل DNS وHTTPS أولًا، ثم اضبط `PUBLIC_ORIGIN=https://your-domain.example` دون مسار أو معاملات وأعد النشر. سيقبل التطبيق ذلك النطاق فقط.

بديل للخطوات اليدوية: `render.yaml` يعرّف نفس الخدمة ويمكن استخدام **New → Blueprint**؛ أدخل القيم السرية المطلوبة. لا تستخدم المسارين معًا حتى لا تنشئ خدمتين.

## 5. الحصول على رابط HTTPS واختبار الصحة

انتظر حالة **Live**. يظهر رابط الخدمة أعلى صفحة Render مثل:

```text
https://smart-monitor-yourname.onrender.com
```

هذا مثال وليس رابطًا منشورًا لك. انسخ **رابطك الحقيقي**. Render يوفر HTTPS تلقائيًا لنطاقه. إذا أخفق البناء، افحص Logs؛ إذا كان الخطأ حول Turso أو متغير مفقود، أصلح Environment ثم أعد النشر. [دليل Web Services](https://render.com/docs/web-services).

افتح في المتصفح:

```text
https://YOUR-SERVICE.onrender.com/api/health
```

المطلوب HTTP 200 والنص:

```json
{"status":"ok","storage":"turso","mode":"production"}
```

اختبار PowerShell:

```powershell
$base = 'https://YOUR-SERVICE.onrender.com'
Invoke-RestMethod "$base/api/health" -TimeoutSec 120
```

`storage: sqlite` أو `mode: development` يعني أن الإعداد غير صحيح. HTTP 503 يعني أن الاتصال بقاعدة البيانات فشل. لا تكتفِ بفتح الصفحة لإثبات عمل القاعدة.

## 6. اختبار الهاتف وPOST telemetry

1. افتح رابط الموقع على الهاتف **باستخدام بيانات الجوال مع إيقاف Wi-Fi** للتأكد أنه عام.
2. سجّل الدخول باستخدام `APP_PASSWORD`.
3. اترك الصفحة في المقدمة، وأبقِ الشاشة مفتوحة. فعّل الصوت من أيقونة السماعة إذا رغبت. لا يحتاج الهاتف كلمة مرور Turso أو مفتاح الجهاز.
4. من PowerShell أرسل عينة تجريبية. أدخل مفتاح **IOT_API_KEY** عند الطلب:

```powershell
$base = 'https://YOUR-SERVICE.onrender.com'
$deviceSecret = Read-Host 'IOT_API_KEY' -AsSecureString
$deviceKey = [System.Net.NetworkCredential]::new('', $deviceSecret).Password
$headers = @{ Authorization = "Bearer $deviceKey" }
$sample = @{
  deviceId = 'SM-001'
  sampleId = [guid]::NewGuid().ToString()
  source = 'wokwi'
  waterDetected = $true
  batteryPercent = 82
  rssi = -51
  timestamp = [DateTime]::UtcNow.ToString('o')
} | ConvertTo-Json
Invoke-RestMethod "$base/api/iot/telemetry" -Method Post -Headers $headers -ContentType 'application/json' -Body $sample -TimeoutSec 120
```

المطلوب HTTP 201، `accepted: true`، ومعرّف `alertId` إذا كانت المراقبة مفعلة ولا يوجد تنبيه نشط. يظهر شريط أحمر على الهاتف دون إعادة تحميل، ثم يمكن فتحه والتحقق من المسبح. البطارية المعروضة تصبح 82%. هذه عينة اختبار وليست جهاز Wokwi بعد.

إرسال **نفس** `$sample` مرة أخرى يعطي HTTP 200 و`duplicate: true` دون تكرار التنبيه. لتجربة حدث جديد: تحقق من التنبيه بالواجهة، أرسل عينة جديدة بـ`waterDetected=$false` و`sampleId` ووقت جديدين، ثم عينة جديدة بـ`$true`. قراءة الماء المستمرة لا تعيد التنبيه بعد التحقق حتى تصل قراءة جافة. لا تعطّل المراقبة أثناء وجود تنبيه غير متحقق منه.

اختبار شامل آلي للرابط الحقيقي: انسخ `.env.example` إلى `.env` في جهازك، وضع `PUBLIC_ORIGIN` رابطك الحقيقي و`APP_PASSWORD` و`IOT_API_KEY` المطابقين للخادم، ثم:

```powershell
npm run verify:deployment -- --write-test-alert
```

هذا الأمر ينشئ تنبيه اختبار، ويتحقق من الصحة وتسجيل الدخول وتخزين القياس وإعادة الإرسال وظهوره في حالة اللوحة. تحقق من التنبيه على الهاتف بعده. لا يشغّل Wokwi ولا يثبت وحده عرض الهاتف أو الصوت.

## 7. تشغيل Wokwi ESP32

1. من مجلد المشروع شغّل، باستخدام رابطك الحقيقي:

```powershell
npm run iot:certificate -- https://YOUR-SERVICE.onrender.com
```

الأمر يتحقق من TLS باستخدام مخزن الثقة في Node ويكتب شهادة CA عامة في `wokwi/root_ca.h`. لا تستخدم `setInsecure()`. أعد توليد الشهادة إذا غيّرت الاستضافة أو جهة إصدار شهادة HTTPS.

2. افتح [مشروع ESP32 جديد في Wokwi](https://wokwi.com/projects/new/esp32).
3. استبدل **كل** محتوى `sketch.ino` و`diagram.json` بالملفات من `wokwi/`.
4. أضف ملف `config.h` وانسخ إليه `config.example.h`، وأضف ملف `root_ca.h` الذي ولّده الأمر السابق.
5. أضف `libraries.txt` بالمحتوى المرفق، أو ثبّت `ArduinoJson` الإصدار `7.4.2` من Library Manager.
6. داخل `config.h` اضبط:

```cpp
static const char API_URL[] = "https://YOUR-SERVICE.onrender.com/api/iot/telemetry";
static const char DEVICE_KEY[] = "YOUR_IOT_API_KEY_FROM_RENDER";
static const char DEVICE_ID[] = "SM-001";
```

**الرابط الدقيق المطلوب هو رابط Render الحقيقي + `/api/iot/telemetry`**. لا تضع رابط الموقع وحده أو `/api/health` أو localhost أو عنوان الشبكة المنزلية. لا تضع `APP_PASSWORD` أو `TURSO_AUTH_TOKEN` داخل Wokwi.

7. اضغط تشغيل ▶. يتصل البرنامج بـ`Wokwi-GUEST` دون كلمة مرور ويزامن الوقت. انتظر Serial Monitor: `Telemetry HTTP 201` ثم `Accepted by database`.
8. في البداية المفتاحان يسار = لا اكتشاف. حرك المفتاحين يمين: الأول اضطراب الماء والثاني تأكيد الحساس. يبقى `waterDetected=true` طالما كلاهما يمين. احتفظ بوضع المفتاح حتى يصل HTTP 201، خصوصًا في التشغيل البارد.
9. شاهد التنبيه على الهاتف خلال دورة التحديث. حرّك مقبض البطارية لتغيير النسبة في العينة التالية.
10. تحقق من التنبيه، ثم أعد أحد المفتاحين يسار حتى تُقبل عينة جافة. أعدهما يمين لإرسال حدث جديد.

المحاكاة ترسل كل 20 ثانية أو عند تغيّر حالة الاكتشاف؛ الطلب الفاشل يعاد بنفس المعرّف بعد انتظار 10 ثوانٍ. لا توجد بوابة محلية ولا port forwarding ولا ngrok. [شبكة Wokwi وبوابته العامة](https://docs.wokwi.com/guides/esp32-wifi).

مشاريع Wokwi المشتركة قد تكشف `DEVICE_KEY`؛ استخدم مفتاح عرض مخصصًا وغيّره في Render وبعده Wokwi إذا شاركت المشروع. لا تحفظه في GitHub. عند إغلاق تبويب المحاكاة تتوقف الحساسات الافتراضية فقط؛ **الموقع والخادم والقاعدة يواصلون العمل دون جهاز Windows**. يمكن تشغيل المحاكاة في متصفح آخر أو توصيل ESP32 حقيقي لاحقًا.

## 8. إثبات الاستمرارية دون جهازك

1. غيّر اسم المسبح وأضف جهة اتصال اختبار، ثم أنشئ تنبيهًا وتحقق منه.
2. في Render اختر **Manual Deploy → Deploy latest commit** وانتظر Live.
3. افتح الهاتف من بيانات الجوال وسجّل الدخول إن احتاج. يجب بقاء الاسم وجهة الاتصال والسجل. هذا يثبت أن البيانات ليست في قرص Render المؤقت.
4. أطفئ جهاز Windows. افتح الموقع و`/api/health` من الهاتف. لا تحتاج تشغيل `npm start` محليًا.
5. إذا أردت قياسات جديدة أثناء إطفاء Windows، شغّل Wokwi من جهاز آخر؛ إغلاق متصفح المحاكي يوقف القياسات.

## 9. التشغيل المحلي والصيانة

```powershell
Copy-Item .env.example .env
npm ci
npm start
```

افتح `http://localhost:5173` للتطوير فقط. المحلي يستخدم `data/monitor.sqlite` إذا تركت متغيرات Turso فارغة. يمكن إضافة كلمات المرور محليًا لاختبار الدخول. `npm run db:backup` ينسخ SQLite المحلي فقط، وليس Turso. احتفظ بنسخ/تصديرات Turso من أدواته عند الحاجة، ولا تفترض أن وجود تخزين دائم يعوّض النسخ الاحتياطي.

استكشاف الأخطاء:

| الحالة | التصحيح |
|---|---|
| أول طلب بطيء | انتظر استيقاظ Render ثم أعد المحاولة؛ لا تفترض فقدان البيانات |
| 401 telemetry | طابق DEVICE_KEY مع IOT_API_KEY، وليس كلمة مرور اللوحة |
| 403 telemetry | DEVICE_ID يجب أن يكون SM-001، واستعمل النطاق المضبوط |
| 400 telemetry | راجع JSON، ساعة NTP، battery 0–100، rssi عدد صحيح -120–0 |
| 409 telemetry | أُعيد استخدام sampleId لبيانات مختلفة؛ أنشئ معرّفًا جديدًا |
| 429 | قلل الإرسال؛ الحد 120 عينة/دقيقة للخدمة، وانتظر دقيقة |
| 503 أو فشل بدء الخدمة | راجع رمز Turso وعنوانه والحصص وسجل Render |
| خطأ TLS في Wokwi | أعد توليد root_ca.h وتحقق من NTP والنطاق، دون تعطيل التحقق |
| لا تنبيه جديد | فعّل المراقبة، تحقق من التنبيه القديم وأرسل false ثم true |
| الجهاز غير متصل | لم تصل قراءة حديثة خلال 90 ثانية؛ شغّل المحاكاة وافحص Serial |
| الهاتف لا يصدر صوتًا | افتح الصفحة وفعّل السماعة؛ قيود المتصفح قد تمنع الخلفية/قفل الشاشة |

الواجهة لا تتصل بقاعدة البيانات مباشرة، ولا يوجد مفتاح سري في `dist/`. جميع بيانات التطبيق في Turso؛ الإعدادات والحصص المجانية تبقى خاضعة لحساباتك لدى المزودين.
