# المراقب الذكي — Smart Monitor

واجهة عربية متجاوبة للجوال وسطح المكتب، مع Node.js API وقاعدة بيانات دائمة واستقبال قراءات ESP32.

ابدأ من [DEPLOYMENT.md](DEPLOYMENT.md) لنشر التطبيق كاملًا على **Render + Turso Cloud**. هذا التسليم جاهز للإعداد، وليس إعلانًا عن نشر عام تم إنجازه.

## التشغيل المحلي

يتطلب Node.js 24.14 أو أحدث؛ الإصدار المستهدف 24.19.

```powershell
npm ci
Copy-Item .env.example .env
npm start
```

افتح `http://localhost:5173`. استخدم هذا العنوان للتطوير فقط. لا حاجة لأداة بناء للواجهة؛ ملفات `dist/` هي الواجهة الحالية المحفوظة. قاعدة التطوير SQLite في `data/monitor.sqlite`. الموقع يفتح مباشرة دون كلمة مرور. إضافة IOT_API_KEY تفعّل استقبال القياسات.

## الإنتاج

- Render Node Web Service يخدم الواجهة وAPI على نفس HTTPS domain.
- Turso Cloud **libSQL** يخزن البيانات خارج قرص Render المؤقت. يرفض التطبيق وضع production بدون القاعدة والمفاتيح المطلوبة.
- Wokwi يرسل إلى `https://YOUR-SERVICE.onrender.com/api/iot/telemetry`.
- الواجهة تحدّث البيانات كل 5 ثوانٍ أثناء ظهور الصفحة وتعرض التنبيه دون تحديث يدوي.
- الأسماء والإعدادات والجهات والسجل محفوظة، مع منع الكتابات المتعارضة وإعادة إرسال القياسات المكررة.
- التنبيه على الهاتف داخل الصفحة المفتوحة؛ لا يوجد Web Push عند الإغلاق أو SMS. جهات الاتصال وتفضيل التصعيد محفوظة فقط.

## الأوامر

| الأمر | الغرض |
|---|---|
| `npm run build` | فحص JavaScript وتجهيز الأصول الموجودة للنشر |
| `npm start` | تشغيل Node وقراءة .env إن وجد |
| `npm test` | اختبارات API والبيانات والإنتاج والترحيلات |
| `npm run secrets` | توليد مفتاح IoT جديد، تحفظها بشكل خاص |
| `npm run db:backup` | نسخ SQLite المحلي |
| `npm run db:upload` | نقل قاعدة محلية إلى Turso فارغة دون تغيير الأصل |
| `npm run iot:certificate -- https://YOUR-SERVICE.onrender.com` | استخراج CA موثوقة لبرنامج ESP32 |
| `npm run verify:deployment -- --write-test-alert` | اختبار HTTPS عام بعد إعداد حساباتك؛ ينشئ تنبيهًا تجريبيًا |

راجع [DATABASE.md](DATABASE.md)، [Wokwi](wokwi/README.md)، [TEST-REPORT.md](TEST-REPORT.md).
