const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== الإعدادات ====================
const GITHUB_TOKEN = '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';
const GITHUB_OWN = 'kaseral8800800-code';
const GITHUB_REPO = 'Ali';
const GITHUB_PATH = 'codes.json';
const GITHUB_BRANCH = 'main';

app.use(cors());
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== الصفحة الرئيسية ====================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== جلب الأكواد ====================
app.get('/api/codes', async (req, res) => {
    try {
        const response = await axios.get(
            `https://api.github.com/repos/${GITHUB_OWN}/${GITHUB_REPO}/contents/${GITHUB_PATH}`,
            {
                headers: {
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Cache-Control': 'no-cache'
                }
            }
        );
        const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
        const codesData = JSON.parse(content);
        res.json({ success: true, codes: codesData.codes, sha: response.data.sha });
    } catch (error) {
        console.error('خطأ:', error.message);
        res.status(500).json({ success: false, message: '❌ فشل الاتصال بـ GitHub' });
    }
});

// ==================== التحقق من الكود وتفعيله ====================
app.post('/api/verify', async (req, res) => {
    try {
        const { code, device } = req.body;

        if (!code || code.length < 4) {
            return res.json({ success: false, message: '❌ الرجاء إدخال كود صحيح', type: 'invalid' });
        }

        // جلب الأكواد من GitHub
        const getResponse = await axios.get(
            `https://api.github.com/repos/${GITHUB_OWN}/${GITHUB_REPO}/contents/${GITHUB_PATH}`,
            {
                headers: {
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Cache-Control': 'no-cache'
                }
            }
        );

        const currentContent = Buffer.from(getResponse.data.content, 'base64').toString('utf-8');
        const codesData = JSON.parse(currentContent);
        const sha = getResponse.data.sha;

        // البحث عن الكود
        const codeIndex = codesData.codes.findIndex(c => c.code === code.toUpperCase());

        // 1. الكود غير موجود
        if (codeIndex === -1) {
            return res.json({
                success: false,
                message: '❌ الكود غير صحيح!\n\n📞 تواصل مع المشرف للحصول على كود جديد.',
                type: 'not_found'
            });
        }

        const codeData = codesData.codes[codeIndex];

        // 2. التحقق من الحظر
        if (codeData.blocked) {
            return res.json({
                success: false,
                message: `🚫 تم حظر هذا الكود!\n\n👤 الاسم: ${codeData.name}\n📅 تاريخ الحظر: ${codeData.blockedDate || 'غير معروف'}\n\n📞 للاستفسار تواصل مع المشرف.`,
                type: 'blocked'
            });
        }

        // 3. التحقق من تاريخ الانتهاء
        if (codeData.expiryDate) {
            const now = new Date();
            const expiryDate = new Date(codeData.expiryDate);
            if (now > expiryDate) {
                const daysAgo = Math.floor((now - expiryDate) / (1000 * 60 * 60 * 24));
                return res.json({
                    success: false,
                    message: `⏰ انتهت صلاحية الكود منذ ${daysAgo} يوم\n📅 تاريخ الانتهاء: ${expiryDate.toLocaleDateString('ar-SY')}\n\n📞 تواصل مع المشرف للحصول على كود جديد.`,
                    type: 'expired'
                });
            }
        }

        // 4. التحقق من عدد الأجهزة
        if (codeData.maxDevices && codeData.devices && device) {
            if (codeData.devices.length >= codeData.maxDevices && !codeData.devices.includes(device)) {
                return res.json({
                    success: false,
                    message: `📱 تم تجاوز عدد الأجهزة المسموح بها (${codeData.maxDevices})\n\n📞 تواصل مع المشرف.`,
                    type: 'device_limit'
                });
            }
        }

        // ✅ الكود صالح - تحديث البيانات
        codesData.codes[codeIndex].used = true;
        codesData.codes[codeIndex].activatedDate = codesData.codes[codeIndex].activatedDate || new Date().toISOString();
        codesData.codes[codeIndex].lastAccess = new Date().toISOString();
        codesData.codes[codeIndex].accessCount = (codesData.codes[codeIndex].accessCount || 0) + 1;

        // إضافة الجهاز
        if (device) {
            if (!codesData.codes[codeIndex].devices) {
                codesData.codes[codeIndex].devices = [];
            }
            if (!codesData.codes[codeIndex].devices.includes(device)) {
                codesData.codes[codeIndex].devices.push(device);
            }
        }

        // حفظ التحديثات على GitHub
        const updatedContent = Buffer.from(JSON.stringify(codesData, null, 2)).toString('base64');

        await axios.put(
            `https://api.github.com/repos/${GITHUB_OWN}/${GITHUB_REPO}/contents/${GITHUB_PATH}`,
            {
                message: `✅ تفعيل: ${code.toUpperCase()} - ${codeData.name}`,
                content: updatedContent,
                sha: sha,
                branch: GITHUB_BRANCH
            },
            {
                headers: {
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            }
        );

        // حساب الأيام المتبقية
        let remainingDays = 'غير محدد';
        if (codeData.expiryDate) {
            const expiry = new Date(codeData.expiryDate);
            const now = new Date();
            const diff = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
            remainingDays = diff > 0 ? `${diff} يوم` : 'منتهي';
        }

        res.json({
            success: true,
            message: `✅ أهلاً ${codeData.name}!\n📍 ${codeData.city}\n📚 ${codeData.grade}\n⏰ الصلاحية: ${remainingDays}\n🔢 الأجهزة: ${codesData.codes[codeIndex].devices.length}/${codeData.maxDevices || '∞'}`,
            name: codeData.name,
            city: codeData.city,
            grade: codeData.grade,
            type: 'success'
        });

    } catch (error) {
        console.error('خطأ:', error.message);
        res.status(500).json({
            success: false,
            message: '❌ فشل الاتصال بالخادم. حاول لاحقاً.',
            type: 'error'
        });
    }
});

// ==================== تشغيل السيرفر ====================
app.listen(PORT, () => {
    console.log('🚀 السيرفر يعمل على: http://localhost:' + PORT);
    console.log('📁 الملفات من مجلد: ' + path.join(__dirname, 'public'));
});
