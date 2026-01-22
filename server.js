require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');
const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');

const app = express();
const PORT = process.env.PORT || 10000;

const connection = new IORedis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null 
});

const tryonQueue = new Queue('tryon-queue', { connection });

app.use(cors({ origin: '*' })); 
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

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

// GÜNCELLENMİŞ WORKER (SEGMIND İÇİN)
const worker = new Worker('tryon-queue', async (job) => {
    const { userImageBase64, dressImageUrl } = job.data;
    
    // Gelinlik URL ise Base64'e çevir
    let dressBase64 = dressImageUrl;
    if (dressImageUrl.startsWith('http')) {
        const imgRes = await axios.get(dressImageUrl, { responseType: 'arraybuffer' });
        dressBase64 = Buffer.from(imgRes.data).toString('base64');
    }

    // Segmind API
    const response = await axios.post('https://api.segmind.com/v1/idm-vton', {
        category: 'dresses',
        garment_img: dressBase64,
        human_img: userImageBase64,
        garment_des: "wedding dress",
        nsfw_filter: true
    }, {
        headers: { 'x-api-key': process.env.SEGMIND_API_KEY },
        responseType: 'arraybuffer' // Resim verisi olarak alacağız
    });

    // Gelen binary veriyi Base64 URL'e çevir
    const base64Image = Buffer.from(response.data, 'binary').toString('base64');
    const finalUrl = `data:image/jpeg;base64,${base64Image}`;

    return { output: [finalUrl] };
}, { connection });

app.get('/api/status/:jobId', async (req, res) => {
    const job = await tryonQueue.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ state: 'not_found' });
    const state = await job.getState();
    const result = job.returnvalue;
    res.json({ state, result });
});

app.listen(PORT, () => console.log(`🚀 Server çalışıyor...`));
