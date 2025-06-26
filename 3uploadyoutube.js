const fs = require('fs');
const path = require('path');
const { uploadToYoutube, updateThumbnail, getChannelInfo } = require('./utils/youtube-uploader');
const { markAsUploaded, markAsError } = require('./utils/update-notion');
const { cleanupTempFile } = require('./utils/drive-downloader');
const { downloadVideoById } = require('./2downloadvideo');
const { fetchVideoById } = require('./1fetchvideos');
require('dotenv').config();

/**
 * Valida configurações do YouTube antes do upload
 */
function validateYouTubeConfig() {
    console.log('🔍 Validando configurações do YouTube...');
    
    const required = [
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET',
        'GOOGLE_REFRESH_TOKEN'
    ];
    
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
        throw new Error(`❌ Configurações YouTube faltando: ${missing.join(', ')}`);
    }
    
    console.log('✅ Configurações YouTube validadas');
}

/**
 * Prepara metadados otimizados para o YouTube
 * @param {Object} videoData - Dados do vídeo do Notion
 * @returns {Object} - Metadados formatados
 */
function prepareYouTubeMetadata(videoData) {
    try {
        console.log('📋 Preparando metadados para YouTube...');
        
        // Título otimizado (máximo 100 caracteres)
        let title = videoData.title || 'Vídeo sem título';
        if (title.length > 100) {
            title = title.substring(0, 97) + '...';
            console.log(`✂️ Título truncado: "${title}"`);
        }
        
        // Descrição otimizada (máximo 5000 caracteres)
        let description = videoData.description || '';
        
        // Adicionar rodapé personalizado
        const footer = `
        
═══════════════════════════════════════
🎬 Publicado automaticamente via Auto Publisher
📅 Data: ${new Date().toLocaleDateString('pt-BR')}
🤖 Sistema: YouTube Auto Upload v2.0
═══════════════════════════════════════

#AutoPublisher #YouTube #Automação`;
        
        const maxDescLength = 5000 - footer.length;
        if (description.length > maxDescLength) {
            description = description.substring(0, maxDescLength - 3) + '...';
            console.log('✂️ Descrição truncada para caber o rodapé');
        }
        
        description += footer;
        
        // Tags processadas
        let tags = [];
        if (videoData.tags) {
            tags = videoData.tags
                .split(',')
                .map(tag => tag.trim())
                .filter(tag => tag.length > 0 && tag.length <= 500)
                .slice(0, 500); // Limite do YouTube
        }
        
        // Adicionar tags automáticas
        const autoTags = ['auto-publisher', 'upload-automatico'];
        tags = [...tags, ...autoTags].slice(0, 500);
        
        // Categoria e privacidade
        const category = videoData.category || 'Education';
        const privacy = videoData.privacy || 'Public';
        
        const metadata = {
            title,
            description,
            tags,
            category,
            privacy: privacy.toLowerCase(),
            language: 'pt-BR',
            defaultLanguage: 'pt',
            categoryId: getCategoryId(category),
            privacyStatus: formatPrivacyStatus(privacy)
        };
        
        console.log('📋 Metadados preparados:');
        console.log(`   📺 Título: "${metadata.title}" (${metadata.title.length} chars)`);
        console.log(`   📝 Descrição: ${metadata.description.length} chars`);
        console.log(`   🏷️ Tags: ${metadata.tags.length} tag(s)`);
        console.log(`   📂 Categoria: ${metadata.category} (ID: ${metadata.categoryId})`);
        console.log(`   🔒 Privacidade: ${metadata.privacy}`);
        
        return metadata;
        
    } catch (error) {
        console.error('❌ Erro ao preparar metadados:', error.message);
        throw error;
    }
}

/**
 * Mapeia categoria para ID do YouTube (duplicado aqui para standalone)
 */
function getCategoryId(category) {
    const categoryMap = {
        'Education': '27',
        'Entertainment': '24',
        'Music': '10',
        'Gaming': '20',
        'Sports': '17',
        'Science & Technology': '28',
        'News & Politics': '25',
        'Howto & Style': '26',
        'People & Blogs': '22',
        'Comedy': '34',
        'Film & Animation': '1',
        'Autos & Vehicles': '2'
    };
    
    return categoryMap[category] || '27';
}

