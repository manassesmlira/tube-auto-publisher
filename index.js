const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3333;
const API_SECRET = process.env.API_SECRET || 'pregadormanasses2025';

// Middleware
app.use(cors());
app.use(express.json());

// Função para autenticar API Key
function authenticateApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'] || req.query.secret;
    if (!apiKey || apiKey !== API_SECRET) {
        return res.status(401).json({ 
            erro: 'Não autorizado!',
            timestamp: new Date().toISOString() 
        });
    }
    next();
}

// Função para registrar logs
function logAction(action, status = 'Success', details = '') {
    try {
        const timestamp = new Date().toISOString();
        const logEntry = `${timestamp} - ${action} - ${status}${details ? ' - ' + details : ''}\n`;
        
        fs.appendFileSync('auto-publisher-log.txt', logEntry);
        console.log(`📝 ${action}: ${status}`);
    } catch (error) {
        console.error('❌ Erro ao salvar log:', error.message);
    }
}

// Endpoint principal - Upload de vídeo
app.post('/upload-video', authenticateApiKey, async (req, res) => {
    try {
        console.log('🎬 Iniciando upload automático de vídeo...');
        logAction('UPLOAD_VIDEO_STARTED');

        // Importar scripts sequenciais
        const fetchVideos = require('./1_fetch_videos');
        const downloadVideo = require('./2_download_video');
        const uploadYoutube = require('./3_upload_youtube');
        const updateNotion = require('./4_update_notion');

        // Executar pipeline
        console.log('📋 1. Buscando vídeos pendentes no Notion...');
        const videoData = await fetchVideos();
        
        if (!videoData) {
            console.log('ℹ️ Nenhum vídeo pendente encontrado');
            logAction('NO_PENDING_VIDEOS');
            return res.json({
                success: true,
                message: 'Nenhum vídeo pendente para upload',
                timestamp: new Date().toISOString()
            });
        }

        console.log('📥 2. Baixando vídeo do Google Drive...');
        const videoFile = await downloadVideo(videoData);

        console.log('🚀 3. Fazendo upload para YouTube...');
        const youtubeResult = await uploadYoutube(videoData, videoFile);

        console.log('📝 4. Atualizando status no Notion...');
        await updateNotion(videoData.id, youtubeResult);

        console.log('✅ Upload concluído com sucesso!');
        logAction('UPLOAD_VIDEO_COMPLETED', 'Success', youtubeResult.videoUrl);

        res.json({
            success: true,
            message: 'Vídeo enviado com sucesso!',
            videoTitle: videoData.title,
            youtubeUrl: youtubeResult.videoUrl,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('❌ Erro no upload:', error.message);
        logAction('UPLOAD_VIDEO_ERROR', 'Error', error.message);
        
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint para verificar último upload
app.get('/status/last-upload', authenticateApiKey, (req, res) => {
    try {
        const logFile = 'auto-publisher-log.txt';
        
        if (!fs.existsSync(logFile)) {
            return res.json({
                upload_executed_recently: false,
                message: 'Nenhum log encontrado',
                timestamp: new Date().toISOString()
            });
        }

        const logs = fs.readFileSync(logFile, 'utf8');
        const lines = logs.trim().split('\n');
        
        // Procurar por upload bem-sucedido nas últimas 2 horas
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            if (line.includes('UPLOAD_VIDEO_COMPLETED - Success')) {
                const timestamp = line.split(' - ')[0];
                const logDate = new Date(timestamp);
                
                if (logDate > twoHoursAgo) {
                    return res.json({
                        upload_executed_recently: true,
                        last_upload: timestamp,
                        message: 'Upload executado recentemente',
                        timestamp: new Date().toISOString()
                    });
                }
            }
        }

        res.json({
            upload_executed_recently: false,
            message: 'Nenhum upload recente encontrado',
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        res.status(500).json({
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint de saúde
app.get('/health', (req, res) => {
    res.json({
        status: 'online',
        service: 'Auto Publisher - YouTube',
        timestamp: new Date().toISOString()
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 Auto Publisher rodando na porta ${PORT}`);
    console.log(`🎬 Canal: Pregador Manasses`);
    console.log(`⏰ Upload diário às 14h (horário de São Paulo)`);
    logAction('SERVER_STARTED');
});
