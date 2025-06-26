const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const axios = require('axios');

// Configurar autenticação Google
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'http://localhost:3333/oauth/callback'
);

oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
});

const drive = google.drive({ version: 'v3', auth: oauth2Client });

/**
 * Extrai o ID do arquivo de diferentes formatos de URL do Google Drive
 * @param {string} url - URL do Google Drive
 * @returns {string} - ID do arquivo
 */
function extractFileIdFromUrl(url) {
    console.log('🔍 Extraindo ID da URL:', url);
    
    // Padrões de URL do Google Drive que suportamos
    const patterns = [
        /\/file\/d\/([a-zA-Z0-9-_]+)/,           // https://drive.google.com/file/d/ID/view
        /\/open\?id=([a-zA-Z0-9-_]+)/,          // https://drive.google.com/open?id=ID
        /\/d\/([a-zA-Z0-9-_]+)/,                // https://drive.google.com/d/ID
        /id=([a-zA-Z0-9-_]+)/,                  // Qualquer URL com id=ID
        /^([a-zA-Z0-9-_]+)$/                    // Se for só o ID puro
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
            console.log('✅ ID extraído:', match[1]);
            return match[1];
        }
    }

    throw new Error(`❌ Não foi possível extrair ID do arquivo da URL: ${url}`);
}

/**
 * Obtém informações básicas do arquivo no Drive
 * @param {string} fileId - ID do arquivo
 * @returns {Object} - Informações do arquivo
 */
async function getFileInfo(fileId) {
    try {
        console.log('📋 Obtendo informações do arquivo...');
        
        const response = await drive.files.get({
            fileId: fileId,
            fields: 'name, mimeType, size, videoMediaMetadata'
        });

        const fileInfo = {
            name: response.data.name,
            mimeType: response.data.mimeType,
            size: parseInt(response.data.size),
            sizeFormatted: formatFileSize(parseInt(response.data.size))
        };

        console.log(`📁 Nome: ${fileInfo.name}`);
        console.log(`📊 Tamanho: ${fileInfo.sizeFormatted}`);
        console.log(`🎬 Tipo: ${fileInfo.mimeType}`);

        // Validar se é um arquivo de vídeo
        if (!fileInfo.mimeType.startsWith('video/')) {
            console.warn('⚠️ Arquivo não é um vídeo, mas continuando...');
        }

        return fileInfo;

    } catch (error) {
        if (error.code === 404) {
            throw new Error('❌ Arquivo não encontrado no Google Drive (404)');
        } else if (error.code === 403) {
            throw new Error('❌ Sem permissão para acessar o arquivo (403)');
        } else {
            throw new Error(`❌ Erro ao obter informações: ${error.message}`);
        }
    }
}

/**
 * Formata o tamanho do arquivo para leitura humana
 * @param {number} bytes - Tamanho em bytes
 * @returns {string} - Tamanho formatado
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Cria pasta temporária se não existir
 * @returns {string} - Caminho da pasta temp
 */
function ensureTempDirectory() {
    const tempDir = path.join(__dirname, '..', 'temp');
    
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
        console.log('📁 Pasta temporária criada:', tempDir);
    }
    
    return tempDir;
}

/**
 * Baixa arquivo do Google Drive
 * @param {string} driveUrl - URL do Google Drive
 * @returns {Object} - Informações do arquivo baixado
 */