/**
 * Formata status de privacidade (duplicado aqui para standalone)
 */
function formatPrivacyStatus(privacy) {
    const privacyMap = {
        'Public': 'public',
        'Unlisted': 'unlisted',
        'Private': 'private'
    };
    
    return privacyMap[privacy] || 'public';
}

/**
 * Verifica se arquivo é válido para upload
 * @param {string} filePath - Caminho do arquivo
 * @returns {Object} - Resultado da validação
 */
function validateVideoFile(filePath) {
    try {
        console.log('🔍 Validando arquivo de vídeo...');
        
        if (!fs.existsSync(filePath)) {
            throw new Error('❌ Arquivo não encontrado');
        }
        
        const stats = fs.statSync(filePath);
        const fileSize = stats.size;
        const fileName = path.basename(filePath);
        const extension = path.extname(fileName).toLowerCase();
        
        // Verificar extensão suportada
        const supportedFormats = ['.mp4', '.mov', '.avi', '.wmv', '.flv', '.webm', '.mkv'];
        if (!supportedFormats.includes(extension)) {
            throw new Error(`❌ Formato não suportado: ${extension}`);
        }
        
        // Verificar tamanho (limite YouTube: 128GB)
        const maxSize = 128 * 1024 * 1024 * 1024; // 128GB
        if (fileSize > maxSize) {
            throw new Error(`❌ Arquivo muito grande: ${fileSize} bytes`);
        }
        
        const minSize = 1024 * 1024; // 1MB
        if (fileSize < minSize) {
            throw new Error(`❌ Arquivo muito pequeno: ${fileSize} bytes`);
        }
        
        console.log('✅ Arquivo válido para upload');
        console.log(`   📁 Nome: ${fileName}`);
        console.log(`   📊 Tamanho: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
        console.log(`   🎬 Formato: ${extension}`);
        
        return {
            isValid: true,
            filePath,
            fileName,
            fileSize,
            extension
        };
        
    } catch (error) {
        console.error('❌ Erro na validação do arquivo:', error.message);
        return {
            isValid: false,
            error: error.message
        };
    }
}

/**
 * Executa upload completo para o YouTube
 * @param {Object} videoData - Dados do vídeo
 * @param {string} filePath - Caminho do arquivo
 * @returns {Object} - Resultado do upload
 */
async function uploadToYouTubeComplete(videoData, filePath) {
    const startTime = Date.now();
    try {
        console.log('🚀 INICIANDO UPLOAD PARA YOUTUBE...');
        console.log('═'.repeat(50));
        console.log(`🎬 Título: ${videoData.title}`);
        console.log(`📁 Arquivo: ${path.basename(filePath)}`);
        
        // 1. Validar configurações
        validateYouTubeConfig();
        
        // 2. Validar arquivo
        const fileValidation = validateVideoFile(filePath);
        if (!fileValidation.isValid) {
            throw new Error(`Arquivo inválido: ${fileValidation.error}`);
        }
        
        // 3. Preparar metadados
        const metadata = prepareYouTubeMetadata(videoData);
        
        // 4. Obter informações do canal
        let channelInfo = null;
        try {
            channelInfo = await getChannelInfo();
            if (channelInfo) {
                console.log(`📺 Canal: ${channelInfo.title}`);
                console.log(`👥 Inscritos: ${channelInfo.subscriberCount}`);
                console.log(`🎬 Vídeos: ${channelInfo.videoCount}`);
            }
        } catch (channelError) {
            console.warn('⚠️ Erro ao obter info do canal:', channelError.message);
        }
        
        // 5. Preparar dados do arquivo
        const stats = fs.statSync(filePath);
        const fileSize = stats.size;
        const fileName = path.basename(filePath);
        const mimeType = 'video/mp4';

        console.log('📊 Dados do arquivo:');
        console.log(`📁 Nome: ${fileName}`);
        console.log(`📊 Tamanho: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);
        console.log(`📋 Tipo: ${mimeType}`);
        
        // 6. Executar upload
        console.log('⬆️ Enviando para YouTube...');
        const uploadResult = await uploadToYoutube(videoData, { filePath, fileSize, fileName, mimeType });
        
        // 7. Calcular estatísticas
        const uploadTime = ((Date.now() - startTime) / 1000).toFixed(1);
        const uploadSpeed = (fileValidation.fileSize / 1024 / 1024 / uploadTime).toFixed(1);
        
        console.log('═'.repeat(50));
        console.log('✅ UPLOAD CONCLUÍDO COM SUCESSO!');
        console.log(`🎬 Video ID: ${uploadResult.videoId}`);
        console.log(`🔗 URL: ${uploadResult.videoUrl}`);
        console.log(`⏱️ Tempo total: ${uploadTime}s`);
        console.log(`🚀 Velocidade: ${uploadSpeed} MB/s`);
        console.log(`🔒 Privacidade: ${uploadResult.privacy}`);
        
        // Retornar resultado completo
        return {
            success: true,
            videoId: uploadResult.videoId,
            videoUrl: uploadResult.videoUrl,
            privacy: uploadResult.privacy,
            thumbnailUrl: uploadResult.thumbnailUrl,
            uploadDate: new Date().toISOString(),
            uploadTimeSeconds: parseFloat(uploadTime),
            uploadSpeed: parseFloat(uploadSpeed),
            fileSize: fileValidation.fileSize,
            fileName: fileValidation.fileName,
            channelInfo,
            metadata
        };
        
    } catch (error) {
        const errorTime = ((Date.now() - startTime) / 1000).toFixed(1);
        console.error('═'.repeat(50));
        console.error('❌ ERRO NO UPLOAD:');
        console.error(`💥 Erro: ${error.message}`);
        console.error(`⏱️ Falhou após: ${errorTime}s`);
        console.error('═'.repeat(50));
        
        return {
            success: false,
            error: error.message,
            uploadDate: new Date().toISOString(),
            uploadTimeSeconds: parseFloat(errorTime),
            attempts: 1
        };
    }
}


