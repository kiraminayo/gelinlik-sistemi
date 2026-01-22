require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');

const app = express();
const PORT = process.env.PORT || 10000;

// Redis Bağlantısı (Sıra sistemi için şart)
// Render'da REDIS_URL environment variable olarak verilecek
const connection = new IORedis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null 
});

// İş Kuyruğu Oluştur
const tryonQueue = new Queue('tryon-queue', { connection });

app.use(cors({ origin: '*' })); 
app.use(express.json());

// Fotoğraf Yükleme Ayarı
const upload = multer({ storage: multer.memoryStorage() });

// 1. İSTEK KARŞILAMA
app.post('/api/queue-tryon', upload.single('userImage'), async (req, res) => {
    try {
        const { dressImageUrl } = req.body;
        if (!req.file || !dressImageUrl) return res.status(400).json({ error: 'Eksik veri.' });

        const job = await tryonQueue.add('process-tryon', {
            userImageBase64: req.file.buffer.toString('base64'),
            dressImageUrl: dressImageUrl
        });
        res.json({ jobId: job.id, status: 'queued' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

// 2. İŞLEYİCİ (Worker)
const worker = new Worker('tryon-queue', async (job) => {
    const { userImageBase64, dressImageUrl } = job.data;
    const response = await axios.post('https://api.fashn.ai/v1/run', {
        model_image: userImageBase64,
        garment_image: dressImageUrl,
        category: 'dresses',
        nsfw_filter: true
    }, {
        headers: { 
            'Authorization': `Bearer ${process.env.FASHN_API_KEY}`,
            'Content-Type': 'application/json'
        }
    });
    return response.data;
}, { connection });

// 3. DURUM SORGULAMA
app.get('/api/status/:jobId', async (req, res) => {
    const job = await tryonQueue.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ state: 'not_found' });
    const state = await job.getState();
    const result = job.returnvalue;
    res.json({ state, result });
});

app.listen(PORT, () => console.log(`🚀 Server çalışıyor...`));