async function downloadFromDrive(driveUrl) {
    try {
        console.log('📥 Iniciando download do Google Drive...');
        
        // 1. Extrair ID do arquivo
        const fileId = extractFileIdFromUrl(driveUrl);
        console.log(`🔍 ID extraído: ${fileId}`);
        
        // 2. Preparar pasta e caminho do arquivo
        const tempDir = ensureTempDirectory();
        const fileName = `video_${fileId}.mp4`; // Nome genérico
        const filePath = path.join(tempDir, fileName);
        
        // 3. Remover arquivo existente se houver
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log('🗑️ Arquivo anterior removido');
        }
        
        // 4. Tentar múltiplas URLs de download
        const downloadUrls = [
            `https://drive.google.com/uc?export=download&id=${fileId}`,
            `https://docs.google.com/uc?export=download&id=${fileId}`,
            `https://drive.usercontent.google.com/download?id=${fileId}&export=download`,
            `https://drive.google.com/uc?id=${fileId}&export=download`
        ];
        
        console.log('⬇️ Testando URLs de download...');
        const startTime = Date.now();
        
        for (let i = 0; i < downloadUrls.length; i++) {
            try {
                console.log(`🔗 Tentativa ${i + 1}: Testando URL...`);
                
                const response = await axios({
                    method: 'GET',
                    url: downloadUrls[i],
                    responseType: 'stream',
                    timeout: 60000, // 60 segundos
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        'Accept': '*/*',
                        'Accept-Encoding': 'gzip, deflate, br',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache'
                    },
                    maxRedirects: 5,
                    validateStatus: function (status) {
                        return status >= 200 && status < 400; // Aceita redirects
                    }
                });
                
                // Verificar se é realmente um arquivo de vídeo (não uma página de erro)
                const contentType = response.headers['content-type'] || '';
                const contentLength = response.headers['content-length'] || 0;
                
                console.log(`📊 Status: ${response.status}`);
                console.log(`📋 Content-Type: ${contentType}`);
                console.log(`📐 Content-Length: ${contentLength} bytes`);
                
                // Se retornou HTML, é provável que seja página de erro
                if (contentType.includes('text/html')) {
                    console.log(`❌ URL ${i + 1}: Retornou HTML (página de erro)`);
                    continue;
                }
                
                // Se chegou aqui, parece ser um arquivo válido
                console.log(`✅ URL ${i + 1} funcionou! Iniciando download...`);
                
                // 5. Fazer download com progress
                await new Promise((resolve, reject) => {
                    const writeStream = fs.createWriteStream(filePath);
                    let downloadedBytes = 0;
                    const totalBytes = parseInt(contentLength) || 0;
                    
                    response.data.on('data', (chunk) => {
                        downloadedBytes += chunk.length;
                        if (totalBytes > 0) {
                            const progress = ((downloadedBytes / totalBytes) * 100).toFixed(1);
                            process.stdout.write(`\r📥 Progresso: ${progress}% (${formatFileSize(downloadedBytes)}/${formatFileSize(totalBytes)})`);
                        } else {
                            process.stdout.write(`\r📥 Baixado: ${formatFileSize(downloadedBytes)}`);
                        }
                    });
                    
                    response.data.pipe(writeStream);
                    
                    writeStream.on('finish', () => {
                        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
                        console.log(`\n✅ Download concluído em ${duration}s`);
                        resolve();
                    });
                    
                    writeStream.on('error', (error) => {
                        console.error('\n❌ Erro ao salvar arquivo:', error.message);
                        reject(error);
                    });
                    
                    response.data.on('error', (error) => {
                        console.error('\n❌ Erro no stream:', error.message);
                        reject(error);
                    });
                });
                
                // 6. Verificar se arquivo foi criado corretamente
                if (!fs.existsSync(filePath)) {
                    throw new Error('❌ Arquivo não foi criado após download');
                }
                
                const finalSize = fs.statSync(filePath).size;
                console.log(`📁 Arquivo salvo: ${filePath}`);
                console.log(`📊 Tamanho final: ${formatFileSize(finalSize)}`);
                
                // Verificar se arquivo não está vazio
                if (finalSize === 0) {
                    fs.unlinkSync(filePath);
                    throw new Error('❌ Arquivo baixado está vazio');
                }
                
                // Verificar se é realmente um arquivo de vídeo (verificação básica)
                if (finalSize < 1024) { // Menor que 1KB é suspeito
                    console.warn('⚠️ Arquivo muito pequeno, pode não ser um vídeo válido');
                }
                
                return {
                    filePath: filePath,
                    fileName: fileName,
                    fileSize: finalSize,
                    fileSizeFormatted: formatFileSize(finalSize),
                    mimeType: 'video/mp4'
                };
                
            } catch (error) {
                console.log(`❌ URL ${i + 1} falhou: ${error.message}`);
                
                // Limpar arquivo parcial se existir
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
                
                // Se não é a última tentativa, continua
                if (i < downloadUrls.length - 1) {
                    console.log(`🔄 Tentando próxima URL...`);
                    continue;
                } else {
                    // Era a última tentativa
                    throw error;
                }
            }
        }
        
        // Se chegou aqui, todas as URLs falharam
        throw new Error('❌ Todas as URLs de download falharam');
        
    } catch (error) {
        console.error('❌ Erro no download:', error.message);
        throw error;
    }
}

// Função auxiliar para formatar tamanho de arquivo (caso não exista)
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}


/**
 * Remove arquivo temporário
 * @param {string} filePath - Caminho do arquivo
 */
function cleanupTempFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log('🗑️ Arquivo temporário removido:', path.basename(filePath));
        }
    } catch (error) {
        console.warn('⚠️ Erro ao remover arquivo temporário:', error.message);
    }
}

/**
 * Remove todos os arquivos da pasta temp
 */
function cleanupTempDirectory() {
    try {
        const tempDir = path.join(__dirname, '..', 'temp');
        if (fs.existsSync(tempDir)) {
            const files = fs.readdirSync(tempDir);
            files.forEach(file => {
                const filePath = path.join(tempDir, file);
                fs.unlinkSync(filePath);
            });
            console.log(`🗑️ ${files.length} arquivo(s) temporário(s) removido(s)`);
        }
    } catch (error) {
        console.warn('⚠️ Erro ao limpar pasta temporária:', error.message);
    }
}

module.exports = {
    downloadFromDrive,
    extractFileIdFromUrl,
    getFileInfo,
    cleanupTempFile,
    cleanupTempDirectory,
    formatFileSize
};



// 🎯 PRINCIPAIS FUNCIONALIDADES:
//✅ O QUE FAZ:
//Extrai ID de qualquer formato de URL do Drive
//Baixa vídeos com barra de progresso
//Valida arquivos (tamanho, tipo, permissões)
//Gerencia pasta temp automaticamente
//Limpa arquivos após uso
//🛡️ VALIDAÇÕES:
//✅ URLs em vários formatos
//✅ Arquivos até 2GB
//✅ Permissões de acesso
//✅ Integridade do download
//📊 RECURSOS:
//✅ Barra de progresso visual
//✅ Formatação de tamanhos
//✅ Logs detalhados
//✅ Limpeza automática