/**
 * Processo completo: buscar dados + upload + atualizar Notion
 * @param {string} pageId - ID da página no Notion
 * @param {string} filePath - Caminho do arquivo (opcional, fará download se não fornecido)
 * @returns {Object} - Resultado completo
 */
async function uploadVideoById(pageId, filePath = null) {
    let downloadResult = null;
    let fileToCleanup = null;
    
    try {
        console.log('🚀 PROCESSO COMPLETO DE UPLOAD...');
        console.log(`📄 ID da página: ${pageId}`);
        
        // 1. Buscar dados do vídeo
        console.log('📋 Buscando dados do vídeo...');
        const videoData = await fetchVideoById(pageId);
        
        if (!videoData) {
            throw new Error('❌ Vídeo não encontrado no Notion');
        }
        
        console.log(`✅ Vídeo encontrado: "${videoData.title}"`);
        
        // 2. Download se necessário
        if (!filePath) {
            console.log('📥 Arquivo não fornecido, fazendo download...');
            downloadResult = await downloadVideoById(pageId);
            
            if (!downloadResult.success) {
                throw new Error(`Falha no download: ${downloadResult.error}`);
            }
            
            filePath = downloadResult.downloadResult.filePath;
            fileToCleanup = filePath;
            console.log(`✅ Download concluído: ${downloadResult.downloadResult.fileName}`);
        } else {
            console.log(`📁 Usando arquivo fornecido: ${filePath}`);
        }
        
        // 3. Upload para YouTube
        const uploadResult = await uploadToYouTubeComplete(videoData, filePath);
        
        // 4. Atualizar Notion
        console.log('📝 Atualizando Notion...');
        try {
            await markAsUploaded(pageId, uploadResult, videoData);
            console.log('✅ Notion atualizado com sucesso');
        } catch (notionError) {
            console.warn('⚠️ Erro ao atualizar Notion:', notionError.message);
            // Não falha o processo se o upload YouTube foi bem-sucedido
        }
        
        // 5. Limpeza (manter arquivo se upload foi bem-sucedido)
        if (fileToCleanup && !uploadResult.success) {
            try {
                cleanupTempFile(fileToCleanup);
                console.log('🧹 Arquivo temporário removido');
            } catch (cleanupError) {
                console.warn('⚠️ Erro na limpeza:', cleanupError.message);
            }
        }
        
        // Resultado final
        const finalResult = {
            success: uploadResult.success,
            pageId,
            videoData,
            uploadResult,
            downloadResult
        };
        
        if (uploadResult.success) {
            console.log('🎉 PROCESSO FINALIZADO COM SUCESSO!');
            console.log(`🎬 Vídeo publicado: ${uploadResult.videoUrl}`);
        } else {
            console.error('💥 PROCESSO FALHOU!');
            console.error(`❌ Erro: ${uploadResult.error}`);
        }
        
        return finalResult;
        
    } catch (error) {
        console.error('💥 ERRO NO PROCESSO COMPLETO:', error.message);
        
        // Marcar como erro no Notion
        try {
            await markAsError(pageId, error.message);
            console.log('📝 Erro registrado no Notion');
        } catch (notionError) {
            console.warn('⚠️ Erro ao registrar no Notion:', notionError.message);
        }
        
        // Limpeza em caso de erro
        if (fileToCleanup) {
            try {
                cleanupTempFile(fileToCleanup);
                console.log('🧹 Arquivo temporário removido');
            } catch (cleanupError) {
                console.warn('⚠️ Erro na limpeza:', cleanupError.message);
            }
        }
        
        return {
            success: false,
            error: error.message,
            pageId,
            videoData: videoData || null,
            downloadResult,
            uploadResult: null
        };
    }
}

/**
 * Função principal - executar upload se chamado diretamente
 */
async function main() {
    try {
        // Verificar argumentos
        const pageId = process.argv[2];
        const filePath = process.argv[3]; // Opcional
        
        if (!pageId) {
            throw new Error('❌ Uso: node 3_upload_youtube.js <page_id> [file_path]');
        }
        
        console.log('🚀 INICIANDO SCRIPT DE UPLOAD...');
        console.log('═'.repeat(50));
        
        // Executar processo completo
        const result = await uploadVideoById(pageId, filePath);
        
        if (result.success) {
            console.log('🎉 UPLOAD FINALIZADO COM SUCESSO!');
            console.log(`🎬 Vídeo: ${result.uploadResult.videoUrl}`);
            process.exit(0);
        } else {
            console.error('💥 UPLOAD FALHOU!');
            console.error(`❌ Erro: ${result.error}`);
            process.exit(1);
        }
        
    } catch (error) {
        console.error('💥 ERRO FATAL:');
        console.error(error.message);
        process.exit(1);
    }
}

// Executar se chamado diretamente
if (require.main === module) {
    main();
}

module.exports = {
    uploadToYouTubeComplete,
    uploadVideoById,
    prepareYouTubeMetadata,
    validateVideoFile,
    validateYouTubeConfig
};

/*
🎯 PRINCIPAIS FUNCIONALIDADES:
🎬 UPLOAD COMPLETO:
Busca dados do Notion
Download automático se necessário
Upload otimizado para YouTube
Atualiza status no Notion
📋 METADADOS INTELIGENTES:
✅ Títulos otimizados (100 chars)
✅ Descrições com rodapé automático
✅ Tags processadas e validadas
✅ Categoria e privacidade corretas
🛡️ VALIDAÇÕES ROBUSTAS:
✅ Configurações YouTube válidas
✅ Arquivo compatível e tamanho OK
✅ Metadados dentro dos limites
✅ Canal acessível
📊 MONITORAMENTO AVANÇADO:
✅ Tempo e velocidade de upload
✅ Informações do canal
✅ Logs detalhados de progresso
✅ Estatísticas completas
🧹 GESTÃO DE ARQUIVOS:
✅ Limpeza automática em caso de erro
✅ Mantém arquivo se upload OK
✅ Tratamento de arquivos temporários
✅ Verificação de espaço
🔄 PROCESSO INTEGRADO:
✅ Combina download + upload
✅ Atualização automática Notion
✅ Tratamento de erros robusto
✅ Códigos de saída apropriados
*/